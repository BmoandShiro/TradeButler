# TradeButler Requirements

## Required Software

### 1. Node.js (v18 or higher)
- **Download:** https://nodejs.org/
- **Verify:** `node --version`
- **Includes:** npm (Node Package Manager)

### 2. Rust & Cargo
- **Download:** https://rustup.rs/
- **Verify:** `cargo --version`
- **Note:** After installing Rust, Cargo will be installed automatically at `%USERPROFILE%\.cargo\bin`

### 3. Microsoft Visual C++ Build Tools (Windows only)
- **Required for:** Compiling Rust code on Windows (provides `link.exe` that Rust needs)
- **Download:** https://visualstudio.microsoft.com/visual-cpp-build-tools/
- **Note:** You do NOT need the full Visual Studio - just the Build Tools (much smaller download ~3GB vs ~10GB+)
- **Installation:** 
  1. Download the installer from the link above
  2. Run the installer
  3. Select "C++ build tools" workload
  4. Make sure "MSVC v143 - VS 2022 C++ x64/x86 build tools" is checked
  5. Click Install
- **Alternative:** If you already have Visual Studio installed, make sure the "Desktop development with C++" workload is installed

## Quick Setup

Run the setup script to configure your environment:

```powershell
.\setup.ps1
```

This script will:
- ✅ Check if Rust/Cargo is installed
- ✅ Add Cargo to your PATH permanently (if needed)
- ✅ Check if Node.js is installed
- ✅ Install npm dependencies

## Manual Setup

### Adding Cargo to PATH (if not done automatically)

**PowerShell (as Administrator):**
```powershell
[System.Environment]::SetEnvironmentVariable(
    "Path",
    [System.Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User) + ";$env:USERPROFILE\.cargo\bin",
    [System.EnvironmentVariableTarget]::User
)
```

**Or via Windows GUI:**
1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Go to **Advanced** tab → **Environment Variables**
3. Under **User variables**, select `Path` → **Edit**
4. Click **New** and add: `%USERPROFILE%\.cargo\bin`
5. Click **OK** on all windows
6. **Restart your terminal/IDE**

## Verification

After setup, verify everything works:

```bash
# Check Node.js
node --version

# Check npm
npm --version

# Check Rust
rustc --version

# Check Cargo
cargo --version
```

## Optional Requirements

### Internet Connectivity (Optional)
- **Required for:** Stock chart features (Yahoo Finance API)
- **Note:** The app works fully offline for trade analytics and metrics
- Charts will only work with an active internet connection
- No API keys required for basic chart functionality

## Troubleshooting

### "cargo: command not found"
- Run `.\setup.ps1` to add Cargo to PATH
- Or manually add `%USERPROFILE%\.cargo\bin` to your PATH
- **Restart your terminal/IDE** after adding to PATH

### "Failed to compile" errors
- Ensure Visual C++ Build Tools are installed
- Try running: `rustup update`

### Port 1420 already in use
- Close any other instances of the app
- Or change the port in `vite.config.ts`

### Chart features not working
- Ensure you have an active internet connection
- Check if Yahoo Finance is accessible from your network
- Some symbols may not have intraday data available (daily data will be used as fallback)

