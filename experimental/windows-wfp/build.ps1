param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Installer was not found.'
}

$visualStudio = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudio) {
    throw 'Visual Studio C++ tools are required.'
}

$systemWdkToolset = Join-Path $visualStudio 'MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\WindowsKernelModeDriver10.0'
$systemWdkHeader = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Include\10.0.26100.0\km\fwpsk.h'
$hasSystemWdk = (Test-Path -LiteralPath $systemWdkToolset) -and (Test-Path -LiteralPath $systemWdkHeader)

$packages = Join-Path $PSScriptRoot 'packages'
$wdkProps = Join-Path $packages 'Microsoft.Windows.WDK.x64.10.0.26100.6584\build\native\Microsoft.Windows.WDK.x64.props'
if (-not $hasSystemWdk -and -not (Test-Path -LiteralPath $wdkProps)) {
    $nuget = Get-Command nuget.exe -ErrorAction SilentlyContinue
    if (-not $nuget) {
        throw 'Windows Driver Kit was not found. Install the Visual Studio DriverKit components or install nuget.exe so the pinned WDK packages can be restored.'
    }
    & $nuget.Source restore (Join-Path $PSScriptRoot 'packages.config') -PackagesDirectory $packages -NonInteractive
    if ($LASTEXITCODE -ne 0) {
        throw "WDK package restore failed with exit code $LASTEXITCODE."
    }
}

if ($hasSystemWdk) {
    Write-Host 'Using the system Windows Driver Kit.'
} else {
    Write-Host 'Using the pinned Windows Driver Kit NuGet packages.'
}

$msbuild = Join-Path $visualStudio 'MSBuild\Current\Bin\MSBuild.exe'
$project = Join-Path $PSScriptRoot 'driver\PulseNetWfp.vcxproj'
& $msbuild $project /m /p:Configuration=$Configuration /p:Platform=x64 /p:SkipPackageVerification=true
if ($LASTEXITCODE -ne 0) {
    throw "WFP driver build failed with exit code $LASTEXITCODE."
}

$serviceProject = Join-Path $PSScriptRoot 'service\PulseNetLimiter.vcxproj'
& $msbuild $serviceProject /m /p:Configuration=$Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) {
    throw "Limiter service build failed with exit code $LASTEXITCODE."
}

$infVerifier = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Tools\10.0.26100.0\x64\InfVerif.exe'
$generatedInf = Join-Path $PSScriptRoot "driver\out\$Configuration\PulseNetWfp.inf"
if (-not (Test-Path -LiteralPath $infVerifier)) {
    throw 'The x64 INF verifier was not found in the system WDK.'
}
& $infVerifier /u $generatedInf
if ($LASTEXITCODE -ne 0) {
    throw "WFP driver INF verification failed with exit code $LASTEXITCODE."
}
