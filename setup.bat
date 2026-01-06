@echo off
REM TradeButler Setup Script (Batch)
REM This script checks prerequisites and installs all dependencies
REM Compatible with Windows 10 and Windows 11

REM Prevent window from closing
setlocal enabledelayedexpansion

REM Check Windows version
for /f "tokens=4-5 delims=. " %%i in ('ver') do set VERSION=%%i.%%j
echo ========================================
echo   TradeButler Setup Script
echo   Windows Version: %VERSION%
echo ========================================
echo.

set ALL_GOOD=1
set INSTALLED_NODE=0
set INSTALLED_RUST=0

REM Check Node.js
echo Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
    echo   [OK] Node.js found: !NODE_VERSION!
) else (
    echo   [ERROR] Node.js not found!
    echo     Attempting to install Node.js...
    echo.
    
    REM Try winget first (available on Windows 10 1809+ with App Installer update)
    where winget >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo     Using winget to install Node.js...
        echo     This may take a few minutes, please wait...
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1
        if %ERRORLEVEL% EQU 0 (
            echo     [OK] Node.js installation started!
            echo     Please restart your terminal and run this script again.
            echo     (The PATH needs to be refreshed for Node.js to be available)
            set INSTALLED_NODE=1
            set ALL_GOOD=0
        ) else (
            echo     [WARNING] winget installation returned an error.
            echo     Trying direct download method...
            echo     Downloading Node.js installer...
            powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $url = 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi'; $out = '%TEMP%\nodejs-installer.msi'; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -ErrorAction Stop; Write-Host 'Download complete'; exit 0 } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
            if exist "%TEMP%\nodejs-installer.msi" (
                echo     Running Node.js installer...
                echo     Please follow the installation wizard that appears...
                msiexec /i "%TEMP%\nodejs-installer.msi" /quiet /norestart
                set NODE_INSTALL_EXIT=%ERRORLEVEL%
                del "%TEMP%\nodejs-installer.msi" >nul 2>&1
                if !NODE_INSTALL_EXIT! EQU 0 (
                    echo     [OK] Node.js installed!
                    echo     Please restart your terminal and run this script again.
                    set INSTALLED_NODE=1
                    set ALL_GOOD=0
                ) else (
                    echo     [ERROR] Node.js installer failed.
                    echo     Please install Node.js manually from: https://nodejs.org/
                    set ALL_GOOD=0
                )
            ) else (
                echo     [ERROR] Failed to download Node.js installer.
                echo     Please install Node.js manually from: https://nodejs.org/
                set ALL_GOOD=0
            )
        )
    ) else (
        echo     [INFO] winget not available (Windows 10 may need App Installer update).
        echo     Trying direct download method...
        echo     Downloading Node.js installer...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $url = 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi'; $out = '%TEMP%\nodejs-installer.msi'; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -ErrorAction Stop; Write-Host 'Download complete'; exit 0 } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
        if exist "%TEMP%\nodejs-installer.msi" (
            echo     Running Node.js installer...
            echo     Please follow the installation wizard that appears...
            msiexec /i "%TEMP%\nodejs-installer.msi" /quiet /norestart
            set NODE_INSTALL_EXIT=%ERRORLEVEL%
            del "%TEMP%\nodejs-installer.msi" >nul 2>&1
            if !NODE_INSTALL_EXIT! EQU 0 (
                echo     [OK] Node.js installed!
                echo     Please restart your terminal and run this script again.
                set INSTALLED_NODE=1
                set ALL_GOOD=0
            ) else (
                echo     [ERROR] Node.js installer failed.
                echo     Please install Node.js manually from: https://nodejs.org/
                echo     Or install winget from Microsoft Store, then run this script again.
                set ALL_GOOD=0
            )
        ) else (
            echo     [ERROR] Failed to download Node.js installer.
            echo     Please install Node.js manually from: https://nodejs.org/
            echo     Or install winget from Microsoft Store, then run this script again.
            set ALL_GOOD=0
        )
    )
)

echo.

REM Check npm (only if Node.js is found)
if %INSTALLED_NODE% EQU 0 (
    echo Checking npm...
    where npm >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        for /f "tokens=*" %%i in ('npm --version 2^>nul') do set NPM_VERSION=%%i
        echo   [OK] npm found: !NPM_VERSION!
    ) else (
        echo   [ERROR] npm not found!
        echo     npm should come with Node.js. Please reinstall Node.js.
        set ALL_GOOD=0
    )
    echo.
)

REM Check Rust
echo Checking Rust...
where rustc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('rustc --version 2^>nul') do set RUST_VERSION=%%i
    echo   [OK] Rust found: !RUST_VERSION!
) else (
    echo   [ERROR] Rust not found!
    echo     Attempting to install Rust...
    echo.
    
    REM Try winget first
    where winget >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo     Using winget to install Rust...
        echo     This may take several minutes, please wait...
        winget install Rustlang.Rustup --silent --accept-package-agreements --accept-source-agreements
        if %ERRORLEVEL% EQU 0 (
            echo     [OK] Rust installation started!
            echo     Please restart your terminal and run this script again.
            echo     (The PATH needs to be refreshed for Rust to be available)
            set INSTALLED_RUST=1
            set ALL_GOOD=0
        ) else (
            echo     [WARNING] winget installation returned an error.
            echo     Trying direct download method...
            echo     Downloading Rust installer...
            powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%TEMP%\rustup-init.exe' -UseBasicParsing -ErrorAction Stop; Write-Host 'Download complete' } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
            if exist "%TEMP%\rustup-init.exe" (
                echo     Running Rust installer (this may take several minutes)...
                echo     Please follow any prompts that appear...
                "%TEMP%\rustup-init.exe" -y
                set RUSTUP_EXIT=%ERRORLEVEL%
                del "%TEMP%\rustup-init.exe" >nul 2>&1
                if !RUSTUP_EXIT! EQU 0 (
                    echo     [OK] Rust installed!
                    echo     Please restart your terminal and run this script again.
                    echo     (The PATH needs to be refreshed for Rust to be available)
                    set INSTALLED_RUST=1
                    set ALL_GOOD=0
                ) else (
                    echo     [ERROR] Rust installer failed.
                    echo     Please install Rust manually from: https://rustup.rs/
                    set ALL_GOOD=0
                )
            ) else (
                echo     [ERROR] Failed to download Rust installer.
                echo     Please install Rust manually from: https://rustup.rs/
                set ALL_GOOD=0
            )
        )
    ) else (
        REM No winget, try direct download
        echo     [INFO] winget not available. Trying direct download...
        echo     Downloading Rust installer...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%TEMP%\rustup-init.exe' -UseBasicParsing -ErrorAction Stop; Write-Host 'Download complete' } catch { Write-Host 'Download failed:' $_.Exception.Message; exit 1 }"
        if exist "%TEMP%\rustup-init.exe" (
            echo     Running Rust installer (this may take several minutes)...
            echo     Please follow any prompts that appear...
            "%TEMP%\rustup-init.exe" -y
            set RUSTUP_EXIT=%ERRORLEVEL%
            del "%TEMP%\rustup-init.exe" >nul 2>&1
            if !RUSTUP_EXIT! EQU 0 (
                echo     [OK] Rust installed!
                echo     Please restart your terminal and run this script again.
                echo     (The PATH needs to be refreshed for Rust to be available)
                set INSTALLED_RUST=1
                set ALL_GOOD=0
            ) else (
                echo     [ERROR] Rust installer failed.
                echo     Please install Rust manually from: https://rustup.rs/
                set ALL_GOOD=0
            )
        ) else (
            echo     [ERROR] Failed to download Rust installer.
            echo     Please install Rust manually from: https://rustup.rs/
            set ALL_GOOD=0
        )
    )
)

echo.

REM Check Cargo (only if Rust is found)
if %INSTALLED_RUST% EQU 0 (
    echo Checking Cargo...
    where cargo >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        for /f "tokens=*" %%i in ('cargo --version 2^>nul') do set CARGO_VERSION=%%i
        echo   [OK] Cargo found: !CARGO_VERSION!
    ) else (
        echo   [WARNING] Cargo not found in PATH!
        
        REM Check if Cargo exists but isn't in PATH
        if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
            echo   [INFO] Cargo found but not in PATH. Adding to PATH...
            setx PATH "%PATH%;%USERPROFILE%\.cargo\bin" >nul 2>&1
            if %ERRORLEVEL% EQU 0 (
                echo   [OK] Added Cargo to PATH.
                echo     Please restart your terminal and run this script again.
                set ALL_GOOD=0
            ) else (
                echo   [ERROR] Failed to add Cargo to PATH automatically.
                echo     Please manually add this to your PATH: %USERPROFILE%\.cargo\bin
                echo     See REQUIREMENTS.md for instructions.
                set ALL_GOOD=0
            )
        ) else (
            echo     Cargo should come with Rust. Please reinstall Rust.
            set ALL_GOOD=0
        )
    )
    echo.
)

REM If prerequisites are missing or were just installed, exit
if %ALL_GOOD% EQU 0 (
    echo ========================================
    if %INSTALLED_NODE% EQU 1 (
        echo   Node.js installation started!
    )
    if %INSTALLED_RUST% EQU 1 (
        echo   Rust installation started!
    )
    if %INSTALLED_NODE% EQU 0 if %INSTALLED_RUST% EQU 0 (
        echo   Setup incomplete. Please install
        echo   missing prerequisites and try again.
    )
    echo ========================================
    echo.
    if %INSTALLED_NODE% EQU 0 if %INSTALLED_RUST% EQU 0 (
        echo Quick links:
        echo   • Node.js: https://nodejs.org/
        echo   • Rust: https://rustup.rs/
        echo   • Visual C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo.
    )
    echo IMPORTANT: Close this window and open a NEW terminal window,
    echo then run this script again to continue.
    echo.
    echo Press any key to close this window...
    pause >nul
    exit /b 1
)

REM Install npm dependencies
echo ========================================
echo   Installing npm dependencies...
echo ========================================
echo.
echo This may take a few minutes...
echo.

call npm install
set NPM_EXIT=%ERRORLEVEL%

if !NPM_EXIT! NEQ 0 (
    echo.
    echo ========================================
    echo   [ERROR] npm install failed!
    echo ========================================
    echo.
    echo Please check the error messages above.
    echo Common issues:
    echo   • Make sure you have an internet connection
    echo   • Try running: npm cache clean --force
    echo   • Check if Node.js is properly installed
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

echo.
echo ========================================
echo   [OK] Setup complete!
echo ========================================
echo.
echo You can now run the app with:
echo   npm run tauri:dev
echo.
echo Or use the convenience scripts:
echo   dev.ps1    (PowerShell)
echo   dev.bat    (Command Prompt)
echo.
echo Press any key to exit...
pause >nul
