# PulseNet Windows bandwidth limiter

This directory contains the privileged Windows data plane for per-application bandwidth rules.
The desktop application remains unprivileged.

## Architecture

1. `PulseNetWfp.sys` registers IPv4 and IPv6 callouts at the ALE connect-redirect layers.
2. The Windows service owns persistent rules, BFE objects, loopback proxy listeners, and named-pipe IPC.
3. BFE filters match the canonical application ID returned by `FwpmGetAppIdFromFileName`.
4. The callout copies the original endpoints into a versioned redirect context and redirects matching TCP flows to the service.
5. The service relays both directions through independent token buckets. A missing service, invalid context, or driver error is fail-open.

## Current milestone

- The Tauri backend persists and validates per-executable rules.
- The UI can create, edit, and remove download/upload limits.
- The Tauri backend performs a versioned named-pipe handshake and atomically replaces the active rule set.
- Service readiness requires the SCM service, callout driver, BFE controller, and proxy listeners to all be active.
- The callout driver ABI, IPv4/IPv6 registration, redirect context, INF, and WDK project build successfully with WDK 26100.6584.
- The LocalSystem service owns dynamic BFE objects, canonical per-app filters, IPv4/IPv6 loopback listeners, and shared per-rule token buckets.
- Named-pipe requests are local-only, size bounded, version checked, and limited to interactive users, administrators, and LocalSystem.

The current enforceable version targets TCP. UDP requires separate bind/flow handling and must not reuse the TCP redirect path. Rules remain saved but inactive when the signed driver and service are not installed.

## Build prerequisites

- Visual Studio 2022 C++ tools
- Windows SDK and WDK 10.0.26100.6584
- MSVC v143 x64/x86 Spectre-mitigated libraries

If a system WDK is unavailable, the build script can restore the pinned WDK and SDK packages with `nuget.exe`.

Build from PowerShell:

```powershell
.\native\windows-limiter\build.ps1 -Configuration Debug
```

The packaged test-signed output is written to:

```text
native\windows-limiter\driver\out\Debug\PulseNetWfp\
native\windows-limiter\driver\out\Release\PulseNetWfp\
native\windows-limiter\out\Debug\PulseNetLimiter.exe
native\windows-limiter\out\Release\PulseNetLimiter.exe
```

Development deployment requires an isolated test machine with test signing enabled. The native service supports `install`, `uninstall`, and `--console`, but installing the service alone does not install or trust the callout driver package.

Public releases require Microsoft attestation or WHQL signing and installer custom actions that install/start the driver and service once with elevation. Never ship the generated test certificate or ask end users to disable driver signature enforcement.

The redirect implementation follows the architecture of Microsoft's WFPSampler and the WFP connect-redirection documentation.
