# UI/UX Design System Specification
## Desktop Canvas — Interface & Interaction Design

| Field | Value |
|---|---|
| Document | UI_UX_DESIGN.md |
| Version | 1.0.0 |
| Status | Draft — Ready for Design/Engineering Review |
| Related Docs | PRD.md, TRD.md |

---

## 1. Aesthetic Direction

Desktop Canvas's chrome (toolbar, wizard, popovers, tray) follows a **modern Fluent-Design-adjacent, Paint-3D-inspired creative aesthetic**: soft-elevation surfaces, restrained acrylic-style translucency, rounded geometry, and confident, high-contrast iconography. The canvas *content area itself* is deliberately chrome-free — the aesthetic exists to frame creativity, never to compete with it.

**Design principles:**

1. **Chrome recedes, content leads.** The floating HUD uses translucency and soft shadows so it visually "floats" above the desktop without ever fully opaque-blocking what's beneath it, even in light themes.
2. **Legible at a glance, at any DPI.** Because the HUD sits over an unpredictable, user-chosen backdrop, every interactive element must retain a minimum 4.5:1 contrast ratio against both light and dark backdrops via a scrim/backdrop-blur layer — never relying on the wallpaper for contrast.
3. **Dark-mode-first.** The default and primary-designed theme is dark, matching the creative-tool conventions of Paint 3D, Photoshop, and Figma; light and auto (follow-Windows-theme) are first-class alternates, not afterthoughts.

## 2. Design Tokens

### 2.1 Color System

| Token | Dark Theme | Light Theme | Usage |
|---|---|---|---|
| `--surface-base` | `#1E1F22` @ 82% opacity (acrylic) | `#F7F7F8` @ 88% opacity (acrylic) | HUD panel background |
| `--surface-raised` | `#2A2B2F` | `#FFFFFF` | Popovers, dropdowns |
| `--border-subtle` | `#3A3B40` | `#E3E3E6` | Panel/popover borders |
| `--text-primary` | `#F5F5F7` | `#1B1B1F` | Primary labels |
| `--text-secondary` | `#A8A9AE` | `#63636B` | Secondary labels, hints |
| `--accent-primary` | `#5B8CFF` | `#3A66E0` | Active tool highlight, primary actions |
| `--accent-danger` | `#FF6B6B` | `#E0453A` | Destructive actions (delete, clear canvas) |
| `--overlay-scrim` | `rgba(0,0,0,0.45)` | `rgba(255,255,255,0.55)` | Ensures contrast of HUD text regardless of backdrop |

### 2.2 Typography

| Role | Family | Size | Weight |
|---|---|---|---|
| HUD labels | Segoe UI Variable | 12px | Regular (400) |
| Popover headers | Segoe UI Variable | 13px | Semibold (600) |
| Wizard headings | Segoe UI Variable Display | 24px | Semibold (600) |
| Canvas text notes (default) | Segoe UI | 16px (user-adjustable) | Regular (400), user-adjustable |

### 2.3 Elevation & Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Buttons, chips |
| `--radius-md` | 12px | HUD panel, popovers |
| `--radius-lg` | 16px | Wizard cards, sticky-note default corners |
| `--shadow-float` | `0 8px 24px rgba(0,0,0,0.35)` | Floating HUD elevation off the desktop |

## 3. Startup Setup Wizard — Wireframe & UX

Four-step modal flow (see `PRD.md` §7.1 for functional spec). Each step is a centered card, `560×420` logical px, over a dimmed live preview of the user's actual desktop.

```
┌──────────────────────────────────────────────────────┐
│  ● ○ ○ ○                                     [Skip]   │  <- step indicator
│                                                        │
│   Set up your canvas geometry                         │
│   ─────────────────────────                           │
│                                                        │
│   ( ) One continuous canvas across all displays        │
│   (•) Independent canvas per display                   │
│                                                        │
│         [ live multi-monitor preview thumbnail ]       │
│                                                        │
│                                                        │
│                                     [Back]   [Next →]  │
└──────────────────────────────────────────────────────┘
```

Step 3 (Backdrop selector) additionally renders a segmented control (`Solid | Gradient | Image`) with the relevant editor beneath it and a live full-bleed preview rendered behind the dimmed card so the user sees the true result before committing. Step 4 (Session reload) is skipped automatically (no card shown) when no prior `canvas_state.json` exists.

## 4. Floating Toolbar HUD Specification

### 4.1 Layout

A horizontally-oriented, draggable bar, default-docked to top-center of the primary display, collapsible to an icon-only rail. Logical dimensions: `560×56px` expanded, `56×56px` collapsed.

```
┌────────────────────────────────────────────────────────────┐
│ [⠿] [▸Select] [✎Pen] [▮Highlight] [⌫Erase] │ [T] [🖼] [▤]  │ [Mode ⇄] │
└────────────────────────────────────────────────────────────┘
  drag    ── tool group ──────────────────────  content group  transition
  handle                                                       group
```

| Region | Contents |
|---|---|
| Drag handle | Leftmost 24px; grabbing anywhere on the handle repositions the whole HUD; position is persisted per-monitor-arrangement in `settings.json`. |
| Tool group | Select/Move, Pen, Highlighter, Eraser — mutually exclusive selection, active tool gets `--accent-primary` underline + icon fill. |
| Content group | Text note, Image add, Background settings — momentary actions/panel-openers, not persistent tool states. |
| Transition group | Mode Switcher — rightmost, visually separated by a vertical divider, always reachable regardless of which tool is active. |

### 4.2 Popover Panels

Clicking a tool's small chevron (not the tool itself, to keep single-click tool switching fast) opens a popover anchored beneath it:

- **Brush palette popover:** 8 preset swatches + a "custom" swatch that opens hex/RGBA entry; opacity slider (0–100%) beneath; width slider (1–64px) with a live circular size preview.
- **Background settings popover:** Mirrors the wizard's backdrop editor (§3) so backdrop can be changed post-setup without re-running the full wizard.

Popovers use `--surface-raised` with `--shadow-float`, close on outside click or `Esc`, and never exceed the visible bounds of the display they're anchored to (auto-flip above the HUD if opening below would clip off-screen).

## 5. Canvas Interaction Patterns

| Interaction | Behavior |
|---|---|
| Panning | Space+drag (mouse), two-finger drag (touch/trackpad), or middle-mouse-button drag. |
| Zoom | `Ctrl` + mouse wheel, or pinch gesture; zoom is chrome-independent — the HUD stays fixed to screen space, not canvas space. |
| Object selection | Single click with the Select tool selects one object and shows its bounding box; `Shift`-click adds to selection; drag-rubber-band selects all objects intersecting the drag rect. |
| Bounding box | 8-point resize handles (4 corner, 4 edge) at object corners/midpoints; corner handles preserve aspect ratio by default, `Shift`-drag on a corner allows free distortion. |
| Rotation | A short stem above the top-center resize handle; dragging rotates about the object's center; holding `Shift` snaps to 15° increments. |
| Double-click note creation | Double-clicking empty canvas space (Select tool active, or from any tool via a dedicated modifier) spawns a Floating Text Note in inline-edit state, cursor focused immediately, with a minimal inline formatting toolbar (bold/italic/size/color) appearing directly above the note. |

## 6. Micro-Interactions & Transitions

### 6.1 Mode Toggle Transition

| Phase | Duration | Effect |
|---|---|---|
| Out | 60 ms | Current mode's interactive chrome (HUD in Edit Mode, nothing in Wallpaper Mode) fades out and scales to 96%. |
| Cross-fade | 60 ms overlap | Canvas content cross-fades between "live" and "frozen raster" representations — visually identical pixels, so this phase is imperceptible as a content change, only as a subtle chrome shift. |
| In | 60 ms | New mode's chrome fades in and scales from 96% to 100%. |

Total visual duration ≤ 150 ms, matching the budget in `PRD.md` §6.3. Input is queued (not dropped) during the transition and flushed to the newly-active mode the instant handover completes.

### 6.2 System Tray Icon States

| State | Icon Treatment |
|---|---|
| Wallpaper Mode (default) | Monochrome outline glyph, matches Windows tray theme (light/dark auto). |
| Edit Mode active | Same glyph with a small filled accent-colored dot badge, top-right. |
| Safe Mode / injection failed | Glyph with a small amber warning badge; hovering shows a tooltip explaining recovery is in progress or available via "Retry" in the context menu. |

### 6.3 Context Menu

Right-click on the tray icon shows, top to bottom: `Toggle Edit Mode`, separator, `Reconfigure Canvas…` (relaunches the wizard), `Open Canvas Folder`, separator, `Start with Windows` (checkable), separator, `Quit Desktop Canvas`.

## 7. Accessibility

- All HUD controls are keyboard-reachable via `Tab`/`Shift+Tab` with a visible focus ring (`2px solid var(--accent-primary)`, 2px offset).
- Minimum hit-target size of 32×32px for every icon button, even in the collapsed/icon-only HUD state.
- Color is never the sole indicator of tool selection state; an underline plus icon-fill change accompanies the accent-color highlight.
- The wizard and all popovers are screen-reader-labeled (`aria-label`/UI Automation names) even though the primary interaction model is pointer-based, to support Windows Narrator users configuring the app.

## 8. Component Inventory Summary

| Component | Used In |
|---|---|
| Segmented control | Wizard step 3, Background settings popover |
| Slider (continuous) | Opacity, brush width |
| Swatch grid | Brush palette popover, backdrop color picker |
| Inline rich-text toolbar | Floating Text Notes |
| Modal card (wizard step) | Setup Wizard only |
| Popover | Tool option panels |
| Tray context menu | Native Win32 menu, styled to match system theme automatically (not custom-drawn, for OS-consistency and accessibility reliability) |
