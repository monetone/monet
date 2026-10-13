// Monet Vision — a real Tauri 2 window dressed in the Monet liquid-glass
// chrome. The window is transparent + decorationless with native vibrancy;
// all chrome (title bar, docks, panels) and the raster editor itself are
// drawn in the webview by @monet-ui/monet-react + the Rust/WASM engine.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use monet_ui::{Accent, MonetWindow};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl};

mod c2pa_sign;
mod droplet;
mod float;
mod heic;
mod model_dl;
mod recovery_session;

/// Rust → webview: a batch of native paths to open as document tabs.
const EV_OPEN: &str = "monet://open-files";
/// Webview → Rust: the frontend is listening on [`EV_OPEN`]; flush the backlog.
const EV_OPEN_READY: &str = "monet://open-files/ready";

/// Files the OS handed us before the webview could hear about them. macOS
/// delivers `open -a "Monet Vision" photo.tif` and Finder double-clicks as a
/// `RunEvent::Opened` that beats the first React render, so the paths are
/// parked here until App.tsx announces itself on [`EV_OPEN_READY`].
#[derive(Default)]
struct PendingOpen {
    state: Mutex<PendingOpenState>,
}

#[derive(Default)]
struct PendingOpenState {
    ready: bool,
    paths: Vec<String>,
}

impl PendingOpen {
    /// Park `paths` for the webview, keeping delivery order across batches.
    fn push(&self, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        self.state.lock().expect("pending-open lock").paths.extend(paths);
    }

    /// The webview announced itself on [`EV_OPEN_READY`].
    fn mark_ready(&self) {
        self.state.lock().expect("pending-open lock").ready = true;
    }

    /// A navigation has detached the listener; park new paths until the next
    /// [`EV_OPEN_READY`] handshake.
    fn mark_not_ready(&self) {
        self.state.lock().expect("pending-open lock").ready = false;
    }

    /// Drain the backlog for delivery — empty while the webview is not listening
    /// yet, so nothing is emitted into the void, and empty on a second call so a
    /// path never opens twice.
    fn take_ready(&self) -> Vec<String> {
        let mut state = self.state.lock().expect("pending-open lock");
        if !state.ready {
            return Vec::new();
        }
        std::mem::take(&mut state.paths)
    }
}

/// Launch arguments that name an existing file. `is_file` doubles as the filter
/// for flags and platform noise (`-psn_0_…`, `--webview-*`): anything that isn't
/// a file on disk is not something Vision was asked to open.
fn file_args(args: impl IntoIterator<Item = OsString>) -> Vec<String> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// `file://` URLs → local paths. Other schemes (deep links) aren't ours.
#[cfg(target_os = "macos")]
fn file_urls(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Queue `paths` for the webview and deliver them if it is already listening.
fn queue_open(app: &AppHandle, paths: Vec<String>) {
    app.state::<PendingOpen>().push(paths);
    flush_open(app);
}

fn flush_open(app: &AppHandle) {
    let batch = app.state::<PendingOpen>().take_ready();
    if !batch.is_empty() {
        let _ = app.emit(EV_OPEN, batch);
    }
}

/// Webview → Rust: the frontend is listening on [`EV_CLI`]; hand over the job.
const EV_CLI_READY: &str = "monet://cli/ready";
/// Rust → webview: `{ exe, job }` — the running binary (Copy as Command Line
/// needs it in every launch) and the command-line job, when there is one.
const EV_CLI: &str = "monet://cli/run";
/// Webview → Rust: `{ code, stdout, stderr }` — print it and exit with `code`.
const EV_CLI_DONE: &str = "monet://cli/done";

const CLI_VALUE_FLAGS: [&str; 8] = [
    "--run-script", "--play-action", "--batch", "--destination", "--dest", "--format", "--template", "--serial",
];
const CLI_SWITCHES: [&str; 3] = ["--override-save", "--stop-on-error", "--no-subfolders"];
/// Flags that only mean something to `--play-action … --batch`.
const CLI_BATCH_ONLY: [&str; 9] = [
    "--batch", "--destination", "--dest", "--format", "--template", "--serial",
    "--override-save", "--stop-on-error", "--no-subfolders",
];
/// Flags that only mean something when the batch writes to a folder.
const CLI_FOLDER_ONLY: [&str; 5] = ["--dest", "--format", "--template", "--serial", "--override-save"];
const CLI_USAGE: &str = "usage: monet-vision --run-script <file.js>
       monet-vision --play-action <Set/Name> --batch <dir> [--destination folder|none|save-and-close]
                    [--dest <dir>] [--format png|jpeg|tiff] [--template <name>] [--serial <n>]
                    [--override-save] [--no-subfolders] [--stop-on-error]
       monet-vision <droplet.json> <image or folder>…";

/// A command-line run (#468): a script, or a saved action batched over a
/// folder with the Batch dialog's options. Paths are absolute and exist.
#[derive(serde::Serialize, Clone, Debug, Default, PartialEq)]
struct CliJob {
    script: Option<String>,
    action: Option<String>,
    batch: Option<String>,
    /// The webview's BatchDestination: "folder", "none" or "saveAndClose".
    destination: String,
    dest: Option<String>,
    format: Option<String>,
    template: Option<String>,
    serial: Option<String>,
    override_save: bool,
    stop_on_error: bool,
    subfolders: bool,
    /// A droplet descriptor (#469) and the images or folders to run it over.
    droplet: Option<String>,
    inputs: Vec<String>,
}

/// The job, until the webview takes it on [`EV_CLI_READY`].
struct PendingCli(Mutex<Option<CliJob>>);

#[derive(serde::Deserialize)]
struct CliDone {
    code: i32,
    stdout: String,
    stderr: String,
}

/// The job's status, recorded on [`EV_CLI_DONE`]. `AppHandle::exit(code)` alone
/// never reaches the process: tauri-runtime-wry answers the request with
/// `ControlFlow::Exit`, and tao ends the run loop with status 0.
static CLI_STATUS: OnceLock<i32> = OnceLock::new();

/// The webview's job result; one that doesn't parse is a failed run.
fn cli_done(payload: &str) -> CliDone {
    serde_json::from_str(payload).unwrap_or_else(|e| CliDone {
        code: 1,
        stdout: String::new(),
        stderr: format!("monet-vision: unreadable job result: {e}"),
    })
}

/// The process status once the run loop hands back control: the job's result,
/// 1 for a job that ended without one, or for a GUI launch the loop's own code,
/// as `run` exited with.
fn exit_status(cli: bool, job: Option<i32>, run_loop: i32) -> i32 {
    job.or(cli.then_some(1)).unwrap_or(run_loop)
}

/// Launch arguments → a command-line job. `Ok(None)` when none of our flags is
/// present: a plain launch that opens files exactly as before. `Err` names the
/// problem; main() reports it with exit status 2 before Tauri boots, so bad
/// input opens, plays and writes nothing.
fn cli_job(args: &[String]) -> Result<Option<CliJob>, String> {
    let known = |arg: &str| CLI_VALUE_FLAGS.iter().chain(&CLI_SWITCHES).copied().find(|f| *f == arg);
    if !args.iter().any(|arg| known(arg).is_some()) {
        return droplet_job(args);
    }
    let usage = |problem: String| format!("{problem}\n{CLI_USAGE}");
    let mut given: Vec<&str> = Vec::new();
    let mut values = std::collections::HashMap::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if arg.starts_with("-psn_") || arg.starts_with("--webview-") {
            continue; // platform noise, as in file_args
        }
        let Some(flag) = known(arg) else {
            return Err(usage(format!("unknown argument {arg}")));
        };
        if given.contains(&flag) {
            return Err(usage(format!("{flag} was given twice")));
        }
        given.push(flag);
        if CLI_VALUE_FLAGS.contains(&flag) {
            match rest.next() {
                Some(value) if !value.starts_with("--") => {
                    values.insert(flag, value.clone());
                }
                _ => return Err(usage(format!("{flag} needs a value"))),
            }
        }
    }
    let action = values.remove("--play-action");
    if let Some(script) = values.remove("--run-script") {
        if action.is_some() {
            return Err(usage("use --run-script or --play-action, not both".into()));
        }
        if let Some(flag) = given.iter().find(|f| CLI_BATCH_ONLY.contains(*f)) {
            return Err(usage(format!("{flag} only applies to --play-action")));
        }
        if !Path::new(&script).is_file() {
            return Err(format!("script not found: {script}"));
        }
        return Ok(Some(CliJob { script: Some(absolute(&script)), ..CliJob::default() }));
    }
    let (Some(action), Some(batch)) = (action, values.remove("--batch")) else {
        return Err(usage(if given.contains(&"--play-action") {
            "--play-action needs --batch <dir>".into()
        } else {
            "give --run-script <file.js>, or --play-action <Set/Name> with --batch <dir>".into()
        }));
    };
    let destination = match values.remove("--destination").as_deref() {
        None | Some("folder") => "folder",
        Some("none") => "none",
        Some("save-and-close") => "saveAndClose",
        Some(other) => {
            return Err(usage(format!("unknown --destination {other} (use folder, none or save-and-close)")))
        }
    };
    if destination != "folder" {
        if let Some(flag) = given.iter().find(|f| CLI_FOLDER_ONLY.contains(*f)) {
            return Err(usage(format!("{flag} only applies to --destination folder")));
        }
    }
    let format = values.remove("--format");
    if let Some(format) = format.as_deref().filter(|f| !["png", "jpeg", "tiff"].contains(f)) {
        return Err(usage(format!("unknown --format {format} (use png, jpeg or tiff)")));
    }
    // Batch's Starting serial #: a whole number of 0 or more (parseBatchSerial).
    let serial = values.remove("--serial");
    if serial.as_deref().is_some_and(|s| s.is_empty() || s.len() > 15 || !s.bytes().all(|b| b.is_ascii_digit())) {
        return Err(usage("--serial must be a whole number of 0 or more".into()));
    }
    if !Path::new(&batch).is_dir() {
        return Err(format!("batch folder not found: {batch}"));
    }
    let dest = values.remove("--dest");
    if let Some(dest) = dest.as_deref().filter(|d| !Path::new(d).is_dir()) {
        return Err(format!("destination folder not found: {dest}"));
    }
    Ok(Some(CliJob {
        script: None,
        action: Some(action),
        batch: Some(absolute(&batch)),
        destination: destination.into(),
        dest: dest.as_deref().map(absolute),
        format,
        template: values.remove("--template"),
        serial,
        override_save: given.contains(&"--override-save"),
        stop_on_error: given.contains(&"--stop-on-error"),
        subfolders: !given.contains(&"--no-subfolders"),
        ..CliJob::default()
    }))
}

/// The webview does not know this process's working directory.
fn absolute(path: &str) -> String {
    std::path::absolute(path).map_or_else(|_| path.to_string(), |p| p.to_string_lossy().into_owned())
}

/// `monet-vision droplet.json a.jpg folder/ …` (#469): a droplet descriptor
/// among plain launch arguments runs its batch over the others, headless like
/// `--play-action`. `Ok(None)` when none is a droplet, so the files open as
/// before, a JSON file that isn't a droplet included.
fn droplet_job(args: &[String]) -> Result<Option<CliJob>, String> {
    let args: Vec<&String> = args.iter().filter(|a| !a.starts_with("-psn_") && !a.starts_with("--webview-")).collect();
    let Some(at) = args.iter().position(|a| droplet::is_droplet(Path::new(a))) else {
        return Ok(None);
    };
    let inputs: Vec<&String> = args.iter().enumerate().filter(|(i, _)| *i != at).map(|(_, a)| *a).collect();
    if let Some(missing) = inputs.iter().find(|a| !Path::new(a).exists()) {
        return Err(format!("not a file or folder: {missing}"));
    }
    if inputs.is_empty() {
        return Err(format!("{} is a droplet: give the images or folders to run it on\n{CLI_USAGE}", args[at]));
    }
    Ok(Some(CliJob {
        droplet: Some(absolute(args[at])),
        inputs: inputs.iter().map(|a| absolute(a)).collect(),
        ..CliJob::default()
    }))
}

fn main() {
    // `monet-vision --run-script foo.js` / `--play-action Set/Name --batch dir`:
    // bad input is refused here, before Tauri boots, so it opens and writes nothing.
    let args: Vec<String> = std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let job = match cli_job(&args) {
        Ok(job) => job,
        Err(problem) => {
            eprintln!("monet-vision: {problem}");
            std::process::exit(2);
        }
    };
    let cli = job.is_some();
    let mut builder = tauri::Builder::default()
        // Managed before the app runs, not in setup: macOS hands a cold launch's
        // files (Finder, `open -a`, a droplet app) to RunEvent::Opened before
        // setup has run, and queue_open parks them here.
        .manage(PendingOpen::default())
        .invoke_handler(monet_ui::invoke_handler())
        .plugin(monet_ui::dialog_plugin())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_opener::init());
    if job.is_none() {
        // Local MCP server: exposes Vision's @mcp commands to MCP clients over
        // http://127.0.0.1:48211/mcp (token in the app config dir's mcp.json).
        // port_range 6 keeps the busy-port fallback walk (48211-48216) below
        // Galerie's documented 48217, so the two apps never contend for it.
        // A command-line job goes without: init binds a port and rewrites
        // mcp.json, which would take a running GUI's MCP connection away.
        builder = builder.plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet Vision").port(48211).port_range(6)));
    }
    let run_loop = builder
        .plugin(c2pa_sign::init())
        .plugin(droplet::init())
        .plugin(float::init())
        .plugin(heic::init())
        .plugin(model_dl::init())
        .plugin(monet_ui::atomic_save_plugin())
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
                webview.state::<PendingOpen>().mark_not_ready();
            }
        })
        .setup(move |app| {
            monet_ui::install_quit_guard(app.handle())?;
            let handle = app.handle().clone();
            app.listen(EV_OPEN_READY, move |_| {
                handle.state::<PendingOpen>().mark_ready();
                flush_open(&handle);
            });
            // Every launch answers this handshake: the dialogs' Copy as Command
            // Line needs the binary's path. `take` hands a job over once, so a
            // webview reload never runs it twice.
            app.manage(PendingCli(Mutex::new(job.clone())));
            let handle = app.handle().clone();
            app.listen(EV_CLI_READY, move |_| {
                let job = handle.state::<PendingCli>().0.lock().expect("pending-cli lock").take();
                let exe = std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned());
                let _ = handle.emit(EV_CLI, serde_json::json!({ "exe": exe, "job": job }));
            });
            if job.is_none() {
                // `monet-vision photo.tif` (Linux/Windows, and a direct exec on macOS).
                queue_open(app.handle(), file_args(std::env::args_os().skip(1)));
            } else {
                let handle = app.handle().clone();
                app.listen(EV_CLI_DONE, move |event| {
                    let done = cli_done(event.payload());
                    if !done.stdout.is_empty() {
                        println!("{}", done.stdout.trim_end());
                    }
                    if !done.stderr.is_empty() {
                        eprintln!("{}", done.stderr.trim_end());
                    }
                    let _ = std::io::Write::flush(&mut std::io::stdout());
                    let _ = CLI_STATUS.set(done.code);
                    handle.exit(done.code);
                });
                // No Dock icon or app menu for a run nobody watches.
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            // A second GUI process must not treat the running session's snapshots
            // as a crash (#553). The claim never deletes a snapshot; a live owner
            // boots the new process with the blocked query instead.
            let recovery_blocked = job.is_none() && app.path().app_data_dir().ok().is_some_and(|dir| {
                !recovery_session::claim_recovery_session(
                    &dir.join(recovery_session::RECOVERY_DIR),
                    std::process::id(),
                    recovery_session::pid_alive,
                )
            });
            let url = if job.is_some() {
                WebviewUrl::App("index.html?cli=1".into())
            } else if recovery_blocked {
                WebviewUrl::App("index.html?recoveryBlocked=1".into())
            } else {
                WebviewUrl::default()
            };
            MonetWindow::builder(app.handle(), "main", url)
                .title("Monet Vision")
                .app_name("Vision")
                .accent(Accent::Raster)
                .inner_size(1500.0, 940.0)
                .min_inner_size(960.0, 640.0)
                // Decorationless by design: Monet draws its own liquid-glass title
                // bar. Do NOT add `.decorations(...)` here — it brings back the
                // native OS title bar. Guarded by src/native/windowChrome.test.ts.
                // A command-line job runs in a window nobody sees, and leaves the
                // geometry the GUI remembers alone.
                .visible(job.is_none())
                .remember_state(job.is_none())
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Monet Vision")
        .run_return(|_app, _event| {
            // macOS routes `open -a`, Finder double-clicks and file associations
            // here instead of through argv — including while Vision is running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                queue_open(_app, file_urls(urls));
            }
        });
    if cli && CLI_STATUS.get().is_none() {
        eprintln!("monet-vision: the job ended before it reported a result");
    }
    std::process::exit(exit_status(cli, CLI_STATUS.get().copied(), run_loop));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_args_keeps_real_files_and_drops_flags() {
        let this_file = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
        let args = ["--flag", "-psn_0_12345", this_file, "/no/such/photo.tif"]
            .map(OsString::from);
        assert_eq!(file_args(args), vec![this_file.to_string()]);
    }

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// The race this queue exists for: the OS hands us paths long before React
    /// mounts, so nothing may be delivered until the webview says it is
    /// listening — otherwise the launch file is emitted into the void and the
    /// user gets a blank "Untitled".
    #[test]
    fn pending_open_parks_paths_until_the_webview_is_ready() {
        let pending = PendingOpen::default();
        pending.push(paths(&["/a.tif"]));
        assert!(pending.take_ready().is_empty(), "delivered before ready");

        pending.mark_ready();
        assert_eq!(pending.take_ready(), paths(&["/a.tif"]));
    }

    /// `take_ready` drains: a second flush (the ready handshake fires again on a
    /// webview reload) must not re-open the same document.
    #[test]
    fn pending_open_drains_once() {
        let pending = PendingOpen::default();
        pending.mark_ready();
        pending.push(paths(&["/a.tif"]));
        assert_eq!(pending.take_ready(), paths(&["/a.tif"]));
        assert!(pending.take_ready().is_empty(), "same batch delivered twice");
    }

    /// argv at launch, then a macOS `Opened` event a moment later: both routes
    /// feed one queue, and the backlog keeps arrival order.
    #[test]
    fn pending_open_accumulates_batches_in_order() {
        let pending = PendingOpen::default();
        pending.push(paths(&["/a.tif", "/b.png"]));
        pending.push(paths(&["/c.psd"]));
        pending.mark_ready();
        assert_eq!(pending.take_ready(), paths(&["/a.tif", "/b.png", "/c.psd"]));
    }

    /// The common launch (no file arguments) must stay a no-op — an empty batch
    /// would pop a document tab out of nothing.
    #[test]
    fn pending_open_ignores_empty_batches() {
        let pending = PendingOpen::default();
        pending.mark_ready();
        pending.push(Vec::new());
        assert!(pending.take_ready().is_empty());
    }

    /// Delivery after the webview is up must be immediate, not parked until the
    /// next event: `open -a "Monet Vision" photo.tif` on a running app.
    #[test]
    fn pending_open_delivers_immediately_once_ready() {
        let pending = PendingOpen::default();
        pending.mark_ready();
        pending.push(paths(&["/late.tif"]));
        assert_eq!(pending.take_ready(), paths(&["/late.tif"]));
    }

    /// Reloading removes the old listener. An OS open in that interval must wait
    /// for the replacement listener and must still drain exactly once.
    #[test]
    fn pending_open_survives_webview_reload() {
        let pending = PendingOpen::default();
        pending.mark_ready();
        pending.mark_not_ready();
        pending.push(paths(&["/during-reload.tif"]));
        assert!(pending.take_ready().is_empty(), "delivered during reload");

        pending.mark_ready();
        assert_eq!(pending.take_ready(), paths(&["/during-reload.tif"]));
        assert!(pending.take_ready().is_empty(), "same path delivered twice");
    }

    const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs");
    const DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    const OUT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures");

    /// The webview's job result is the process status. `AppHandle::exit(code)`
    /// alone ended the run loop with 0, so a failed script or an unknown action
    /// looked like success to whatever scheduled the job.
    #[test]
    fn a_job_result_becomes_the_process_exit_status() {
        let status = |payload: &str| exit_status(true, Some(cli_done(payload).code), 0);
        assert_eq!(status(r#"{"code":0,"stdout":"1 processed","stderr":""}"#), 0);
        assert_eq!(status(r#"{"code":1,"stdout":"","stderr":"ReferenceError: nope"}"#), 1);
        let unknown = r#"{"code":2,"stdout":"","stderr":"No single saved action matches \"Nope/Missing\"."}"#;
        assert_eq!(status(unknown), 2);
        assert_eq!(status("not a result"), 1);
        // A job whose run loop ended before it reported (its hidden window was
        // destroyed, say) did not succeed.
        assert_eq!(exit_status(true, None, 0), 1);
        // A GUI launch has no job result: its event loop decides, as before.
        assert_eq!(exit_status(false, None, 0), 0);
        assert_eq!(exit_status(false, None, 3), 3);
    }

    /// A launch without any of our flags stays a plain (file-opening) launch.
    #[test]
    fn cli_job_leaves_plain_launches_alone() {
        assert_eq!(cli_job(&paths(&[])), Ok(None));
        assert_eq!(cli_job(&paths(&[SCRIPT, "-psn_0_12345", "--webview-x"])), Ok(None));
    }

    #[test]
    fn cli_job_parses_a_script_run() {
        let job = cli_job(&paths(&["-psn_0_1", "--run-script", SCRIPT])).unwrap().unwrap();
        assert_eq!(job.script, Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("main.rs").to_string_lossy().into_owned()));
        assert_eq!(job.action, None);
    }

    #[test]
    fn cli_job_parses_a_batch_with_every_option() {
        let args = [
            "--play-action", "Default Actions/Invert", "--batch", DIR, "--dest", OUT,
            "--format", "jpeg", "--template", "{name}", "--serial", "7",
            "--override-save", "--stop-on-error", "--no-subfolders",
        ];
        assert_eq!(
            cli_job(&paths(&args)),
            Ok(Some(CliJob {
                script: None,
                action: Some("Default Actions/Invert".into()),
                batch: Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").to_string_lossy().into_owned()),
                destination: "folder".into(),
                dest: Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").to_string_lossy().into_owned()),
                format: Some("jpeg".into()),
                template: Some("{name}".into()),
                serial: Some("7".into()),
                override_save: true,
                stop_on_error: true,
                subfolders: false,
                droplet: None,
                inputs: Vec::new(),
            }))
        );
        let job = cli_job(&paths(&["--play-action", "A", "--batch", DIR, "--destination", "save-and-close"]))
            .unwrap()
            .unwrap();
        assert_eq!((job.destination.as_str(), job.subfolders, job.dest), ("saveAndClose", true, None));
    }

    /// Every refusal names what to fix; main() turns it into exit status 2
    /// before Tauri boots, so nothing is opened, played or written.
    #[test]
    fn cli_job_rejects_bad_input_naming_the_problem() {
        let batch = |extra: &[&'static str]| [&["--play-action", "A", "--batch", DIR][..], extra].concat();
        let cases: Vec<(Vec<&str>, &str)> = vec![
            (vec!["--run-script"], "--run-script needs a value"),
            (vec!["--play-action", "--batch", DIR], "--play-action needs a value"),
            (vec!["--run-script", SCRIPT, "--play-action", "A"], "not both"),
            (vec!["--batch", DIR], "--play-action <Set/Name>"),
            (vec!["--play-action", "A"], "--play-action needs --batch <dir>"),
            (vec!["--run-script", SCRIPT, "--stop-on-error"], "--stop-on-error only applies to --play-action"),
            (vec!["--run-script", SCRIPT, "--run-script", SCRIPT], "--run-script was given twice"),
            (vec!["--run-script", SCRIPT, "photo.tif"], "unknown argument photo.tif"),
            (vec!["--run-script", "/no/such/script.js"], "script not found: /no/such/script.js"),
            (vec!["--play-action", "A", "--batch", "/no/such/dir"], "batch folder not found: /no/such/dir"),
            (vec!["--play-action", "A", "--batch", SCRIPT], "batch folder not found"),
            (batch(&["--dest", "/no/such/out"]), "destination folder not found: /no/such/out"),
            (batch(&["--format", "gif"]), "unknown --format gif"),
            (batch(&["--destination", "cloud"]), "unknown --destination cloud"),
            (batch(&["--destination", "none", "--format", "png"]), "--format only applies to --destination folder"),
            (batch(&["--serial", "-1"]), "--serial must be a whole number"),
            (batch(&["--serial", "2.5"]), "--serial must be a whole number"),
        ];
        for (args, needle) in cases {
            match cli_job(&paths(&args)) {
                Err(message) => assert!(message.contains(needle), "{args:?}: {message}"),
                other => panic!("{args:?} was accepted: {other:?}"),
            }
        }
    }

    /// A droplet descriptor, an image, a folder and a JSON file that is not a
    /// droplet, in a fresh temp folder.
    fn droplet_fixture(tag: &str) -> [String; 4] {
        let dir = std::env::temp_dir().join(format!("mv-droplet-args-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("more")).unwrap();
        let files = [dir.join("Resize.json"), dir.join("a.jpg"), dir.join("more"), dir.join("package.json")];
        std::fs::write(&files[0], r#"{"actionName":"Invert","format":"png","template":"{name}","stopOnError":false}"#).unwrap();
        std::fs::write(&files[1], [0xff, 0xd8, 0xff]).unwrap();
        std::fs::write(&files[3], r#"{"name":"not a droplet","format":"png"}"#).unwrap();
        files.map(|p| p.to_string_lossy().into_owned())
    }

    /// `monet-vision droplet.json a.jpg folder/` runs the droplet over the rest,
    /// headless, wherever the descriptor sits among them; nothing opens.
    #[test]
    fn a_droplet_among_launch_arguments_runs_over_the_rest() {
        let [droplet, image, folder, _] = droplet_fixture("run");
        let job = cli_job(&paths(&["-psn_0_1", &image, &droplet, &folder])).unwrap().unwrap();
        assert_eq!(job.droplet.as_deref(), Some(droplet.as_str()));
        assert_eq!(job.inputs, vec![image, folder]);
        assert_eq!((job.script, job.action, job.batch), (None, None, None));
    }

    /// Plain files, and JSON that only looks like one by its extension, stay a
    /// plain launch whose files all open as before: none is dropped silently.
    #[test]
    fn launch_arguments_without_a_droplet_open_as_before() {
        let [_, image, _, other] = droplet_fixture("plain");
        assert_eq!(cli_job(&paths(&[&image, &other])), Ok(None));
        assert_eq!(file_args([&image, &other].map(OsString::from)), vec![image, other]);
    }

    #[test]
    fn a_droplet_needs_inputs_that_exist() {
        let [droplet, image, _, _] = droplet_fixture("bad");
        let refused = |args: &[&str], needle: &str| match cli_job(&paths(args)) {
            Err(message) => assert!(message.contains(needle), "{args:?}: {message}"),
            other => panic!("{args:?} was accepted: {other:?}"),
        };
        refused(&[&droplet], "is a droplet: give the images or folders to run it on");
        refused(&[&droplet, &image, "/no/such/b.jpg"], "not a file or folder: /no/such/b.jpg");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn file_urls_maps_file_scheme_only() {
        let urls = [
            tauri::Url::parse("file:///tmp/a%20photo.tif").unwrap(),
            tauri::Url::parse("https://example.com/b.png").unwrap(),
        ];
        assert_eq!(file_urls(&urls), vec!["/tmp/a photo.tif".to_string()]);
    }
}
