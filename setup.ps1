# TradeButler Setup Script
# This script checks prerequisites and installs all dependencies

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TradeButler Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"
$allGood = $true

# Function to check if a command exists
function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
if (Test-Command "node") {
    $nodeVersion = node --version
    Write-Host "  ✓ Node.js found: $nodeVersion" -ForegroundColor Green
    
    # Check if version is 18 or higher
    $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($majorVersion -lt 18) {
        Write-Host "  ⚠ Warning: Node.js version 18+ recommended. Current: $nodeVersion" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✗ Node.js not found!" -ForegroundColor Red
    Write-Host "    Attempting to install Node.js..." -ForegroundColor Yellow
    
    # Try winget first
    if (Test-Command "winget") {
        Write-Host "    Using winget to install Node.js..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    ✓ Node.js installed! Please restart your terminal and run this script again." -ForegroundColor Green
            Write-Host "    (The PATH needs to be refreshed for Node.js to be available)" -ForegroundColor Yellow
            $allGood = $false
        } else {
            Write-Host "    ✗ winget installation failed. Trying alternative method..." -ForegroundColor Yellow
        }
    }
    
    # If winget failed or not available, provide manual instructions
    if (-not (Test-Command "node")) {
        Write-Host "    Please install Node.js manually from: https://nodejs.org/" -ForegroundColor Yellow
        Write-Host "    Or run: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
        Write-Host "    After installing, restart your terminal and run this script again." -ForegroundColor Yellow
        $allGood = $false
    }
}

Write-Host ""

# Check npm
Write-Host "Checking npm..." -ForegroundColor Yellow
if (Test-Command "npm") {
    $npmVersion = npm --version
    Write-Host "  ✓ npm found: $npmVersion" -ForegroundColor Green
} else {
    Write-Host "  ✗ npm not found!" -ForegroundColor Red
    Write-Host "    npm should come with Node.js. Please reinstall Node.js." -ForegroundColor Yellow
    $allGood = $false
}

Write-Host ""

# Check Rust
Write-Host "Checking Rust..." -ForegroundColor Yellow
if (Test-Command "rustc") {
    $rustVersion = rustc --version
    Write-Host "  ✓ Rust found: $rustVersion" -ForegroundColor Green
} else {
    Write-Host "  ✗ Rust not found!" -ForegroundColor Red
    Write-Host "    Attempting to install Rust..." -ForegroundColor Yellow
    
    # Try winget first
    if (Test-Command "winget") {
        Write-Host "    Using winget to install Rust..." -ForegroundColor Cyan
        winget install Rustlang.Rustup --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    ✓ Rust installed! Please restart your terminal and run this script again." -ForegroundColor Green
            Write-Host "    (The PATH needs to be refreshed for Rust to be available)" -ForegroundColor Yellow
            $allGood = $false
        } else {
            Write-Host "    ✗ winget installation failed. Trying rustup installer..." -ForegroundColor Yellow
            
            # Try downloading and running rustup-init.exe
            $rustupUrl = "https://win.rustup.rs/x86_64"
            $rustupPath = "$env:TEMP\rustup-init.exe"
            try {
                Write-Host "    Downloading Rust installer..." -ForegroundColor Cyan
                Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupPath -UseBasicParsing
                Write-Host "    Running Rust installer (this may take a few minutes)..." -ForegroundColor Cyan
                Start-Process -FilePath $rustupPath -ArgumentList "-y" -Wait -NoNewWindow
                Remove-Item $rustupPath -ErrorAction SilentlyContinue
                Write-Host "    ✓ Rust installed! Please restart your terminal and run this script again." -ForegroundColor Green
                Write-Host "    (The PATH needs to be refreshed for Rust to be available)" -ForegroundColor Yellow
                $allGood = $false
            } catch {
                Write-Host "    ✗ Automatic installation failed: $_" -ForegroundColor Red
                Write-Host "    Please install Rust manually from: https://rustup.rs/" -ForegroundColor Yellow
                $allGood = $false
            }
        }
    } else {
        # No winget, try direct download
        $rustupUrl = "https://win.rustup.rs/x86_64"
        $rustupPath = "$env:TEMP\rustup-init.exe"
        try {
            Write-Host "    Downloading Rust installer..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupPath -UseBasicParsing
            Write-Host "    Running Rust installer (this may take a few minutes)..." -ForegroundColor Cyan
            Start-Process -FilePath $rustupPath -ArgumentList "-y" -Wait -NoNewWindow
            Remove-Item $rustupPath -ErrorAction SilentlyContinue
            Write-Host "    ✓ Rust installed! Please restart your terminal and run this script again." -ForegroundColor Green
            Write-Host "    (The PATH needs to be refreshed for Rust to be available)" -ForegroundColor Yellow
            $allGood = $false
        } catch {
            Write-Host "    ✗ Automatic installation failed: $_" -ForegroundColor Red
            Write-Host "    Please install Rust manually from: https://rustup.rs/" -ForegroundColor Yellow
            $allGood = $false
        }
    }
}

Write-Host ""

# Check Cargo
Write-Host "Checking Cargo..." -ForegroundColor Yellow
if (Test-Command "cargo") {
    $cargoVersion = cargo --version
    Write-Host "  ✓ Cargo found: $cargoVersion" -ForegroundColor Green
} else {
    Write-Host "  ✗ Cargo not found!" -ForegroundColor Red
    
    # Try to add Cargo to PATH if Rust is installed
    $cargoPath = "$env:USERPROFILE\.cargo\bin"
    if (Test-Path $cargoPath) {
        Write-Host "  → Cargo found but not in PATH. Adding to PATH..." -ForegroundColor Yellow
        try {
            $currentPath = [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
            if ($currentPath -notlike "*$cargoPath*") {
                [System.Environment]::SetEnvironmentVariable(
                    "Path",
                    "$currentPath;$cargoPath",
                    [System.EnvironmentVariableTarget]::User
                )
                Write-Host "  ✓ Added Cargo to PATH. Please restart your terminal." -ForegroundColor Green
                Write-Host "    After restarting, run this script again to continue." -ForegroundColor Yellow
                $allGood = $false
            }
        } catch {
            Write-Host "  ✗ Failed to add Cargo to PATH automatically." -ForegroundColor Red
            Write-Host "    Please manually add this to your PATH: $cargoPath" -ForegroundColor Yellow
            Write-Host "    See REQUIREMENTS.md for instructions." -ForegroundColor Yellow
            $allGood = $false
        }
    } else {
        Write-Host "    Cargo should come with Rust. Please reinstall Rust." -ForegroundColor Yellow
        $allGood = $false
    }
}

Write-Host ""

# If prerequisites are missing, exit
if (-not $allGood) {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  Setup incomplete. Please install" -ForegroundColor Red
    Write-Host "  missing prerequisites and try again." -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Quick links:" -ForegroundColor Cyan
    Write-Host "  • Node.js: https://nodejs.org/" -ForegroundColor White
    Write-Host "  • Rust: https://rustup.rs/" -ForegroundColor White
    Write-Host "  • Visual C++ Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor White
    exit 1
}

# Install npm dependencies
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installing npm dependencies..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

try {
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  ✓ Setup complete!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "You can now run the app with:" -ForegroundColor Cyan
        Write-Host "  npm run tauri:dev" -ForegroundColor White
        Write-Host ""
        Write-Host "Or use the convenience scripts:" -ForegroundColor Cyan
        Write-Host "  .\dev.ps1    (PowerShell)" -ForegroundColor White
        Write-Host "  dev.bat      (Command Prompt)" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "✗ npm install failed. Please check the error messages above." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "✗ Error installing dependencies: $_" -ForegroundColor Red
    exit 1
}
