param(
    [switch]$Elevated
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
    throw 'The PulseNet Windows network helper can only be installed on Windows.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
    if ($Elevated) {
        throw 'Administrator access is required to install the PulseNet network helper.'
    }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "PulseNet network helper setup failed with exit code $($process.ExitCode)."
    }
    exit 0
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$buildScript = Join-Path $repositoryRoot 'native\windows-firewall\build.ps1'
$helper = Join-Path $repositoryRoot 'native\windows-firewall\out\Build\Release\PulseNetNetworkControl.exe'

& $buildScript -Configuration Release
if ($LASTEXITCODE -ne 0) {
    throw "PulseNet network helper build failed with exit code $LASTEXITCODE."
}

& $helper install
if ($LASTEXITCODE -ne 0) {
    throw "PulseNet network helper installation failed with exit code $LASTEXITCODE."
}

Write-Host 'PulseNet network helper is installed, updated, and running.'
