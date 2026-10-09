# RapidCal

[![Continuous Integration](https://github.com/Smit2553/RapidCal/actions/workflows/ci.yml/badge.svg)](https://github.com/Smit2553/RapidCal/actions/workflows/ci.yml)
[![Cross-Platform Release & Deployment](https://github.com/Smit2553/RapidCal/actions/workflows/release.yml/badge.svg)](https://github.com/Smit2553/RapidCal/actions/workflows/release.yml)

**RapidCal** is a lightweight, offline-first cross-platform desktop calendar engineered in **Rust (Tauri v2)** and **SolidJS + TypeScript + Tailwind CSS** for `<1ms` UI interactions, a tiny memory footprint (`<10MB` background daemon when hibernated to system tray), and seamless multi-account sync across **Google Calendar** and **Microsoft Outlook / Microsoft 365**.

> [!NOTE]
> **AI Disclosure:** This project was built with the assistance of AI coding agents, and is actively used and dogfooded every day by me (the developer) as my primary desktop calendar.

---

## Key Features

- **Tauri v2 + SolidJS Zero-VDOM Frontend**: Fine-grained reactive signals, `1px` hairline precision grids, `JetBrains Mono` tabular time gutters, adaptive Dark & Light themes, diagonal tentative stripes, and glowing live current-time needle.
- **Offline-First SQLite WAL + FTS5 Engine**:
  - `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA mmap_size = 268435456;`
  - Persistent `outbox_mutations` queue for `<1ms` optimistic local edits and automatic background push with exponential backoff.
  - `<2ms` full-text search via `events_fts` (`FTS5` virtual table).
- **Multi-Account OAuth2 + PKCE Loopback Vault**:
  - Direct localhost loopback OAuth2 + PKCE (`S256`) flow in Rust (`127.0.0.1:0`) with zero external cloud relay.
  - Native OS Keychain token storage (`keyring`) with automatic AES-256-GCM encrypted SQLite fallback (`encrypted_credentials`).
- **Google Calendar v3, Microsoft Graph Delta Sync & `.ics` Feed Subscriptions**:
  - Incremental `nextSyncToken` (Google) and `@odata.deltaLink` (Microsoft Graph) synchronization, plus read-only `.ics` / `webcal://` calendar feed polling.
  - Bi-directional translator between Microsoft Graph `patternedRecurrence` and RFC 5545 `RRULE` strings, plus Windows-to-IANA timezone translation for published Outlook `.ics` feeds.
  - Local Rust `rrule` expansion with rolling materialized window (`event_instances`) + on-the-fly expansion for distant years.
- **Multi-Account Meeting Suite**:
  - 1-click Video Conference Join (`Cmd/Ctrl+J`) for Google Meet, Microsoft Teams, Zoom, and Webex.
  - Inline & Inspector Attendee RSVP (`Yes` / `Maybe` / `No`).
  - **Cross-Account Busy Blocking**: Mirror personal events as `[Busy]` onto work calendars across Google <-> Outlook with automatic time-change propagation.

---

## Enterprise & University Microsoft Outlook Disclosure

> [!IMPORTANT]
> **Known Limitation — Enterprise / University Microsoft 365 OAuth Tenants:**
> While personal Microsoft accounts (`@outlook.com`, `@hotmail.com`, `@live.com`) and open Microsoft 365 tenants work with full two-way OAuth2 sync, many corporate and university Microsoft Entra ID (Azure AD) tenants block unverified third-party OAuth applications from requesting `Calendars.ReadWrite` without IT administrator tenant-wide consent or a Microsoft Partner Network verified business entity.
>
> **Resolving enterprise Microsoft OAuth publisher verification is not on the roadmap at this point.**
>
> **Supported Workaround (Read-Only `.ics` Subscription):**
> If your organization blocks Microsoft OAuth sign-in, you can connect your Outlook schedule in **Settings → Connected Accounts → Subscribe via `.ICS` / WebCal Feed (Read-Only)**:
> 1. Open [Outlook on the Web](https://outlook.office.com) → **Settings (Gear Icon)** → **Calendar** → **Shared calendars**.
> 2. Under **Publish a calendar**, select your calendar, choose **Can view all details**, and click **Publish**.
> 3. Copy the generated **ICS** link and paste it into RapidCal. RapidCal will automatically sync your events, recurring series, timezones, and Microsoft Teams / Zoom join links (`Cmd/Ctrl+J`) on a read-only basis.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd/Ctrl + K` | Open Command Palette (Natural Language Quick-Add & FTS5 Search) |
| `Cmd/Ctrl + F` | Open SQLite FTS5 Search |
| `Cmd/Ctrl + J` | 1-Click Join Active or Upcoming Video Meeting (Meet / Teams / Zoom) |
| `Cmd/Ctrl + R` | Trigger Immediate Incremental Sync & Outbox Flush |
| `C` | Quick-Add Event with Rust Natural Language Parser |
| `D` / `3` / `5` / `W` | Switch to Day / 3-Day / Work-Week (5d) / Week (7d) View |
| `M` / `A` | Switch to Month / Chronological Agenda Dossier View |
| `T` | Jump to Today |
| `[` / `]` | Collapse or Expand Left Sidebar / Right Event Inspector |
| `←` / `→` | Step Backward / Forward in Current View |
| `Delete` / `Backspace` | Delete Selected Event |

---

## Development & Build Commands

```bash
# Install frontend dependencies
npm install

# Type-check and build SolidJS production bundle
npm run build

# Run Tauri v2 desktop app in development mode
npm run tauri dev

# Run Rust formatting check, Clippy static analysis, and unit/integration tests
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## CI/CD Integration & Deployment Architecture

RapidCal includes a complete GitHub Actions CI/CD pipeline under [`.github/workflows/`](.github/workflows/):

1. **Continuous Integration ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))**:
   - Triggered on every `push` and `pull_request` to `main` / `develop`, or manually via `workflow_dispatch`.
   - **Frontend Job**: Runs `npm ci`, TypeScript compiler check (`tsc --noEmit`), and Vite/SolidJS production build (`npm run build`), uploading the verified `dist/` bundle artifact.
   - **Rust Quality Job**: Verifies `cargo fmt --check`, enforces zero-warning static analysis via `cargo clippy --all-targets -- -D warnings`, and validates `tauri/custom-protocol` asset embedding.
   - **Cross-Platform Test Matrix**: Executes the Rust unit and integration test suite across `ubuntu-latest`, `macos-latest`, and `windows-latest` with `Swatinem/rust-cache@v2`.

2. **Cross-Platform Release & Deployment ([`.github/workflows/release.yml`](.github/workflows/release.yml))**:
   - Triggered automatically when pushing a semantic version tag (`v*.*.*`) or manually via `workflow_dispatch`.
   - Runs a pre-release quality gate before building native installers in parallel via [`tauri-apps/tauri-action@v0`](https://github.com/tauri-apps/tauri-action):
     - **Linux (`x86_64`)**: `.AppImage`, `.deb`, and `.rpm`
     - **macOS (`universal-apple-darwin`, `aarch64-apple-darwin`, `x86_64-apple-darwin`)**: Universal `.dmg` disk image and `.app` bundle (plus dedicated Apple Silicon and Intel `.dmg` installers)
     - **Windows (`x86_64-pc-windows-msvc`)**: `.msi` (WiX) and `-setup.exe` (NSIS) installers
   - Automatically drafts a GitHub Release and uploads all platform installers.

```bash
# Cut and deploy a new cross-platform release
git tag v0.1.0
git push origin v0.1.0
```
