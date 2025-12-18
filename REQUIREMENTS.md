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
- **Required for:** Compiling Rust code on Windows
- **Download:** https://visualstudio.microsoft.com/visual-cpp-build-tools/
- **Or install:** Visual Studio with C++ workload

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

