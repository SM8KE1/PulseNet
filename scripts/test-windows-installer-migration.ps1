param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentMsi,

    [Parameter(Mandatory = $true)]
    [string]$CurrentNsis
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$oldVersion = '1.6.2'
$oldNsisUrl = "https://github.com/SM8KE1/PulseNet/releases/download/v$oldVersion/PulseNet_${oldVersion}_x64-setup.exe"
$oldMsiUrl = "https://github.com/SM8KE1/PulseNet/releases/download/v$oldVersion/PulseNet_${oldVersion}_x64_en-US.msi"
$tempRoot = Join-Path $env:RUNNER_TEMP 'pulsenet-installer-migration'
$oldNsis = Join-Path $tempRoot 'old-nsis.exe'
$oldMsi = Join-Path $tempRoot 'old-msi.msi'

function Get-PulseNetUninstallEntries {
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        foreach ($key in Get-ChildItem -LiteralPath $root) {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath
            if ($entry.DisplayName -eq 'PulseNet') {
                [pscustomobject]@{
                    ProductCode = $key.PSChildName
                    DisplayVersion = [string]$entry.DisplayVersion
                    WindowsInstaller = [int]$entry.WindowsInstaller
                    UninstallString = [string]$entry.UninstallString
                }
            }
        }
    }
}

function Invoke-Installer {
    param([string]$FilePath, [string[]]$Arguments)

    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "Installer failed with exit code $($process.ExitCode): $FilePath"
    }
}

function Remove-PulseNetInstallations {
    Get-Process -Name 'pulsenet' -ErrorAction SilentlyContinue | Stop-Process -Force
    foreach ($entry in @(Get-PulseNetUninstallEntries)) {
        if ($entry.WindowsInstaller -eq 1) {
            Invoke-Installer -FilePath 'msiexec.exe' -Arguments @('/x', $entry.ProductCode, '/qn', '/norestart')
            continue
        }
        if ($entry.UninstallString -match '^"([^"]+)"') {
            Invoke-Installer -FilePath $Matches[1] -Arguments @('/S')
        } elseif ($entry.UninstallString) {
            $uninstaller = $entry.UninstallString.Split(' ')[0]
            Invoke-Installer -FilePath $uninstaller -Arguments @('/S')
        }
    }
}

function Assert-SingleCurrentInstall {
    $entries = @(Get-PulseNetUninstallEntries)
    if ($entries.Count -ne 1) {
        throw "Expected one PulseNet uninstall entry, found $($entries.Count)."
    }
    if ($entries[0].DisplayVersion -ne '2.0.2') {
        throw "Expected PulseNet 2.0.2, found $($entries[0].DisplayVersion)."
    }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
Invoke-WebRequest -Uri $oldNsisUrl -OutFile $oldNsis
Invoke-WebRequest -Uri $oldMsiUrl -OutFile $oldMsi

try {
    Remove-PulseNetInstallations

    Invoke-Installer -FilePath $oldNsis -Arguments @('/S')
    Invoke-Installer -FilePath 'msiexec.exe' -Arguments @('/i', $CurrentMsi, '/qn', '/norestart')
    Assert-SingleCurrentInstall

    Remove-PulseNetInstallations

    Invoke-Installer -FilePath 'msiexec.exe' -Arguments @('/i', $oldMsi, '/qn', '/norestart')
    Invoke-Installer -FilePath $CurrentNsis -Arguments @('/S')
    Assert-SingleCurrentInstall
} finally {
    Remove-PulseNetInstallations
}
