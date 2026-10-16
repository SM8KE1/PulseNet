# Changelog

All notable PulseNet changes are documented in this file.

## 2.0.2

.

## 2.0.0 - 2026-08-10

### Added

- Network Usage Monitor with live physical and active VPN adapter traffic.
- Active process connection view with search, connection sorting, application icons, animated details, and system-process filtering.
- Persistent per-application TCP download-share chart with reset support.
- Per-application internet blocking and download/upload bandwidth rules.
- Windows network-control helper service and Linux systemd/cgroup v2/nftables helper.
- Direct GitHub Release packaging for Linux AppImage, DEB, RPM, Arch files, Windows NSIS, and Windows MSI (support later narrowed to DEB and RPM on Linux).

### Changed

- Migrated system data collection from shell commands to native Windows APIs and Linux `/proc`, `/sys`, and NetworkManager D-Bus paths where possible.
- Refreshed Ping, DNS, Speed Test, Log, Settings, About, and Network Usage layouts.
- Made the main window resizable and tightened responsive behavior for compact and expanded sidebars.
- Updated the desktop runtime to Tauri 2 and Linux builds to WebKitGTK 4.1 on Ubuntu 24.04.
- Reduced the frontend dependency tree by using the web-only React Spring package.
- Added production Content Security Policy restrictions and automated dependency auditing.

### Fixed

- Prevented inactive adapters from reporting misleading alternating zero-rate samples.
- Improved active adapter filtering while retaining connected VPN adapters.
- Fixed custom ping host persistence and the Add action.
- Fixed automatic update checks and the Settings update button layout.
- Added MSI-to-NSIS and NSIS-to-MSI cleanup paths for Windows upgrades.
- Fixed Linux application icons, unprivileged startup, DNS management, and current-distribution package dependencies.

### Verified

- Windows NSIS and MSI bundles build locally for version 2.0.0.
- UI and Rust unit tests pass on the release source.
- npm dependency audit reports zero known vulnerabilities.

## 1.6.2 - 2026-06-10

- Migrated from Tauri 1 to Tauri 2.
- Updated Linux builds for WebKitGTK 4.1 and Ubuntu 24.04.
- Fixed Linux package dependencies, local development, window closing, and update checks.
