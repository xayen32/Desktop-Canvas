# scripts/bootstrap.ps1
# Desktop Canvas - Developer Environment Bootstrap

$ErrorActionPreference = "Stop"

Write-Host "=== Desktop Canvas Bootstrap ===" -ForegroundColor Cyan

Write-Host "`n[1/4] Installing frontend dependencies in ./ui..." -ForegroundColor Yellow
npm install --prefix ./ui

Write-Host "`n[2/4] Verifying Rust toolchain..." -ForegroundColor Yellow
rustc --version
cargo --version

Write-Host "`n[3/4] Fetching Rust crate dependencies in ./src-tauri..." -ForegroundColor Yellow
cargo fetch --manifest-path ./src-tauri/Cargo.toml

Write-Host "`n[4/4] Verifying WebView2 Runtime..." -ForegroundColor Yellow
$webview2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $webview2) {
    Write-Warning "WebView2 Runtime not detected in standard 32-bit registry key. Checking Edge installation..."
} else {
    Write-Host "WebView2 Runtime detected." -ForegroundColor Green
}

Write-Host "`n=== Bootstrap Complete! ===" -ForegroundColor Green
