
# PulseNet

PulseNet is a desktop network utility built with **Tauri + React**.
It provides ping monitoring, DNS testing and management, speed testing, logs, and app settings in one lightweight app.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet/releases)
[![Version](https://img.shields.io/badge/version-1.6.1-blue)](https://github.com/SM8KE1/PulseNet/releases)

<img width="1000" height="600" alt="Screenshot 2026-06-08 164748" src="https://github.com/user-attachments/assets/5c034c43-0ccd-453d-aa42-768ccf621cff" />




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

## Install (Linux)

Use the package format that matches your distribution:

- Ubuntu/Debian: use the `.deb` bundle
- Fedora/openSUSE/RHEL: use the `.rpm` bundle
- Arch/Manjaro/EndeavourOS: prefer the native package in `packaging/arch`
- AppImage: fallback option for distributions without a native package path

For Arch-based systems:

```bash
git clone https://github.com/SM8KE1/PulseNet.git
cd PulseNet
sudo pacman -S --needed base-devel git nodejs npm rust cargo gtk3 libayatana-appindicator librsvg networkmanager openssl polkit webkit2gtk-4.1
cd packaging/arch
makepkg -si
pulsenet
```

## Run as Administrator

For reliable ICMP ping behavior on Windows, run PulseNet with administrator privileges.

## Linux Notes

Linux DNS Manager support uses NetworkManager through `nmcli`.
For applying or resetting DNS, the system must allow NetworkManager changes through the active user session or Polkit/`pkexec`.
Linux builds use Tauri v2 and WebKitGTK 4.1, which is compatible with Ubuntu 24.04 and current Debian-based distributions.
On Arch-based systems, the native package launcher sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` by default to avoid common WebKitGTK EGL/DMABUF startup issues.

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
