# PulseNet Arch Package

This package builds PulseNet as a native Arch package instead of using the AppImage.

Tauri v1 requires the WebKitGTK 4.0/libsoup2 stack. On Arch, install `webkit2gtk`
from AUR before running `makepkg`, or use an AUR helper that can resolve AUR
dependencies.

```bash
sudo pacman -S --needed base-devel git nodejs npm rust cargo gtk3 libayatana-appindicator librsvg networkmanager openssl polkit
yay -S webkit2gtk
cd packaging/arch
makepkg -si
pulsenet
```

The installed launcher sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` by default to avoid
common WebKitGTK EGL/DMABUF startup issues on Arch/Wayland/NVIDIA systems.
