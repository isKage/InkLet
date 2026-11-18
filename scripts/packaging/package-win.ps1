# Builds the Windows installer (NSIS .exe) and drops it in .\dist\.
#
# Nothing is installed: the script only compiles and copies the installer out.
# Old files in dist\ are removed first, so what is there is always from the
# current build.
#
# Run from the repository root on a Windows machine:
#   powershell -ExecutionPolicy Bypass -File scripts\packaging\package-win.ps1
#
# Prerequisites (one-time):
#   1. Rust (MSVC toolchain):      https://rustup.rs
#      winget install Rustlang.Rustup
#   2. MSVC build tools:           winget install Microsoft.VisualStudio.2022.BuildTools
#      (select "Desktop development with C++")
#   3. WebView2 runtime:           preinstalled on Windows 11; on Windows 10 install
#      the Evergreen Runtime from Microsoft.
#   4. pnpm:                       corepack enable
#
# Tauri cannot cross-compile Windows bundles from macOS/Linux, so this must run
# on Windows itself (or in a Windows VM).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Rust toolchain not found. Install from https://rustup.rs and reopen the terminal."
}

$version = (Get-Content (Join-Path $root 'apps/desktop/package.json') -Raw | ConvertFrom-Json).version
$bundle = Join-Path $root 'apps/desktop/src-tauri/target/release/bundle'
$dist = Join-Path $root 'dist'

Write-Host "Installing workspace dependencies..."
pnpm install

# Start from nothing: no stale installer from an earlier build.
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null
foreach ($dir in @('nsis', 'msi')) {
    $stale = Join-Path $bundle $dir
    if (Test-Path $stale) { Remove-Item $stale -Recurse -Force }
}

Write-Host "Building Windows bundles (NSIS + MSI)..."
pnpm --filter @inklet/desktop exec tauri build --bundles nsis,msi

# Only the installers leave the build tree.
Get-ChildItem -Path $bundle -Recurse -Include *.exe,*.msi -ErrorAction SilentlyContinue |
    Copy-Item -Destination $dist

Write-Host ""
Write-Host "Installers in dist\:"
Get-ChildItem -Path $dist | ForEach-Object { "{0,10:N1} MB  {1}" -f ($_.Length / 1MB), $_.Name }
