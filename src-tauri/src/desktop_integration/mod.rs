pub mod autostart;
pub mod display;
pub mod lifecycle;
pub mod reparent;
pub mod shell_events;
pub mod state_machine;
pub mod traits;
pub mod workerw;

pub use autostart::{is_autostart_enabled, set_autostart_enabled};
pub use display::{get_display_topology, DisplayTopology};
pub use lifecycle::trim_working_set_memory;
#[allow(unused_imports)]
pub use reparent::{
    get_process_main_hwnd, get_virtual_screen_bounds, reparent_window_to_workerw,
    transition_to_edit_mode, transition_to_wallpaper_mode,
};
#[allow(unused_imports)]
pub use shell_events::{
    attach_shell_subclass, handle_display_change, handle_taskbar_created,
    register_taskbar_created_msg,
};
#[allow(unused_imports)]
pub use state_machine::{DesktopCanvasState, DesktopStateMachine, SendHwnd};
#[allow(unused_imports)]
pub use traits::RealWindowEnumerationSource;
