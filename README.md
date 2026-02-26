# PulseNet

PulseNet is a desktop network utility built with **Tauri + React**.
It provides ping monitoring, DNS checking, speed testing, and logs in one lightweight app.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet/releases)
[![Version](https://img.shields.io/badge/version-1.5.1-blue)](https://github.com/SM8KE1/PulseNet/releases)

<img width="1000" height="600" alt="Screenshot 2026-02-26 141744" src="https://github.com/user-attachments/assets/5de4fe13-b1c5-4029-8207-164e80ecdd3b" />



## Main Features

- Ping Monitoring (real-time)
- DNS Checker
- Speed Test with provider switch (Cloudflare / Hetzner)
- Log page

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
