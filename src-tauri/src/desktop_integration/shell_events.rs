use super::reparent::{get_virtual_screen_bounds, VirtualScreenRect};
use super::state_machine::{DesktopCanvasState, DesktopStateMachine};
use super::traits::WindowEnumerationSource;
use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use tracing::{error, info, warn};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, RegisterWindowMessageW, SetWindowLongPtrW,
    SetWindowPos, GWLP_WNDPROC, HTTRANSPARENT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    WM_DISPLAYCHANGE, WM_NCHITTEST, WNDPROC,
};

#[allow(dead_code)]
static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
#[allow(dead_code)]
static TASKBAR_CREATED_MSG: AtomicU32 = AtomicU32::new(0);
#[allow(dead_code)]
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Registers the "TaskbarCreated" window message broadcasted by Windows when Explorer restarts.
pub fn register_taskbar_created_msg() -> u32 {
    #[cfg(windows)]
    unsafe {
        RegisterWindowMessageW(w!("TaskbarCreated"))
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Attaches a Win32 window subclass to handle TaskbarCreated, WM_DISPLAYCHANGE, and transparent hit-testing.
#[allow(dead_code)]
pub fn attach_shell_subclass(hwnd: HWND, app: tauri::AppHandle) {
    if (hwnd.0 as usize) == 0 || (hwnd.0 as usize) == 0x9999 {
        return;
    }

    let _ = APP_HANDLE.set(app);
    let taskbar_msg = register_taskbar_created_msg();
    TASKBAR_CREATED_MSG.store(taskbar_msg, Ordering::SeqCst);

    unsafe {
        let prev = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        if prev != 0 && prev != (shell_subclass_wndproc as *const () as usize as isize) {
            ORIGINAL_WNDPROC.store(prev, Ordering::SeqCst);
            let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, shell_subclass_wndproc as *const () as usize as isize);
            info!("Attached shell window subclass to host HWND {:?}", hwnd);
        }
    }
}

unsafe extern "system" fn shell_subclass_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let taskbar_msg = TASKBAR_CREATED_MSG.load(Ordering::Relaxed);
    if taskbar_msg != 0 && msg == taskbar_msg {
        info!("Received TaskbarCreated message in window subclass!");
        if let Some(app) = APP_HANDLE.get() {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                let _ = crate::ipc::commands::toggle_mode_internal(&app_clone, Some("wallpaper"));
            });
        }
        return LRESULT(0);
    }

    if msg == WM_DISPLAYCHANGE {
        info!("Received WM_DISPLAYCHANGE message in window subclass");
        let _ = handle_display_change(hwnd);
        if let Some(app) = APP_HANDLE.get() {
            use tauri::Emitter;
            let topo = crate::desktop_integration::get_display_topology();
            let _ = app.emit("display-changed", topo);
        }
        return LRESULT(0);
    }

    if msg == WM_NCHITTEST {
        if let Some(app) = APP_HANDLE.get() {
            use tauri::Manager;
            if let Ok(sm) = app.state::<crate::state::AppState>().state_machine.lock() {
                if sm.current_state == DesktopCanvasState::WallpaperMode {
                    return LRESULT(HTTRANSPARENT as isize);
                }
            }
        }
    }

    let prev = ORIGINAL_WNDPROC.load(Ordering::Relaxed);
    if prev != 0 {
        let prev_fn: WNDPROC = std::mem::transmute(prev);
        CallWindowProcW(prev_fn, hwnd, msg, wparam, lparam)
    } else {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

/// Handles the `TaskbarCreated` event triggered after an Explorer.exe crash or restart.
/// Executes WorkerW discovery with backoff, reparents the host window, and restores wallpaper mode styles.
#[allow(dead_code)]
pub fn handle_taskbar_created<S: WindowEnumerationSource>(
    host_hwnd: HWND,
    source: &S,
    state_machine: &mut DesktopStateMachine,
    sleep_fn: impl Fn(std::time::Duration),
) -> Result<HWND, String> {
    info!("Explorer.exe restart detected via TaskbarCreated message. Initiating re-injection sequence...");
    state_machine.current_state = DesktopCanvasState::AppStartup;

    match state_machine.execute_injection_with_backoff(source, sleep_fn) {
        Ok(workerw_hwnd) => {
            info!("Located new WorkerW host {:?} after Explorer restart. Reparenting...", workerw_hwnd);
            super::reparent::transition_to_wallpaper_mode(host_hwnd, workerw_hwnd)?;
            info!("Successfully restored Wallpaper Mode after Explorer restart.");
            Ok(workerw_hwnd)
        }
        Err(err) => {
            warn!("Failed to re-inject into WorkerW after Explorer restart: {:?}. Entering SafeMode fallback.", err);
            state_machine.current_state = DesktopCanvasState::SafeMode;
            Err(format!("Re-injection failed: {:?}", err))
        }
    }
}

/// Handles `WM_DISPLAYCHANGE` when monitors are connected, disconnected, or screen resolutions change.
/// Updates the host window size and coordinates to cover the new virtual desktop.
#[allow(dead_code)]
pub fn handle_display_change(host_hwnd: HWND) -> Result<VirtualScreenRect, String> {
    let bounds = get_virtual_screen_bounds();
    info!(
        "WM_DISPLAYCHANGE: Updating virtual screen bounds to (x={}, y={}, w={}, h={})",
        bounds.x, bounds.y, bounds.width, bounds.height
    );

    if (host_hwnd.0 as usize) == 0x9999 {
        return Ok(bounds);
    }

    #[cfg(windows)]
    unsafe {
        let ok = SetWindowPos(
            host_hwnd,
            HWND_BOTTOM,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        if ok.is_err() {
            error!("SetWindowPos failed during display change adjustment: {:?}", ok);
            return Err("Failed to reposition window on display change".into());
        }
    }

    Ok(bounds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_integration::traits::mock::{MockWindowNode, MockWindowSource};

    #[test]
    fn test_taskbar_created_triggers_re_injection() {
        let source = MockWindowSource::new(vec![
            MockWindowNode {
                id: 100,
                class_name: "Progman".into(),
                title: Some("Program Manager".into()),
                children: vec![],
            },
            MockWindowNode {
                id: 200,
                class_name: "WorkerW".into(),
                title: None,
                children: vec![MockWindowNode {
                    id: 201,
                    class_name: "SHELLDLL_DefView".into(),
                    title: None,
                    children: vec![],
                }],
            },
            MockWindowNode {
                id: 300,
                class_name: "WorkerW".into(),
                title: None,
                children: vec![],
            },
        ]);

        let mut sm = DesktopStateMachine::new();
        let fake_host = HWND(0x9999 as _);

        let result = handle_taskbar_created(fake_host, &source, &mut sm, |_| {});
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), HWND(300 as *mut core::ffi::c_void));
        assert_eq!(sm.current_state, DesktopCanvasState::WallpaperMode);
    }

    #[test]
    fn test_safe_mode_fallback_on_unrecoverable_injection() {
        let source = MockWindowSource::new(vec![]);
        let mut sm = DesktopStateMachine::new();
        let fake_host = HWND(0x9999 as _);

        let result = handle_taskbar_created(fake_host, &source, &mut sm, |_| {});
        assert!(result.is_err());
        assert_eq!(sm.current_state, DesktopCanvasState::SafeMode);
    }

    #[test]
    fn test_display_change_recalculates_bounds() {
        let fake_host = HWND(0x9999 as _);
        let res = handle_display_change(fake_host);
        assert!(res.is_ok());
        let bounds = res.unwrap();
        assert!(bounds.width > 0);
        assert!(bounds.height > 0);
    }
}
