pub mod assets;
pub mod persistence;
pub mod schema;

pub use assets::{import_image_bytes, AssetReference};
pub use persistence::{
    load_canvas_state, load_settings, save_canvas_state, save_settings,
};
pub use schema::{
    BackdropSchema, CanvasStateSchema,
    SettingsPatch, SettingsSchema,
};

use crate::desktop_integration::DesktopStateMachine;
use std::sync::Mutex;

pub struct AppState {
    pub state_machine: Mutex<DesktopStateMachine>,
    #[allow(dead_code)]
    pub inject_workerw: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(false)
    }
}

impl AppState {
    pub fn new(inject_workerw: bool) -> Self {
        Self {
            state_machine: Mutex::new(DesktopStateMachine::new()),
            inject_workerw,
        }
    }
}
