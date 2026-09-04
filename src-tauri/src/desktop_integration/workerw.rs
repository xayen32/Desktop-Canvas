use super::traits::WindowEnumerationSource;
use thiserror::Error;
use tracing::{debug, info};
use windows::Win32::Foundation::HWND;

/// Win32 undocumented message to Progman to spawn the secondary WorkerW desktop layer.
pub const SPAWN_WORKERW_MSG: u32 = 0x052C;

#[derive(Error, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum WorkerWError {
    #[error("Progman window not found in active session")]
    ProgmanNotFound,
    #[error("SendMessageTimeout (0x052C) to Progman failed: {0}")]
    SendMessageFailed(String),
    #[error("SHELLDLL_DefView window not found under Progman or any WorkerW")]
    ShellDllDefViewNotFound,
    #[error("Target sibling WorkerW window not found")]
    WorkerWSiblingNotFound,
}

/// Locates the background WorkerW window host behind desktop icons.
pub fn locate_workerw_host<S: WindowEnumerationSource>(source: &S) -> Result<HWND, WorkerWError> {
    let progman = source
        .find_window("Progman", None)
        .ok_or(WorkerWError::ProgmanNotFound)?;
    debug!("Located Progman HWND: {:?}", progman);

    let _ = source.send_message_timeout(progman, SPAWN_WORKERW_MSG, 0x0000000D, 0, 1000);
    let _ = source.send_message_timeout(progman, SPAWN_WORKERW_MSG, 0, 0, 1000);
    debug!("Dispatched 0x052C messages to Progman");

    let mut shelldll_parent_workerw: Option<HWND> = None;

    source.enum_windows(|top_hwnd| {
        let shell_child = source.find_window_ex(
            Some(top_hwnd),
            None,
            "SHELLDLL_DefView",
            None,
        );
        if shell_child.is_some() {
            shelldll_parent_workerw = Some(top_hwnd);
            return false;
        }
        true
    });

    let shell_workerw = shelldll_parent_workerw.ok_or(WorkerWError::ShellDllDefViewNotFound)?;
    debug!("Located window hosting SHELLDLL_DefView: {:?}", shell_workerw);

    let sibling_workerw = source.find_window_ex(
        None,
        Some(shell_workerw),
        "WorkerW",
        None,
    );

    if let Some(target) = sibling_workerw {
        info!("Successfully identified background WorkerW host via sibling lookup: {:?}", target);
        return Ok(target);
    }

    let mut candidate_workerw: Option<HWND> = None;
    source.enum_windows(|top_hwnd| {
        let shell_child = source.find_window_ex(
            Some(top_hwnd),
            None,
            "SHELLDLL_DefView",
            None,
        );
        if shell_child.is_none() && top_hwnd != shell_workerw && top_hwnd != progman {
            candidate_workerw = Some(top_hwnd);
            return false;
        }
        true
    });

    if let Some(target) = candidate_workerw {
        info!("Successfully identified background WorkerW host via enumeration: {:?}", target);
        return Ok(target);
    }

    info!("Falling back to shell_workerw host: {:?}", shell_workerw);
    Ok(shell_workerw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_integration::traits::mock::{MockWindowNode, MockWindowSource};

    #[test]
    fn test_finds_workerw_single_sibling() {
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

        let target = locate_workerw_host(&source);
        assert_eq!(target, Ok(HWND(300 as *mut core::ffi::c_void)));
        assert!(*source.message_sent.borrow());
    }

    #[test]
    fn test_finds_workerw_multiple_siblings() {
        let source = MockWindowSource::new(vec![
            MockWindowNode {
                id: 100,
                class_name: "Progman".into(),
                title: None,
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
            MockWindowNode {
                id: 400,
                class_name: "WorkerW".into(),
                title: None,
                children: vec![],
            },
        ]);

        let target = locate_workerw_host(&source);
        assert_eq!(target, Ok(HWND(300 as *mut core::ffi::c_void)));
    }

    #[test]
    fn test_no_shelldll_defview_found() {
        let source = MockWindowSource::new(vec![
            MockWindowNode {
                id: 100,
                class_name: "Progman".into(),
                title: None,
                children: vec![],
            },
            MockWindowNode {
                id: 200,
                class_name: "WorkerW".into(),
                title: None,
                children: vec![],
            },
        ]);

        let result = locate_workerw_host(&source);
        assert_eq!(result, Err(WorkerWError::ShellDllDefViewNotFound));
    }

    #[test]
    fn test_missing_progman() {
        let source = MockWindowSource::new(vec![]);
        let result = locate_workerw_host(&source);
        assert_eq!(result, Err(WorkerWError::ProgmanNotFound));
    }
}
