#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_integration;
mod ipc;
mod state;
mod tray;

use desktop_integration::register_taskbar_created_msg;
use ipc::commands::{
    apply_wallpaper_snapshot, get_display_bounds, get_settings, import_image, load_canvas,
    save_canvas, set_wallpaper_backend, toggle_mode, update_settings,
};
use state::{load_settings, AppState};
use std::path::PathBuf;
use tauri::Manager;
use tracing::{error, info, warn, Level};
use tracing_subscriber::FmtSubscriber;
use windows::Win32::Foundation::HWND;

fn init_logging() -> Result<(), Box<dyn std::error::Error>> {
    let log_dir = if let Ok(override_dir) = std::env::var("DESKTOP_CANVAS_DEV_APPDATA_OVERRIDE") {
        PathBuf::from(override_dir).join("logs")
    } else if let Some(app_data) = dirs::data_dir() {
        app_data.join("DesktopCanvas").join("logs")
    } else {
        PathBuf::from("logs")
    };

    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "shell.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .with_writer(non_blocking)
        .finish();

    Box::leak(Box::new(_guard));

    let _ = tracing::subscriber::set_global_default(subscriber);
    info!("Logging initialized in directory: {:?}", log_dir);
    Ok(())
}

fn main() {
    let _ = init_logging();
    info!("Starting Desktop Canvas Native Shell v0.1.0");

    #[cfg(windows)]
    unsafe {
        use windows::core::w;
        use windows::Win32::System::StationsAndDesktops::{
            OpenDesktopW, SetThreadDesktop, DESKTOP_CONTROL_FLAGS,
        };
        if let Ok(desk) = OpenDesktopW(w!("Default"), DESKTOP_CONTROL_FLAGS(0), false, 0x01FF) {
            if !desk.is_invalid() {
                let _ = SetThreadDesktop(desk);
                info!("Attached process thread to interactive desktop 'Default'");
            }
        }
    }

    const IPC_PORT: u16 = 39268;
    let ipc_addr = std::net::SocketAddr::from(([127, 0, 0, 1], IPC_PORT));

    // Check if an existing primary instance is already running
    if let Ok(mut stream) = std::net::TcpStream::connect_timeout(&ipc_addr, std::time::Duration::from_millis(300)) {
        info!("Existing Desktop Canvas instance detected on 127.0.0.1:{}. Sending WAKEUP signal...", IPC_PORT);
        #[cfg(windows)]
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
            let _ = AllowSetForegroundWindow(ASFW_ANY);
        }
        use std::io::Write;
        let _ = stream.write_all(b"WAKEUP\n");
        let _ = stream.flush();
        info!("Wakeup signal sent to primary instance. Exiting secondary process.");
        return;
    }

    // Bind the loopback port as the primary instance
    let ipc_listener = match std::net::TcpListener::bind(ipc_addr) {
        Ok(listener) => {
            info!("Successfully bound primary instance IPC listener on port {}", IPC_PORT);
            Some(listener)
        }
        Err(e) => {
            warn!("Could not bind port {}: {}. Retrying connect once...", IPC_PORT, e);
            std::thread::sleep(std::time::Duration::from_millis(200));
            if let Ok(mut stream) = std::net::TcpStream::connect_timeout(&ipc_addr, std::time::Duration::from_millis(300)) {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
                    let _ = AllowSetForegroundWindow(ASFW_ANY);
                }
                use std::io::Write;
                let _ = stream.write_all(b"WAKEUP\n");
                let _ = stream.flush();
                info!("Wakeup signal sent on retry. Exiting secondary process.");
                return;
            }
            None
        }
    };

    let taskbar_created_msg = register_taskbar_created_msg();
    info!("Registered TaskbarCreated message ID: {}", taskbar_created_msg);

    let initial_settings = load_settings();
    info!(
        "Loaded settings on launch: first_run_completed={}",
        initial_settings.first_run_completed
    );

    let args: Vec<String> = std::env::args().collect();
    let inject_workerw = !args.iter().any(|arg| arg == "--windowed");
    info!("Inject WorkerW flag: {}", inject_workerw);

    let app_state = AppState::new(inject_workerw);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            set_wallpaper_backend,
            apply_wallpaper_snapshot,
            toggle_mode,
            get_display_bounds,
            import_image,
            save_canvas,
            load_canvas,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                info!("Window CloseRequested: transitioning to Wallpaper Mode instead of closing");
                let _ = ipc::commands::toggle_mode_internal(&app, Some("wallpaper"));
            }
        })
        .setup(move |app| {
            info!("Running Tauri application setup...");
            let handle = app.handle();

            if let Err(e) = tray::create_system_tray(handle) {
                error!("Failed to create system tray: {}", e);
            } else {
                info!("System tray created successfully");
            }

            if let Some(listener) = ipc_listener {
                let ipc_app_handle = handle.clone();
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    info!("Single-instance IPC thread running, waiting for connections on port {}", IPC_PORT);
                    for stream in listener.incoming() {
                        match stream {
                            Ok(stream) => {
                                let mut reader = BufReader::new(stream);
                                let mut line = String::new();
                                if reader.read_line(&mut line).is_ok() {
                                    let cmd = line.trim();
                                    info!("IPC command received: {}", cmd);
                                    if cmd == "WAKEUP" {
                                        info!("IPC WAKEUP received! Bringing Studio Edit Mode window to foreground...");
                                        let _ = ipc::commands::toggle_mode_internal(&ipc_app_handle, Some("edit"));
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Error accepting IPC connection: {}", e);
                            }
                        }
                    }
                });
            }

            let hotkey_app_handle = handle.clone();

            std::thread::spawn(move || {
                use windows::Win32::UI::Input::KeyboardAndMouse::{
                    RegisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
                };
                use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

                unsafe {
                    let mod_ctrl_alt = HOT_KEY_MODIFIERS(MOD_CONTROL.0 | MOD_ALT.0 | MOD_NOREPEAT.0);
                    let _ = RegisterHotKey(HWND(std::ptr::null_mut()), 1, mod_ctrl_alt, 0x44);
                    let _ = RegisterHotKey(HWND(std::ptr::null_mut()), 2, MOD_NOREPEAT, 0x77);

                    info!("Global hotkeys registered (Ctrl+Alt+D, F8)");

                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
                        if msg.message == WM_HOTKEY {
                            info!("Global hotkey triggered, toggling mode...");
                            let _ = ipc::commands::toggle_mode_internal(&hotkey_app_handle, None);
                        } else if taskbar_created_msg != 0 && msg.message == taskbar_created_msg {
                            info!("TaskbarCreated broadcast received in background loop, refreshing shell state...");
                            let _ = ipc::commands::toggle_mode_internal(&hotkey_app_handle, Some("wallpaper"));
                        }
                    }
                }
            });

            let main_window = app.get_webview_window("main");
            info!("app.get_webview_window('main') result: {:?}", main_window.is_some());
            if let Some(window) = main_window {
                let show_res = window.show();
                info!("window.show() result: {:?}", show_res);
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
                info!("Desktop Canvas main studio window displayed and focused successfully.");
            } else {
                error!("CRITICAL: get_webview_window('main') returned None!");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running Desktop Canvas application");
}
