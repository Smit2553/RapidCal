# Changelog

All notable changes to **RapidCal** are documented in this file.

## [v0.1.1] - 2026-10-10

### Fixed
- **macOS Apple Silicon (`aarch64.dmg`) Installer**: Fixed the `"RapidCal is damaged and can't be opened"` Gatekeeper error on M1/M2/M3/M4 Macs. Single-architecture `arm64` builds previously relied only on the linker's bare Mach-O signature (`adhoc,linker-signed`), leaving `Info.plist` and `Resources/` unsealed. RapidCal now applies full bundle-level ad-hoc signing (`signingIdentity: "-"`) so `Contents/_CodeSignature/CodeResources` is properly sealed across all macOS bundles (`aarch64`, `universal`, and `x64`).

### Added
- **In-App GitHub Releases Update Checker**:
  - New **Updates** panel in **Settings** (`Cmd/Ctrl + ,`) showing installed version, latest GitHub release, release notes, and last-checked timestamp.
  - Automatic architecture-aware installer selection (`aarch64.dmg`, `x64.dmg`, `universal.dmg`, `-setup.exe`, `.msi`, `.AppImage`, `.deb`, `.rpm`) with 1-click download.
  - Optional background update check on app launch (**Automatically check for updates on launch**).
- **Documentation**: Added AI disclosure and developer dogfooding note to `README.md`.

---

## [v0.1.0] - 2026-10-09

### Added
- Initial cross-platform alpha release of **RapidCal** for macOS, Windows, and Linux.
- Offline-first SQLite WAL + FTS5 calendar engine with optimistic `<1ms` local mutations and background outbox sync.
- Multi-account OAuth2 + PKCE loopback authentication for Google Calendar and Microsoft Outlook / Microsoft 365.
- Read-only `.ics` / `webcal://` calendar feed subscription support with Windows-to-IANA timezone translation.
- 1-click video conference join (`Cmd/Ctrl + J`), natural-language quick-add (`C` / `Cmd/Ctrl + K`), RSVP management, and cross-account `[Busy]` block mirroring.
