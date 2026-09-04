use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub dpi: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTopology {
    pub virtual_x: i32,
    pub virtual_y: i32,
    pub virtual_width: i32,
    pub virtual_height: i32,
    pub monitors: Vec<MonitorInfo>,
}

/// Enumerates all attached physical monitors and returns complete geometry and DPI metadata.
pub fn get_display_topology() -> DisplayTopology {
    let mut monitors: Vec<MonitorInfo> = Vec::new();

    unsafe extern "system" fn monitor_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let monitors_ptr = lparam.0 as *mut Vec<MonitorInfo>;
        let monitors = unsafe { &mut *monitors_ptr };

        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        let info_ptr = &mut info as *mut MONITORINFOEXW as *mut MONITORINFO;
        let res = unsafe { GetMonitorInfoW(hmonitor, info_ptr) };

        if res.as_bool() {
            let rc = info.monitorInfo.rcMonitor;
            let width = rc.right - rc.left;
            let height = rc.bottom - rc.top;
            let is_primary = (info.monitorInfo.dwFlags & 1) != 0; // MONITORINFOF_PRIMARY = 1

            let mut dpi_x: u32 = 96;
            let mut dpi_y: u32 = 96;
            let _ = unsafe {
                GetDpiForMonitor(
                    hmonitor,
                    MDT_EFFECTIVE_DPI,
                    &mut dpi_x,
                    &mut dpi_y,
                )
            };

            let scale_factor = dpi_x as f64 / 96.0;

            let name_len = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());
            let name = String::from_utf16_lossy(&info.szDevice[..name_len]);

            monitors.push(MonitorInfo {
                id: format!("mon_{}_{}", rc.left, rc.top),
                name,
                x: rc.left,
                y: rc.top,
                width,
                height,
                dpi: dpi_x,
                scale_factor,
                is_primary,
            });
        }

        BOOL(1)
    }

    let _ = unsafe {
        EnumDisplayMonitors(
            HDC(std::ptr::null_mut()),
            None,
            Some(monitor_enum_proc),
            LPARAM(&mut monitors as *mut Vec<MonitorInfo> as isize),
        )
    };

    let virtual_bounds = super::reparent::get_virtual_screen_bounds();

    DisplayTopology {
        virtual_x: virtual_bounds.x,
        virtual_y: virtual_bounds.y,
        virtual_width: virtual_bounds.width,
        virtual_height: virtual_bounds.height,
        monitors,
    }
}
