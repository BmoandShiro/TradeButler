@echo off
REM TradeButler Development Script (Batch version)
REM This script sets up the environment and runs the app in development mode

echo 🚀 Starting TradeButler in development mode...

REM Add Cargo to PATH if not already present
set "CARGO_PATH=%USERPROFILE%\.cargo\bin"
echo %PATH% | findstr /C:"%CARGO_PATH%" >nul
if errorlevel 1 (
    echo 📦 Adding Cargo to PATH...
    set "PATH=%PATH%;%CARGO_PATH%"
) else (
    echo ✅ Cargo already in PATH
)

REM Verify Cargo is accessible
where cargo >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Cargo not found. Please install Rust from https://rustup.rs/
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ❌ Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Run the development server
echo.
echo 🎯 Starting Tauri development server...
echo.
call npm run tauri:dev

