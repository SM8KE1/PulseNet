# PulseNet

PulseNet is a desktop network utility built with **Tauri and React**. Monitor connectivity, inspect network usage, manage DNS settings, and control per-application internet access from one app.

[![Latest release](https://img.shields.io/github/v/release/SM8KE1/PulseNet?label=Download)](https://github.com/SM8KE1/PulseNet/releases/latest)

<p align="center">
  <img width="900" alt="PulseNet dashboard" src="https://github.com/user-attachments/assets/5c034c43-0ccd-453d-aa42-768ccf621cff" />
</p>

## Features

- Ping monitoring and DNS checks
- DNS management and internet speed tests
- Live network and per-application usage monitoring
- Per-application internet blocking and bandwidth limits
- Searchable logs and configurable settings

## 📥 Direct Download

<table>
  <thead>
    <tr><th>OS</th><th>Download</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Windows</td>
      <td>
        <a href="https://github.com/SM8KE1/PulseNet/releases/latest/download/PulseNet_2.0.2_x64-setup.exe"><img src="https://img.shields.io/badge/Setup-x64-0078D7.svg?logo=windows" alt="Windows x64 Setup"></a>
        <a href="https://github.com/SM8KE1/PulseNet/releases/latest/download/PulseNet_2.0.2_x64_en-US.msi"><img src="https://img.shields.io/badge/MSI-x64-2D7D9A.svg?logo=windows" alt="Windows x64 MSI"></a>
      </td>
    </tr>
    <tr>
      <td>Ubuntu / Debian</td>
      <td>
        <a href="https://github.com/SM8KE1/PulseNet/releases/latest/download/PulseNet_2.0.2_amd64.deb"><img src="https://img.shields.io/badge/DEB-amd64-A81D33.svg?logo=debian" alt="Linux amd64 DEB"></a>
        <a href="https://sm8ke1.github.io/PulseNet/apt/"><img src="https://img.shields.io/badge/APT-Repository-E95420.svg?logo=ubuntu" alt="PulseNet APT repository"></a>
      </td>
    </tr>
    <tr>
      <td>Fedora / openSUSE</td>
      <td>
        <a href="https://github.com/SM8KE1/PulseNet/releases/latest/download/PulseNet-2.0.2-1.x86_64.rpm"><img src="https://img.shields.io/badge/RPM-x86__64-EE0000.svg?logo=linux" alt="Linux x86_64 RPM"></a>
      </td>
    </tr>
  </tbody>
</table>

## Installation

### Windows

Download and run the Setup installer. Run PulseNet as administrator for reliable ICMP ping monitoring.

### Ubuntu / Debian

Supported on 64-bit Ubuntu 24.04+ and Debian 13+. To install from the PulseNet APT repository:

```bash
curl -fsSLO https://sm8ke1.github.io/PulseNet/apt/pulsenet-archive-keyring.gpg
sudo install -D -m 0644 pulsenet-archive-keyring.gpg /usr/share/keyrings/pulsenet-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/pulsenet-archive-keyring.gpg] https://sm8ke1.github.io/PulseNet/apt stable main" | sudo tee /etc/apt/sources.list.d/pulsenet.list
sudo apt update
sudo apt install pulse-net
rm pulsenet-archive-keyring.gpg
```

To update an existing APT installation, run `sudo apt update && sudo apt install --only-upgrade pulse-net`. If you installed from a downloaded `.deb`, install the newer file with `sudo apt install ./PulseNet_2.0.2_amd64.deb`; this upgrades the existing package without uninstalling it first.

### Fedora / openSUSE

Download the `.rpm` package above and install it with your distribution's package manager.

### Linux requirements

Per-application network controls require systemd, cgroup v2, and nftables. Launch the app as a normal user; do not run the GUI with `sudo`.

## Development

Requires Node.js (LTS), Rust, and the platform's Tauri dependencies.

```bash
npm install
npm run dev
npm run build
```

## License

ISC
