# PulseNet

PulseNet is a desktop network utility built with **Tauri + React**.
It provides ping monitoring, DNS testing and management, speed testing, logs, and app settings in one lightweight app.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet/releases)
[![Version](https://img.shields.io/badge/version-1.6.1-blue)](https://github.com/SM8KE1/PulseNet/releases)

<img width="1000" height="600" alt="Screenshot 2026-02-26 141744" src="https://github.com/user-attachments/assets/5de4fe13-b1c5-4029-8207-164e80ecdd3b" />



## Main Features

- Real-time ping monitoring with profiles and public IP visibility controls
- DNS Checker with single-domain tests, benchmark tools, custom DNS entries, and batch checks
- System DNS Manager with current DNS detection, adapter filtering, DHCP reset, recommended DNS apply, and rollback support
- Speed Test with provider switch (Cloudflare / Hetzner), quality summary, latency, jitter, and public IP details
- Log page with filters, search, export, and summary cards
- Settings and About pages with refreshed UI
- Sidebar donation shortcut for `https://daramet.com/SM0KE`

## Version 1.6.1

- Refreshed DNS, Speed Test, Log, Settings, Ping, and About screens
- Improved DNS adapter detection speed and filtering for internet-related physical adapters
- Added a sidebar gift/donation button with a small in-app donation nudge
- Fixed dev server path to use `http://127.0.0.1:5173`
- Windows bundles are available as NSIS setup and MSI installer

## Install (Windows)

1. Download latest installer from:
   - `https://github.com/SM8KE1/PulseNet/releases`
2. Run setup and finish installation.

## Run as Administrator

For reliable ICMP ping behavior on Windows, run PulseNet with administrator privileges.

## Development

### Prerequisites

- Node.js (LTS)
- Rust (rustup)
- Visual Studio Build Tools (C++ workload)
- WebView2 Runtime

### Commands

```bash
npm install
npm run dev
npm run build
```

## Project Paths

- `src/renderer` -> React UI
- `src-tauri/src/main.rs` -> Tauri backend
- `src-tauri/tauri.conf.json` -> app/window/bundle config

## License

ISC
