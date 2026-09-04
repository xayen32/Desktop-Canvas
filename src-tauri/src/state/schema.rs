use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub offset: f64,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradientConfig {
    pub kind: String, // "linear" | "radial"
    pub angle_degrees: f64,
    pub stops: Vec<GradientStop>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolidConfig {
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageBackdropConfig {
    pub asset_hash: Option<String>,
    pub local_file_path: Option<String>,
    pub data_url: Option<String>,
    pub fit_mode: Option<String>, // "cover" | "contain" | "tile" | "center"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub kind: String, // "grid" | "dots" | "none"
    pub spacing: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackdropSchema {
    #[serde(rename = "type")]
    pub backdrop_type: String, // "solid" | "gradient" | "image"
    pub solid: Option<SolidConfig>,
    pub gradient: Option<GradientConfig>,
    pub image: Option<ImageBackdropConfig>,
    pub overlay: Option<OverlayConfig>,
}

impl Default for BackdropSchema {
    fn default() -> Self {
        Self {
            backdrop_type: "gradient".into(),
            solid: Some(SolidConfig {
                color: "#1E1F22".into(),
            }),
            gradient: Some(GradientConfig {
                kind: "linear".into(),
                angle_degrees: 135.0,
                stops: vec![
                    GradientStop {
                        offset: 0.0,
                        color: "#18191C".into(),
                    },
                    GradientStop {
                        offset: 1.0,
                        color: "#282A2E".into(),
                    },
                ],
            }),
            image: None,
            overlay: Some(OverlayConfig {
                kind: "none".into(),
                spacing: 32.0,
                opacity: 0.15,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSchema {
    pub schema_version: u32,
    pub theme: String, // "dark" | "light" | "auto"
    pub geometry_mode: String, // "continuous" | "per-monitor"
    pub backdrop: BackdropSchema,
    pub autostart: bool,
    pub hotkey: String,
    pub first_run_completed: bool,
}

impl Default for SettingsSchema {
    fn default() -> Self {
        Self {
            schema_version: 1,
            theme: "dark".into(),
            geometry_mode: "continuous".into(),
            backdrop: BackdropSchema::default(),
            autostart: false,
            hotkey: "Ctrl+Alt+D".into(),
            first_run_completed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub geometry_mode: Option<String>,
    pub backdrop: Option<BackdropSchema>,
    pub autostart: Option<bool>,
    pub hotkey: Option<String>,
    pub first_run_completed: Option<bool>,
}

impl SettingsSchema {
    pub fn apply_patch(&mut self, patch: SettingsPatch) {
        if let Some(t) = patch.theme {
            self.theme = t;
        }
        if let Some(g) = patch.geometry_mode {
            self.geometry_mode = g;
        }
        if let Some(b) = patch.backdrop {
            self.backdrop = b;
        }
        if let Some(a) = patch.autostart {
            self.autostart = a;
        }
        if let Some(h) = patch.hotkey {
            self.hotkey = h;
        }
        if let Some(f) = patch.first_run_completed {
            self.first_run_completed = f;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VirtualBoundsSchema {
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportSchema {
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub virtual_bounds: VirtualBoundsSchema,
}

impl Default for ViewportSchema {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            virtual_bounds: VirtualBoundsSchema {
                width: 1920,
                height: 1080,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrokePointSchema {
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_pressure")]
    pub pressure: f64,
}

fn default_pressure() -> f64 {
    0.5
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrokeElementSchema {
    pub id: String,
    pub tool: String, // "pen" | "highlighter" | "eraser"
    pub points: Vec<StrokePointSchema>,
    pub color: String,
    pub width: f64,
    pub opacity: f64,
    #[serde(default = "default_blend_mode")]
    pub blend_mode: String, // "normal" | "multiply"
    pub z_index: i32,
}

fn default_blend_mode() -> String {
    "normal".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTransformSchema {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageElementSchema {
    pub id: String,
    pub asset_hash: String,
    pub local_file_path: String,
    pub transform: CanvasTransformSchema,
    pub z_index: i32,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub above_ink: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TypographySchema {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    pub font_size: f64,
    pub color: String,
    #[serde(default = "default_font_weight")]
    pub font_weight: u32,
}

fn default_font_family() -> String {
    "Segoe UI".into()
}

fn default_font_weight() -> u32 {
    400
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickyStyleSchema {
    pub background_color: String,
    pub corner_radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DimensionsSchema {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextNoteSchema {
    pub id: String,
    pub content: String,
    pub typography: TypographySchema,
    pub sticky_style: Option<StickyStyleSchema>,
    pub dimensions: DimensionsSchema,
    pub z_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum CanvasElement {
    #[serde(rename = "stroke")]
    Stroke(StrokeElementSchema),
    #[serde(rename = "image")]
    Image(ImageElementSchema),
    #[serde(rename = "textNote")]
    TextNote(TextNoteSchema),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasStateSchema {
    pub schema_version: u32,
    pub viewport: ViewportSchema,
    pub backdrop: BackdropSchema,
    pub elements: Vec<CanvasElement>,
}

impl Default for CanvasStateSchema {
    fn default() -> Self {
        Self {
            schema_version: 1,
            viewport: ViewportSchema::default(),
            backdrop: BackdropSchema::default(),
            elements: Vec::new(),
        }
    }
}
