//! File ▸ Automate ▸ Create Droplet (#469). The dialog saves an action + Batch
//! settings as a small JSON descriptor. Handing Vision that descriptor together
//! with images runs the droplet's batch over them instead of opening them:
//! `monet-vision droplet.json a.jpg …` (main.rs, headless) or the descriptor
//! and images opened or dropped together (the webview routes those).
//!
//! Finder can't drop onto a .json file, so on macOS the dialog can also save a
//! droplet app: an AppleScript applet, compiled by `osacompile`, with the
//! descriptor in its Resources. Dropping images or folders on it hands them to
//! Vision with the descriptor first, launching Vision if it isn't running.
use std::path::Path;
use std::process::Command;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

/// A descriptor is a few hundred bytes; anything bigger is some other JSON.
const MAX_BYTES: u64 = 64 * 1024;
/// Where a droplet app keeps its descriptor, relative to the bundle.
const DESCRIPTOR: &str = "Contents/Resources/droplet.json";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("droplet")
        .invoke_handler(tauri::generate_handler![save_droplet_app])
        .build()
}

/// The shape Create Droplet writes: a File Naming template, an output format,
/// Stop For Errors and the action's name or whole-number id, after at most one
/// UTF-8 byte order mark. Any other JSON is not a droplet. state/batchIo.ts
/// parseDroplet applies the same rule; fixtures/droplet-shapes.json holds both
/// to it.
pub fn is_droplet_text(text: &str) -> bool {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    v["template"].is_string()
        && ["png", "jpeg", "tiff"].iter().any(|f| v["format"] == *f)
        && v["stopOnError"].is_boolean()
        && (v["actionName"].is_string() || v["actionId"].as_f64().is_some_and(|id| id.fract() == 0.0))
}

/// Whether `path` is a droplet descriptor: a small .json file of that shape.
pub fn is_droplet(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"))
        && std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() <= MAX_BYTES)
        && std::fs::read_to_string(path).is_ok_and(|text| is_droplet_text(&text))
}

/// The applet's source. `open` sends Vision one open-documents event with the
/// descriptor first: a running Vision gets it as `RunEvent::Opened`, one that
/// isn't running is launched with it (`--args` would be ignored by a running
/// Vision). It goes through LaunchServices, so the droplet needs no Automation
/// consent the way `tell application` would. It opens the Vision that saved it
/// (`vision_app`), and any Vision by bundle id once that one has moved: with
/// several copies installed, `open -b` alone may pick another one. With no
/// Vision at all it says so instead of showing LaunchServices' error.
fn applet_script(bundle_id: &str, vision_app: Option<&str>) -> String {
    let by_id = format!(
        r#"try
		do shell script "open -b {bundle_id} " & args
	on error
		display alert "Monet Vision isn't installed on this Mac." message "Install Monet Vision, then drop the images on this droplet again." as critical
	end try"#
    );
    let open = match vision_app {
        Some(app) => format!(
            "try\n\t\tdo shell script \"open -a \" & quoted form of \"{}\" & \" \" & args\n\ton error\n\t\t{}\n\tend try",
            app.replace('\\', "\\\\").replace('"', "\\\""),
            by_id.replace('\n', "\n\t")
        ),
        None => by_id,
    };
    format!(
        r#"on open droppedItems
	set args to quoted form of (POSIX path of (path to me) & "{DESCRIPTOR}")
	repeat with droppedItem in droppedItems
		set args to args & " " & quoted form of POSIX path of droppedItem
	end repeat
	{open}
end open

on run
	display dialog "Drop images or folders on this droplet to process them in Monet Vision." buttons {{"OK"}} default button "OK"
end run"#
    )
}

fn droplet_app_refusal(path: &str, exists: bool, overwrite: bool) -> Option<String> {
    if !path.to_ascii_lowercase().ends_with(".app") {
        return Some("A droplet app must be saved as a .app bundle.".into());
    }
    if exists && !overwrite {
        return Some(format!(
            "{path} already exists. Choose a new name, or replace the droplet on purpose."
        ));
    }
    None
}

/// Save Droplet App…: build the applet with the descriptor in it.
#[tauri::command]
async fn save_droplet_app<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    descriptor: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    if let Some(reason) = droplet_app_refusal(&path, std::path::Path::new(&path).exists(), overwrite.unwrap_or(false)) {
        return Err(reason);
    }
    // …/Monet Vision.app/Contents/MacOS/Vision; a dev binary has no bundle.
    let exe = std::env::current_exe().ok();
    let vision_app = exe.as_deref().and_then(|exe| exe.ancestors().nth(3)).filter(|p| p.extension().is_some_and(|e| e == "app"));
    build_app(Path::new(&path), &app.config().identifier, vision_app, &descriptor)
}

fn build_app(dest: &Path, bundle_id: &str, vision_app: Option<&Path>, descriptor: &str) -> Result<(), String> {
    if !is_droplet_text(descriptor) {
        return Err("That is not a droplet descriptor.".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("Droplet apps can only be made on macOS. Save Droplet… saves it as .json; run that with: monet-vision <droplet.json> <images…>".into());
    }
    let (Some(parent), Some(name)) = (dest.parent(), dest.file_name()) else {
        return Err(format!("Can't save a droplet app at {}.", dest.display()));
    };
    // Build under the droplet's own name (osacompile names the app and its
    // signature after the file) in a hidden folder beside it, then move it into
    // place, so a failed build leaves an earlier droplet there as it was.
    let staging = parent.join(format!(".monet-droplet-{}", std::process::id()));
    let staged = staging.join(name);
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("Couldn't build the droplet app in {}: {e}.", parent.display()))?;
    let mut compile = Command::new("osacompile");
    compile.arg("-o").arg(&staged);
    for line in applet_script(bundle_id, vision_app.map(|p| p.to_str().unwrap_or_default())).lines() {
        compile.arg("-e").arg(line);
    }
    // osacompile signs the applet, and adding the descriptor breaks that seal:
    // sign it again once the descriptor is in.
    let built = run(&mut compile)
        .and_then(|()| add_descriptor(&staged, descriptor).map_err(|e| e.to_string()))
        .and_then(|()| run(Command::new("codesign").args(["--force", "--sign", "-"]).arg(&staged)))
        .and_then(|()| replace(&staged, dest).map_err(|e| e.to_string()))
        .map_err(|e| format!("Couldn't build the droplet app: {e}. Save Droplet… still saves the droplet as .json."));
    let _ = std::fs::remove_dir_all(&staging);
    built
}

/// Run a build tool; what it printed to stderr is the error.
fn run(command: &mut Command) -> Result<(), String> {
    let tool = command.get_program().to_string_lossy().into_owned();
    let out = command.output().map_err(|e| format!("couldn't run {tool} ({e})"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{tool} failed: {}", String::from_utf8_lossy(&out.stderr).trim().trim_end_matches('.')))
    }
}

fn add_descriptor(app: &Path, descriptor: &str) -> std::io::Result<()> {
    let file = app.join(DESCRIPTOR);
    std::fs::create_dir_all(file.parent().expect("the descriptor path has a folder"))?;
    std::fs::write(file, descriptor)
}

/// Move the built droplet to `dest`, replacing what the save dialog already
/// confirmed replacing there.
fn replace(staged: &Path, dest: &Path) -> std::io::Result<()> {
    // Droplet apps are macOS-only. Exchange the complete bundles atomically:
    // deleting the old one before rename would lose it if the save failed.
    #[cfg(target_os = "macos")]
    if dest.exists() {
        use std::os::unix::ffi::OsStrExt;
        let from = std::ffi::CString::new(staged.as_os_str().as_bytes())?;
        let to = std::ffi::CString::new(dest.as_os_str().as_bytes())?;
        if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        // The old bundle is now in staging; build_app's cleanup removes it.
        return Ok(());
    }
    std::fs::rename(staged, dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DROPLET: &str = r#"{"actionName":"Invert","format":"png","template":"{name}_{serial}","stopOnError":false}"#;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mv-droplet-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The shape decides, not the .json extension: other JSON opens as a
    /// document. batchIo.test.ts holds parseDroplet to the same fixture.
    #[test]
    fn a_droplet_app_needs_the_app_extension_and_will_not_replace_one_quietly() {
        assert!(droplet_app_refusal("/tmp/notes.txt", false, false).is_some());
        assert!(droplet_app_refusal("/tmp/Web.json", false, true).is_some());
        let existing = droplet_app_refusal("/tmp/Web.app", true, false).expect("existing app");
        assert!(existing.contains("already exists"), "{existing}");
        assert!(droplet_app_refusal("/tmp/Web.app", true, true).is_none());
        assert!(droplet_app_refusal("/tmp/Web.app", false, false).is_none());
    }

    #[test]
    fn droplet_text_needs_the_create_droplet_shape() {
        let shapes: serde_json::Value = serde_json::from_str(include_str!("../fixtures/droplet-shapes.json")).unwrap();
        let texts = |key: &str| shapes[key].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_owned()).collect::<Vec<_>>();
        for text in texts("droplets") {
            assert!(is_droplet_text(&text), "{text} was refused");
        }
        for text in texts("notDroplets") {
            assert!(!is_droplet_text(&text), "{text} passed as a droplet");
        }
    }

    #[test]
    fn a_droplet_file_is_a_small_json_of_that_shape() {
        let dir = temp_dir("file");
        let droplet = dir.join("Resize.json");
        std::fs::write(&droplet, DROPLET).unwrap();
        assert!(is_droplet(&droplet));
        let renamed = dir.join("Resize.txt");
        std::fs::write(&renamed, DROPLET).unwrap();
        assert!(!is_droplet(&renamed));
        let big = dir.join("big.json");
        let padded = format!("{},\"pad\":\"{}\"}}", &DROPLET[..DROPLET.len() - 1], "x".repeat(MAX_BYTES as usize));
        assert!(is_droplet_text(&padded), "only the size rules it out");
        std::fs::write(&big, padded).unwrap();
        assert!(!is_droplet(&big));
        assert!(!is_droplet(&dir.join("missing.json")));
        assert!(!is_droplet(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Finder's drop reaches `on open`; the applet reads its descriptor from
    /// where `add_descriptor` puts it and hands it and the drop to the Vision
    /// that saved it, or to any Vision by bundle id once that one is gone.
    #[test]
    fn the_applet_opens_its_descriptor_and_the_drop_in_vision() {
        let script = applet_script("dev.monet.vision", Some(r#"/Apps/Monet "Vision".app"#));
        assert!(script.starts_with("on open droppedItems\n"));
        assert!(script.contains(r#"set args to quoted form of (POSIX path of (path to me) & "Contents/Resources/droplet.json")"#));
        assert!(script.contains("set args to args & \" \" & quoted form of POSIX path of droppedItem"));
        let fallback = "on error
		try
			do shell script \"open -b dev.monet.vision \" & args
		on error
			display alert \"Monet Vision isn't installed on this Mac.\" message \"Install Monet Vision, then drop the images on this droplet again.\" as critical
		end try
	end try
end open";
        assert!(script.contains(&format!(
            "\ttry\n\t\tdo shell script \"open -a \" & quoted form of \"/Apps/Monet \\\"Vision\\\".app\" & \" \" & args\n\t{fallback}"
        )), "{script}");
        assert!(!script.contains("--args"), "a running Vision ignores --args");
        assert!(script.contains("on run\n"), "a double-click explains the droplet");
        // A dev build is no bundle: the droplet finds Vision by bundle id.
        let by_id = applet_script("dev.monet.vision", None);
        assert!(by_id.contains("\ttry\n\t\tdo shell script \"open -b dev.monet.vision \" & args\n\ton error\n\t\tdisplay alert \"Monet Vision isn't installed on this Mac.\""), "{by_id}");
    }

    #[test]
    fn the_descriptor_goes_in_the_bundle_and_replaces_an_older_droplet() {
        let dir = temp_dir("install");
        let staged = dir.join(".monet-droplet-1/Resize.app");
        std::fs::create_dir_all(staged.join("Contents/MacOS")).unwrap();
        std::fs::write(staged.join("Contents/MacOS/droplet"), "new").unwrap();
        let dest = dir.join("Resize.app");
        std::fs::create_dir_all(dest.join("Contents/MacOS")).unwrap();
        std::fs::write(dest.join("Contents/MacOS/droplet"), "old").unwrap();

        add_descriptor(&staged, DROPLET).unwrap();
        let replacement = replace(&staged, &dest);
        let saved = if cfg!(target_os = "macos") {
            replacement.unwrap();
            assert_eq!(std::fs::read_to_string(staged.join("Contents/MacOS/droplet")).unwrap(), "old");
            dest.clone()
        } else {
            // Other platforms cannot build macOS droplets or replace a populated
            // bundle atomically, and must leave the earlier one alone.
            assert!(replacement.is_err());
            assert_eq!(std::fs::read_to_string(dest.join("Contents/MacOS/droplet")).unwrap(), "old");
            let fresh = dir.join("New.app");
            replace(&staged, &fresh).unwrap();
            fresh
        };
        assert_eq!(std::fs::read_to_string(saved.join("Contents/MacOS/droplet")).unwrap(), "new");
        let descriptor = saved.join(DESCRIPTOR);
        assert_eq!(std::fs::read_to_string(&descriptor).unwrap(), DROPLET);
        assert!(is_droplet(&descriptor), "the bundled descriptor is what the command line accepts");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_replacement_keeps_the_saved_droplet() {
        let dir = temp_dir("failed-install");
        let dest = dir.join("Resize.app");
        std::fs::create_dir_all(dest.join("Contents/MacOS")).unwrap();
        std::fs::write(dest.join("Contents/MacOS/droplet"), "old").unwrap();
        assert!(replace(&dir.join("missing.app"), &dest).is_err());
        assert_eq!(std::fs::read_to_string(dest.join("Contents/MacOS/droplet")).unwrap(), "old");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bad_descriptor_builds_nothing() {
        let dir = temp_dir("refuse");
        let dest = dir.join("Nope.app");
        let refused = build_app(&dest, "dev.monet.vision", None, r#"{"name":"x"}"#).unwrap_err();
        assert!(refused.contains("not a droplet descriptor"), "{refused}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
