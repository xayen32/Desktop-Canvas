use windows::Win32::Foundation::HWND;

/// Abstract source for querying and enumerating Windows top-level/child windows.
/// This abstraction enables testing the WorkerW discovery logic in CI environments
/// without requiring an active or interactive desktop session.
pub trait WindowEnumerationSource {
    /// Find a top-level window by class name and optional window title.
    fn find_window(&self, class_name: &str, window_name: Option<&str>) -> Option<HWND>;

    /// Send a message with timeout to a target window.
    fn send_message_timeout(
        &self,
        hwnd: HWND,
        msg: u32,
        wparam: usize,
        lparam: isize,
        timeout_ms: u32,
    ) -> Result<usize, String>;

    /// Enumerate all top-level windows. Invokes `callback` for each window.
    /// If `callback` returns false, enumeration stops immediately.
    fn enum_windows<F>(&self, callback: F) -> bool
    where
        F: FnMut(HWND) -> bool;

    /// Find a child window matching the specified class name.
    fn find_window_ex(
        &self,
        parent: Option<HWND>,
        child_after: Option<HWND>,
        class_name: &str,
        window_name: Option<&str>,
    ) -> Option<HWND>;
}

pub use real::RealWindowEnumerationSource;

pub mod real {
    use super::WindowEnumerationSource;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, SendMessageTimeoutW, SMTO_NORMAL,
    };

    #[allow(dead_code)]
    pub struct RealWindowEnumerationSource;

    #[allow(dead_code)]
    impl RealWindowEnumerationSource {
        pub fn new() -> Self {
            Self
        }
    }

    impl Default for RealWindowEnumerationSource {
        fn default() -> Self {
            Self::new()
        }
    }

    impl WindowEnumerationSource for RealWindowEnumerationSource {
        fn find_window(&self, class_name: &str, window_name: Option<&str>) -> Option<HWND> {
            let class_hstring = HSTRING::from(class_name);
            let class_pcwstr = PCWSTR(class_hstring.as_ptr());
            let title_hstring = window_name.map(HSTRING::from);
            let title_pcwstr = title_hstring
                .as_ref()
                .map(|s| PCWSTR(s.as_ptr()))
                .unwrap_or(PCWSTR::null());

            unsafe {
                let hwnd = FindWindowW(class_pcwstr, title_pcwstr);
                if let Ok(h) = hwnd {
                    if h.0.is_null() {
                        None
                    } else {
                        Some(h)
                    }
                } else {
                    None
                }
            }
        }

        fn send_message_timeout(
            &self,
            hwnd: HWND,
            msg: u32,
            wparam: usize,
            lparam: isize,
            timeout_ms: u32,
        ) -> Result<usize, String> {
            let mut result: usize = 0;
            let res = unsafe {
                SendMessageTimeoutW(
                    hwnd,
                    msg,
                    WPARAM(wparam),
                    LPARAM(lparam),
                    SMTO_NORMAL,
                    timeout_ms,
                    Some(&mut result as *mut usize),
                )
            };

            if res.0 == 0 {
                Err(format!("SendMessageTimeoutW failed on HWND {:?}", hwnd))
            } else {
                Ok(result)
            }
        }

        fn enum_windows<F>(&self, mut callback: F) -> bool
        where
            F: FnMut(HWND) -> bool,
        {
            struct EnumContext<'a> {
                cb: &'a mut dyn FnMut(HWND) -> bool,
            }

            let mut ctx = EnumContext { cb: &mut callback };

            unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
                let ctx_ptr = lparam.0 as *mut EnumContext;
                let ctx = &mut *ctx_ptr;
                let continue_enum = (ctx.cb)(hwnd);
                if continue_enum {
                    BOOL(1)
                } else {
                    BOOL(0)
                }
            }

            let res = unsafe {
                EnumWindows(
                    Some(enum_proc),
                    LPARAM(&mut ctx as *mut EnumContext as isize),
                )
            };
            res.is_ok()
        }

        fn find_window_ex(
            &self,
            parent: Option<HWND>,
            child_after: Option<HWND>,
            class_name: &str,
            window_name: Option<&str>,
        ) -> Option<HWND> {
            let class_hstring = HSTRING::from(class_name);
            let class_pcwstr = PCWSTR(class_hstring.as_ptr());
            let title_hstring = window_name.map(HSTRING::from);
            let title_pcwstr = title_hstring
                .as_ref()
                .map(|s| PCWSTR(s.as_ptr()))
                .unwrap_or(PCWSTR::null());

            let parent_hwnd = parent.unwrap_or(HWND(std::ptr::null_mut()));
            let child_after_hwnd = child_after.unwrap_or(HWND(std::ptr::null_mut()));

            unsafe {
                let hwnd = FindWindowExW(
                    parent_hwnd,
                    child_after_hwnd,
                    class_pcwstr,
                    title_pcwstr,
                );
                if let Ok(h) = hwnd {
                    if h.0.is_null() {
                        None
                    } else {
                        Some(h)
                    }
                } else {
                    None
                }
            }
        }
    }
}

#[cfg(test)]
pub mod mock {
    use super::WindowEnumerationSource;
    use std::cell::RefCell;
    use windows::Win32::Foundation::HWND;

    #[derive(Debug, Clone)]
    pub struct MockWindowNode {
        pub id: usize,
        pub class_name: String,
        pub title: Option<String>,
        pub children: Vec<MockWindowNode>,
    }

    pub struct MockWindowSource {
        pub top_level_windows: Vec<MockWindowNode>,
        pub message_sent: RefCell<bool>,
        pub spawn_message_hook:
            RefCell<Option<Box<dyn FnMut(HWND, u32) -> Result<usize, String>>>>,
    }

    impl MockWindowSource {
        pub fn new(top_level: Vec<MockWindowNode>) -> Self {
            Self {
                top_level_windows: top_level,
                message_sent: RefCell::new(false),
                spawn_message_hook: RefCell::new(None),
            }
        }

        pub fn hwnd_from_id(id: usize) -> HWND {
            HWND(id as *mut core::ffi::c_void)
        }

        pub fn id_from_hwnd(hwnd: HWND) -> usize {
            hwnd.0 as usize
        }

        fn find_node_by_id<'a>(nodes: &'a [MockWindowNode], id: usize) -> Option<&'a MockWindowNode> {
            for node in nodes {
                if node.id == id {
                    return Some(node);
                }
                if let Some(child) = Self::find_node_by_id(&node.children, id) {
                    return Some(child);
                }
            }
            None
        }
    }

    impl WindowEnumerationSource for MockWindowSource {
        fn find_window(&self, class_name: &str, window_name: Option<&str>) -> Option<HWND> {
            for node in &self.top_level_windows {
                if node.class_name == class_name {
                    if let Some(title) = window_name {
                        if node.title.as_deref() == Some(title) {
                            return Some(Self::hwnd_from_id(node.id));
                        }
                    } else {
                        return Some(Self::hwnd_from_id(node.id));
                    }
                }
            }
            None
        }

        fn send_message_timeout(
            &self,
            hwnd: HWND,
            msg: u32,
            _wparam: usize,
            _lparam: isize,
            _timeout_ms: u32,
        ) -> Result<usize, String> {
            *self.message_sent.borrow_mut() = true;
            if let Some(hook) = self.spawn_message_hook.borrow_mut().as_mut() {
                hook(hwnd, msg)
            } else {
                Ok(1)
            }
        }

        fn enum_windows<F>(&self, mut callback: F) -> bool
        where
            F: FnMut(HWND) -> bool,
        {
            for node in &self.top_level_windows {
                if !callback(Self::hwnd_from_id(node.id)) {
                    return false;
                }
            }
            true
        }

        fn find_window_ex(
            &self,
            parent: Option<HWND>,
            child_after: Option<HWND>,
            class_name: &str,
            window_name: Option<&str>,
        ) -> Option<HWND> {
            let search_list: &[MockWindowNode] = match parent {
                Some(p) => {
                    let pid = Self::id_from_hwnd(p);
                    if pid == 0 {
                        &self.top_level_windows
                    } else if let Some(parent_node) = Self::find_node_by_id(&self.top_level_windows, pid) {
                        &parent_node.children
                    } else {
                        return None;
                    }
                }
                None => &self.top_level_windows,
            };

            let start_idx = match child_after {
                Some(ca) => {
                    let ca_id = Self::id_from_hwnd(ca);
                    if ca_id == 0 {
                        0
                    } else {
                        search_list
                            .iter()
                            .position(|n| n.id == ca_id)
                            .map(|idx| idx + 1)
                            .unwrap_or(0)
                    }
                }
                None => 0,
            };

            for node in search_list.iter().skip(start_idx) {
                if node.class_name == class_name {
                    if let Some(title) = window_name {
                        if node.title.as_deref() == Some(title) {
                            return Some(Self::hwnd_from_id(node.id));
                        }
                    } else {
                        return Some(Self::hwnd_from_id(node.id));
                    }
                }
            }
            None
        }
    }
}
