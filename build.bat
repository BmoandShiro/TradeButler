@echo off
echo ========================================
echo Building TradeButler for Distribution
echo ========================================
echo.

echo Step 1: Building frontend...
call npm run build
if errorlevel 1 (
    echo Frontend build failed!
    pause
    exit /b 1
)

echo.
echo Step 2: Building Tauri application...
call npm run tauri:build
if errorlevel 1 (
    echo Tauri build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build Complete!
echo ========================================
echo.
echo Distribution files are located in:
echo   src-tauri\target\release\bundle\
echo.
echo Available formats:
echo.
echo   PORTABLE (Run directly):
echo     src-tauri\target\release\bundle\app\TradeButler.exe
echo     - Just double-click to run, no installation needed
echo.
echo   MSI INSTALLER:
echo     src-tauri\target\release\bundle\msi\TradeButler_1.0.0_x64_en-US.msi
echo     - Double-click to install TradeButler on your system
echo     - Creates Start Menu shortcuts
echo     - Can be uninstalled via Windows Settings
echo.
echo   NSIS INSTALLER (More customizable):
echo     src-tauri\target\release\bundle\nsis\TradeButler_1.0.0_x64-setup.exe
echo     - Double-click to run installer wizard
echo     - More installation options
echo     - Creates Start Menu shortcuts
echo     - Can be uninstalled via Windows Settings
echo.
echo Note: You can distribute any or all of these formats to users.
echo       The portable version is great for USB drives or testing.
echo       The installers are better for permanent installation.
echo.
echo Opening bundle folder...
start "" "src-tauri\target\release\bundle"
echo.
pause
