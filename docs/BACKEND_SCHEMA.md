# Backend Schema Specification
## Desktop Canvas — Data Architecture & State Serialization

| Field | Value |
|---|---|
| Document | BACKEND_SCHEMA.md |
| Version | 1.0.0 |
| Status | Draft — Ready for Engineering Review |
| Related Docs | TRD.md, PERFORMANCE_AND_LIFECYCLE_SPEC.md |

---

## 1. Local Storage Hierarchy

All application state lives exclusively under the current Windows user's roaming profile, per `PRD.md` §8.3:

```
%APPDATA%\DesktopCanvas\
│
├── canvas_state.json          # Current scene graph (strokes, images, notes, backdrop)
├── settings.json              # App-level preferences (theme, hotkeys, canvas geometry mode)
│
├── images\                    # Deduplicated, content-addressed asset store
│   ├── 3f2a9c1e....png
│   └── 7bd41a02....jpg
│
├── backups\                   # Rolling known-good snapshots
│   ├── canvas_state.20260810-091500.json
│   ├── canvas_state.20260812-140212.json
│   └── canvas_state.20260814-070045.json
│
└── logs\
    └── shell.log               # Rotated at 5 MB, see TRD.md §9
```

- `images/` files are named by their SHA-256 content hash (see §3), guaranteeing that two visually identical pastes never duplicate storage.
- `backups/` retains the last **5** known-good snapshots on a rolling basis, pruned oldest-first, written on every successful checkpoint (not on every debounce tick — see §5).

## 2. Complete JSON Schemas

All schemas are expressed as JSON Schema (Draft 2020-12) for validator generation and are versioned via a top-level `schemaVersion` field to support the migration strategy in §5.

### 2.1 `CanvasStateSchema`

```json
{
  "$id": "https://desktopcanvas.local/schemas/canvas_state.schema.json",
  "type": "object",
  "required": ["schemaVersion", "viewport", "backdrop", "elements"],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "viewport": {
      "type": "object",
      "required": ["zoom", "panX", "panY", "virtualBounds"],
      "properties": {
        "zoom": { "type": "number", "minimum": 0.1, "maximum": 8.0 },
        "panX": { "type": "number" },
        "panY": { "type": "number" },
        "virtualBounds": {
          "type": "object",
          "required": ["width", "height"],
          "properties": {
            "width": { "type": "integer", "minimum": 1 },
            "height": { "type": "integer", "minimum": 1 }
          }
        }
      }
    },
    "backdrop": { "$ref": "#/$defs/BackdropSchema" },
    "elements": {
      "type": "array",
      "items": {
        "oneOf": [
          { "$ref": "#/$defs/StrokeElementSchema" },
          { "$ref": "#/$defs/ImageElementSchema" },
          { "$ref": "#/$defs/TextNoteSchema" }
        ]
      }
    }
  },
  "$defs": {
    "StrokeElementSchema": { "$ref": "#/$defs/StrokeElementSchemaDef" },
    "ImageElementSchema": { "$ref": "#/$defs/ImageElementSchemaDef" },
    "TextNoteSchema": { "$ref": "#/$defs/TextNoteSchemaDef" },
    "BackdropSchema": { "$ref": "#/$defs/BackdropSchemaDef" }
  }
}
```

### 2.2 `StrokeElementSchema`

```json
{
  "$id": "#StrokeElementSchemaDef",
  "type": "object",
  "required": ["id", "type", "points", "color", "width", "opacity", "blendMode", "zIndex"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "const": "stroke" },
    "tool": { "type": "string", "enum": ["pen", "highlighter", "eraser"] },
    "points": {
      "type": "array",
      "minItems": 2,
      "items": {
        "type": "object",
        "required": ["x", "y"],
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" },
          "pressure": { "type": "number", "minimum": 0, "maximum": 1, "default": 0.5 }
        }
      }
    },
    "color": { "type": "string", "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" },
    "width": { "type": "number", "minimum": 1, "maximum": 64 },
    "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
    "blendMode": { "type": "string", "enum": ["normal", "multiply"], "default": "normal" },
    "zIndex": { "type": "integer" }
  }
}
```

`blendMode: "multiply"` is used for the Highlighter tool by default, giving correct color-mixing behavior when strokes overlap; the Pen tool always uses `"normal"`.

### 2.3 `ImageElementSchema`

```json
{
  "$id": "#ImageElementSchemaDef",
  "type": "object",
  "required": ["id", "type", "assetHash", "localFilePath", "transform", "zIndex", "pinned"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "const": "image" },
    "assetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "localFilePath": { "type": "string" },
    "transform": {
      "type": "object",
      "required": ["x", "y", "width", "height", "rotation"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number", "minimum": 1 },
        "height": { "type": "number", "minimum": 1 },
        "rotation": { "type": "number", "minimum": -360, "maximum": 360 }
      }
    },
    "zIndex": { "type": "integer" },
    "pinned": { "type": "boolean", "default": false }
  }
}
```

`pinned: true` excludes the element from accidental drag/move (used for reference images the user wants locked in place); `assetHash` is the SHA-256 content hash and is the single source of truth linking this element to its file in `images/` (see §3) — `localFilePath` is a cached convenience field, always re-derivable from `assetHash` and therefore safe to repair if it ever drifts.

### 2.4 `TextNoteSchema`

```json
{
  "$id": "#TextNoteSchemaDef",
  "type": "object",
  "required": ["id", "type", "content", "typography", "dimensions", "zIndex"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "const": "textNote" },
    "content": { "type": "string" },
    "typography": {
      "type": "object",
      "required": ["fontFamily", "fontSize", "color", "fontWeight"],
      "properties": {
        "fontFamily": { "type": "string", "default": "Segoe UI" },
        "fontSize": { "type": "number", "minimum": 8, "maximum": 128 },
        "color": { "type": "string", "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" },
        "fontWeight": { "type": "integer", "enum": [400, 600, 700], "default": 400 }
      }
    },
    "stickyStyle": {
      "type": ["object", "null"],
      "properties": {
        "backgroundColor": { "type": "string" },
        "cornerRadius": { "type": "number", "minimum": 0, "maximum": 32 }
      }
    },
    "dimensions": {
      "type": "object",
      "required": ["x", "y", "width", "height"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number", "minimum": 20 },
        "height": { "type": "number", "minimum": 20 }
      }
    },
    "zIndex": { "type": "integer" }
  }
}
```

### 2.5 `BackdropSchema`

```json
{
  "$id": "#BackdropSchemaDef",
  "type": "object",
  "required": ["type"],
  "properties": {
    "type": { "type": "string", "enum": ["solid", "gradient", "image"] },
    "solid": {
      "type": "object",
      "properties": { "color": { "type": "string" } }
    },
    "gradient": {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "enum": ["linear", "radial"] },
        "angleDegrees": { "type": "number" },
        "stops": {
          "type": "array",
          "minItems": 2,
          "items": {
            "type": "object",
            "properties": {
              "offset": { "type": "number", "minimum": 0, "maximum": 1 },
              "color": { "type": "string" }
            }
          }
        }
      }
    },
    "image": {
      "type": "object",
      "properties": {
        "assetHash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "fitMode": { "type": "string", "enum": ["cover", "contain", "tile", "center"] }
      }
    },
    "overlay": {
      "type": ["object", "null"],
      "properties": {
        "kind": { "type": "string", "enum": ["grid", "dots", "none"] },
        "spacing": { "type": "number", "minimum": 4, "maximum": 200 },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    }
  }
}
```

## 3. Asset Isolation & Deduplication

Every image entering the canvas — whether via clipboard paste or drag-and-drop — is processed through a single ingestion path before an `ImageElementSchema` entry is created:

1. Raw bytes are read into memory.
2. A SHA-256 digest is computed over the raw bytes.
3. If `images\<hash>.<ext>` already exists, no write occurs — the new element simply references the existing `assetHash`.
4. If not, the bytes are written atomically (write to a temp file in `images\`, then rename) to `images\<hash>.<ext>`.
5. The resulting element's `assetHash` and `localFilePath` are set, and the element is appended to `elements[]`.

This guarantees: (a) pasting the same screenshot ten times costs the disk space of one file, and (b) `localFilePath` values can never "go stale" independent of the content they reference — a corrupted or manually-deleted file under `images\` is trivially detectable (hash mismatch or missing file) and reported through the self-healing path in `PERFORMANCE_AND_LIFECYCLE_SPEC.md` §4, rather than silently showing a broken image.

## 4. IPC Protocol API

All commands are Tauri typed `invoke` calls (request/response) issued from the webview to the native shell, or typed events pushed from the shell to the webview. Every command returns a `Result<T, DesktopCanvasError>` shape on the Rust side, surfaced to TypeScript as a resolved value or a rejected promise.

### 4.1 Commands (webview → shell)

| Command | Payload | Response | Description |
|---|---|---|---|
| `save_canvas` | `{ state: CanvasStateSchema }` | `{ ok: true, savedAt: string (ISO 8601) }` | Persists the current scene graph; triggers the debounce/checkpoint pipeline in §5. |
| `load_canvas` | `{}` | `{ state: CanvasStateSchema }` | Returns the last-persisted (or last-recovered) scene graph on startup. |
| `toggle_mode` | `{ target: "wallpaper" \| "edit" \| "auto" }` | `{ ok: true, mode: "wallpaper" \| "edit" }` | Requests a mode transition; `"auto"` toggles relative to current state. |
| `import_image` | `{ base64Data: string, mimeType: string }` | `{ assetHash: string, localFilePath: string }` | Runs the ingestion pipeline in §3 and returns the resulting reference. |
| `set_wallpaper_backend` | `{ backdrop: BackdropSchema }` | `{ ok: true }` | Updates and persists the active backdrop configuration. |
| `apply_wallpaper_snapshot` | `{ base64Png: string }` | `{ ok: true }` | Exports composite canvas PNG and applies as active Windows desktop wallpaper. |
| `get_settings` | `{}` | `{ settings: SettingsSchema }` | Returns current app-level settings. |
| `update_settings` | `{ patch: Partial<SettingsSchema> }` | `{ settings: SettingsSchema }` | Merges and persists a partial settings update. |

### 4.2 Events (shell → webview)

| Event | Payload | Description |
|---|---|---|
| `mode-changed` | `{ mode: "wallpaper" \| "edit" }` | Pushed after a `toggle_mode`-triggered or `TaskbarCreated`-triggered transition completes. |
| `display-changed` | `{ virtualBounds: { width, height } }` | Pushed on `WM_DISPLAYCHANGE`; webview re-lays-out canvas bounds. |
| `dpi-changed` | `{ monitorId: string, dpi: number }` | Pushed on `WM_DPICHANGED` for the affected monitor. |
| `recovery-notice` | `{ level: "info" \| "warning", message: string }` | Pushed when the self-healing pipeline (`PERFORMANCE_AND_LIFECYCLE_SPEC.md` §4) takes a corrective action the user should be aware of (e.g., "Restored from backup"). |

## 5. Versioning & Migration Strategy

- Every persisted `canvas_state.json` and `settings.json` carries a `schemaVersion` integer.
- On load, if `schemaVersion` is lower than the current app's supported version, a migration function chain (`migrate_v1_to_v2`, `migrate_v2_to_v3`, …) is applied sequentially before the state is handed to the webview — never a single "big jump" transform, so each migration step stays small, testable, and independently reversible for QA purposes.
- If `schemaVersion` is *higher* than supported (user downgraded the app), the shell refuses to overwrite the file, loads it read-only into a recovery view, and prompts the user to update the app rather than risking silent data loss.

## 6. Backup Strategy

- A full, validated copy of `canvas_state.json` is written to `backups\` (timestamped, per §1) immediately after every successful checkpoint write that passes schema validation.
- Backups are pruned to the most recent 5 on a rolling basis.
- The self-healing pipeline (`PERFORMANCE_AND_LIFECYCLE_SPEC.md` §4) sources its "last known good snapshot" exclusively from this directory, never from the potentially-in-flight `canvas_state.json` itself.
