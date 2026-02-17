# PulseNet

PulseNet is a desktop network utility built with **Tauri + React** for Windows.
It provides fast ping monitoring, DNS checking, speed testing, and in-app logs in a modern UI.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet/releases)
[![Version](https://img.shields.io/badge/version-1.4.2-blue)](https://github.com/SM8KE1/PulseNet/releases)

## Features

- Real-time ping monitoring for custom and default hosts
- DNS Checker page to test multiple DNS servers for a target domain
- Speed Test page (Cloudflare-based)
- Log page
- Auto-launch option from app settings

## Important Note

PulseNet uses ICMP for ping responses.
For accurate ping behavior on Windows, run the app with administrator privileges.

## Installation (Windows)

1. Download the latest installer from:
   - `https://github.com/SM8KE1/PulseNet/releases`
2. Run `PulseNet Setup.exe`.
3. Complete installation.
4. (Recommended) Start PulseNet as Administrator.

## Development Setup

### Prerequisites (Windows)

- Node.js (LTS recommended)
- Rust toolchain (`rustup`)
- Microsoft C++ Build Tools (or Visual Studio with C++ workload)
- WebView2 Runtime (usually already installed on modern Windows)

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

### Build production bundles

```bash
npm run build
```

## Project Structure

- `src/renderer` - React UI
- `src-tauri/src/main.rs` - Tauri backend commands and app lifecycle
- `src-tauri/tauri.conf.json` - app/window/bundle configuration
- `assets` - icons and static resources

## Troubleshooting

- If `npm run dev` fails with Cargo errors:
  - Ensure Rust is installed and available in terminal `PATH`.
- If linker error appears (`link.exe not found`):
  - Install Visual Studio Build Tools with C++ tools.
- If app opens without window:
  - Check tray icon and click `Show PulseNet`.
- If ping shows permission issues:
  - Run PulseNet as Administrator.

## Contributing

Issues and pull requests are welcome.
