use tracing::info;

#[cfg(windows)]
use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};

/// Trims the application's working set memory pages via Win32 OS APIs.
/// Called upon entering Wallpaper Mode to minimize RAM footprint.
pub fn trim_working_set_memory() {
    #[cfg(windows)]
    unsafe {
        let process = GetCurrentProcess();
        let _ = SetProcessWorkingSetSize(process, usize::MAX, usize::MAX);
        info!("Working set memory trimmed successfully via SetProcessWorkingSetSize");
    }
    #[cfg(not(windows))]
    {
        info!("Working set memory trimming is Windows-only (no-op on this platform)");
    }
}
