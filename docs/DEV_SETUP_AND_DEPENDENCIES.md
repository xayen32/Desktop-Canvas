# Developer Setup & Dependencies
## Desktop Canvas — Environment & Onboarding Guide

| Field | Value |
|---|---|
| Document | DEV_SETUP_AND_DEPENDENCIES.md |
| Version | 1.0.0 |
| Status | Draft — Ready for Engineering Onboarding |
| Related Docs | TRD.md |

---

## 1. Prerequisites & Toolchains

| Tool | Version | Purpose |
|---|---|---|
| Node.js | LTS (20.x or later) | Tauri CLI, frontend build tooling (TypeScript, bundler) |
| Rust / Cargo | `stable-x86_64-pc-windows-msvc` toolchain | Native shell compilation |
| Visual Studio 2022 Build Tools | MSVC v143, Windows 10/11 SDK (latest) | Required by the Rust MSVC toolchain and any native crate with a C dependency |
| WebView2 Runtime | Evergreen (auto-updating) | Rendering host for the canvas UI; pre-installed on Windows 11 and most Windows 10 22H2+ machines, bundled as a bootstrapper fallback in the installer |
| Git | Any recent version | Source control |

### 1.1 Installing Rust

```powershell
# Download and run rustup, then select the MSVC toolchain
winget install Rustlang.Rustup
rustup toolchain install stable-x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

### 1.2 Installing Visual Studio 2022 Build Tools

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended --passive"
```

The `Microsoft.VisualStudio.Workload.VCTools` workload provides the MSVC linker (`link.exe`) that the Rust `stable-x86_64-pc-windows-msvc` toolchain shells out to; without it, `cargo build` fails at the link stage even though compilation succeeds.

### 1.3 Installing Node.js

```powershell
winget install OpenJS.NodeJS.LTS
```

## 2. One-Command Setup

### 2.1 Clone & Bootstrap

```powershell
git clone https://github.com/your-org/desktop-canvas.git
cd desktop-canvas
./scripts/bootstrap.ps1
```

`bootstrap.ps1` performs, in order:

```powershell
# scripts/bootstrap.ps1
Write-Host "Installing frontend dependencies..."
npm install --prefix ./ui

Write-Host "Installing Tauri CLI..."
cargo install tauri-cli --version "^2.0"

Write-Host "Fetching Rust crate dependencies..."
cargo fetch --manifest-path ./src-tauri/Cargo.toml

Write-Host "Verifying WebView2 Runtime is present..."
$webview2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $webview2) {
    Write-Warning "WebView2 Runtime not detected. It will be installed automatically by the Evergreen Bootstrapper on first packaged run, but local `cargo tauri dev` may require a manual install: https://developer.microsoft.com/microsoft-edge/webview2/"
}

Write-Host "Bootstrap complete."
```

### 2.2 Environment Variables

Create `.env.local` at the repository root (git-ignored):

```
# .env.local
DESKTOP_CANVAS_LOG_LEVEL=debug
DESKTOP_CANVAS_DEV_APPDATA_OVERRIDE=C:\Users\<you>\AppData\Roaming\DesktopCanvasDev
```

`DESKTOP_CANVAS_DEV_APPDATA_OVERRIDE` redirects local state storage to a dev-only folder, so local testing never mutates a real installed copy's `canvas_state.json` on a shared dev machine.

### 2.3 Building — Debug

```powershell
cargo tauri dev
```

This launches the app with hot-reload on the TypeScript/HTML/CSS side and a debug-symbol Rust binary. The dev build **does not** perform the WorkerW injection by default (see `DESKTOP_CANVAS_DEV_APPDATA_OVERRIDE`-adjacent flag `--dev-windowed` below) so engineers iterating on canvas/HUD UI are not fighting the desktop shell on every reload.

```powershell
# To test real WorkerW injection locally (required before any WINDOW_MANAGEMENT_SPEC.md change):
cargo tauri dev -- --inject-workerw
```

### 2.4 Building — Release

```powershell
cargo tauri build
```

Produces a signed MSI installer under `src-tauri/target/release/bundle/msi/`. Code-signing requires a valid certificate configured via the `TAURI_SIGNING_PRIVATE_KEY` environment variable in CI; local unsigned builds are permitted for development but will trigger a SmartScreen warning if distributed.

## 3. Project Structure

```
desktop-canvas/
├── src-tauri/                  # Rust native shell
│   ├── src/
│   │   ├── main.rs
│   │   ├── desktop_integration/    # WINDOW_MANAGEMENT_SPEC.md implementation
│   │   │   ├── workerw.rs
│   │   │   ├── state_machine.rs
│   │   │   └── shell_hooks.rs
│   │   ├── state/                  # BACKEND_SCHEMA.md implementation
│   │   │   ├── schema.rs
│   │   │   ├── persistence.rs
│   │   │   └── migrations.rs
│   │   ├── ipc/                    # Tauri command + event definitions
│   │   └── tray.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── ui/                          # WebView2-hosted TypeScript front end
│   ├── src/
│   │   ├── canvas/                 # Stroke/image/text rendering + input capture
│   │   ├── hud/                    # UI_UX_DESIGN.md floating toolbar
│   │   ├── wizard/                 # Setup Wizard
│   │   └── ipc-client.ts
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   └── bootstrap.ps1
└── docs/                        # This documentation suite
```

## 4. Common Build Errors & Solutions

| Error | Cause | Solution |
|---|---|---|
| `error: linker 'link.exe' not found` | MSVC Build Tools not installed, or wrong Rust toolchain (`gnu` instead of `msvc`) active. | Install VS 2022 Build Tools per §1.2; run `rustup default stable-x86_64-pc-windows-msvc`. |
| `error[E0433]: failed to resolve: use of undeclared crate or module 'windows'` | `windows` crate missing from `Cargo.toml` or feature flags not enabled for the required Win32 modules (e.g., `Win32_UI_WindowsAndMessaging`). | Add/verify the crate and required feature flags in `src-tauri/Cargo.toml`; re-run `cargo fetch`. |
| Type-casting pointer errors (`HWND` vs `isize` vs `*mut c_void` mismatches) | `windows`-crate versions differ in whether handle types are tuple-structs wrapping an integer or raw pointers; mixing crate versions or copying snippets from mismatched crate versions. | Pin a single `windows` crate version across the workspace in `Cargo.toml`; use the crate's own conversion methods (`HWND(value)` / `.0`) rather than raw `as` casts between versions. |
| `WebView2Loader.dll not found` / blank window at runtime | WebView2 Runtime not installed on the dev machine, or the Evergreen bootstrapper hasn't run. | Install the Evergreen Runtime manually for local dev: `https://developer.microsoft.com/microsoft-edge/webview2/`; verify via the registry check in `bootstrap.ps1` (§2.1). |
| App manifest / DPI errors: HUD appears blurry or mis-scaled at non-100% DPI during dev | `tauri.conf.json` missing or incorrect `dpiAwareness` manifest entry, or `SetProcessDpiAwarenessContext` call ordering issue relative to window creation. | Confirm `<dpiAwareness>PerMonitorV2</dpiAwareness>` is present in the generated manifest (`tauri.conf.json` → `bundle.windows.wix`/`nsis` manifest settings) and that the DPI awareness context is set before the first `HWND` is created, per `TRD.md` §4. |
| `cargo tauri dev` succeeds but `Win + D` hides the window | Ran without `--inject-workerw` (default dev mode intentionally skips injection, §2.3) — this is expected, not a bug. | Re-run with `cargo tauri dev -- --inject-workerw` when testing desktop-integration behavior specifically. |
| CI build fails signing step only | `TAURI_SIGNING_PRIVATE_KEY` / associated password secret not configured in the CI environment, or expired certificate. | Verify CI secrets configuration; local `cargo tauri build` without signing configured is expected to produce an unsigned (dev-only) artifact and is not itself an error. |

## 5. Code Style & Contribution Guidelines

- **Rust:** `rustfmt` (default settings) and `clippy` (`cargo clippy --all-targets -- -D warnings`) must pass with zero warnings before merge.
- **TypeScript:** ESLint + Prettier, configuration checked into `ui/.eslintrc.json`; no `any` types in the `ipc-client.ts` boundary layer — all IPC payloads are typed against the schemas in `BACKEND_SCHEMA.md`.
- **Commits touching `desktop_integration/`:** Must include a note in the PR description confirming which of the manual matrix cases in `TESTING_AND_QA_PLAN.md` §3 (at minimum M1, M3, M11) were re-run locally, since this code path cannot be fully validated by CI alone.
- **Schema changes:** Any change to a struct in `state/schema.rs` requires a corresponding entry in `state/migrations.rs` and a new fixture-based migration test, per `BACKEND_SCHEMA.md` §5 — schema changes without a migration path are rejected in review.
