# Testing & QA Plan
## Desktop Canvas — Quality Assurance & Test Matrix

| Field | Value |
|---|---|
| Document | TESTING_AND_QA_PLAN.md |
| Version | 1.0.0 |
| Status | Draft — Ready for QA Review |
| Related Docs | PRD.md, WINDOW_MANAGEMENT_SPEC.md, PERFORMANCE_AND_LIFECYCLE_SPEC.md |

---

## 1. Test Strategy Overview

Desktop Canvas's risk profile is concentrated in three areas that ordinary UI testing does not cover well: (a) undocumented Win32 desktop-shell integration, (b) mode-transition timing/crash-safety, and (c) resource budgets that must hold over long idle periods. The test strategy therefore layers three tiers:

1. **Automated unit/integration tests** (run on every commit) — fast, deterministic, cover serialization and protocol correctness.
2. **Automated mock-environment Win32 tests** (run on every commit) — validate the WorkerW-location algorithm's logic against simulated window hierarchies without needing a live desktop.
3. **Manual verification matrix** (run every release candidate, and for any change touching `WINDOW_MANAGEMENT_SPEC.md` or `PERFORMANCE_AND_LIFECYCLE_SPEC.md`) — the only tier that can validate real Explorer/DWM behavior, real multi-monitor hardware, and real long-idle power draw.

## 2. Automated Testing Suite

### 2.1 State Serialization / Deserialization Unit Tests

| Test | Assertion |
|---|---|
| `test_roundtrip_canvas_state` | Serializing a populated `CanvasStateSchema` and deserializing it back yields a byte-for-byte-equivalent scene graph (element order, all field values). |
| `test_reject_invalid_stroke_color` | A stroke with `color: "not-a-hex"` fails schema validation with a specific, catchable error variant. |
| `test_schema_version_migration_v1_to_v2` | A fixture file at `schemaVersion: 1` migrates to the current version and passes validation, with every migration step (§5 of `BACKEND_SCHEMA.md`) covered by its own fixture-based test. |
| `test_corrupted_json_falls_back_to_backup` | Feeding a truncated/invalid `canvas_state.json` plus a valid backup into the load path yields the backup's content and a `recovery-notice: info` event, matching `PERFORMANCE_AND_LIFECYCLE_SPEC.md` §4.1. |
| `test_asset_dedup_by_hash` | Importing the same image bytes twice results in exactly one file under `images\` and two elements referencing the same `assetHash`. |

### 2.2 Win32 WorkerW Hook Unit Tests (Mock Environment)

Because `EnumWindows`/`FindWindowExW` cannot be meaningfully unit-tested against the *real* desktop in CI (no interactive desktop session, and destructive to a real shell if it were), the enumeration **logic** in `WINDOW_MANAGEMENT_SPEC.md` §2 is refactored behind a trait/interface (`WindowEnumerationSource`) that production code satisfies via real Win32 calls and tests satisfy via an in-memory fixture window tree.

| Test | Fixture Shape | Assertion |
|---|---|---|
| `test_finds_workerw_single_sibling` | Windows-10-style hierarchy: one `WorkerW` with `SHELLDLL_DefView`, one plain sibling `WorkerW`. | Algorithm selects the plain sibling. |
| `test_finds_workerw_multiple_siblings` | Windows-11-quirk hierarchy: one `WorkerW` with `SHELLDLL_DefView`, two further plain `WorkerW` siblings. | Algorithm selects the **first** plain sibling and ignores the second, per `WINDOW_MANAGEMENT_SPEC.md` §5. |
| `test_no_shelldll_defview_found` | Degenerate hierarchy with no `SHELLDLL_DefView` anywhere (simulating a mid-restart Explorer state). | Algorithm returns `None`, triggering the retry policy rather than panicking. |
| `test_retry_backoff_schedule` | Mocked clock + a fixture that returns `None` for the first 4 calls and `Some(hwnd)` on the 5th. | Retry delays match the table in `WINDOW_MANAGEMENT_SPEC.md` §3.3 exactly, and injection succeeds on the final attempt. |
| `test_retry_exhaustion_enters_safe_mode` | Fixture that always returns `None`. | State machine transitions to `SAFE_MODE` after exactly 5 attempts, never more. |

### 2.3 IPC Payload Schema Validators

| Test | Assertion |
|---|---|
| `test_save_canvas_rejects_malformed_payload` | An `save_canvas` invocation with a payload failing `CanvasStateSchema` validation is rejected before any file I/O is attempted. |
| `test_import_image_rejects_oversized_payload` | A `base64Data` payload exceeding the configured maximum (default 50 MB decoded) is rejected with a specific error rather than attempting the write and failing later. |
| `test_toggle_mode_rejects_unknown_target` | A `toggle_mode` call with `target: "foo"` is rejected at the type/schema layer, not silently ignored. |

## 3. Manual Verification Matrix

| # | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| M1 | `Win + D` stress test | Enter Wallpaper Mode with canvas content present. Press `Win + D` 100 times in rapid succession (scripted key-send acceptable). | Canvas content is never hidden, cleared, or corrupted; desktop icons show/hide normally as if the app were not running. | P0 |
| M2 | `Win + D` during Edit Mode | While in Edit Mode with an in-progress stroke, press `Win + D`. | Application does not crash; either the stroke completes safely and the app returns to Wallpaper Mode, or the app defines and documents the intended behavior — no undefined/crashing state. | P0 |
| M3 | Multi-monitor hot-unplug | With 2+ monitors and canvas content spanning them, physically or virtually (RDP/driver) disconnect a monitor. | Canvas re-flows to remaining display(s) without content loss; no crash; `display-changed` event fires exactly once per topology change. | P0 |
| M4 | Multi-monitor resolution change | Change one monitor's resolution while app is running in both Wallpaper and Edit Mode (separate runs). | HUD and canvas re-scale correctly; no clipped or off-screen HUD; content coordinates remain stable. | P1 |
| M5 | DPI scaling — 100% | Set display scaling to 100%, launch app fresh. | All chrome crisp, no blur, HUD hit-targets align pixel-accurately with rendered icons. | P0 |
| M6 | DPI scaling — 125% | Repeat M5 at 125%. | Same acceptance criteria as M5. | P0 |
| M7 | DPI scaling — 150% | Repeat M5 at 150%. | Same acceptance criteria as M5. | P0 |
| M8 | DPI scaling — 200% | Repeat M5 at 200%. | Same acceptance criteria as M5. | P0 |
| M9 | Mixed-DPI multi-monitor | Two monitors at different scale factors (e.g., 100% and 150%); drag the HUD and an image element between them. | No distortion of stroke geometry; HUD re-scales live as it crosses the monitor boundary. | P1 |
| M10 | Large image drag-and-drop | Drag-and-drop a 4K (3840×2160) and separately an 8K (7680×4320) screenshot onto the canvas; monitor RSS via Task Manager/WPR. | Import completes without UI freeze; RAM budget in `PERFORMANCE_AND_LIFECYCLE_SPEC.md` §1 (Edit Mode row) is respected or the documented budget is explicitly revisited; no crash. | P1 |
| M11 | Explorer.exe manual crash | Run `taskkill /f /im explorer.exe` while app is in Wallpaper Mode with content present; observe Explorer auto-relaunch. | App detects `TaskbarCreated`, re-injects into the new `WorkerW`, restores Wallpaper Mode automatically, content intact; no orphaned top-level window flashes visibly on the taskbar. | P0 |
| M12 | Explorer.exe crash during Edit Mode | Repeat M11 while actively in Edit Mode. | App restores to Edit Mode (not silently dropped to Wallpaper Mode) with all in-memory edits intact. | P0 |
| M13 | Repeated Explorer restarts | Repeat M11 five times consecutively with no delay between. | Every cycle succeeds; no cumulative resource leak (verify handle count and RAM before/after via Task Manager "Details" tab). | P1 |
| M14 | Cold boot / autostart | Enable "Start with Windows," reboot the machine. | App reaches Wallpaper Mode automatically within a reasonable post-logon window, without visibly flashing a normal window first. | P1 |
| M15 | Idle power draw, extended | Leave app in Wallpaper Mode for 30+ minutes with a power/energy monitoring tool (e.g., Windows' own Task Manager "Power usage" column, or `powercfg /energy`). | CPU usage reads 0% sustained after the initial settle period; RAM stays under budget; no gradual RAM growth (leak check). | P0 |
| M16 | Rapid mode toggling | Toggle Edit/Wallpaper Mode via hotkey 50 times in quick succession. | No crash, no visual tearing left behind, final state matches the last requested mode. | P1 |
| M17 | Setup Wizard cancel/skip paths | Launch fresh install, exercise "Skip" and "Back" on every wizard step. | App reaches a valid default `WALLPAPER_MODE` state regardless of how the wizard was exited; no null/undefined settings crash later. | P1 |
| M18 | Corrupted state file recovery | Manually truncate `canvas_state.json` mid-content, relaunch app. | Falls back to most recent backup per `PERFORMANCE_AND_LIFECYCLE_SPEC.md` §4.1; corrupted file preserved under `backups\` with `.corrupt.` suffix; user sees an info-level notice. | P1 |

## 4. Regression Suite

Every P0 case in §3, plus the full automated suite in §2, is re-run against every release candidate build prior to sign-off. Any change to `WINDOW_MANAGEMENT_SPEC.md`-covered code additionally requires a full re-run of M1–M3 and M11–M13 regardless of how small the diff appears, given the historically undocumented and version-sensitive nature of the WorkerW mechanism (`WINDOW_MANAGEMENT_SPEC.md` §5).

## 5. Reference Hardware / Configuration Matrix

| Configuration | Included Because |
|---|---|
| Windows 10 22H2, single monitor, 100% DPI | Baseline minimum supported OS. |
| Windows 11 (current supported servicing branch at release time), single monitor, 100% DPI | Baseline current OS. |
| Windows 11, dual monitor, mixed DPI (100%/150%) | Covers M9, the highest-risk DPI/monitor combination. |
| Windows 11, triple monitor, uniform 125% DPI | Covers virtual-screen-bounds math at scale beyond two displays. |
| Windows 11 on a device with a pressure-sensitive pen (e.g., Surface-class hardware) | Validates pressure/tilt input path end-to-end, not just mouse-simulated pressure. |

## 6. Release / Exit Criteria

A release candidate is sign-off-eligible only when:

1. 100% of automated tests in §2 pass on CI.
2. 100% of P0 manual cases in §3 pass on every configuration in §5.
3. M1 and M11 each pass 100 consecutive iterations with zero failures, run back-to-back in a single session (not cumulative across multiple partial runs).
4. No open defect is classified P0 or P1 in the tracked defect list.
5. Idle power draw (M15) shows 0% sustained CPU and RAM within budget after a 30-minute soak, on at least the two baseline OS configurations in §5.
