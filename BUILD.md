# Building TradeButler for Distribution

This guide explains how to build TradeButler into standalone executables for Windows, macOS, and Linux.

## Prerequisites

1. **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
2. **Rust** (latest stable) - [Install via rustup](https://rustup.rs/)
3. **Platform-specific build tools:**
   - **Windows**: Microsoft Visual C++ Build Tools
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Linux**: `build-essential`, `libwebkit2gtk-4.1-dev`, `libsoup2.4-dev`, `pkg-config`

## Build Steps

### 1. Install Dependencies

```bash
cd TradeButler
npm install
```

### 2. Build the Application

#### For Windows:
```bash
npm run tauri:build
```
This creates three distribution formats:

1. **Portable Executable** (No installation required):
   - `src-tauri/target/release/bundle/app/TradeButler.exe`
   - Just double-click to run
   - Perfect for USB drives or testing
   - Data stored in: `%APPDATA%\TradeButler\`

2. **MSI Installer** (Standard Windows installer):
   - `src-tauri/target/release/bundle/msi/TradeButler_1.0.0_x64_en-US.msi`
   - Double-click to install
   - Creates Start Menu shortcuts
   - Can be uninstalled via Windows Settings

3. **NSIS Installer** (More customizable):
   - `src-tauri/target/release/bundle/nsis/TradeButler_1.0.0_x64-setup.exe`
   - Double-click to run installer wizard
   - More installation options
   - Creates Start Menu shortcuts
   - Can be uninstalled via Windows Settings

#### For macOS:
```bash
npm run tauri:build
```
This creates:
- `src-tauri/target/release/bundle/macos/TradeButler.app` - macOS application bundle
- `src-tauri/target/release/bundle/dmg/TradeButler_1.0.0_x64.dmg` - macOS disk image

#### For Linux:
```bash
npm run tauri:build
```
This creates:
- `src-tauri/target/release/TradeButler` - Linux executable
- `src-tauri/target/release/bundle/appimage/TradeButler_1.0.0_amd64.AppImage` - AppImage
- `src-tauri/target/release/bundle/deb/TradeButler_1.0.0_amd64.deb` - Debian package

### 3. Build for Specific Platform (Cross-compilation)

To build for a different platform than your current OS, you'll need to set up cross-compilation. However, it's often easier to build on the target platform or use CI/CD.

## What Gets Bundled

The build process automatically bundles:

✅ **Frontend**: All React code, assets, and dependencies (from `dist/` folder)  
✅ **Backend**: Rust binary with SQLite database engine  
✅ **Icons**: All icon files from `src-tauri/icons/`  
✅ **Dependencies**: All required system libraries and runtime components  
✅ **Database**: SQLite database is created on first run in user's app data directory

## Icon Requirements

Your icons are already set up in `src-tauri/icons/`:
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon
- `icon.png` - Linux/fallback icon
- Various sizes for different contexts

## Distribution Files

After building, you'll find distribution-ready files in:
- **Windows**: 
  - `src-tauri/target/release/bundle/app/` - Portable executable (no installation)
  - `src-tauri/target/release/bundle/msi/` - MSI installer
  - `src-tauri/target/release/bundle/nsis/` - NSIS installer
- **macOS**: `src-tauri/target/release/bundle/dmg/` (DMG disk image)
- **Linux**: `src-tauri/target/release/bundle/appimage/` or `deb/` (AppImage or Debian package)

**Note**: For Windows, you can distribute any or all three formats. Most users prefer the installer versions (MSI or NSIS) for permanent installation, while the portable version is great for testing or users who prefer portable apps.

## Code Signing (Optional but Recommended)

For production releases, you should code sign your application:

### Windows:
- Requires a code signing certificate
- Sign the `.exe` and `.msi` files
- Tools: `signtool.exe` (Windows SDK)

### macOS:
- Requires Apple Developer account ($99/year)
- Sign with: `codesign --sign "Developer ID Application: Your Name" TradeButler.app`
- Notarize with: `xcrun notarytool submit TradeButler.dmg`

### Linux:
- Sign AppImage with GPG key
- Sign Debian package with `debsign`

## Version Number

Update the version in:
- `package.json` - `"version": "1.0.0"`
- `src-tauri/tauri.conf.json` - `"version": "1.0.0"`
- `src-tauri/Cargo.toml` - `version = "1.0.0"`

## Build Optimization

For smaller file sizes:
1. Enable release mode optimizations (already done in `tauri build`)
2. Remove unused dependencies
3. Optimize images and assets
4. Enable compression in build config

## Troubleshooting

### Build fails with "link.exe not found" (Windows)
- Install Microsoft Visual C++ Build Tools
- Or install Visual Studio with C++ workload

### Build fails with missing libraries (Linux)
```bash
sudo apt-get update
sudo apt-get install libwebkit2gtk-4.1-dev libsoup2.4-dev build-essential pkg-config
```

### Build is slow
- First build compiles all Rust dependencies (can take 10-30 minutes)
- Subsequent builds are much faster (only recompiles changed code)

### Large file size
- Normal for Tauri apps: ~10-50MB depending on platform
- Includes Rust runtime, WebView, and all dependencies
- Still much smaller than Electron apps

## Quick Build Script

Create a `build.bat` (Windows) or `build.sh` (macOS/Linux) for easy building:

**Windows (`build.bat`):**
```batch
@echo off
echo Building TradeButler...
call npm run build
call npm run tauri:build
echo Build complete! Check src-tauri/target/release/bundle/
pause
```

**macOS/Linux (`build.sh`):**
```bash
#!/bin/bash
echo "Building TradeButler..."
npm run build
npm run tauri:build
echo "Build complete! Check src-tauri/target/release/bundle/"
```
