@echo off
REM TradeButler Setup Script (Batch)
REM This script checks prerequisites and installs all dependencies

echo ========================================
echo   TradeButler Setup Script
echo ========================================
echo.

set ALL_GOOD=1

REM Check Node.js
echo Checking Node.js...
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo   [OK] Node.js found: %NODE_VERSION%
) else (
    echo   [ERROR] Node.js not found!
    echo     Attempting to install Node.js...
    
    REM Try winget first
    where winget >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo     Using winget to install Node.js...
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        if %ERRORLEVEL% EQU 0 (
            echo     [OK] Node.js installed! Please restart your terminal and run this script again.
            echo     (The PATH needs to be refreshed for Node.js to be available)
            set ALL_GOOD=0
        ) else (
            echo     [ERROR] winget installation failed.
            echo     Please install Node.js manually from: https://nodejs.org/
            echo     Or run: winget install OpenJS.NodeJS.LTS
            echo     After installing, restart your terminal and run this script again.
            set ALL_GOOD=0
        )
    ) else (
        echo     Please install Node.js manually from: https://nodejs.org/
        echo     Or run: winget install OpenJS.NodeJS.LTS
        echo     After installing, restart your terminal and run this script again.
        set ALL_GOOD=0
    )
)

echo.

REM Check npm
echo Checking npm...
where npm >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo   [OK] npm found: %NPM_VERSION%
) else (
    echo   [ERROR] npm not found!
    echo     npm should come with Node.js. Please reinstall Node.js.
    set ALL_GOOD=0
)

echo.

REM Check Rust
echo Checking Rust...
where rustc >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('rustc --version') do set RUST_VERSION=%%i
    echo   [OK] Rust found: %RUST_VERSION%
) else (
    echo   [ERROR] Rust not found!
    echo     Attempting to install Rust...
    
    REM Try winget first
    where winget >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo     Using winget to install Rust...
        winget install Rustlang.Rustup --silent --accept-package-agreements --accept-source-agreements
        if %ERRORLEVEL% EQU 0 (
            echo     [OK] Rust installed! Please restart your terminal and run this script again.
            echo     (The PATH needs to be refreshed for Rust to be available)
            set ALL_GOOD=0
        ) else (
            echo     [ERROR] winget installation failed. Trying rustup installer...
            echo     Downloading Rust installer...
            powershell -Command "Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%TEMP%\rustup-init.exe' -UseBasicParsing"
            if exist "%TEMP%\rustup-init.exe" (
                echo     Running Rust installer (this may take a few minutes)...
                "%TEMP%\rustup-init.exe" -y
                del "%TEMP%\rustup-init.exe" >nul 2>&1
                echo     [OK] Rust installed! Please restart your terminal and run this script again.
                echo     (The PATH needs to be refreshed for Rust to be available)
                set ALL_GOOD=0
            ) else (
                echo     [ERROR] Automatic installation failed.
                echo     Please install Rust manually from: https://rustup.rs/
                set ALL_GOOD=0
            )
        )
    ) else (
        REM No winget, try direct download
        echo     Downloading Rust installer...
        powershell -Command "Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%TEMP%\rustup-init.exe' -UseBasicParsing"
        if exist "%TEMP%\rustup-init.exe" (
            echo     Running Rust installer (this may take a few minutes)...
            "%TEMP%\rustup-init.exe" -y
            del "%TEMP%\rustup-init.exe" >nul 2>&1
            echo     [OK] Rust installed! Please restart your terminal and run this script again.
            echo     (The PATH needs to be refreshed for Rust to be available)
            set ALL_GOOD=0
        ) else (
            echo     [ERROR] Automatic installation failed.
            echo     Please install Rust manually from: https://rustup.rs/
            set ALL_GOOD=0
        )
    )
)

echo.

REM Check Cargo
echo Checking Cargo...
where cargo >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('cargo --version') do set CARGO_VERSION=%%i
    echo   [OK] Cargo found: %CARGO_VERSION%
) else (
    echo   [ERROR] Cargo not found!
    
    REM Check if Cargo exists but isn't in PATH
    if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
        echo   [INFO] Cargo found but not in PATH. Adding to PATH...
        setx PATH "%PATH%;%USERPROFILE%\.cargo\bin" >nul 2>&1
        if %ERRORLEVEL% EQU 0 (
            echo   [OK] Added Cargo to PATH. Please restart your terminal.
            echo     After restarting, run this script again to continue.
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

REM If prerequisites are missing, exit
if %ALL_GOOD% EQU 0 (
    echo.
    echo ========================================
    echo   Setup incomplete. Please install
    echo   missing prerequisites and try again.
    echo ========================================
    echo.
    echo Quick links:
    echo   • Node.js: https://nodejs.org/
    echo   • Rust: https://rustup.rs/
    echo   • Visual C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM Install npm dependencies
echo ========================================
echo   Installing npm dependencies...
echo ========================================
echo.

call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] npm install failed. Please check the error messages above.
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

