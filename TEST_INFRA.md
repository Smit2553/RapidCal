# RapidCal End-to-End (E2E) Test Infrastructure

## 1. Overview & Architecture

The RapidCal E2E test harness is an automated, opaque-box testing framework built specifically for desktop calendar verification across multiple viewport sizes, themes, and emulated operating systems. 

To operate reliably in sandboxed, restricted, and air-gapped CI environments where registry access is disabled (`403 Forbidden` on `npm install`), the harness is engineered entirely in **native Node.js 22** using built-in `fetch`, `WebSocket`, `child_process`, and the **Chrome DevTools Protocol (CDP)** without any external npm testing dependencies (such as Puppeteer or Playwright wrappers).

```
                      ┌────────────────────────────────────────┐
                      │        Node.js 22 Test Runner          │
                      │     (tests/e2e/run_all.js)             │
                      └──────────────┬─────────────────────────┘
                                     │
                 ┌───────────────────┴────────────────────┐
                 ▼                                        ▼
   ┌───────────────────────────┐            ┌───────────────────────────┐
   │    Vite Dev Server        │            │  Headless Chromium        │
   │  (tests/e2e/cdp/          │            │  (Chrome for Testing 151) │
   │   dev_server.js)          │            │  (tests/e2e/cdp/chrome.js)│
   │  Local: 127.0.0.1:1420+   │            │  CDP over WebSocket       │
   └─────────────┬─────────────┘            └─────────────┬─────────────┘
                 │                                        │
                 │              HTTP / Assets             │
                 └────────────────────────────────────────┘
```

---

## 2. Core Harness Components (`tests/e2e/cdp/`)

### 2.1 Headless Chrome Launcher (`tests/e2e/cdp/chrome.js`)
- **Binary Location**: Uses the locally provisioned Chromium binary at:
  `/home/asurite.ad.asu.edu/ssdevruk/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
  (configurable via `CHROME_PATH` / `CHROME_BIN`).
- **Ephemeral Port Allocation**: Launches with `--remote-debugging-port=0` (or configured port) to eliminate port collisions and socket `TIME_WAIT` latency. It dynamically extracts the assigned `ws://...` endpoint from Chrome's standard error stream.
- **Offline / Sandboxed Resilience**: Includes flags to prevent background network attempts and hang risks in proxy-constrained environments:
  - `--headless=new`
  - `--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage`
  - `--disable-background-networking`, `--disable-component-update`
  - `--disable-sync`, `--disable-default-apps`, `--disable-domain-reliability`
- **Lifecycle Management**: Cleans up temporary user data directories and kills processes upon exit or abort signals.

### 2.2 Dev Server Manager (`tests/e2e/cdp/dev_server.js`)
- **Auto-Detection**: Probes whether RapidCal is already running at `http://127.0.0.1:1420/` or a custom `RAPIDCAL_TEST_URL`.
- **Dynamic Spawn & Fallback**: If offline, spawns the local Vite binary (`node_modules/.bin/vite --port 1420 --host 127.0.0.1 --strictPort false`) to avoid port binding conflicts.
- **URL Extraction**: Scrapes the active listening URL from Vite's startup output (`http://127.0.0.1:<port>/`), verifies HTTP readiness with native `http.get`, and terminates the child process upon test suite completion.

### 2.3 CDP Client (`tests/e2e/cdp/cdp_client.js`)
Implements typed, bidirectional RPC communication with Chromium DevTools Protocol:
- **`Page` Domain**: `Page.enable`, `Page.navigate`, `Page.loadEventFired`, `Page.captureScreenshot`.
- **`Runtime` Domain**: `Runtime.enable`, `Runtime.evaluate` with promise resolution and object return.
- **`Emulation` Domain**:
  - `Emulation.setDeviceMetricsOverride`: Viewport resizing down to `960×640` and up to `1920×1080`.
  - `Emulation.setUserAgentOverride`: Platform simulation (`MacIntel`, `Linux x86_64`, `Win32`).
- **`DOM` & Layout Auditing**:
  - `checkHorizontalOverflow()`: Scans the active DOM tree for unintentional horizontal overflow (`scrollWidth > clientWidth`).
  - `getBoundingBox(selector)`: Extracts precise bounding box metrics (`x`, `y`, `width`, `height`).
  - `click(selector)`, `type(selector, text)`, `waitForSelector(selector)`.

### 2.4 Unified Test Harness (`tests/e2e/harness.js`)
- Exposes `createHarness()` which initializes Chrome, launches/connects to Vite, opens a page session, and mounts helper utilities.
- Provides `TestSuite` with lifecycle hooks (`beforeAll`, `afterAll`, `beforeEach`, `afterEach`), structured timing assertions, and PNG screenshot saving to `tests/e2e/screenshots/`.

---

## 3. Test Suite Inventory

| Tier | File | Description | Test Count |
| :--- | :--- | :--- | :---: |
| **Tier 1** | `tests/e2e/tier1_views.test.js` | **View & Navigation Coverage**: Validates rendering of Day, 3-Day, Work Week, Week, Month, and Agenda views; Settings dialog navigation across all tabs; Command Palette modal open/dismiss. | **10** |
| **Tier 2** | `tests/e2e/tier2_boundaries.test.js` | **Boundary & Layout Verification**: Minimum viewport (`960×640`) with dual sidebars open simultaneously; time-grid gutter widths under 12h (`12:00 PM`) and 24h (`12:00`); dual timezone header spacing; short-duration event cards (15m/30m); overlapping card column packing; zero horizontal overflow audit across 4 viewports (`960×640`, `1280×800`, `1380×860`, `1920×1080`). | **7** |
| **Tier 3** | `tests/e2e/tier3_cross_features.test.js` | **Cross-Feature Integration**: Platform emulation (`MacIntel` vs `Linux x86_64` vs `Win32`) verifying dynamic modifier badges (`⌘` vs `Ctrl`); Dark vs Light mode contrast and CSS class toggling; Timezone detection and gutter reflow. | **6** |
| **Tier 4** | `tests/e2e/tier4_user_flows.test.js` | **End-to-End User Journeys**: Creating events via EventInspector; Natural Language Quick Add via Command Palette; Event search filtering; Date stepping and jump to Today; User preference persistence (week start day); Sidebar collapsing and expanding reflow. | **6** |
| **Total** | — | — | **29** |

---

## 4. How to Execute Tests

### Run All Suites (Tiers 1–4)
```bash
node tests/e2e/run_all.js
```

### Run an Individual Suite
```bash
# Tier 1 only (Views & Navigation)
node tests/e2e/run_all.js tier1
# or directly:
node tests/e2e/tier1_views.test.js

# Tier 2 only (Boundaries & Viewports)
node tests/e2e/run_all.js tier2
# or directly:
node tests/e2e/tier2_boundaries.test.js

# Tier 3 only (Cross-Features, Themes, Platforms)
node tests/e2e/run_all.js tier3
# or directly:
node tests/e2e/tier3_cross_features.test.js

# Tier 4 only (User Flows & Interactions)
node tests/e2e/run_all.js tier4
# or directly:
node tests/e2e/tier4_user_flows.test.js
```

### Optional Environment Variables
- `RAPIDCAL_TEST_URL`: Connect to a pre-existing server (e.g. `http://localhost:1420/`).
- `CHROME_PATH`: Override the Chromium executable location.
- `CDP_PORT`: Specify a fixed CDP debugging port (default: auto-detected ephemeral port).

---

## 5. Artifacts and Reporting

1. **Structured JSON Report**:
   Every run generates `/home/asurite.ad.asu.edu/ssdevruk/Documents/Projects/RapidCal/tests/e2e/test_report.json` containing test results, timestamps, duration, pass/fail counts, and defect details.
2. **Visual Inspection Screenshots**:
   Screenshots captured during test execution are saved in:
   `/home/asurite.ad.asu.edu/ssdevruk/Documents/Projects/RapidCal/tests/e2e/screenshots/`
   - `tier1_01_topbar.png` through `tier1_09_command_palette.png`
   - `tier2_01_dual_sidebars_960x640.png` through `tier2_07_overflow_audit_passed.png`
   - `tier3_01_platform_mac.png` through `tier3_06_timezone_reflow.png`
   - `tier4_01_event_created.png` through `tier4_06_sidebars_toggle.png`
