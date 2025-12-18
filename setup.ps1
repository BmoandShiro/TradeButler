# TradeButler Setup Script
# This script sets up the development environment permanently

Write-Host "🔧 TradeButler Development Environment Setup" -ForegroundColor Cyan
Write-Host "==========================================`n" -ForegroundColor Cyan

# Check if Rust/Cargo is installed
Write-Host "Checking for Rust/Cargo..." -ForegroundColor Yellow
$cargoPath = "$env:USERPROFILE\.cargo\bin"

if (Test-Path "$cargoPath\cargo.exe") {
    Write-Host "✅ Rust/Cargo is installed" -ForegroundColor Green
    $cargoVersion = & "$cargoPath\cargo.exe" --version
    Write-Host "   $cargoVersion" -ForegroundColor Gray
} else {
    Write-Host "❌ Rust/Cargo not found!" -ForegroundColor Red
    Write-Host "   Please install Rust from: https://rustup.rs/" -ForegroundColor Yellow
    Write-Host "   After installation, run this script again." -ForegroundColor Yellow
    exit 1
}

# Check if Cargo is in PATH
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
if ($currentPath -notlike "*$cargoPath*") {
    Write-Host "`n📦 Adding Cargo to PATH permanently..." -ForegroundColor Yellow
    
    # Add to user PATH
    $newPath = $currentPath
    if ($newPath -and -not $newPath.EndsWith(";")) {
        $newPath += ";"
    }
    $newPath += $cargoPath
    
    [System.Environment]::SetEnvironmentVariable(
        "Path",
        $newPath,
        [System.EnvironmentVariableTarget]::User
    )
    
    Write-Host "✅ Cargo added to PATH!" -ForegroundColor Green
    Write-Host "   Note: You may need to restart your terminal/IDE for changes to take effect." -ForegroundColor Yellow
} else {
    Write-Host "`n✅ Cargo is already in PATH" -ForegroundColor Green
}

# Check Node.js
Write-Host "`nChecking for Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found!" -ForegroundColor Red
    Write-Host "   Please install Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Install npm dependencies
Write-Host "`n📦 Installing npm dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✅ Dependencies already installed" -ForegroundColor Green
}

Write-Host "`n🎉 Setup complete!" -ForegroundColor Green
Write-Host "`nYou can now run:" -ForegroundColor Cyan
Write-Host "   npm run tauri:dev    (to start development)" -ForegroundColor White
Write-Host "   npm run tauri:build  (to build for production)" -ForegroundColor White
Write-Host "`nOr use the convenience scripts:" -ForegroundColor Cyan
Write-Host "   .\dev.ps1  or  dev.bat" -ForegroundColor White

