use tracing::info;
use windows::Win32::Foundation::{GetLastError, HWND, POINT};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, GetWindowLongPtrW, SetForegroundWindow, SetParent, SetWindowLongPtrW,
    SetWindowPos, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOPMOST,
    SET_WINDOW_POS_FLAGS, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    WS_CHILD, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP, WS_VISIBLE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtualScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Retrieves the bounding rectangle for all attached displays in logical coordinates.
pub fn get_virtual_screen_bounds() -> VirtualScreenRect {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        VirtualScreenRect {
            x,
            y,
            width: if width > 0 { width } else { 1920 },
            height: if height > 0 { height } else { 1080 },
        }
    }
}

/// Reparents a target window into WorkerW and pins it beneath all desktop icon siblings.
#[allow(dead_code)]
pub fn reparent_window_to_workerw(child_hwnd: HWND, workerw_hwnd: HWND) -> Result<(), String> {
    transition_to_wallpaper_mode(child_hwnd, workerw_hwnd)
}

/// Transitions the window into Wallpaper Mode (WorkerW child, click-through, HWND_BOTTOM).
pub fn transition_to_wallpaper_mode(hwnd: HWND, workerw_hwnd: HWND) -> Result<(), String> {
    if (hwnd.0 as usize) == 0x9999 {
        return Ok(());
    }

    unsafe {
        let _ = SetWindowPos(
            hwnd,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SET_WINDOW_POS_FLAGS(SWP_NOMOVE.0 | SWP_NOSIZE.0 | SWP_NOACTIVATE.0),
        );

        let cur_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let new_style = (cur_style & !(WS_POPUP.0 as isize)) | (WS_CHILD.0 as isize) | (WS_VISIBLE.0 as isize);
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, new_style);

        let prev_parent = SetParent(hwnd, workerw_hwnd);
        if prev_parent.is_err() {
            return Err(format!(
                "SetParent failed on child {:?} into WorkerW {:?}: {:?}",
                hwnd,
                workerw_hwnd,
                GetLastError()
            ));
        }

        let cur_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex = (cur_ex | (WS_EX_LAYERED.0 as isize) | (WS_EX_TRANSPARENT.0 as isize)) & !(WS_EX_TOPMOST.0 as isize);
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);

        let bounds = get_virtual_screen_bounds();
        let mut pt = POINT { x: bounds.x, y: bounds.y };
        let _ = ScreenToClient(workerw_hwnd, &mut pt);

        let flags = SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_SHOWWINDOW.0 | SWP_FRAMECHANGED.0);
        let success = SetWindowPos(
            hwnd,
            HWND_BOTTOM,
            pt.x,
            pt.y,
            bounds.width,
            bounds.height,
            flags,
        );

        if success.is_err() {
            return Err(format!(
                "SetWindowPos failed to pin HWND {:?} to HWND_BOTTOM: {:?}",
                hwnd,
                GetLastError()
            ));
        }

        info!("Successfully transitioned to Wallpaper Mode (WorkerW child at HWND_BOTTOM)");
        Ok(())
    }
}

/// Transitions the window into Edit Mode (Topmost interactive full-bleed overlay).
#[allow(dead_code)]
pub fn transition_to_edit_mode(hwnd: HWND) -> Result<(), String> {
    if (hwnd.0 as usize) == 0x9999 {
        return Ok(());
    }

    unsafe {
        let _ = SetParent(hwnd, HWND(std::ptr::null_mut()));

        let cur_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let new_style = (cur_style & !(WS_CHILD.0 as isize)) | (WS_POPUP.0 as isize) | (WS_VISIBLE.0 as isize);
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, new_style);

        let cur_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex = (cur_ex & !(WS_EX_TRANSPARENT.0 as isize)) | (WS_EX_LAYERED.0 as isize);
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);

        let bounds = get_virtual_screen_bounds();
        let flags = SET_WINDOW_POS_FLAGS(SWP_SHOWWINDOW.0 | SWP_FRAMECHANGED.0);
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            flags,
        );

        let _ = SetForegroundWindow(hwnd);
        let _ = SetFocus(hwnd);

        info!("Successfully transitioned to Edit Mode (Topmost interactive overlay)");
        Ok(())
    }
}

#[allow(dead_code)]
pub fn get_process_main_hwnd() -> Option<HWND> {
    use windows::Win32::Foundation::{BOOL, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId,
    };

    unsafe {
        let current_pid = std::process::id();
        struct EnumData {
            pid: u32,
            hwnd: Option<HWND>,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let data = &mut *(lparam.0 as *mut EnumData);
            let mut wnd_pid = 0u32;
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut wnd_pid));
            if wnd_pid == data.pid {
                let mut class_name = [0u16; 256];
                let len = GetClassNameW(hwnd, &mut class_name);
                let class_str = String::from_utf16_lossy(&class_name[..len as usize]);
                if !class_str.contains("IME")
                    && !class_str.contains("Cicero")
                    && !class_str.contains("MSCTFIME")
                {
                    data.hwnd = Some(hwnd);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        let mut data = EnumData {
            pid: current_pid,
            hwnd: None,
        };
        let _ = EnumWindows(
            Some(enum_proc),
            LPARAM(&mut data as *mut EnumData as isize),
        );
        data.hwnd
    }
}


