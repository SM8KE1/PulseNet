# PulseNet

نرم‌افزار مانیتورینگ پینگ به صورت لحظه‌ای

این ابزار به شما اجازه میده پینگ لحظه ای شما به سرورهای بزرگ و اصلی به صورت لحظه ای چک کنید و از اتصال اینترنت خود به شبکه جهانی مطلع بشید.

[![Windows](https://img.shields.io/badge/Windows-Ready-green)](https://github.com/SM8KE1/PulseNet-/releases)
[![macOS](https://img.shields.io/badge/macOS-Coming%20Soon-orange)](https://github.com/SM8KE1/PulseNet-/releases)
[![Linux](https://img.shields.io/badge/Linux-Coming%20Soon-orange)](https://github.com/SM8KE1/PulseNet-/releases)

## ویژگی‌ها

- مانیتورینگ لحظه‌ای پینگ
- نمایش نمودار پینگ
- اعلان‌های هشدار

## دانلود

### ویندوز
- [PulseNet Setup.exe](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.Setup.exe) - نسخه نصب
- [PulseNet Portable.zip](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.Portable.zip) - نسخه قابل حمل

### مک
- [PulseNet.dmg](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.dmg) - نسخه نصب
- [PulseNet.zip](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet-mac.zip) - نسخه فشرده

### لینوکس
- [PulseNet.AppImage](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.AppImage) - نسخه AppImage
- [PulseNet.deb](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.deb) - نسخه Debian/Ubuntu
- [PulseNet.rpm](https://github.com/SM8KE1/PulseNet-/releases/latest/download/PulseNet.rpm) - نسخه Red Hat/Fedora

> **نکته**: نسخه‌های مک و لینوکس به زودی منتشر خواهند شد.

## نصب

### ویندوز
1. فایل `PulseNet Setup.exe` را دانلود کنید
2. فایل را اجرا کنید
3. مراحل نصب را دنبال کنید

### نسخه قابل حمل (Portable)
1. فایل `PulseNet Portable.zip` را دانلود کنید
2. فایل را از حالت فشرده خارج کنید
3. فایل `PulseNet.exe` را اجرا کنید
 
## توسعه

### نصب وابستگی‌ها
```bash
npm install
```

### اجرا در حالت توسعه
```bash
npm start
```

### ساخت نسخه نهایی
```bash
# ساخت برای ویندوز
npm run build:win

# ساخت برای مک
npm run build:mac

# ساخت برای لینوکس
npm run build:linux

# ساخت برای همه پلتفرم‌ها
npm run build:all
```
