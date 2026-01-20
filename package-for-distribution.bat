@echo off
echo ========================================
echo Packaging TradeButler for Distribution
echo ========================================
echo.
echo This will create a clean distribution package
echo with only the files users need.
echo.

set "RELEASE_DIR=src-tauri\target\release"
set "BUNDLE_DIR=%RELEASE_DIR%\bundle"
set "DIST_DIR=TradeButler-Distribution"

if not exist "%RELEASE_DIR%" (
    echo ERROR: Release build not found!
    echo Please run build.bat first.
    pause
    exit /b 1
)

echo Creating distribution package...
if exist "%DIST_DIR%" (
    echo Deleting old distribution folder...
    rmdir /s /q "%DIST_DIR%"
)

mkdir "%DIST_DIR%"
mkdir "%DIST_DIR%\Installers"
mkdir "%DIST_DIR%\Portable"

echo.
echo Copying installers...

if exist "%BUNDLE_DIR%\msi\TradeButler_1.0.0_x64_en-US.msi" (
    copy "%BUNDLE_DIR%\msi\TradeButler_1.0.0_x64_en-US.msi" "%DIST_DIR%\Installers\" >nul
    echo   [OK] MSI Installer copied
) else (
    echo   [WARNING] MSI installer not found
)

if exist "%BUNDLE_DIR%\nsis\TradeButler_1.0.0_x64-setup.exe" (
    copy "%BUNDLE_DIR%\nsis\TradeButler_1.0.0_x64-setup.exe" "%DIST_DIR%\Installers\" >nul
    echo   [OK] NSIS Installer copied
) else (
    echo   [WARNING] NSIS installer not found
)

echo.
echo Copying portable executable...

if exist "%RELEASE_DIR%\TradeButler.exe" (
    copy "%RELEASE_DIR%\TradeButler.exe" "%DIST_DIR%\Portable\" >nul
    echo   [OK] Portable executable copied
) else (
    echo   [ERROR] Portable executable not found!
)

echo.
echo Creating README...
(
    echo TradeButler Distribution Package
    echo =================================
    echo.
    echo INSTALLERS (Installers folder^):
    echo   - TradeButler_1.0.0_x64_en-US.msi
    echo     * Double-click to install
    echo     * Creates Start Menu shortcuts
    echo     * Can be uninstalled via Windows Settings
    echo.
    echo   - TradeButler_1.0.0_x64-setup.exe
    echo     * Double-click to run installer wizard
    echo     * More installation options
    echo     * Creates Start Menu shortcuts
    echo     * Can be uninstalled via Windows Settings
    echo.
    echo PORTABLE (Portable folder^):
    echo   - TradeButler.exe
    echo     * Just double-click to run
    echo     * No installation required
    echo     * Perfect for USB drives or testing
    echo     * Data stored in: %%APPDATA%%\TradeButler\
    echo.
    echo RECOMMENDATION:
    echo   For most users: Use one of the installers
    echo   For portable use: Use TradeButler.exe
) > "%DIST_DIR%\README.txt"

echo   [OK] README created

echo.
echo ========================================
echo Package Complete!
echo ========================================
echo.
echo Distribution package created in:
echo   %DIST_DIR%\
echo.
echo This folder contains ONLY what users need:
echo   - Installers\ (MSI and NSIS installers)
echo   - Portable\ (Standalone executable)
echo   - README.txt (Instructions)
echo.
echo You can now zip this folder and distribute it!
echo.
echo Opening distribution folder...
start "" "%DIST_DIR%"
echo.
pause
