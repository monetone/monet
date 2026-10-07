// Monet Rythme — a liquid-glass digital audio workstation.
//
// The window itself is transparent + decorationless with a native material
// (macOS vibrancy / Windows acrylic); all chrome (title bar, docks, panels) is
// drawn in the webview by @monet-ui/monet-react. The monet-ui crate builds the
// window and wires its custom window controls. The audio accent tints the
// otherwise-neutral chrome.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MonetWindow};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, WebviewUrl};

const DEFAULT_PLUGIN_ROOT_SCAN_DEPTH: usize = 6;
const MAX_PLUGIN_ROOT_SCAN_DEPTH: usize = 16;
const GLOBAL_SHORTCUT_PRESETS_FILE: &str = "keyboard-shortcut-presets.json";
const APP_PREFERENCES_FILE: &str = "app-preferences.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAudioPluginMetadata {
    path: String,
    name: Option<String>,
    version: Option<String>,
    bundle_identifier: Option<String>,
    kind: &'static str,
    validation_status: &'static str,
    validation_issues: Vec<String>,
    entry_point_verified: bool,
}

#[tauri::command]
fn scan_native_audio_plugin_metadata(paths: Vec<String>) -> Vec<NativeAudioPluginMetadata> {
    paths
        .into_iter()
        .map(scan_native_audio_plugin_path)
        .collect()
}

#[tauri::command]
fn scan_native_audio_plugin_roots(
    roots: Vec<String>,
    max_depth: Option<usize>,
) -> Vec<NativeAudioPluginMetadata> {
    let depth = max_depth
        .unwrap_or(DEFAULT_PLUGIN_ROOT_SCAN_DEPTH)
        .min(MAX_PLUGIN_ROOT_SCAN_DEPTH);
    discover_native_audio_plugin_paths(&roots, depth)
        .into_iter()
        .map(scan_native_audio_plugin_path)
        .collect()
}

#[tauri::command]
fn read_global_keyboard_shortcut_presets<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    let path = global_shortcut_presets_path(&app)?;
    read_global_shortcut_presets_file(&path)
}

#[tauri::command]
fn write_global_keyboard_shortcut_presets<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    presets_json: String,
) -> Result<(), String> {
    let path = global_shortcut_presets_path(&app)?;
    write_global_shortcut_presets_file(&path, &presets_json)
}

#[tauri::command]
fn read_app_preferences<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    let path = app_preferences_path(&app)?;
    read_app_preferences_file(&path)
}

#[tauri::command]
fn write_app_preferences<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    preferences_json: String,
) -> Result<(), String> {
    let path = app_preferences_path(&app)?;
    write_app_preferences_file(&path, &preferences_json)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(invoke_handler())
        // Native OS dialogs (file open/save, message/ask/confirm). The JS side
        // calls them through @monet-ui/monet-react's openFile/saveFile/confirm/
        // message/ask helpers; the "dialog:default" capability permits them.
        // Durable document saves: write → fsync → rename → fsync(dir).
        .plugin(monet_ui::atomic_save_plugin())
        .plugin(monet_ui::dialog_plugin())
        // Native filesystem access for the paths those dialogs return: the JS
        // side reads/writes them through @tauri-apps/plugin-fs (ui/io-web), and
        // the "fs:*" capabilities scope what it may touch.
        .plugin(tauri_plugin_fs::init())
        // Local MCP server: exposes Rythme's @mcp commands to MCP clients over
        // http://127.0.0.1:48215/mcp (token in the app config dir's mcp.json).
        .plugin(monet_mcp::init(
            monet_mcp::McpOptions::new("Monet Rythme").port(48215),
        ))
        .setup(|app| {
            monet_ui::install_quit_guard(app.handle())?;
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Monet Rythme")
                .app_name("Rythme")
                .accent(Accent::Audio)
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1000.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet Rythme");
}

fn invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    let rythme_handler: Box<tauri::ipc::InvokeHandler<R>> = Box::new(tauri::generate_handler![
        scan_native_audio_plugin_metadata,
        scan_native_audio_plugin_roots,
        read_global_keyboard_shortcut_presets,
        write_global_keyboard_shortcut_presets,
        read_app_preferences,
        write_app_preferences
    ]);
    let monet_handler: Box<tauri::ipc::InvokeHandler<R>> = Box::new(monet_ui::invoke_handler());
    move |invoke| match invoke.message.command() {
        "scan_native_audio_plugin_metadata" => rythme_handler(invoke),
        "scan_native_audio_plugin_roots" => rythme_handler(invoke),
        "read_global_keyboard_shortcut_presets" => rythme_handler(invoke),
        "write_global_keyboard_shortcut_presets" => rythme_handler(invoke),
        "read_app_preferences" => rythme_handler(invoke),
        "write_app_preferences" => rythme_handler(invoke),
        _ => monet_handler(invoke),
    }
}

fn global_shortcut_presets_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(GLOBAL_SHORTCUT_PRESETS_FILE))
        .map_err(|err| format!("Could not resolve app config dir: {err}"))
}

fn read_global_shortcut_presets_file(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(err) => Err(format!("Could not read shortcut preset preferences: {err}")),
    }
}

fn write_global_shortcut_presets_file(path: &Path, json: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create shortcut preset preferences dir: {err}"))?;
    }
    fs::write(path, json).map_err(|err| format!("Could not write shortcut preset preferences: {err}"))
}

fn app_preferences_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(APP_PREFERENCES_FILE))
        .map_err(|err| format!("Could not resolve app config dir: {err}"))
}

fn read_app_preferences_file(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(err) => Err(format!("Could not read app preferences: {err}")),
    }
}

fn write_app_preferences_file(path: &Path, json: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create app preferences dir: {err}"))?;
    }
    fs::write(path, json).map_err(|err| format!("Could not write app preferences: {err}"))
}

fn discover_native_audio_plugin_paths(roots: &[String], max_depth: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen_plugins = HashSet::new();
    let mut seen_dirs = HashSet::new();
    for root in roots {
        let root = root.trim();
        if root.is_empty() {
            continue;
        }
        collect_native_audio_plugin_paths(
            Path::new(root),
            0,
            max_depth,
            &mut out,
            &mut seen_plugins,
            &mut seen_dirs,
        );
    }
    out.sort_by_key(|path| path.to_ascii_lowercase());
    out
}

fn collect_native_audio_plugin_paths(
    path: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<String>,
    seen_plugins: &mut HashSet<String>,
    seen_dirs: &mut HashSet<String>,
) {
    if push_native_audio_plugin_path(path, out, seen_plugins) {
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if !meta.is_dir() || depth > max_depth {
        return;
    }
    let dir_key = path_key(path);
    if !seen_dirs.insert(dir_key) {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    children.sort_by_key(|child| child.to_string_lossy().to_ascii_lowercase());
    for child in children {
        if push_native_audio_plugin_path(&child, out, seen_plugins) {
            continue;
        }
        if depth < max_depth {
            collect_native_audio_plugin_paths(
                &child,
                depth + 1,
                max_depth,
                out,
                seen_plugins,
                seen_dirs,
            );
        }
    }
}

fn push_native_audio_plugin_path(
    path: &Path,
    out: &mut Vec<String>,
    seen_plugins: &mut HashSet<String>,
) -> bool {
    let path_string = path.to_string_lossy().to_string();
    if plugin_kind_from_path(&path_string) == "unknown" {
        return false;
    }
    let key = path_string.to_ascii_lowercase();
    if seen_plugins.insert(key) {
        out.push(path_string);
    }
    true
}

fn path_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn scan_native_audio_plugin_path(path: String) -> NativeAudioPluginMetadata {
    let kind = plugin_kind_from_path(&path);
    let mut out = NativeAudioPluginMetadata {
        path: path.clone(),
        name: None,
        version: None,
        bundle_identifier: None,
        kind,
        validation_status: "pathOnly",
        validation_issues: Vec::new(),
        entry_point_verified: false,
    };
    let p = Path::new(&path);
    let Ok(meta) = fs::metadata(p) else {
        out.validation_status = "invalid";
        out.validation_issues
            .push("Path does not exist".to_string());
        return out;
    };
    if kind == "unknown" {
        out.validation_status = "invalid";
        out.validation_issues
            .push("Unknown native plug-in format".to_string());
        return out;
    }
    let bundle = kind == "vst3" || kind == "audioUnit" || (kind == "vst2" && meta.is_dir());
    if !bundle {
        return out;
    }
    if !meta.is_dir() {
        out.validation_status = "invalid";
        out.validation_issues
            .push("Expected plug-in bundle directory".to_string());
        return out;
    }
    let plist_path = p.join("Contents").join("Info.plist");
    let mut au_declares_component = false;
    match fs::read_to_string(&plist_path) {
        Ok(plist) if plist.contains("<plist") => {
            out.name = plist_string(&plist, "CFBundleDisplayName")
                .or_else(|| plist_string(&plist, "CFBundleName"));
            out.version = plist_string(&plist, "CFBundleShortVersionString")
                .or_else(|| plist_string(&plist, "CFBundleVersion"));
            out.bundle_identifier = plist_string(&plist, "CFBundleIdentifier");
            au_declares_component = kind == "audioUnit"
                && (plist.contains("<key>AudioComponents</key>")
                    || plist_string(&plist, "factoryFunction").is_some());
        }
        Ok(_) => out
            .validation_issues
            .push("Info.plist is not readable XML".to_string()),
        Err(_) => out
            .validation_issues
            .push("Missing readable Info.plist".to_string()),
    }
    let macos_dir = p.join("Contents").join("MacOS");
    let executables = child_files(&macos_dir);
    if !macos_dir.is_dir() || executables.is_empty() {
        out.validation_issues
            .push("Missing bundle executable in Contents/MacOS".to_string());
    } else {
        out.entry_point_verified = au_declares_component
            || executables
                .iter()
                .any(|executable| binary_has_entry_point(executable, kind));
    }
    out.validation_status = if out.validation_issues.is_empty() {
        "metadataVerified"
    } else {
        "invalid"
    };
    out
}

fn plugin_kind_from_path(path: &str) -> &'static str {
    let lower = path.trim_end_matches(['/', '\\']).to_ascii_lowercase();
    if lower.ends_with(".component") {
        "audioUnit"
    } else if lower.ends_with(".vst3") {
        "vst3"
    } else if lower.ends_with(".vst") || lower.ends_with(".dll") || lower.ends_with(".so") {
        "vst2"
    } else {
        "unknown"
    }
}

fn plist_string(plist: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let after_key = plist.split_once(&marker)?.1;
    let start = after_key.find("<string>")? + "<string>".len();
    let end = after_key[start..].find("</string>")?;
    let value = xml_unescape(&after_key[start..start + end])
        .trim()
        .to_string();
    (!value.is_empty()).then_some(value)
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn child_files(path: &Path) -> Vec<std::path::PathBuf> {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_file())
                .map(|_| entry.path())
        })
        .collect()
}

fn binary_has_entry_point(path: &Path, kind: &str) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    entry_point_markers(kind).iter().any(|marker| {
        let needle = marker.as_bytes();
        bytes.windows(needle.len()).any(|window| window == needle)
    })
}

fn entry_point_markers(kind: &str) -> &'static [&'static str] {
    match kind {
        "vst3" => &["GetPluginFactory", "bundleEntry", "bundleExit"],
        "vst2" => &["VSTPluginMain", "main_macho"],
        "audioUnit" => &["AudioComponentFactoryFunction", "AudioUnitFactory"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn parses_plist_strings() {
        let plist =
            r#"<plist><dict><key>CFBundleName</key><string>Pro &amp; Q</string></dict></plist>"#;
        assert_eq!(
            plist_string(plist, "CFBundleName").as_deref(),
            Some("Pro & Q")
        );
    }

    #[test]
    fn scans_xml_plist_bundle_metadata() {
        let root = test_dir("vst3");
        let plugin = root.join("Pro-Q 3.vst3");
        fs::create_dir_all(plugin.join("Contents/MacOS")).unwrap();
        fs::write(plugin.join("Contents/MacOS/Pro-Q 3"), "GetPluginFactory").unwrap();
        fs::write(
            plugin.join("Contents/Info.plist"),
            r#"
          <plist><dict>
            <key>CFBundleName</key><string>Pro-Q 3</string>
            <key>CFBundleIdentifier</key><string>com.fabfilter.Pro-Q.3</string>
            <key>CFBundleShortVersionString</key><string>3.2.1</string>
          </dict></plist>
        "#,
        )
        .unwrap();

        let out = scan_native_audio_plugin_path(plugin.to_string_lossy().into_owned());
        assert_eq!(out.kind, "vst3");
        assert_eq!(out.validation_status, "metadataVerified");
        assert_eq!(out.name.as_deref(), Some("Pro-Q 3"));
        assert_eq!(out.version.as_deref(), Some("3.2.1"));
        assert_eq!(
            out.bundle_identifier.as_deref(),
            Some("com.fabfilter.Pro-Q.3")
        );
        assert!(out.entry_point_verified);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scans_roots_recursively_without_descending_into_plugin_bundles() {
        let root = test_dir("root-scan");
        let plugin = root.join("Vendor").join("Pro-Q 3.vst3");
        fs::create_dir_all(plugin.join("Contents/MacOS")).unwrap();
        fs::write(plugin.join("Contents/MacOS/Pro-Q 3"), "GetPluginFactory").unwrap();
        fs::write(
            plugin.join("Contents/Info.plist"),
            r#"
          <plist><dict>
            <key>CFBundleName</key><string>Pro-Q 3</string>
            <key>CFBundleIdentifier</key><string>com.fabfilter.Pro-Q.3</string>
            <key>CFBundleShortVersionString</key><string>3.2.1</string>
          </dict></plist>
        "#,
        )
        .unwrap();
        fs::create_dir_all(plugin.join("Contents/PlugIns/Nested.vst3")).unwrap();
        fs::write(root.join("notes.txt"), "not a plug-in").unwrap();

        let discovered =
            discover_native_audio_plugin_paths(&[root.to_string_lossy().into_owned()], 4);
        assert_eq!(discovered, vec![plugin.to_string_lossy().into_owned()]);

        let scanned =
            scan_native_audio_plugin_roots(vec![root.to_string_lossy().into_owned()], Some(4));
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].validation_status, "metadataVerified");
        assert!(scanned[0].entry_point_verified);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn marks_missing_candidates_invalid() {
        let out = scan_native_audio_plugin_path("/tmp/does-not-exist/Nope.vst3".to_string());
        assert_eq!(out.validation_status, "invalid");
        assert_eq!(out.validation_issues, vec!["Path does not exist"]);
    }

    #[test]
    fn round_trips_global_shortcut_preset_file() {
        let root = test_dir("shortcut-prefs");
        let path = root.join(GLOBAL_SHORTCUT_PRESETS_FILE);
        assert_eq!(read_global_shortcut_presets_file(&path).unwrap(), "[]");

        write_global_shortcut_presets_file(&path, r#"[{"id":"editing"}]"#).unwrap();
        assert_eq!(
            read_global_shortcut_presets_file(&path).unwrap(),
            r#"[{"id":"editing"}]"#
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn round_trips_app_preferences_file() {
        let root = test_dir("app-prefs");
        let path = root.join(APP_PREFERENCES_FILE);
        assert_eq!(read_app_preferences_file(&path).unwrap(), "{}");

        write_app_preferences_file(
            &path,
            r#"{"fileBehavior":{"exportFormat":"aiff","exportBitDepth":24,"exportFloat":false},"workspace":{"defaultWorkspaceId":"mixing"}}"#,
        )
        .unwrap();
        assert_eq!(
            read_app_preferences_file(&path).unwrap(),
            r#"{"fileBehavior":{"exportFormat":"aiff","exportBitDepth":24,"exportFloat":false},"workspace":{"defaultWorkspaceId":"mixing"}}"#
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn test_dir(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "monet-rythme-{name}-{}-{stamp}",
            std::process::id()
        ))
    }
}
