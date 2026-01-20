# Installer Theming & Required Images

## 🎨 Will the Installer Match Your Dark Theme?

**Short answer:** Not automatically, but you can customize it with images.

### The Reality:
- **MSI Installer (Windows):** Uses standard Windows installer UI (light theme by default)
- **NSIS Installer (Windows):** More customizable - can add custom banners/images
- **DMG (macOS):** Uses Finder window - can customize with background image
- **Your App:** Will be dark-themed once installed ✅

The installer runs **before** your app is installed, so it can't use your React/CSS theme. However, you can make it look dark-themed with custom images!

---

## 📸 Required Images for Installer Customization

### 1. App Icons (Already Have ✅)

You already have these in `src-tauri/icons/`:
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon  
- `icon.png` - Linux/fallback
- Various sizes (32x32, 128x128, etc.)

**Status:** ✅ Already configured

---

### 2. Windows NSIS Installer Images (Optional but Recommended)

To make the installer dark-themed, you'll need:

#### **Side Banner** (Left side of installer)
- **Format:** `.bmp` (bitmap)
- **Size:** 164 x 314 pixels
- **Purpose:** Shows on welcome/finish pages
- **Design:** Dark background with your logo/branding
- **Location:** `src-tauri/icons/installer-sidebar.bmp`

#### **Header Image** (Top of installer pages)
- **Format:** `.bmp` (bitmap)
- **Size:** 150 x 57 pixels
- **Purpose:** Shows at top-right of installer pages
- **Design:** Your logo or app name on dark background
- **Location:** `src-tauri/icons/installer-header.bmp`

#### **Wizard Image** (Optional)
- **Format:** `.bmp` (bitmap)
- **Size:** 55 x 55 pixels
- **Purpose:** Small icon in installer wizard
- **Design:** Your app icon
- **Location:** `src-tauri/icons/installer-wizard.bmp`

---

### 3. macOS DMG Background Image (Optional)

To make the DMG window dark-themed:

- **Format:** `.png`
- **Size:** 600 x 400 pixels (or match DMG window size)
- **Purpose:** Background of the DMG window
- **Design:** Dark background with:
  - Your app icon
  - Arrow pointing to Applications folder
  - "Drag TradeButler to Applications" text
- **Location:** `src-tauri/icons/dmg-background.png`

---

## 🛠️ How to Add Custom Installer Images

### For Windows NSIS Installer:

1. **Create the images:**
   - Use any image editor (Photoshop, GIMP, Figma, etc.)
   - Design dark-themed banners matching your app
   - Export as `.bmp` format (required for NSIS)

2. **Place images in:**
   ```
   src-tauri/icons/
   ├── installer-sidebar.bmp  (164x314)
   ├── installer-header.bmp   (150x57)
   └── installer-wizard.bmp   (55x55)
   ```

3. **Update `tauri.conf.json`:**
   ```json
   {
     "tauri": {
       "bundle": {
         "windows": {
           "nsis": {
             "installerIcon": "icons/icon.ico",
             "installMode": "perMachine",
             "oneClick": false,
             "allowDowngrades": false,
             "createDesktopShortcut": true,
             "createStartMenuShortcut": true,
             "shortcutName": "TradeButler",
             "include": "icons/installer-sidebar.bmp",
             "installerHeaderIcon": "icons/installer-header.bmp",
             "installerSidebar": "icons/installer-sidebar.bmp",
             "deleteAppDataOnUninstall": false
           }
         }
       }
     }
   }
   ```

### For macOS DMG:

1. **Create background image:**
   - Design dark-themed background
   - Include app icon and instructions
   - Export as `.png`

2. **Place in:**
   ```
   src-tauri/icons/dmg-background.png
   ```

3. **Update `tauri.conf.json`:**
   ```json
   {
     "tauri": {
       "bundle": {
         "macOS": {
           "dmg": {
             "background": "icons/dmg-background.png"
           }
         }
       }
     }
   }
   ```

---

## 🎨 Design Guidelines for Dark Installer Images

### Windows NSIS Sidebar Banner (164x314):
- **Background:** Dark color matching your app (e.g., `#1a1a1a` or `#0f0f0f`)
- **Logo:** Your TradeButler logo centered
- **Text:** App name, version, or tagline
- **Style:** Minimal, professional, matches your app's dark theme

### Windows NSIS Header (150x57):
- **Background:** Dark color
- **Content:** Small logo or app name
- **Style:** Clean, minimal

### macOS DMG Background (600x400):
- **Background:** Dark color matching your app
- **Elements:**
  - Large app icon (centered or top)
  - Arrow pointing to Applications folder
  - Text: "Drag TradeButler to Applications to install"
- **Style:** Clean, professional, matches your app

---

## 📋 Quick Checklist

### Minimum Required (Already Done ✅):
- [x] App icons (`.ico`, `.icns`, `.png`)
- [x] Icon configuration in `tauri.conf.json`

### Optional but Recommended:
- [ ] Windows NSIS sidebar banner (`.bmp`, 164x314)
- [ ] Windows NSIS header image (`.bmp`, 150x57)
- [ ] macOS DMG background (`.png`, 600x400)

---

## 🚀 Quick Start: Minimal Customization

If you want to get started quickly without custom images:

1. **Use the portable `.exe`** - No installer UI, just double-click
2. **Or use MSI** - Standard Windows installer (less customizable but professional)
3. **Add images later** - You can always add custom installer images in future releases

---

## 💡 Pro Tips

1. **Test the installer** - Build and test to see how it looks
2. **Keep it simple** - Dark backgrounds with your logo work great
3. **Match your brand** - Use the same colors/fonts as your app
4. **Consider both themes** - Some users have light system themes, but dark images still look professional

---

## 📝 Summary

- **App itself:** Will be dark-themed ✅
- **Installer:** Can be customized with dark-themed images
- **Required:** App icons (already have ✅)
- **Optional:** Installer banners/backgrounds for full dark theme experience

The installer is a one-time experience - once installed, your app will be fully dark-themed!
