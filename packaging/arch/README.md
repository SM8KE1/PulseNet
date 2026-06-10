# PulseNet Arch Package

This package builds PulseNet as a native Arch package instead of using the AppImage.

PulseNet uses Tauri v2 on Linux, so Arch builds use the WebKitGTK 4.1 stack
available from the official repositories.

```bash
sudo pacman -S --needed base-devel git nodejs npm rust cargo gtk3 libayatana-appindicator librsvg networkmanager openssl polkit webkit2gtk-4.1
cd packaging/arch
makepkg -si
pulsenet
```

The installed launcher sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` by default to avoid
common WebKitGTK EGL/DMABUF startup issues on Arch/Wayland/NVIDIA systems.
