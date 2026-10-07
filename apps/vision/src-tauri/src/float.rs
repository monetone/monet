//! Window ▸ Arrange ▸ Float in Window / Float All in Windows / Cascade (#477):
//! a document pulled out of the tab bar into its own OS window.
//!
//! Photoshop keeps one app with one set of panels, and a floating window is only
//! a document canvas — so the main webview stays the single owner of the Store
//! and the wasm engine. A float window (label `float-<doc>`) loads `float.html`,
//! a canvas and nothing else. Its pixels come from the main webview as raw
//! frames through here (`frame` → the float's `attach` channel, never JSON);
//! its pointer, key and text input goes back through `input` to the main
//! webview, which feeds it into the same canvas-view pipeline its own views
//! use. A float may emit no event of its own: that is how the main webview
//! trusts what reaches it on `monet://menu` and the MCP bridge.
//!
//! Bookkeeping lives here too: focusing a float tells the main webview to make
//! its document the active one, closing it hands the document back to the tab
//! bar, and closing the main window takes every float with it.
use std::collections::HashMap;
use std::sync::Mutex;

use monet_ui::{Accent, MenuMode, MonetWindow};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, RunEvent, Runtime, WebviewUrl, WindowEvent};

/// Rust → main webview: a float window took focus; payload is its document id.
const EV_FOCUS: &str = "monet://float/focus";
/// Rust → main webview: a float window is gone; its document goes back to the tabs.
const EV_CLOSED: &str = "monet://float/closed";
/// Rust → main webview: a float window's input, stamped with its document.
const EV_INPUT: &str = "monet://float/input";

/// Cascade's diagonal step between floats, in logical px, from the main
/// window's top-left.
const CASCADE_STEP: f64 = 28.0;

fn label(doc: u32) -> String {
    format!("float-{doc}")
}

/// The document a float window shows, from its label.
fn doc_of(label: &str) -> Option<u32> {
    label.strip_prefix("float-")?.parse().ok()
}

/// Where the `index`-th float sits: one step further down the diagonal each.
fn cascade_position(origin: (f64, f64), index: usize) -> (f64, f64) {
    let step = CASCADE_STEP * (index + 1) as f64;
    (origin.0 + step, origin.1 + step)
}

/// A frame as the float reads it: the eight header words (`doc, kind, docW,
/// docH, x, y, w, h`, from the main webview's `x-float-frame` header) as
/// little-endian u32, then the body. Built in the one copy the hand-over
/// needs anyway. The document id routes it.
fn frame_bytes(head: &str, body: &[u8]) -> Option<(u32, Vec<u8>)> {
    let words = head.split(',').map(|w| w.trim().parse::<u32>().ok()).collect::<Option<Vec<_>>>()?;
    if words.len() != 8 {
        return None;
    }
    let mut out = Vec::with_capacity(4 * words.len() + body.len());
    for word in &words {
        out.extend_from_slice(&word.to_le_bytes());
    }
    out.extend_from_slice(body);
    Some((words[0], out))
}

/// Each float's frame channel, by document id, while its window is up.
#[derive(Default)]
struct Floats(Mutex<HashMap<u32, Channel>>);

impl Floats {
    fn attach(&self, doc: u32, channel: Channel) {
        self.0.lock().expect("floats lock").insert(doc, channel);
    }

    fn detach(&self, doc: u32) {
        self.0.lock().expect("floats lock").remove(&doc);
    }

    /// Hand a frame to its float. False while that window isn't listening
    /// (still loading, or already closed): the main webview resends in full
    /// once it announces itself.
    fn send(&self, head: &str, body: &[u8]) -> Result<bool, String> {
        let (doc, frame) = frame_bytes(head, body).ok_or("a frame header is eight whole numbers")?;
        let channel = self.0.lock().expect("floats lock").get(&doc).cloned();
        match channel {
            Some(channel) => channel.send(InvokeResponseBody::Raw(frame)).map(|_| true).map_err(|e| e.to_string()),
            None => Ok(false),
        }
    }
}

/// The main window's top-left, the origin of the cascade.
fn cascade_origin<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    app.get_webview_window("main")
        .and_then(|w| Some(w.outer_position().ok()?.to_logical::<f64>(w.scale_factor().ok()?)))
        .map_or((0.0, 0.0), |p| (p.x, p.y))
}

/// Main webview: open (or bring forward) document `doc`'s float window, placed
/// `index` steps down the cascade.
#[tauri::command]
async fn open<R: Runtime>(app: AppHandle<R>, doc: u32, title: String, index: usize) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label(doc)) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let (x, y) = cascade_position(cascade_origin(&app), index);
    let window = MonetWindow::builder(&app, label(doc), WebviewUrl::App(format!("float.html?doc={doc}").into()))
        .title(title)
        .accent(Accent::Raster)
        .inner_size(900.0, 680.0)
        .min_inner_size(320.0, 240.0)
        // The app menu belongs to the main webview (it installs Photoshop's
        // menus); a float must not replace it, so every menu command keeps
        // reaching the main webview whichever window is focused.
        .menu(MenuMode::None)
        // Placement is Cascade's, not last session's.
        .remember_state(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    window.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Main webview: close document `doc`'s float window (its document stays open).
#[tauri::command]
fn close<R: Runtime>(app: AppHandle<R>, doc: u32) -> Result<(), String> {
    match app.get_webview_window(&label(doc)) {
        Some(window) => window.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Main webview: line the floats up down the diagonal, in `docs` order.
#[tauri::command]
fn cascade<R: Runtime>(app: AppHandle<R>, docs: Vec<u32>) -> Result<(), String> {
    let origin = cascade_origin(&app);
    for (index, doc) in docs.into_iter().enumerate() {
        if let Some(window) = app.get_webview_window(&label(doc)) {
            let (x, y) = cascade_position(origin, index);
            window.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Main webview: one frame for a float — its header in `x-float-frame`, its
/// body raw. Returns whether the float was listening.
#[tauri::command(async)]
fn frame(request: Request<'_>, floats: tauri::State<'_, Floats>) -> Result<bool, String> {
    let head = request.headers().get("x-float-frame").and_then(|v| v.to_str().ok()).ok_or("a frame names its header")?;
    match request.body() {
        InvokeBody::Raw(bytes) => floats.send(head, bytes),
        InvokeBody::Json(_) => Err("a frame is raw bytes".into()),
    }
}

/// A float's input, for the main webview, always under its own document.
fn stamped(doc: u32, mut input: serde_json::Value) -> Option<serde_json::Value> {
    input.as_object_mut()?.insert("doc".into(), doc.into());
    Some(input)
}

/// Float webview: its pointer, key and text input, forwarded to the main
/// webview (the only event a float can raise).
#[tauri::command]
fn input<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, event: serde_json::Value) -> Result<(), String> {
    let doc = doc_of(webview.label()).ok_or("only a float window sends input")?;
    let event = stamped(doc, event).ok_or("input is an object")?;
    app.emit_to("main", EV_INPUT, event).map_err(|e| e.to_string())
}

/// Float webview: receive frames on `channel`.
#[tauri::command]
fn attach<R: Runtime>(webview: tauri::Webview<R>, floats: tauri::State<'_, Floats>, channel: Channel) -> Result<(), String> {
    let doc = doc_of(webview.label()).ok_or("only a float window receives frames")?;
    floats.attach(doc, channel);
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("float")
        .setup(|app, _| {
            app.manage(Floats::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open, close, cascade, frame, attach, input])
        .on_event(|app, event| {
            let RunEvent::WindowEvent { label, event, .. } = event else { return };
            match (doc_of(label), event) {
                (Some(doc), WindowEvent::Focused(true)) => {
                    let _ = app.emit_to("main", EV_FOCUS, doc);
                }
                (Some(doc), WindowEvent::Destroyed) => {
                    app.state::<Floats>().detach(doc);
                    let _ = app.emit_to("main", EV_CLOSED, doc);
                }
                // Floats are views of the main window's documents: they go with it.
                (None, WindowEvent::Destroyed) if label == "main" => {
                    for (other, window) in app.webview_windows() {
                        if doc_of(&other).is_some() {
                            let _ = window.destroy();
                        }
                    }
                }
                _ => {}
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_float_label_names_its_document() {
        assert_eq!(label(7), "float-7");
        assert_eq!(doc_of(&label(7)), Some(7));
        assert_eq!(doc_of("main"), None);
        assert_eq!(doc_of("float-"), None);
        assert_eq!(doc_of("float-x"), None);
    }

    /// Photoshop's Cascade: each window one fixed step further down and right
    /// of the main window's top-left, none sitting exactly on it.
    #[test]
    fn cascade_steps_down_the_diagonal_from_the_main_window() {
        let origin = (100.0, 50.0);
        let spots: Vec<_> = (0..3).map(|i| cascade_position(origin, i)).collect();
        assert_eq!(spots, vec![(128.0, 78.0), (156.0, 106.0), (184.0, 134.0)]);
    }

    fn channel() -> (Channel, Arc<Mutex<Vec<Vec<u8>>>>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                sink.lock().unwrap().push(bytes);
            }
            Ok(())
        });
        (channel, got)
    }

    const BODY: [u8; 4] = [1, 2, 3, 4];
    fn head_for(doc: u32) -> String {
        format!("{doc},0,2,1,0,0,1,1")
    }

    /// The header words lead the body, little-endian, exactly as float.tsx
    /// reads them back.
    #[test]
    fn a_frame_is_its_header_words_then_its_body() {
        let (doc, frame) = frame_bytes("7,1,640,480,3,4,5,6", &BODY).unwrap();
        assert_eq!(doc, 7);
        let words: Vec<u32> = frame[..32].chunks(4).map(|w| u32::from_le_bytes(w.try_into().unwrap())).collect();
        assert_eq!(words, vec![7, 1, 640, 480, 3, 4, 5, 6]);
        assert_eq!(&frame[32..], &BODY);
        assert_eq!(frame_bytes("7,1,640", &BODY), None);
        assert_eq!(frame_bytes("7,x,1,1,1,1,1,1", &BODY), None);
    }

    /// Frames go to their own document's window, raw and whole; a window that
    /// isn't listening yet (or any more) is reported, not guessed at.
    #[test]
    fn frames_reach_only_their_documents_float() {
        let floats = Floats::default();
        let (seven, got_seven) = channel();
        let (eight, got_eight) = channel();
        floats.attach(7, seven);
        floats.attach(8, eight);

        assert_eq!(floats.send(&head_for(7), &BODY), Ok(true));
        assert_eq!(*got_seven.lock().unwrap(), vec![frame_bytes(&head_for(7), &BODY).unwrap().1]);
        assert!(got_eight.lock().unwrap().is_empty());

        assert_eq!(floats.send(&head_for(9), &BODY), Ok(false));
        floats.detach(7);
        assert_eq!(floats.send(&head_for(7), &BODY), Ok(false));
        assert_eq!(got_seven.lock().unwrap().len(), 1);
        assert!(floats.send("1,2", &BODY).is_err());
    }

    /// A float cannot speak for another document: its input always carries
    /// the document its own window shows.
    #[test]
    fn input_is_stamped_with_the_senders_document() {
        let spoofed = serde_json::json!({ "doc": 99, "type": "keydown", "key": "z" });
        assert_eq!(stamped(7, spoofed), Some(serde_json::json!({ "doc": 7, "type": "keydown", "key": "z" })));
        assert_eq!(stamped(7, serde_json::json!("keydown")), None);
    }
}
