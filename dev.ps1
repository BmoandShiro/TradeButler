# TradeButler Development Script
# This script sets up the environment and runs the app in development mode

Write-Host "🚀 Starting TradeButler in development mode..." -ForegroundColor Cyan

# Add Cargo to PATH if not already present
$cargoPath = "$env:USERPROFILE\.cargo\bin"
if ($env:PATH -notlike "*$cargoPath*") {
    Write-Host "📦 Adding Cargo to PATH..." -ForegroundColor Yellow
    $env:PATH += ";$cargoPath"
} else {
    Write-Host "✅ Cargo already in PATH" -ForegroundColor Green
}

# Verify Cargo is accessible
try {
    $cargoVersion = cargo --version 2>&1
    Write-Host "✅ Cargo found: $cargoVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Cargo not found. Please install Rust from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
}

# Run the development server
Write-Host "`n🎯 Starting Tauri development server...`n" -ForegroundColor Cyan
npm run tauri:dev

