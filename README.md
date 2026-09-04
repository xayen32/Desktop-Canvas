# Desktop Canvas

<p align="center">
  <img src="assets/app-icon.png" alt="Desktop Canvas Logo" width="128" height="128" />
</p>

<p align="center">
  <strong>A Dual-Personality Windows Desktop Canvas & Live Inking Subsystem</strong><br>
  Seamlessly toggle between an interactive full-screen creative workspace and a persistent, zero-overhead live wallpaper.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-0078D6?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Framework-Tauri%20v2-24C8DB?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Language-Rust%20%2B%20TypeScript-DEA584?logo=rust&logoColor=white" alt="Languages" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
</p>

---

## Overview

**Desktop Canvas** transforms your Windows desktop into an infinite creative whiteboard without sacrificing traditional desktop functionality. With a single hotkey, the application transitions between two distinct operating modes:

1. **Edit Mode (Interactive Workspace)**: Elevates to a topmost, borderless drawing canvas. Sketch ideas, pin sticky notes, paste reference images, arrange layers, and customize backdrops using a sleek, floating HUD.
2. **Wallpaper Mode (Passive Desktop)**: Injects the canvas into the native Windows `WorkerW` desktop layer beneath all desktop icons. In this mode, the window is fully click-through (`WS_EX_TRANSPARENT`), freeing up system resources while keeping your notes and sketches visible 24/7.

---

## Key Features

### Dual-State Shell Integration
- **WorkerW Reparenting**: Safely pins the canvas window directly behind desktop icon windows (`SHELLDLL_DefView`) using native Win32 window messaging.
- **Instant Mode Switching**: Press `Ctrl + Shift + Space` or click the system tray icon to switch between Edit and Wallpaper modes in milliseconds.
- **Click-Through Transparency**: In Wallpaper Mode, all mouse and keyboard inputs pass directly to your desktop icons and wallpaper.
- **Shell Crash Recovery**: Subclasses the Win32 window procedure to catch `TaskbarCreated` messages, automatically re-injecting into `WorkerW` if `explorer.exe` restarts.
- **Multi-Monitor Geometry**: Dynamically recalculates virtual desktop bounds across multi-monitor configurations (`WM_DISPLAYCHANGE`).

### Creative Tools & Scene Graph
- **Smooth Vector Inking**: Custom stroke renderer using Catmull-Rom spline interpolation and velocity-based pressure calculation.
- **Multi-Layer Composition**: Independent layering across:
  - Custom solid, gradient, pattern, or image backdrops
  - Below-ink media layers
  - Vector pen & highlighter strokes
  - Above-ink media layers
  - Draggable, formatted sticky notes
- **Transform Gizmo**: Intuitive bounding-box handles for moving, scaling, and rotating placed images.
- **Marquee Selection**: Windows-style selection rectangle to select, group, and manipulate canvas elements.
- **State Persistence & Auto-Backup**: Atomic JSON state serialization with automatic rolling backups and corrupted state recovery.

---

## Architecture

```
Desktop Canvas
├── Native Win32 / Tauri Backend (src-tauri/)
│   ├── Desktop Integration (WorkerW discovery, reparenting, shell subclassing)
│   ├── Display Enumerator (Multi-monitor virtual screen bounds)
│   ├── State Persistence (Atomic serialization, rolling backup rotation)
│   └── IPC Command Gateway (Dual-mode bridge, snapshot trigger, tray events)
│
└── Frontend Canvas UI (ui/)
    ├── Inking Engine (Catmull-Rom spline stroke generation & smoothing)
    ├── Scene Graph (Multi-layer compositor, wallpaper snapshot renderer)
    ├── Media & Gizmo Manager (Image loading, bounding-box manipulation)
    ├── Sticky Notes Engine (Draggable, wrapped Markdown-style note cards)
    └── Floating Toolbar HUD (Tool selection, color pickers, backdrop settings)
```

---

## Getting Started

### Prerequisites

- **Windows 10 / 11** (64-bit)
- **Node.js** (v18 or higher) & **npm**
- **Rust Toolchain** (`stable-x86_64-pc-windows-msvc`)
- **Microsoft C++ Build Tools** (Visual Studio 2022 or Build Tools with C++ workload)
- **WebView2 Runtime** (installed by default on Windows 10/11)

### Quick Bootstrap

Run the PowerShell bootstrap script to install dependencies and verify toolchains:

```powershell
./scripts/bootstrap.ps1
```

### Development

To start the application in development mode with hot reloading:

```powershell
npm run dev
```

To run in standalone windowed mode (skipping desktop WorkerW reparenting during UI debugging):

```powershell
npm run dev:windowed
```

### Testing

Run the automated Rust integration and unit test suite:

```powershell
npm test
```

### Production Build

Compile optimized release binaries and native Windows installers:

```powershell
npm run build
```

The output installer and executable will be generated in `src-tauri/target/release/bundle/`.

---

## Documentation

Detailed architectural and design specifications are available in the [`docs/`](docs/) directory:

- [Product Requirements Document (PRD)](docs/PRD.md)
- [Technical Requirements Document (TRD)](docs/TRD.md)
- [Window Management & Win32 Integration Spec](docs/WINDOW_MANAGEMENT_SPEC.md)
- [UI / UX Design Specification](docs/UI_UX_DESIGN.md)
- [Performance & Lifecycle Specification](docs/PERFORMANCE_AND_LIFECYCLE_SPEC.md)
- [Backend Data Schema](docs/BACKEND_SCHEMA.md)
- [Testing & QA Plan](docs/TESTING_AND_QA_PLAN.md)

---

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to open an issue or submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
