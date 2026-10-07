//! #506 — intercept macOS app termination so the webview's unsaved-changes
//! guard can veto it.
//!
//! tao 0.35 implements only `applicationWillTerminate:` on its app delegate,
//! and tauri-runtime-wry emits `RunEvent::ExitRequested` only when the last
//! window is destroyed or `app.exit()` is called — neither fires on Dock ▸
//! Quit or logout. So this module adds `applicationShouldTerminate:` to the
//! live delegate class at runtime (Objective-C `class_addMethod`), which is
//! the one hook macOS consults before terminating.
//!
//! The dance: when the OS asks to terminate and the webview guard is ready and
//! has not approved, the delegate returns `NSTerminateLater` and emits
//! [`QUIT_EVENT`]. The webview shows its unsaved-changes prompt and answers
//! with `monet_quit_exit` (approved) or `monet_quit_cancel` (declined); those
//! commands call `replyToApplicationShouldTerminate:` on the main thread to
//! let AppKit finish or abort the termination it is holding.
//!
//! One app per process, so module-level statics are enough.

use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
use objc2::ffi::NSUInteger;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyObject, Sel};
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplicationTerminateReply;

use tauri::Runtime;
#[cfg(target_os = "macos")]
use tauri::Emitter;

/// Tauri event the webview listens on to show its unsaved-changes prompt.
pub const QUIT_EVENT: &str = "monet://quit-requested";

/// The webview registered its [`QUIT_EVENT`] listener and can be asked.
static GUARD_READY: AtomicBool = AtomicBool::new(false);
/// The user approved quitting; a later termination request passes straight
/// through.
static APPROVED: AtomicBool = AtomicBool::new(false);
/// A native termination is parked in `NSTerminateLater`, awaiting the
/// webview's reply.
#[cfg(target_os = "macos")]
static TERMINATING_LATER: AtomicBool = AtomicBool::new(false);

/// Whether the delegate method has been added to the live class.
#[cfg(target_os = "macos")]
static INSTALLED: AtomicBool = AtomicBool::new(false);
/// Emits [`QUIT_EVENT`] to every window; set once by [`install`].
#[cfg(target_os = "macos")]
static EMITTER: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

/// Whether a termination request must be deferred to the webview guard rather
/// than allowed through: only when the guard is installed and has not already
/// approved. A missing guard never blocks quitting.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn should_intercept(ready: bool, approved: bool) -> bool {
    ready && !approved
}

// ─────────────────────────────────────────────────────────────
// Install — add applicationShouldTerminate: to the live delegate class
// ─────────────────────────────────────────────────────────────

/// Install the termination interceptor on the running app. Call once from
/// `setup`; a second call is a no-op.
///
/// On non-macOS this is a no-op: the platform has no equivalent veto hook, and
/// the webview's guard still drives `monet_quit_exit` → `app.exit(0)`.
#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use objc2::runtime::{AnyClass, ProtocolObject};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationDelegate};

    if INSTALLED.load(Ordering::SeqCst) {
        return Ok(());
    }

    // Store the emitter once; a retry after a nil delegate keeps the first.
    let _ = EMITTER.set(Box::new({
        let app = app.clone();
        move || {
            let _ = app.emit(QUIT_EVENT, ());
        }
    }));

    // Tauri's setup runs on the main thread; without a marker we cannot touch
    // AppKit, so leave INSTALLED false for a later call to retry.
    let Some(mtm) = MainThreadMarker::new() else {
        return Ok(());
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = ns_app.delegate() else {
        // tao sets the delegate when the event loop is created, before setup;
        // a nil delegate here means there is nothing to hook yet.
        return Ok(());
    };
    let delegate: &ProtocolObject<dyn NSApplicationDelegate> = &delegate;
    let any: &AnyObject = delegate.as_ref();
    let class = any.class();

    let sel = Sel::register(c"applicationShouldTerminate:");
    let imp: objc2::runtime::Imp = unsafe {
        std::mem::transmute(
            application_should_terminate
                as unsafe extern "C-unwind" fn(
                    *mut AnyObject,
                    Sel,
                    *mut AnyObject,
                ) -> NSUInteger,
        )
    };
    // NSApplicationTerminateReply (NSUInteger) ← self (@) ← _cmd (:) ← sender (@).
    let types = c"Q@:@";
    // `class_addMethod` returns false when the method already exists (a second
    // install, or a future tao adding one) — that is already-installed, not an
    // error.
    let _ = unsafe {
        objc2::ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            sel,
            imp,
            types.as_ptr(),
        )
    };
    INSTALLED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Non-macOS: nothing to intercept.
#[cfg(not(target_os = "macos"))]
pub fn install<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}

/// The `applicationShouldTerminate:` implementation added to tao's delegate
/// class. Runs on the main thread, as AppKit requires.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn application_should_terminate(
    _this: *mut AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> NSUInteger {
    if should_intercept(
        GUARD_READY.load(Ordering::SeqCst),
        APPROVED.load(Ordering::SeqCst),
    ) {
        TERMINATING_LATER.store(true, Ordering::SeqCst);
        if let Some(emit) = EMITTER.get() {
            emit();
        }
        NSApplicationTerminateReply::TerminateLater.0
    } else {
        NSApplicationTerminateReply::TerminateNow.0
    }
}

/// Let AppKit finish (`true`) or abort (`false`) the termination it parked in
/// `NSTerminateLater`. Must run on the main thread.
#[cfg(target_os = "macos")]
fn reply_to_termination<R: Runtime>(
    app: &tauri::AppHandle<R>,
    should_terminate: bool,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        if let Some(mtm) = MainThreadMarker::new() {
            NSApplication::sharedApplication(mtm)
                .replyToApplicationShouldTerminate(should_terminate);
        }
    })
}

// ─────────────────────────────────────────────────────────────
// Commands — the webview guard's side of the contract
// ─────────────────────────────────────────────────────────────

/// Webview → Rust: the unsaved-changes guard is installed and listening.
/// `invoke("monet_quit_guard_ready")`.
#[tauri::command]
pub(crate) fn monet_quit_guard_ready() {
    GUARD_READY.store(true, Ordering::SeqCst);
}

/// Webview → Rust: the user approved quitting. If a native termination is
/// pending, let AppKit finish it; otherwise exit directly.
/// `invoke("monet_quit_exit")`.
#[tauri::command]
pub(crate) fn monet_quit_exit<R: Runtime>(app: tauri::AppHandle<R>) -> tauri::Result<()> {
    APPROVED.store(true, Ordering::SeqCst);
    #[cfg(target_os = "macos")]
    if TERMINATING_LATER.swap(false, Ordering::SeqCst) {
        return reply_to_termination(&app, true);
    }
    app.exit(0);
    Ok(())
}

/// Webview → Rust: the user declined quitting. If a native termination is
/// pending, abort it; otherwise a harmless no-op (the non-native decline paths
/// call this too). `invoke("monet_quit_cancel")`.
#[tauri::command]
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub(crate) fn monet_quit_cancel<R: Runtime>(app: tauri::AppHandle<R>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if TERMINATING_LATER.swap(false, Ordering::SeqCst) {
        return reply_to_termination(&app, false);
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// Tests — pure helpers (no live Tauri app)
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intercepts_only_when_the_guard_is_ready_and_unapproved() {
        assert!(should_intercept(true, false));
        assert!(!should_intercept(false, false), "no guard must not block quit");
        assert!(!should_intercept(true, true), "approved must pass through");
        assert!(!should_intercept(false, true));
    }

    #[test]
    fn quit_event_name_is_stable() {
        assert_eq!(QUIT_EVENT, "monet://quit-requested");
    }
}
