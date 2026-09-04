use super::schema::{CanvasStateSchema, SettingsSchema};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{error, info, warn};

pub fn get_app_data_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("DESKTOP_CANVAS_DEV_APPDATA_OVERRIDE") {
        PathBuf::from(override_dir)
    } else if let Some(app_data) = dirs::data_dir() {
        app_data.join("DesktopCanvas")
    } else {
        PathBuf::from(".")
    }
}

pub fn get_settings_path() -> PathBuf {
    get_app_data_dir().join("settings.json")
}

#[allow(dead_code)]
pub fn get_canvas_state_path() -> PathBuf {
    get_app_data_dir().join("canvas_state.json")
}

#[allow(dead_code)]
pub fn get_backups_dir() -> PathBuf {
    get_app_data_dir().join("backups")
}

pub fn load_settings() -> SettingsSchema {
    let path = get_settings_path();
    if !path.exists() {
        info!("No existing settings.json found at {:?}, returning defaults", path);
        return SettingsSchema::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<SettingsSchema>(&content) {
            Ok(settings) => {
                info!("Successfully loaded settings from {:?}", path);
                settings
            }
            Err(e) => {
                error!("Failed to parse settings JSON at {:?}: {}. Using defaults.", path, e);
                SettingsSchema::default()
            }
        },
        Err(e) => {
            error!("Failed to read settings file at {:?}: {}. Using defaults.", path, e);
            SettingsSchema::default()
        }
    }
}

pub fn save_settings(settings: &SettingsSchema) -> Result<(), String> {
    let dir = get_app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create AppData directory {:?}: {}", dir, e))?;

    let target_path = get_settings_path();
    let temp_path = dir.join(format!("settings.tmp.{}", std::process::id()));

    let json_bytes = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings schema: {}", e))?;

    fs::write(&temp_path, &json_bytes)
        .map_err(|e| format!("Failed to write temp settings file {:?}: {}", temp_path, e))?;

    fs::rename(&temp_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename temp file to {:?}: {}", target_path, e)
    })?;

    info!("Successfully saved settings to {:?}", target_path);
    Ok(())
}

fn get_timestamp_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

/// Prunes rolling backups in `backups/` directory, retaining only the `max_keep` most recent files.
pub fn prune_rolling_backups(backups_dir: &Path, max_keep: usize) {
    if let Ok(entries) = fs::read_dir(backups_dir) {
        let mut backup_files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.starts_with("canvas_state.") && s.ends_with(".json"))
                        .unwrap_or(false)
            })
            .collect();

        backup_files.sort();

        if backup_files.len() > max_keep {
            let to_remove = backup_files.len() - max_keep;
            for file in backup_files.iter().take(to_remove) {
                if let Err(e) = fs::remove_file(file) {
                    warn!("Failed to prune old backup file {:?}: {}", file, e);
                } else {
                    info!("Pruned old backup file {:?}", file);
                }
            }
        }
    }
}

pub fn save_canvas_state_to_dir(dir: &Path, state: &CanvasStateSchema) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create AppData directory {:?}: {}", dir, e))?;

    let backups_dir = dir.join("backups");
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backups directory {:?}: {}", backups_dir, e))?;

    let json_bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| format!("Failed to serialize CanvasStateSchema: {}", e))?;

    let target_path = dir.join("canvas_state.json");
    let temp_path = dir.join(format!("canvas_state.tmp.{}", std::process::id()));

    fs::write(&temp_path, &json_bytes)
        .map_err(|e| format!("Failed to write temp canvas state {:?}: {}", temp_path, e))?;

    fs::rename(&temp_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename temp file to {:?}: {}", target_path, e)
    })?;

    let ts = get_timestamp_string();
    let backup_path = backups_dir.join(format!("canvas_state.{}.json", ts));
    if let Err(e) = fs::write(&backup_path, &json_bytes) {
        warn!("Failed to write rolling backup {:?}: {}", backup_path, e);
    } else {
        info!("Saved rolling backup to {:?}", backup_path);
    }

    prune_rolling_backups(&backups_dir, 5);

    Ok(ts)
}

pub fn save_canvas_state(state: &CanvasStateSchema) -> Result<String, String> {
    let dir = get_app_data_dir();
    save_canvas_state_to_dir(&dir, state)
}

pub fn load_canvas_state_from_dir(dir: &Path) -> CanvasStateSchema {
    let path = dir.join("canvas_state.json");
    if !path.exists() {
        info!("No existing canvas_state.json found at {:?}, returning empty default", path);
        return CanvasStateSchema::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<CanvasStateSchema>(&content) {
            Ok(state) => {
                info!("Successfully loaded canvas state from {:?}", path);
                state
            }
            Err(e) => {
                error!("Corrupted canvas_state.json detected at {:?}: {}. Attempting self-healing recovery...", path, e);
                recover_from_backups_or_default(dir, &path)
            }
        },
        Err(e) => {
            error!("Failed to read canvas state file {:?}: {}. Recovering from backups...", path, e);
            recover_from_backups_or_default(dir, &path)
        }
    }
}

pub fn load_canvas_state() -> CanvasStateSchema {
    let dir = get_app_data_dir();
    load_canvas_state_from_dir(&dir)
}

fn recover_from_backups_or_default(app_data_dir: &Path, corrupted_path: &Path) -> CanvasStateSchema {
    let ts = get_timestamp_string();
    let archive_path = app_data_dir.join(format!("canvas_state.corrupt.{}.json", ts));
    let _ = fs::rename(corrupted_path, &archive_path);

    let backups_dir = app_data_dir.join("backups");
    if let Ok(entries) = fs::read_dir(&backups_dir) {
        let mut backup_files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.starts_with("canvas_state.") && s.ends_with(".json"))
                        .unwrap_or(false)
            })
            .collect();

        backup_files.sort_by(|a, b| b.cmp(a));

        for backup in backup_files {
            if let Ok(content) = fs::read_to_string(&backup) {
                if let Ok(state) = serde_json::from_str::<CanvasStateSchema>(&content) {
                    info!("Successfully recovered canvas state from backup {:?}", backup);
                    let _ = save_canvas_state_to_dir(app_data_dir, &state);
                    return state;
                }
            }
        }
    }

    warn!("No valid rolling backups found; initializing fresh default canvas state.");
    let default_state = CanvasStateSchema::default();
    let _ = save_canvas_state_to_dir(app_data_dir, &default_state);
    default_state
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::schema::*;

    #[test]
    fn test_roundtrip_canvas_state() {
        let state = CanvasStateSchema {
            schema_version: 1,
            viewport: ViewportSchema::default(),
            backdrop: BackdropSchema::default(),
            elements: vec![
                CanvasElement::Stroke(StrokeElementSchema {
                    id: "stroke-1".into(),
                    tool: "pen".into(),
                    points: vec![
                        StrokePointSchema { x: 10.0, y: 10.0, pressure: 0.5 },
                        StrokePointSchema { x: 20.0, y: 25.0, pressure: 0.8 },
                    ],
                    color: "#5B8CFF".into(),
                    width: 4.0,
                    opacity: 1.0,
                    blend_mode: "normal".into(),
                    z_index: 1,
                }),
                CanvasElement::TextNote(TextNoteSchema {
                    id: "note-1".into(),
                    content: "Test note content".into(),
                    typography: TypographySchema {
                        font_family: "Segoe UI".into(),
                        font_size: 16.0,
                        color: "#713F12".into(),
                        font_weight: 400,
                    },
                    sticky_style: Some(StickyStyleSchema {
                        background_color: "#FEF08A".into(),
                        corner_radius: 12.0,
                    }),
                    dimensions: DimensionsSchema {
                        x: 100.0,
                        y: 100.0,
                        width: 200.0,
                        height: 150.0,
                    },
                    z_index: 2,
                }),
            ],
        };

        let json = serde_json::to_string_pretty(&state).expect("Serialization failed");
        let deserialized: CanvasStateSchema = serde_json::from_str(&json).expect("Deserialization failed");

        assert_eq!(state, deserialized);
        assert_eq!(deserialized.elements.len(), 2);
    }

    #[test]
    fn test_rolling_backups_pruning_to_five() {
        let temp_dir = std::env::temp_dir().join(format!("dc_test_prune_{}", std::process::id()));
        let backups_dir = temp_dir.join("backups");
        let _ = fs::create_dir_all(&backups_dir);

        for i in 1..=8 {
            let p = backups_dir.join(format!("canvas_state.1000000{}.json", i));
            let _ = fs::write(&p, b"{}");
        }

        prune_rolling_backups(&backups_dir, 5);

        let remaining: Vec<_> = fs::read_dir(&backups_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();

        assert_eq!(remaining.len(), 5);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_corrupted_json_falls_back_to_backup() {
        let temp_dir = std::env::temp_dir().join(format!("dc_test_recover_{}", std::process::id()));
        let backups_dir = temp_dir.join("backups");
        let _ = fs::create_dir_all(&backups_dir);

        let valid_state = CanvasStateSchema {
            schema_version: 1,
            viewport: ViewportSchema::default(),
            backdrop: BackdropSchema::default(),
            elements: vec![],
        };
        let valid_json = serde_json::to_string(&valid_state).unwrap();
        let backup_path = backups_dir.join("canvas_state.100.json");
        fs::write(&backup_path, &valid_json).unwrap();

        let main_path = temp_dir.join("canvas_state.json");
        fs::write(&main_path, b"{ invalid json content !!!").unwrap();

        let loaded = load_canvas_state_from_dir(&temp_dir);
        assert_eq!(loaded.schema_version, 1);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
