use crate::desktop_integration::{
    get_display_topology, trim_working_set_memory, DesktopCanvasState, DisplayTopology,
};
use crate::state::{
    import_image_bytes, load_canvas_state, load_settings, save_canvas_state, save_settings,
    AppState, AssetReference, BackdropSchema, CanvasStateSchema, SettingsPatch, SettingsSchema,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    pub settings: SettingsSchema,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeResponse {
    pub ok: bool,
    pub mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModeChangedPayload {
    pub mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSavedResponse {
    pub ok: bool,
    pub saved_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasLoadedResponse {
    pub state: CanvasStateSchema,
}

#[tauri::command]
pub fn get_settings() -> Result<SettingsResponse, String> {
    let settings = load_settings();
    Ok(SettingsResponse { settings })
}

#[tauri::command]
pub fn update_settings(patch: SettingsPatch) -> Result<SettingsResponse, String> {
    let mut current = load_settings();
    current.apply_patch(patch);
    save_settings(&current)?;
    info!("Settings updated successfully");
    Ok(SettingsResponse { settings: current })
}

#[tauri::command]
pub fn set_wallpaper_backend(backdrop: BackdropSchema) -> Result<OkResponse, String> {
    let mut current = load_settings();
    current.backdrop = backdrop;
    save_settings(&current)?;
    info!("Wallpaper backend backdrop updated");
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn apply_wallpaper_snapshot(base64_png: String) -> Result<OkResponse, String> {
    use base64::Engine;
    let clean_base64 = if let Some(idx) = base64_png.find(',') {
        &base64_png[idx + 1..]
    } else {
        &base64_png
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode base64 wallpaper PNG: {}", e))?;

    let app_data = dirs::data_dir().ok_or("Failed to locate %APPDATA%")?;
    let target_dir = app_data.join("DesktopCanvas");
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_path = target_dir.join("wallpaper.png");

    std::fs::write(&target_path, bytes)
        .map_err(|e| format!("Failed to write wallpaper image: {}", e))?;

    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
            SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE,
        };

        let path_str = target_path.to_string_lossy();
        let path_wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();

        let _ = SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(path_wide.as_ptr() as *mut core::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(SPIF_UPDATEINIFILE.0 | SPIF_SENDCHANGE.0),
        );
        info!("Successfully synchronized Windows desktop wallpaper to {:?}", target_path);
    }

    Ok(OkResponse { ok: true })
}

pub fn toggle_mode_internal(app: &AppHandle, target: Option<&str>) -> Result<ModeResponse, String> {
    use tauri::Manager;

    let state = app.state::<AppState>();
    let mut sm = state.state_machine.lock().map_err(|e| e.to_string())?;

    // Request frontend to persist canvas and snapshot before entering wallpaper mode
    if target.is_none() && sm.current_state != DesktopCanvasState::WallpaperMode {
        info!("In Edit Mode: emitting request-toggle-mode to frontend for seamless wallpaper sync");
        let _ = app.emit("request-toggle-mode", ());
        return Ok(ModeResponse {
            ok: true,
            mode: "wallpaper".to_string(),
        });
    }

    let new_mode = match target {
        Some("wallpaper") => {
            sm.current_state = DesktopCanvasState::WallpaperMode;
            "wallpaper"
        }
        Some("edit") => {
            sm.current_state = DesktopCanvasState::EditMode;
            "edit"
        }
        _ => {
            if sm.current_state == DesktopCanvasState::WallpaperMode {
                sm.current_state = DesktopCanvasState::EditMode;
                "edit"
            } else {
                sm.current_state = DesktopCanvasState::WallpaperMode;
                "wallpaper"
            }
        }
    };

    info!("Toggling Desktop Canvas mode to: {}", new_mode);

    if let Some(window) = app.get_webview_window("main") {
        if new_mode == "wallpaper" {
            let _ = window.set_always_on_top(false);
            let _ = window.hide();
            trim_working_set_memory();
        } else {
            let _ = window.show();
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            let _ = window.set_focus();
            #[cfg(windows)]
            if let Ok(h) = window.hwnd() {
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
                        IsIconic, IsZoomed, SetForegroundWindow, ShowWindow, SW_MAXIMIZE,
                        SW_RESTORE, SW_SHOW,
                    };
                    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};

                    let win_hwnd = HWND(h.0 as *mut core::ffi::c_void);
                    let foreground_hwnd = GetForegroundWindow();
                    let foreground_tid = GetWindowThreadProcessId(foreground_hwnd, None);
                    let current_tid = GetCurrentThreadId();

                    let is_iconic = IsIconic(win_hwnd).as_bool();
                    let is_zoomed = IsZoomed(win_hwnd).as_bool();

                    let show_cmd = if is_iconic {
                        if is_zoomed {
                            SW_MAXIMIZE
                        } else {
                            SW_RESTORE
                        }
                    } else {
                        SW_SHOW
                    };

                    if foreground_tid != 0 && foreground_tid != current_tid {
                        let _ = AttachThreadInput(current_tid, foreground_tid, true);
                        let _ = ShowWindow(win_hwnd, show_cmd);
                        let _ = BringWindowToTop(win_hwnd);
                        let _ = SetForegroundWindow(win_hwnd);
                        let _ = AttachThreadInput(current_tid, foreground_tid, false);
                    } else {
                        let _ = ShowWindow(win_hwnd, show_cmd);
                        let _ = BringWindowToTop(win_hwnd);
                        let _ = SetForegroundWindow(win_hwnd);
                    }
                }
            }
        }
    } else {
        warn!("Main webview window not found when toggling mode! Re-creating Studio window...");
        if new_mode == "edit" {
            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Desktop Canvas")
            .maximized(true)
            .visible(true);
            let _ = builder.build();
        }
    }

    let _ = app.emit(
        "mode-changed",
        ModeChangedPayload {
            mode: new_mode.to_string(),
        },
    );

    Ok(ModeResponse {
        ok: true,
        mode: new_mode.to_string(),
    })
}

#[tauri::command]
pub fn toggle_mode(
    app: AppHandle,
    _state: State<'_, AppState>,
    target: Option<String>,
) -> Result<ModeResponse, String> {
    toggle_mode_internal(&app, target.as_deref())
}

#[tauri::command]
pub fn get_display_bounds() -> Result<DisplayTopology, String> {
    Ok(get_display_topology())
}

#[tauri::command]
pub fn import_image(base64_data: String, mime_type: String) -> Result<AssetReference, String> {
    let raw_b64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw_b64.trim())
        .map_err(|e| format!("Failed to decode base64 image data: {}", e))?;

    import_image_bytes(&bytes, &mime_type)
}

#[tauri::command]
pub fn save_canvas(state: CanvasStateSchema) -> Result<CanvasSavedResponse, String> {
    let saved_at = save_canvas_state(&state)?;
    Ok(CanvasSavedResponse {
        ok: true,
        saved_at,
    })
}

#[tauri::command]
pub fn load_canvas() -> Result<CanvasLoadedResponse, String> {
    let state = load_canvas_state();
    Ok(CanvasLoadedResponse { state })
}
