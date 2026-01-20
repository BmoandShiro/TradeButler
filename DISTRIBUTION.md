# Distribution Options for TradeButler

## ✅ What Gets Bundled Automatically

**YES - Everything is bundled!** Tauri automatically includes:

- ✅ **All React dependencies** (react, react-dom, recharts, etc.)
- ✅ **All Rust dependencies** (SQLite, HTTP client, etc.)
- ✅ **SQLite database engine** (bundled, no separate install needed)
- ✅ **WebView runtime** (embedded, no browser needed)
- ✅ **All assets and icons**
- ✅ **Everything needed to run** - users don't need Node.js, Rust, or any other dependencies

**Result:** Users get a single executable file that "just works" - no installation of dependencies required!

---

## 📦 Distribution Formats

When you run `npm run tauri:build`, Tauri creates **multiple formats** automatically:

### Windows Options:

1. **Standalone Executable** (Portable)
   - Location: `src-tauri/target/release/TradeButler.exe`
   - **Size:** ~15-25 MB
   - **Pros:**
     - ✅ No installation needed - just double-click to run
     - ✅ Can run from USB drive
     - ✅ No admin rights needed
     - ✅ Easy to share (single file)
   - **Cons:**
     - ❌ No Start Menu shortcut
     - ❌ No uninstaller
     - ❌ Windows Defender might flag it (false positive)

2. **MSI Installer** (Recommended for most users)
   - Location: `src-tauri/target/release/bundle/msi/TradeButler_1.0.0_x64_en-US.msi`
   - **Size:** ~15-25 MB
   - **Pros:**
     - ✅ Professional installation experience
     - ✅ Creates Start Menu shortcut
     - ✅ Appears in "Add/Remove Programs"
     - ✅ Easy updates (can upgrade existing install)
     - ✅ Better Windows integration
   - **Cons:**
     - ❌ Requires admin rights to install
     - ❌ Not portable

3. **NSIS Installer** (Alternative installer)
   - Location: `src-tauri/target/release/bundle/nsis/TradeButler_1.0.0_x64-setup.exe`
   - **Size:** ~15-25 MB
   - **Pros:**
     - ✅ More customizable than MSI
     - ✅ Can create portable install option
     - ✅ Better for advanced users
   - **Cons:**
     - ❌ Less common than MSI
     - ❌ Requires admin rights

### macOS Options:

1. **DMG Disk Image** (Recommended)
   - Location: `src-tauri/target/release/bundle/dmg/TradeButler_1.0.0_x64.dmg`
   - **Size:** ~20-40 MB
   - **Pros:**
     - ✅ Standard macOS distribution format
     - ✅ Drag-and-drop installation
     - ✅ Professional appearance
   - **Cons:**
     - ❌ Not portable (installs to Applications)

2. **App Bundle** (Portable)
   - Location: `src-tauri/target/release/bundle/macos/TradeButler.app`
   - **Size:** ~20-40 MB
   - **Pros:**
     - ✅ Can run from anywhere
     - ✅ Portable
   - **Cons:**
     - ❌ Gatekeeper warnings (unless code signed)

### Linux Options:

1. **AppImage** (Portable - Recommended)
   - Location: `src-tauri/target/release/bundle/appimage/TradeButler_1.0.0_amd64.AppImage`
   - **Size:** ~15-25 MB
   - **Pros:**
     - ✅ No installation needed
     - ✅ Works on any Linux distro
     - ✅ Portable (can run from USB)
     - ✅ Single file
   - **Cons:**
     - ❌ Need to make executable: `chmod +x TradeButler.AppImage`

2. **Debian Package** (.deb)
   - Location: `src-tauri/target/release/bundle/deb/TradeButler_1.0.0_amd64.deb`
   - **Size:** ~15-25 MB
   - **Pros:**
     - ✅ Standard Debian/Ubuntu installation
     - ✅ Integrates with package manager
   - **Cons:**
     - ❌ Only works on Debian-based distros

---

## 🎯 Recommendation: Offer Both!

**Best approach:** Provide both installer and portable versions:

### For Windows:
- **MSI Installer** - For most users (professional, easy updates)
- **Portable .exe** - For power users, USB drives, or restricted environments

### For macOS:
- **DMG** - Standard distribution
- **App Bundle** - For portable use

### For Linux:
- **AppImage** - Universal, portable
- **.deb** - For Debian/Ubuntu users who prefer package manager

---

## 📋 How to Build Specific Formats

### Build Everything (Default):
```bash
npm run tauri:build
```
Creates all formats listed above.

### Build Only Installer:
Edit `src-tauri/tauri.conf.json`:
```json
"targets": ["msi"]  // Windows
"targets": ["dmg"]  // macOS
"targets": ["deb"]  // Linux
```

### Build Only Portable:
Edit `src-tauri/tauri.conf.json`:
```json
"targets": ["app"]  // Creates standalone .exe
```

---

## 🚀 User Experience

### With Installer (MSI/DMG):
1. User downloads `.msi` or `.dmg`
2. Double-clicks installer
3. Follows installation wizard
4. App appears in Start Menu/Applications
5. Can uninstall via "Add/Remove Programs"

### With Portable (.exe/AppImage):
1. User downloads `.exe` or `.AppImage`
2. Double-clicks to run (no installation)
3. Can move file anywhere
4. Can run from USB drive
5. No uninstaller needed (just delete file)

---

## 💾 Data Storage

**Important:** Your app stores data in user's AppData directory:
- **Windows:** `%APPDATA%\TradeButler\`
- **macOS:** `~/Library/Application Support/TradeButler/`
- **Linux:** `~/.config/TradeButler/`

This works the same for both installer and portable versions - data is always stored in the user's profile, not with the executable.

---

## 🔒 Code Signing (Recommended for Production)

To avoid "Unknown Publisher" warnings:

### Windows:
- Purchase code signing certificate (~$200-400/year)
- Sign both `.exe` and `.msi` files
- Users won't see security warnings

### macOS:
- Apple Developer account ($99/year)
- Code sign and notarize
- Users won't see Gatekeeper warnings

### Linux:
- GPG signing (free)
- Sign AppImage and .deb packages

---

## 📊 File Size Comparison

| Format | Size | Notes |
|--------|------|-------|
| Windows .exe | ~15-25 MB | Standalone, portable |
| Windows .msi | ~15-25 MB | Installer |
| macOS .dmg | ~20-40 MB | Disk image |
| macOS .app | ~20-40 MB | Application bundle |
| Linux AppImage | ~15-25 MB | Portable |
| Linux .deb | ~15-25 MB | Package |

**Note:** First build takes 10-30 minutes (compiles Rust). Subsequent builds are much faster.

---

## ✅ Summary

**For most users:** Provide the **installer** (MSI/DMG) - it's more professional and user-friendly.

**For power users:** Also provide the **portable** version (.exe/AppImage) - some users prefer it.

**Both are fully self-contained** - no dependencies needed, everything bundled!
