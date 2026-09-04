use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::WIN32_ERROR;
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_SZ, REG_VALUE_TYPE,
};

const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APP_VALUE_NAME: &str = "DesktopCanvas";

/// Checks if autostart on Windows logon is currently enabled in the registry.
pub fn is_autostart_enabled() -> bool {
    let subkey_hstring = HSTRING::from(RUN_KEY_PATH);
    let value_hstring = HSTRING::from(APP_VALUE_NAME);

    unsafe {
        let mut hkey = Default::default();
        let open_status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_hstring.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        );

        if open_status != WIN32_ERROR(0) {
            return false;
        }

        let mut data_type = REG_VALUE_TYPE(0);
        let mut data_len = 0u32;
        let query_status = RegQueryValueExW(
            hkey,
            PCWSTR(value_hstring.as_ptr()),
            None,
            Some(&mut data_type),
            None,
            Some(&mut data_len),
        );

        let _ = RegCloseKey(hkey);
        query_status == WIN32_ERROR(0) && data_len > 0
    }
}

/// Enables or disables autostart on Windows logon.
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let subkey_hstring = HSTRING::from(RUN_KEY_PATH);
    let value_hstring = HSTRING::from(APP_VALUE_NAME);

    unsafe {
        let mut hkey = Default::default();
        let open_status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_hstring.as_ptr()),
            0,
            KEY_WRITE,
            &mut hkey,
        );

        if open_status != WIN32_ERROR(0) {
            return Err(format!(
                "Failed to open HKCU Run registry key: error code {:?}",
                open_status
            ));
        }

        let result = if enabled {
            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Failed to determine current exe path: {}", e))?;
            let exe_str = current_exe.to_string_lossy().to_string();
            let exe_hstring = HSTRING::from(format!("\"{}\"", exe_str));
            let bytes_len = (exe_hstring.len() + 1) * 2;

            let set_status = RegSetValueExW(
                hkey,
                PCWSTR(value_hstring.as_ptr()),
                0,
                REG_SZ,
                Some(std::slice::from_raw_parts(
                    exe_hstring.as_ptr() as *const u8,
                    bytes_len,
                )),
            );

            if set_status != WIN32_ERROR(0) {
                Err(format!(
                    "Failed to set autostart registry value: error code {:?}",
                    set_status
                ))
            } else {
                Ok(())
            }
        } else {
            let del_status = RegDeleteValueW(hkey, PCWSTR(value_hstring.as_ptr()));
            // If already deleted or missing (2 = ERROR_FILE_NOT_FOUND), treat as success
            if del_status != WIN32_ERROR(0) && del_status != WIN32_ERROR(2) {
                Err(format!(
                    "Failed to delete autostart registry value: error code {:?}",
                    del_status
                ))
            } else {
                Ok(())
            }
        };

        let _ = RegCloseKey(hkey);
        result
    }
}
