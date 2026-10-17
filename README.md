
# PulseNet

PulseNet is a desktop network utility built with **Tauri + React**.
It provides ping monitoring, DNS testing and management, speed testing, logs, and app settings in one lightweight app.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet/releases)
[![Version](https://img.shields.io/badge/version-2.0.2-blue)](https://github.com/SM8KE1/PulseNet/releases)
[![CI](https://github.com/SM8KE1/PulseNet/actions/workflows/ci.yml/badge.svg)](https://github.com/SM8KE1/PulseNet/actions/workflows/ci.yml)
[![Build](https://github.com/SM8KE1/PulseNet/actions/workflows/linux-build.yml/badge.svg)](https://github.com/SM8KE1/PulseNet/actions/workflows/linux-build.yml)

<img width="1000" height="600" alt="Screenshot 2026-06-08 164748" src="https://github.com/user-attachments/assets/5c034c43-0ccd-453d-aa42-768ccf621cff" />




## Main Features

- Real-time ping monitoring with profiles and public IP visibility controls
- DNS Checker with single-domain tests, benchmark tools, custom DNS entries, and batch checks
- System DNS Manager with current DNS detection, adapter filtering, DHCP reset, recommended DNS apply, and rollback support
- Speed Test with provider switch (Cloudflare / Hetzner), quality summary, latency, jitter, and public IP details
- Log page with filters, search, export, and summary cards
- Settings and About pages with refreshed UI
- Sidebar donation shortcut for `https://daramet.com/SM0KE`
- Per-application network control: Windows Firewall block/unblock and Linux cgroup/nftables block/rate rules

## Version 2.0.2

- Added full support for Ubuntu 24.04 and newer.
- Fixed bugs and improved overall application performance.
- Added per-application internet access restrictions.
- Added real-time download and upload rate monitoring for total network traffic.
- Added per-application download usage tracking.

## Version 2.0.0

- Refreshed DNS, Speed Test, Log, Settings, Ping, and About screens
- Improved DNS adapter detection speed and filtering for internet-related physical adapters
- Added a sidebar gift/donation button with a small in-app donation nudge
- Added Network Usage monitoring with active adapters, process details, persistent download-share statistics, sorting, and application icons
- Added per-application block and bandwidth rules through native Windows and Linux helpers
- Added automatic Windows and Linux release packaging when a version tag is pushed
- Added a restrictive production CSP and removed vulnerable unused dependency trees
- Fixed dev server path to use `http://127.0.0.1:5173`
- Windows bundles are available as NSIS setup and MSI installer

## Install (Windows)

1. Download latest installer from:
   - `https://github.com/SM8KE1/PulseNet/releases`
2. Run setup and finish installation.

## Install (Linux)

Use the package format that matches your distribution:

- Ubuntu 24.04+ / Debian 13+: install from the APT repository (recommended), or download the `.deb` bundle
- Fedora and openSUSE: use the `.rpm` bundle
- Arch-based distributions and AppImage are not supported.

### Install from the APT repository

```bash
curl -fsSLO https://sm8ke1.github.io/PulseNet/apt/pulsenet-archive-keyring.gpg
sudo install -D -m 0644 pulsenet-archive-keyring.gpg /usr/share/keyrings/pulsenet-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/pulsenet-archive-keyring.gpg] https://sm8ke1.github.io/PulseNet/apt stable main" | sudo tee /etc/apt/sources.list.d/pulsenet.list
sudo apt update
sudo apt install pulsenet
rm pulsenet-archive-keyring.gpg
```

This repository currently targets 64-bit Ubuntu 24.04+ and Debian 13+ systems. Its APT metadata is signed; package updates arrive through `sudo apt update && sudo apt upgrade`.

## Run as Administrator

For reliable ICMP ping behavior on Windows, run PulseNet with administrator privileges.

## Linux Notes

Linux DNS Manager support uses the NetworkManager D-Bus API directly. The app should be launched as a normal user; NetworkManager/Polkit handles authorization only when DNS settings are changed.
Linux Network Usage reads active adapter state through NetworkManager D-Bus and traffic/process data from `/sys` and `/proc`, without shelling out to `nmcli`.
On Linux, Network Usage shows adapter totals, active process connections, and persistent per-application TCP download history. TCP bytes are sampled from active sockets through `ss`; very short connections that close between samples and UDP traffic are not counted. The `ss` utility comes from `iproute2` on Debian/openSUSE and `iproute` on Fedora. Application icons are not available on Linux yet.
Linux installer packages set `cap_net_raw` on the installed PulseNet binary so ICMP ping can work without launching the whole GUI with `sudo`.
DEB and RPM packages install a root systemd helper. The GUI stays unprivileged while the helper validates per-user executable paths, assigns matching processes to cgroup v2, and applies isolated nftables block/rate rules. The helper is limited to `CAP_NET_ADMIN` and `CAP_DAC_OVERRIDE`; this requires cgroup v2, systemd, and nftables. If setup cannot start the helper, the package installer prints a warning; check `systemctl status pulsenet-network-control.service` and `journalctl -u pulsenet-network-control.service`.
Linux builds use Tauri v2 and WebKitGTK 4.1. Arch-based distributions and AppImage are outside the supported platform set.

## Development

### Prerequisites

- Node.js (LTS)
- Rust (rustup)
- Linux: GTK 3, WebKitGTK 4.1, Ayatana AppIndicator, librsvg, OpenSSL, NetworkManager, nftables, and the standard Rust/Node build toolchains
- Windows: Visual Studio Build Tools (C++ workload) and WebView2 Runtime

### Commands

```bash
npm install
npm test
npm audit
npm run dev
npm run build
```

Pushing a `v*` tag builds DEB and RPM packages, checks DEB installation on Ubuntu and Debian and RPM installation on Fedora and openSUSE, publishes the signed APT repository, creates the GitHub release, then builds and attaches the Windows NSIS and MSI packages. Normal pushes to `main` run CI and retain Linux build artifacts in GitHub Actions.

### APT repository maintenance

The release workflow publishes the latest AMD64 DEB and signed APT metadata to GitHub Pages at `https://sm8ke1.github.io/PulseNet/apt/`. GitHub Pages must use **Settings → Pages → Build and deployment → Source: GitHub Actions**. Add a dedicated GPG private key, base64-encoded, as the repository Actions secret `APT_REPO_SIGNING_KEY`; add its base64-encoded public key as `APT_REPO_PUBLIC_KEY`. Both keys must match. Optionally set `APT_REPO_SIGNING_KEY_PASSPHRASE` if the private key is encrypted. Keep the private key dedicated to package signing and back it up securely. The publisher checks that the public and private keys match. The public key downloaded by users is committed into every published repository snapshot.

To create the key pair locally, use `gpg --full-generate-key` and choose a signing key with no expiration. Export the private and public keys as base64 with `gpg --armor --export-secret-keys KEY_ID | base64 -w0` and `gpg --armor --export KEY_ID | base64 -w0`. Store the private export only in `APT_REPO_SIGNING_KEY`; the public export goes in `APT_REPO_PUBLIC_KEY`. Set `APT_REPO_SIGNING_KEY_PASSPHRASE` if the key is encrypted. Do not commit the private key or passphrase.

## Project Paths

- `src/renderer` -> React UI
- `src-tauri/src/main.rs` -> Tauri backend
- `src-tauri/src/updates.rs` -> GitHub update checks and version comparison
- `src-tauri/tauri.conf.json` -> app/window/bundle config
- `native/windows-firewall` -> public user-mode Windows Filtering Platform service
- `experimental/windows-wfp` -> excluded WFP driver prototype

## License

ISC
