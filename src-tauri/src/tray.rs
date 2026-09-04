use crate::desktop_integration::{is_autostart_enabled, set_autostart_enabled};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tracing::{error, info};

pub const TRAY_ID: &str = "desktop-canvas-tray";

pub fn create_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_item = MenuItem::with_id(app, "toggle_mode", "Toggle Edit Mode", true, None::<&str>)?;
    let reconfigure_item = MenuItem::with_id(app, "reconfigure", "Reconfigure Canvas...", true, None::<&str>)?;
    let open_folder_item = MenuItem::with_id(app, "open_folder", "Open Canvas Folder", true, None::<&str>)?;
    
    let autostart_state = is_autostart_enabled();
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        autostart_state,
        None::<&str>,
    )?;
    
    let quit_item = MenuItem::with_id(app, "quit", "Quit Desktop Canvas", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &sep1,
            &reconfigure_item,
            &open_folder_item,
            &sep2,
            &autostart_item,
            &sep3,
            &quit_item,
        ],
    )?;

    let icon = app.default_window_icon().cloned().expect("Default window icon must be defined in tauri.conf.json");

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("Desktop Canvas")
        .on_menu_event(move |app_handle, event| {
            let id_str = event.id.as_ref();
            match id_str {
                "toggle_mode" => {
                    info!("Tray menu: Toggle Edit Mode triggered");
                    let _ = crate::ipc::commands::toggle_mode_internal(app_handle, None);
                }
                "reconfigure" => {
                    info!("Tray menu: Reconfigure Canvas triggered");
                    use tauri::Emitter;
                    let _ = crate::ipc::commands::toggle_mode_internal(app_handle, Some("edit"));
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app_handle.emit("show-wizard", ());
                }
                "open_folder" => {
                    info!("Tray menu: Open Canvas Folder triggered");
                    if let Some(app_data) = dirs::data_dir() {
                        let canvas_folder = app_data.join("DesktopCanvas");
                        let _ = std::fs::create_dir_all(&canvas_folder);
                        let _ = std::process::Command::new("explorer")
                            .arg(canvas_folder.to_string_lossy().to_string())
                            .spawn();
                    }
                }
                "autostart" => {
                    let currently_enabled = is_autostart_enabled();
                    let new_state = !currently_enabled;
                    info!("Tray menu: Toggle autostart to {}", new_state);
                    if let Err(e) = set_autostart_enabled(new_state) {
                        error!("Failed to update autostart setting: {}", e);
                    } else {
                        let mut current = crate::state::load_settings();
                        current.autostart = new_state;
                        let _ = crate::state::save_settings(&current);
                    }
                }
                "quit" => {
                    info!("Tray menu: Quit Desktop Canvas triggered");
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                info!("Tray icon left clicked - toggling mode");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = crate::ipc::commands::toggle_mode_internal(app, None);
                }
            }
        })
        .build(app)?;

    Ok(())
}
