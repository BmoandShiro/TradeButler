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

REM Kill any existing Tauri processes
echo.
echo 🔍 Checking for existing TradeButler instances...
tasklist /FI "IMAGENAME eq TradeButler.exe" 2>NUL | find /I /N "TradeButler.exe">NUL
if not errorlevel 1 (
    echo 🛑 Closing existing TradeButler instances...
    taskkill /F /IM TradeButler.exe >NUL 2>&1
    timeout /t 1 /nobreak >NUL
)

REM Kill any Node processes that might be running Tauri dev server (simplified)
echo 🔍 Checking for Node processes...
taskkill /F /IM node.exe >NUL 2>&1
if not errorlevel 1 (
    echo 🛑 Closed Node processes
    timeout /t 1 /nobreak >NUL
)

REM Run the development server
echo.
echo 🎯 Starting Tauri development server...
echo.
call npm run tauri:dev

