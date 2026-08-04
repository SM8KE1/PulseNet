# PulseNet Windows network control

This is the public Windows implementation for per-application internet blocking. It uses user-mode Windows Filtering Platform management APIs and does not install a kernel driver.

- The desktop client stays unprivileged.
- `PulseNetNetworkControl.exe` runs as a LocalSystem Windows service.
- IPC is local-only, versioned, size-bounded, and exposed through a named pipe.
- Dynamic WFP filters are scoped to the selected executable paths and removed when the service stops.
- Matching rules in the `PulseNet Network Control` firewall group are retained for compatibility.
- Both inbound and outbound traffic are blocked for selected executable paths.

Build with:

```powershell
.\native\windows-firewall\build.ps1 -Configuration Release
```

For local `npm run dev` sessions, install or refresh the current helper once from the repository root:

```powershell
npm run setup:network-helper
```

The command requests administrator access, updates the service binary, and restarts the service.

The WFP bandwidth limiter remains under `experimental/windows-wfp` and is not part of the public build.
