use monet_ui::{Accent, MonetWindow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{env, fs, sync::Mutex};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime, WebviewUrl, WebviewWindow};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedSelection {
    catalog_id: Option<String>,
    active_photo_id: Option<i64>,
    selection: Vec<i64>,
    revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofConfig {
    catalog_path: String,
    fixtures: [String; 2],
}

fn proof_config() -> Result<Option<ProofConfig>, String> {
    let Some(catalog_path) = env::var("GALERIE_SECONDARY_PROOF_CATALOG").ok() else {
        return Ok(None);
    };
    let fixture_one =
        env::var("GALERIE_SECONDARY_PROOF_FIXTURE_ONE").map_err(|_| "missing proof fixture one")?;
    let fixture_two =
        env::var("GALERIE_SECONDARY_PROOF_FIXTURE_TWO").map_err(|_| "missing proof fixture two")?;
    Ok(Some(ProofConfig {
        catalog_path,
        fixtures: [fixture_one, fixture_two],
    }))
}

fn require_proof() -> Result<(), String> {
    proof_config()?
        .map(|_| ())
        .ok_or("secondary proof is not enabled".into())
}

#[tauri::command]
fn shared_selection(
    state: tauri::State<'_, Mutex<SharedSelection>>,
) -> Result<SharedSelection, String> {
    state
        .lock()
        .map(|shared| shared.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_shared_selection<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, Mutex<SharedSelection>>,
    catalog_id: Option<String>,
    active_photo_id: Option<i64>,
    selection: Vec<i64>,
) -> Result<SharedSelection, String> {
    let snapshot = {
        let mut shared = state.lock().map_err(|e| e.to_string())?;
        update_shared_selection(&mut shared, catalog_id, active_photo_id, selection)?
    };
    app.emit("galerie://shared-selection", &snapshot)
        .map_err(|e| e.to_string())?;
    Ok(snapshot)
}

fn update_shared_selection(
    shared: &mut SharedSelection,
    catalog_id: Option<String>,
    active_photo_id: Option<i64>,
    selection: Vec<i64>,
) -> Result<SharedSelection, String> {
    if catalog_id.is_none() && (active_photo_id.is_some() || !selection.is_empty()) {
        return Err("a missing catalog requires an empty selection".into());
    }
    if active_photo_id.is_some_and(|id| !selection.contains(&id)) {
        return Err("active photo must be selected".into());
    }
    shared.catalog_id = catalog_id;
    shared.active_photo_id = active_photo_id;
    shared.selection = selection;
    shared.revision += 1;
    Ok(shared.clone())
}

#[tauri::command]
async fn open_secondary_display<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("secondary") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    MonetWindow::builder(
        &app,
        "secondary",
        WebviewUrl::App("index.html?secondary=1".into()),
    )
    .title("Monet Galerie — Secondary Display")
    .accent(Accent::Raster)
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 500.0)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn secondary_proof_config() -> Result<Option<ProofConfig>, String> {
    proof_config()
}

#[tauri::command]
fn secondary_proof_windows<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Vec<String>, String> {
    require_proof()?;
    // Dropdowns and menus open in (hidden, pooled) monet-ui popup windows.
    let mut labels = app
        .webview_windows()
        .into_keys()
        .filter(|label| !monet_ui::is_popup_label(label))
        .collect::<Vec<_>>();
    labels.sort();
    Ok(labels)
}

#[tauri::command]
fn secondary_proof_observe<R: Runtime>(
    app: tauri::AppHandle<R>,
    window: WebviewWindow<R>,
    observation: Value,
) -> Result<(), String> {
    require_proof()?;
    if window.label() != "secondary" {
        return Err("only the secondary webview may report observations".into());
    }
    app.emit("galerie://secondary-proof-observation", observation)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secondary_proof_close<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    require_proof()?;
    app.get_webview_window("secondary")
        .ok_or("secondary window is not open")?
        .close()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secondary_proof_emit_stale<R: Runtime>(
    app: tauri::AppHandle<R>,
    snapshot: SharedSelection,
) -> Result<(), String> {
    require_proof()?;
    app.emit("galerie://shared-selection", snapshot)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secondary_proof_finish(report: Value) -> Result<(), String> {
    require_proof()?;
    let output = env::var("GALERIE_SECONDARY_PROOF_OUTPUT")
        .map_err(|_| "missing secondary proof output path")?;
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    fs::write(output, bytes).map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secondary")
        .setup(|app, _| {
            app.manage(Mutex::new(SharedSelection::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_secondary_display,
            shared_selection,
            set_shared_selection,
            secondary_proof_config,
            secondary_proof_windows,
            secondary_proof_observe,
            secondary_proof_close,
            secondary_proof_emit_stale,
            secondary_proof_finish
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_snapshot_is_restart_safe_data() {
        let snapshot = SharedSelection {
            catalog_id: Some("/tmp/proof.galcat".into()),
            active_photo_id: Some(7),
            selection: vec![7, 9],
            revision: 3,
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        assert_eq!(
            serde_json::from_str::<SharedSelection>(&json)
                .unwrap()
                .selection,
            vec![7, 9]
        );
    }

    #[test]
    fn accepts_an_explicit_no_catalog_reset() {
        let mut shared = SharedSelection {
            catalog_id: Some("/tmp/proof.galcat".into()),
            active_photo_id: Some(7),
            selection: vec![7],
            revision: 3,
        };
        let reset = update_shared_selection(&mut shared, None, None, vec![]).unwrap();
        assert_eq!(reset.catalog_id, None);
        assert_eq!(reset.active_photo_id, None);
        assert!(reset.selection.is_empty());
        assert_eq!(reset.revision, 4);
    }

    #[test]
    fn rejects_invalid_shared_selection_combinations() {
        let mut shared = SharedSelection::default();
        assert_eq!(
            update_shared_selection(&mut shared, None, Some(7), vec![7]).unwrap_err(),
            "a missing catalog requires an empty selection"
        );
        assert_eq!(
            update_shared_selection(
                &mut shared,
                Some("/tmp/proof.galcat".into()),
                Some(7),
                vec![9]
            )
            .unwrap_err(),
            "active photo must be selected"
        );
        assert_eq!(shared.revision, 0);
    }
}
