# PulseNet Windows network control

This is the public Windows implementation for per-application internet blocking. It uses the supported Windows Firewall COM API and does not install a kernel driver.

- The desktop client stays unprivileged.
- `PulseNetNetworkControl.exe` runs as a LocalSystem Windows service.
- IPC is local-only, versioned, size-bounded, and exposed through a named pipe.
- Only firewall rules in the `PulseNet Network Control` group are reconciled.
- Both inbound and outbound traffic are blocked for selected executable paths.

Build with:

```powershell
.\native\windows-firewall\build.ps1 -Configuration Release
```

The WFP bandwidth limiter remains under `experimental/windows-wfp` and is not part of the public build.
