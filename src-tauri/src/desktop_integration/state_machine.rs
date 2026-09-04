use super::traits::WindowEnumerationSource;
use super::workerw::{locate_workerw_host, WorkerWError};
use std::time::Duration;
use tracing::{error, info, warn};
use windows::Win32::Foundation::HWND;

pub const RETRY_DELAYS_MS: [u64; 5] = [0, 150, 400, 1000, 2500];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum DesktopCanvasState {
    AppStartup,
    SetupWizard,
    InjectWorkerW,
    WallpaperMode,
    EditMode,
    SafeMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SendHwnd(pub HWND);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

#[derive(Debug)]
pub struct DesktopStateMachine {
    pub current_state: DesktopCanvasState,
    pub previous_mode: Option<DesktopCanvasState>,
    pub target_workerw: Option<SendHwnd>,
}

unsafe impl Send for DesktopStateMachine {}
unsafe impl Sync for DesktopStateMachine {}

impl Default for DesktopStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl DesktopStateMachine {
    pub fn new() -> Self {
        Self {
            current_state: DesktopCanvasState::AppStartup,
            previous_mode: None,
            target_workerw: None,
        }
    }

    /// Attempts to inject into WorkerW using an exponential backoff policy.
    /// Accepts an optional sleep closure for testing.
    pub fn execute_injection_with_backoff<S, F>(
        &mut self,
        source: &S,
        mut sleeper: F,
    ) -> Result<HWND, WorkerWError>
    where
        S: WindowEnumerationSource,
        F: FnMut(Duration),
    {
        self.current_state = DesktopCanvasState::InjectWorkerW;
        info!("Starting WorkerW injection with exponential backoff...");

        let mut last_err = WorkerWError::WorkerWSiblingNotFound;

        for (attempt_idx, &delay_ms) in RETRY_DELAYS_MS.iter().enumerate() {
            let attempt_num = attempt_idx + 1;
            if delay_ms > 0 {
                info!(
                    "WorkerW injection attempt {}/5 delayed by {}ms",
                    attempt_num, delay_ms
                );
                sleeper(Duration::from_millis(delay_ms));
            }

            match locate_workerw_host(source) {
                Ok(hwnd) => {
                    info!(
                        "WorkerW injection succeeded on attempt {}/5 (HWND: {:?})",
                        attempt_num, hwnd
                    );
                    self.target_workerw = Some(SendHwnd(hwnd));
                    let next_state = self
                        .previous_mode
                        .unwrap_or(DesktopCanvasState::WallpaperMode);
                    self.current_state = next_state;
                    return Ok(hwnd);
                }
                Err(err) => {
                    warn!(
                        "WorkerW injection attempt {}/5 failed: {:?}",
                        attempt_num, err
                    );
                    last_err = err;
                }
            }
        }

        error!("WorkerW injection failed all 5 attempts. Falling back to SAFE_MODE.");
        self.current_state = DesktopCanvasState::SafeMode;
        self.target_workerw = None;
        Err(last_err)
    }

    /// Toggles between Wallpaper Mode and Edit Mode.
    #[allow(dead_code)]
    pub fn toggle_mode(&mut self) -> DesktopCanvasState {
        match self.current_state {
            DesktopCanvasState::WallpaperMode => {
                self.previous_mode = Some(DesktopCanvasState::WallpaperMode);
                self.current_state = DesktopCanvasState::EditMode;
            }
            DesktopCanvasState::EditMode => {
                self.previous_mode = Some(DesktopCanvasState::EditMode);
                self.current_state = DesktopCanvasState::WallpaperMode;
            }
            _ => {
                self.previous_mode = Some(self.current_state);
                self.current_state = DesktopCanvasState::EditMode;
            }
        }
        self.current_state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_integration::traits::WindowEnumerationSource;
    use std::cell::RefCell;

    struct FlakyMockSource {
        pub fail_count: RefCell<usize>,
        pub max_fails: usize,
    }

    impl WindowEnumerationSource for FlakyMockSource {
        fn find_window(&self, class_name: &str, _window_name: Option<&str>) -> Option<HWND> {
            if class_name == "Progman" {
                Some(HWND(100 as *mut core::ffi::c_void))
            } else {
                None
            }
        }

        fn send_message_timeout(
            &self,
            _hwnd: HWND,
            _msg: u32,
            _wparam: usize,
            _lparam: isize,
            _timeout_ms: u32,
        ) -> Result<usize, String> {
            Ok(1)
        }

        fn enum_windows<F>(&self, mut callback: F) -> bool
        where
            F: FnMut(HWND) -> bool,
        {
            let mut count = self.fail_count.borrow_mut();
            if *count < self.max_fails {
                *count += 1;
                true
            } else {
                callback(HWND(200 as *mut core::ffi::c_void))
            }
        }

        fn find_window_ex(
            &self,
            parent: Option<HWND>,
            _child_after: Option<HWND>,
            class_name: &str,
            _window_name: Option<&str>,
        ) -> Option<HWND> {
            if parent == Some(HWND(200 as *mut core::ffi::c_void)) && class_name == "SHELLDLL_DefView" {
                Some(HWND(201 as *mut core::ffi::c_void))
            } else if parent.is_none() && class_name == "WorkerW" {
                Some(HWND(300 as *mut core::ffi::c_void))
            } else {
                None
            }
        }
    }

    #[test]
    fn test_retry_backoff_schedule() {
        let source = FlakyMockSource {
            fail_count: RefCell::new(0),
            max_fails: 4,
        };

        let mut sm = DesktopStateMachine::new();
        let mut delays_recorded = Vec::new();

        let result = sm.execute_injection_with_backoff(&source, |d| {
            delays_recorded.push(d.as_millis() as u64);
        });

        assert_eq!(result, Ok(HWND(300 as *mut core::ffi::c_void)));
        assert_eq!(sm.current_state, DesktopCanvasState::WallpaperMode);
        assert_eq!(delays_recorded, vec![150, 400, 1000, 2500]);
    }

    #[test]
    fn test_retry_exhaustion_enters_safe_mode() {
        let source = FlakyMockSource {
            fail_count: RefCell::new(0),
            max_fails: 10,
        };

        let mut sm = DesktopStateMachine::new();
        let mut delays_recorded = Vec::new();

        let result = sm.execute_injection_with_backoff(&source, |d| {
            delays_recorded.push(d.as_millis() as u64);
        });

        assert!(result.is_err());
        assert_eq!(sm.current_state, DesktopCanvasState::SafeMode);
        assert_eq!(sm.target_workerw, None);
        assert_eq!(delays_recorded, vec![150, 400, 1000, 2500]);
    }
}
