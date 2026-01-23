import { useState, useEffect, useRef } from "react";
import { Settings as SettingsIcon, Download, RefreshCw, CheckCircle, XCircle, AlertCircle, Palette, RotateCcw, Save, Trash2, Edit2, X, Lock, Key, Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { ColorPicker } from "../components/ColorPicker";
import { 
  loadTheme, 
  saveTheme, 
  applyTheme, 
  resetTheme, 
  defaultTheme, 
  ThemeColors,
  getAllPresets,
  getPresetById,
  createPresetFromCurrentTheme,
  deleteCustomPreset,
  saveCustomPreset,
  ThemePreset,
  presetThemes
} from "../utils/themeManager";
import { 
  hasPassword, 
  getPasswordType, 
  setPassword, 
  deletePassword,
  verifyPassword
} from "../utils/passwordManager";
import { 
  getLockScreenStyle, 
  setLockScreenStyle as saveLockScreenStyle, 
  LockScreenStyle 
} from "../utils/lockScreenManager";

interface VersionInfo {
  current: string;
  latest: string;
  is_up_to_date: boolean;
  download_url?: string;
  release_notes?: string;
  is_installer: boolean;
}

export default function Settings() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  
  // Theme state
  const [theme, setTheme] = useState<ThemeColors>(() => loadTheme());
  const [presets, setPresets] = useState<ThemePreset[]>(() => getAllPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState("");
  
  // Password/PIN state
  const [passwordType, setPasswordType] = useState<"pin" | "password">(() => getPasswordType() || "pin");
  const [newPassword, setNewPassword] = useState("");
  const [newPinDigits, setNewPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPinDigits, setConfirmPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showRemovePin, setShowRemovePin] = useState(false);
  const [removeVerification, setRemoveVerification] = useState("");
  const [removePinDigits, setRemovePinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [lockScreenStyle, setLockScreenStyle] = useState<LockScreenStyle>(() => getLockScreenStyle());
  const newPasswordInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmPasswordInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const removePasswordInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const checkVersion = async () => {
    try {
      setIsChecking(true);
      setError(null);
      console.log("Starting version check...");
      const info = await invoke<VersionInfo>("check_version");
      console.log("Version check successful:", info);
      setVersionInfo(info);
      
      if (!info.is_up_to_date) {
        setShowUpdateModal(true);
      }
    } catch (err: any) {
      console.error("Version check error:", err);
      console.error("Error type:", typeof err);
      console.error("Error constructor:", err?.constructor?.name);
      
      // Handle Tauri error format
      let errorMessage = "Failed to check version";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      } else if (err?.message) {
        errorMessage = err.message;
      } else if (err?.toString) {
        errorMessage = err.toString();
      } else {
        errorMessage = JSON.stringify(err);
      }
      
      console.error("Final error message:", errorMessage);
      setError(errorMessage);
    } finally {
      setIsChecking(false);
    }
  };

  const downloadUpdate = async () => {
    if (!versionInfo?.download_url) return;

    try {
      setIsDownloading(true);
      setError(null);
      
      if (versionInfo.is_installer) {
        // For installer version, download and run the installer
        await invoke("download_and_install_update", { 
          download_url: versionInfo.download_url 
        });
        alert("Update downloaded and installer started. Please follow the installation wizard. Your data will be preserved.");
      } else {
        // For portable version, download and auto-update
        await invoke("download_portable_update", { 
          download_url: versionInfo.download_url 
        });
        alert(`Update downloaded successfully!\n\nThe new version will launch automatically and this window will close.\n\nThe old version will be automatically deleted after the new one starts.\n\nYour data will be preserved.`);
        
        // Close the app after a short delay to allow the update script to launch
        setTimeout(() => {
          invoke("exit_app");
        }, 1500);
      }
      
      setShowUpdateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download update");
      console.error("Download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCancelUpdate = () => {
    setShowUpdateModal(false);
  };

  // Theme handlers
  const updateThemeColor = (key: keyof ThemeColors, color: string) => {
    const updatedTheme = { ...theme, [key]: color };
    setTheme(updatedTheme);
    saveTheme(updatedTheme);
    applyTheme(updatedTheme);
    // Clear selected preset when manually editing colors
    setSelectedPresetId(null);
  };

  const handleResetTheme = () => {
    if (confirm("Reset all theme colors to defaults? This cannot be undone.")) {
      resetTheme();
      setTheme(defaultTheme);
    }
  };

  // Load theme on mount
  useEffect(() => {
    const loadedTheme = loadTheme();
    setTheme(loadedTheme);
    applyTheme(loadedTheme);
    setPresets(getAllPresets());
  }, []);

  // Apply preset
  const handleApplyPreset = (presetId: string) => {
    const preset = getPresetById(presetId);
    if (preset) {
      setTheme(preset.colors);
      saveTheme(preset.colors);
      applyTheme(preset.colors);
      setSelectedPresetId(presetId);
    }
  };

  // Save current theme as preset
  const handleSavePreset = () => {
    if (!presetName.trim()) {
      alert("Please enter a name for your preset");
      return;
    }
    const newPreset = createPresetFromCurrentTheme(presetName.trim());
    setPresets(getAllPresets());
    setShowSavePresetModal(false);
    setPresetName("");
    setSelectedPresetId(newPreset.id);
  };

  // Delete custom preset
  const handleDeletePreset = (presetId: string) => {
    const preset = getPresetById(presetId);
    if (preset && preset.isCustom) {
      if (confirm(`Delete preset "${preset.name}"?`)) {
        deleteCustomPreset(presetId);
        setPresets(getAllPresets());
        if (selectedPresetId === presetId) {
          setSelectedPresetId(null);
        }
      }
    }
  };

  // Start editing preset name
  const handleStartEditPreset = (presetId: string) => {
    const preset = getPresetById(presetId);
    if (preset && preset.isCustom) {
      setEditingPresetId(presetId);
      setEditingPresetName(preset.name);
    }
  };

  // Save edited preset name
  const handleSaveEditPreset = () => {
    if (!editingPresetId || !editingPresetName.trim()) return;
    const preset = getPresetById(editingPresetId);
    if (preset && preset.isCustom) {
      const updated: ThemePreset = {
        ...preset,
        name: editingPresetName.trim(),
      };
      saveCustomPreset(updated);
      setPresets(getAllPresets());
      setEditingPresetId(null);
      setEditingPresetName("");
    }
  };

  // Cancel editing
  const handleCancelEditPreset = () => {
    setEditingPresetId(null);
    setEditingPresetName("");
  };

  // Password handlers
  const handleNewPinDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(0, 1);
    const newDigits = [...newPinDigits];
    newDigits[index] = digit;
    setNewPinDigits(newDigits);
    setPasswordError("");
    if (digit && index < 5 && newPasswordInputRefs.current[index + 1]) {
      newPasswordInputRefs.current[index + 1].focus();
    }
  };

  const handleConfirmPinDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(0, 1);
    const newDigits = [...confirmPinDigits];
    newDigits[index] = digit;
    setConfirmPinDigits(newDigits);
    setPasswordError("");
    if (digit && index < 5 && confirmPasswordInputRefs.current[index + 1]) {
      confirmPasswordInputRefs.current[index + 1].focus();
    }
  };

  const handleRemovePinDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(0, 1);
    const newDigits = [...removePinDigits];
    newDigits[index] = digit;
    setRemovePinDigits(newDigits);
    setPasswordError("");
    if (digit && index < 5 && removePasswordInputRefs.current[index + 1]) {
      removePasswordInputRefs.current[index + 1].focus();
    }
  };

  const handleSetPassword = () => {
    setPasswordError("");
    setPasswordSuccess("");
    
    const passwordValue = passwordType === "pin" ? newPinDigits.join("") : newPassword;
    const confirmValue = passwordType === "pin" ? confirmPinDigits.join("") : confirmPassword;
    
    if (!passwordValue.trim()) {
      setPasswordError(`Please enter a ${passwordType === "pin" ? "PIN" : "password"}`);
      return;
    }
    
    if (passwordType === "pin" && !/^\d{6}$/.test(passwordValue)) {
      setPasswordError("PIN must be exactly 6 digits");
      return;
    }
    
    if (passwordType === "password" && passwordValue.length < 4) {
      setPasswordError("Password must be at least 4 characters");
      return;
    }
    
    if (passwordValue !== confirmValue) {
      setPasswordError(`${passwordType === "pin" ? "PINs" : "Passwords"} do not match`);
      return;
    }
    
    try {
      setPassword(passwordValue, passwordType);
      setPasswordSuccess(`${passwordType === "pin" ? "PIN" : "Password"} set successfully!`);
      setNewPassword("");
      setNewPinDigits(["", "", "", "", "", ""]);
      setConfirmPassword("");
      setConfirmPinDigits(["", "", "", "", "", ""]);
      setTimeout(() => {
        setPasswordSuccess("");
      }, 3000);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Failed to set password");
    }
  };

  const handleChangePassword = () => {
    setPasswordError("");
    setPasswordSuccess("");
    setNewPassword("");
    setNewPinDigits(["", "", "", "", "", ""]);
    setConfirmPassword("");
    setConfirmPinDigits(["", "", "", "", "", ""]);
  };

  const handleRemovePassword = () => {
    if (!hasPassword()) {
      setPasswordError("No password is currently set");
      return;
    }
    setShowRemoveConfirm(true);
    setPasswordError("");
    setRemoveVerification("");
    setRemovePinDigits(["", "", "", "", "", ""]);
    // Focus first input after a brief delay to ensure modal is rendered
    setTimeout(() => {
      if (getPasswordType() === "pin" && removePasswordInputRefs.current[0]) {
        removePasswordInputRefs.current[0].focus();
      }
    }, 100);
  };

  const handleConfirmRemovePassword = () => {
    setPasswordError("");
    const currentType = getPasswordType();
    const verificationValue = currentType === "pin" ? removePinDigits.join("") : removeVerification;
    
    if (!verificationValue.trim()) {
      setPasswordError(`Please enter your current ${currentType === "pin" ? "PIN" : "password"} to remove it`);
      return;
    }
    
    if (!verifyPassword(verificationValue)) {
      setPasswordError(`Incorrect ${currentType === "pin" ? "PIN" : "password"}`);
      setRemoveVerification("");
      setRemovePinDigits(["", "", "", "", "", ""]);
      return;
    }
    
    deletePassword();
    setPasswordSuccess("Password removed successfully!");
    setShowRemoveConfirm(false);
    setRemoveVerification("");
    setRemovePinDigits(["", "", "", "", "", ""]);
    setNewPassword("");
    setNewPinDigits(["", "", "", "", "", ""]);
    setConfirmPassword("");
    setConfirmPinDigits(["", "", "", "", "", ""]);
    setTimeout(() => {
      setPasswordSuccess("");
    }, 3000);
  };

  return (
    <div
      style={{
        padding: "24px",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
          }}
        >
          <SettingsIcon size={28} color="var(--accent)" />
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "600",
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Settings
          </h1>
        </div>

        {/* Theme Customization Section */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Palette size={20} />
              Theme Customization
            </h2>
            <button
              onClick={handleResetTheme}
              style={{
                padding: "8px 16px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <RotateCcw size={14} />
              Reset to Defaults
            </button>
          </div>

          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "24px",
              lineHeight: "1.6",
            }}
          >
            Customize the appearance of TradeButler by adjusting the color scheme. Changes are applied immediately.
          </p>

          {/* Preset Selector */}
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "8px" }}>
              Theme Presets
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 12px",
                    backgroundColor: selectedPresetId === preset.id ? "var(--accent)" : "var(--bg-tertiary)",
                    border: `1px solid ${selectedPresetId === preset.id ? "var(--accent)" : "var(--border-color)"}`,
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onClick={() => handleApplyPreset(preset.id)}
                >
                  <span style={{ fontSize: "13px", color: selectedPresetId === preset.id ? "white" : "var(--text-primary)" }}>
                    {editingPresetId === preset.id ? (
                      <input
                        type="text"
                        value={editingPresetName}
                        onChange={(e) => setEditingPresetName(e.target.value)}
                        onBlur={handleSaveEditPreset}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEditPreset();
                          if (e.key === "Escape") handleCancelEditPreset();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          padding: "2px 6px",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                          width: "120px",
                        }}
                        autoFocus
                      />
                    ) : (
                      preset.name
                    )}
                  </span>
                  {preset.isCustom && editingPresetId !== preset.id && (
                    <>
                      <Edit2
                        size={12}
                        style={{ color: selectedPresetId === preset.id ? "white" : "var(--text-secondary)", cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditPreset(preset.id);
                        }}
                      />
                      <Trash2
                        size={12}
                        style={{ color: selectedPresetId === preset.id ? "white" : "var(--text-secondary)", cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePreset(preset.id);
                        }}
                      />
                    </>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowSavePresetModal(true)}
              style={{
                padding: "8px 16px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Save size={14} />
              Save Current Theme as Preset
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
            {/* Background Colors */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                Background Colors
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Primary Background
                  </label>
                  <ColorPicker
                    value={theme.bgPrimary}
                    onChange={(color) => updateThemeColor("bgPrimary", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Secondary Background
                  </label>
                  <ColorPicker
                    value={theme.bgSecondary}
                    onChange={(color) => updateThemeColor("bgSecondary", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Tertiary Background
                  </label>
                  <ColorPicker
                    value={theme.bgTertiary}
                    onChange={(color) => updateThemeColor("bgTertiary", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Hover Background
                  </label>
                  <ColorPicker
                    value={theme.bgHover}
                    onChange={(color) => updateThemeColor("bgHover", color)}
                  />
                </div>
              </div>
            </div>

            {/* Text & Border Colors */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                Text & Border
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Primary Text
                  </label>
                  <ColorPicker
                    value={theme.textPrimary}
                    onChange={(color) => updateThemeColor("textPrimary", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Secondary Text
                  </label>
                  <ColorPicker
                    value={theme.textSecondary}
                    onChange={(color) => updateThemeColor("textSecondary", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Border Color
                  </label>
                  <ColorPicker
                    value={theme.borderColor}
                    onChange={(color) => updateThemeColor("borderColor", color)}
                  />
                </div>
              </div>
            </div>

            {/* Accent Colors */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                Accent Colors
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Accent
                  </label>
                  <ColorPicker
                    value={theme.accent}
                    onChange={(color) => updateThemeColor("accent", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Accent Hover
                  </label>
                  <ColorPicker
                    value={theme.accentHover}
                    onChange={(color) => updateThemeColor("accentHover", color)}
                  />
                </div>
              </div>
            </div>

            {/* Status Colors */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                Status Colors
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Success
                  </label>
                  <ColorPicker
                    value={theme.success}
                    onChange={(color) => updateThemeColor("success", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Danger
                  </label>
                  <ColorPicker
                    value={theme.danger}
                    onChange={(color) => updateThemeColor("danger", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Warning
                  </label>
                  <ColorPicker
                    value={theme.warning}
                    onChange={(color) => updateThemeColor("warning", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Profit
                  </label>
                  <ColorPicker
                    value={theme.profit}
                    onChange={(color) => updateThemeColor("profit", color)}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Loss
                  </label>
                  <ColorPicker
                    value={theme.loss}
                    onChange={(color) => updateThemeColor("loss", color)}
                  />
                </div>
              </div>
            </div>

            {/* Lock Screen Style */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "12px" }}>
                Lock Screen Style
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Lock Screen Theme
                  </label>
                  <div
                    style={{
                      display: "flex",
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "6px",
                      padding: "2px",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const newStyle: LockScreenStyle = "default";
                        setLockScreenStyle(newStyle);
                        saveLockScreenStyle(newStyle);
                      }}
                      style={{
                        flex: 1,
                        padding: "10px",
                        borderRadius: "4px",
                        fontSize: "14px",
                        fontWeight: "500",
                        cursor: "pointer",
                        border: "none",
                        backgroundColor: lockScreenStyle === "default" ? "var(--accent)" : "transparent",
                        color: lockScreenStyle === "default" ? "white" : "var(--text-primary)",
                        transition: "all 0.2s",
                      }}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newStyle: LockScreenStyle = "galaxy";
                        setLockScreenStyle(newStyle);
                        saveLockScreenStyle(newStyle);
                      }}
                      style={{
                        flex: 1,
                        padding: "10px",
                        borderRadius: "4px",
                        fontSize: "14px",
                        fontWeight: "500",
                        cursor: "pointer",
                        border: "none",
                        backgroundColor: lockScreenStyle === "galaxy" ? "var(--accent)" : "transparent",
                        color: lockScreenStyle === "galaxy" ? "white" : "var(--text-primary)",
                        transition: "all 0.2s",
                      }}
                    >
                      Galaxy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Password/PIN Lock Section */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2
              style={{
                fontSize: "20px",
                fontWeight: "600",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Lock size={20} />
              App Lock
            </h2>
          </div>

          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "24px",
              lineHeight: "1.6",
            }}
          >
            Set a password or 6-digit PIN to lock your TradeButler app. Use the lock button in the sidebar to lock/unlock the app.
          </p>

          {hasPassword() && (
            <div
              style={{
                padding: "12px 16px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <CheckCircle size={16} color="var(--profit)" />
              <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                {getPasswordType() === "pin" ? "6-digit PIN" : "Password"} is set
              </span>
            </div>
          )}

          {/* Password Type Toggle */}
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "8px" }}>
              Lock Type
            </label>
            <div
              style={{
                display: "flex",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                padding: "2px",
                border: "1px solid var(--border-color)",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setPasswordType("pin");
                  setNewPassword("");
                  setNewPinDigits(["", "", "", "", "", ""]);
                  setConfirmPassword("");
                  setConfirmPinDigits(["", "", "", "", "", ""]);
                  setPasswordError("");
                }}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: passwordType === "pin" ? "var(--accent)" : "transparent",
                  color: passwordType === "pin" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                6-Digit PIN
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordType("password");
                  setNewPassword("");
                  setNewPinDigits(["", "", "", "", "", ""]);
                  setConfirmPassword("");
                  setConfirmPinDigits(["", "", "", "", "", ""]);
                  setPasswordError("");
                }}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                  border: "none",
                  backgroundColor: passwordType === "password" ? "var(--accent)" : "transparent",
                  color: passwordType === "password" ? "white" : "var(--text-primary)",
                  transition: "all 0.2s",
                }}
              >
                Password
              </button>
            </div>
          </div>

          {/* Password Input Fields */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "8px" }}>
              {hasPassword() ? "New " : ""}{passwordType === "pin" ? "PIN" : "Password"}
            </label>
            {passwordType === "pin" ? (
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    justifyContent: "center",
                    marginBottom: "8px",
                  }}
                >
                  {newPinDigits.map((digit, index) => (
                    <div
                      key={index}
                      style={{
                        width: "50px",
                        height: "60px",
                        position: "relative",
                        backgroundColor: "var(--bg-tertiary)",
                        border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s",
                      }}
                    >
                      {showNewPin ? (
                        <span
                          style={{
                            fontSize: "28px",
                            fontFamily: "monospace",
                            fontWeight: "600",
                            color: "var(--text-primary)",
                          }}
                        >
                          {digit || ""}
                        </span>
                      ) : (
                        <div
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: digit ? "var(--text-primary)" : "transparent",
                            border: digit ? "none" : "2px solid var(--border-color)",
                          }}
                        />
                      )}
                      <input
                        ref={(el) => (newPasswordInputRefs.current[index] = el)}
                        type="tel"
                        inputMode="numeric"
                        value={digit}
                        onChange={(e) => handleNewPinDigitChange(index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !digit && index > 0 && newPasswordInputRefs.current[index - 1]) {
                            newPasswordInputRefs.current[index - 1].focus();
                          }
                        }}
                        maxLength={1}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          opacity: 0,
                          cursor: "pointer",
                          fontSize: "28px",
                          textAlign: "center",
                          fontFamily: "monospace",
                          outline: "none",
                        }}
                        onFocus={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = "var(--accent)";
                            container.style.borderWidth = "2px";
                          }
                        }}
                        onBlur={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = passwordError ? "var(--danger)" : "var(--border-color)";
                            container.style.borderWidth = "1px";
                          }
                        }}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewPin(!showNewPin)}
                  style={{
                    position: "absolute",
                    right: "0",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-secondary)",
                  }}
                >
                  {showNewPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordError("");
                  }}
                  placeholder="Enter password"
                  style={{
                    width: "100%",
                    padding: "12px 40px 12px 12px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                    fontSize: "16px",
                    outline: "none",
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-secondary)",
                  }}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "var(--text-primary)", marginBottom: "8px" }}>
              Confirm {passwordType === "pin" ? "PIN" : "Password"}
            </label>
            {passwordType === "pin" ? (
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    justifyContent: "center",
                    marginBottom: "8px",
                  }}
                >
                  {confirmPinDigits.map((digit, index) => (
                    <div
                      key={index}
                      style={{
                        width: "50px",
                        height: "60px",
                        position: "relative",
                        backgroundColor: "var(--bg-tertiary)",
                        border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s",
                      }}
                    >
                      {showConfirmPin ? (
                        <span
                          style={{
                            fontSize: "28px",
                            fontFamily: "monospace",
                            fontWeight: "600",
                            color: "var(--text-primary)",
                          }}
                        >
                          {digit || ""}
                        </span>
                      ) : (
                        <div
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: digit ? "var(--text-primary)" : "transparent",
                            border: digit ? "none" : "2px solid var(--border-color)",
                          }}
                        />
                      )}
                      <input
                        ref={(el) => (confirmPasswordInputRefs.current[index] = el)}
                        type="tel"
                        inputMode="numeric"
                        value={digit}
                        onChange={(e) => handleConfirmPinDigitChange(index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !digit && index > 0 && confirmPasswordInputRefs.current[index - 1]) {
                            confirmPasswordInputRefs.current[index - 1].focus();
                          }
                        }}
                        maxLength={1}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          opacity: 0,
                          cursor: "pointer",
                          fontSize: "28px",
                          textAlign: "center",
                          fontFamily: "monospace",
                          outline: "none",
                        }}
                        onFocus={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = "var(--accent)";
                            container.style.borderWidth = "2px";
                          }
                        }}
                        onBlur={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = passwordError ? "var(--danger)" : "var(--border-color)";
                            container.style.borderWidth = "1px";
                          }
                        }}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmPin(!showConfirmPin)}
                  style={{
                    position: "absolute",
                    right: "0",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-secondary)",
                  }}
                >
                  {showConfirmPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError("");
                  }}
                  placeholder="Confirm password"
                  style={{
                    width: "100%",
                    padding: "12px 40px 12px 12px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                    fontSize: "16px",
                    outline: "none",
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    color: "var(--text-secondary)",
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}
          </div>

          {passwordError && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--danger)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "var(--danger)",
                fontSize: "13px",
              }}
            >
              <AlertCircle size={16} />
              <span>{passwordError}</span>
            </div>
          )}

          {passwordSuccess && (
            <div
              style={{
                marginBottom: "16px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--profit)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "var(--profit)",
                fontSize: "13px",
              }}
            >
              <CheckCircle size={16} />
              <span>{passwordSuccess}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            {hasPassword() ? (
              <button
                type="button"
                onClick={handleRemovePassword}
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <Trash2 size={16} />
                Remove {getPasswordType() === "pin" ? "PIN" : "Password"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSetPassword}
                disabled={
                  passwordType === "pin"
                    ? newPinDigits.join("").length !== 6 || confirmPinDigits.join("").length !== 6
                    : !newPassword || !confirmPassword
                }
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor:
                    passwordType === "pin"
                      ? newPinDigits.join("").length === 6 && confirmPinDigits.join("").length === 6
                        ? "var(--accent)"
                        : "var(--bg-tertiary)"
                      : newPassword && confirmPassword
                      ? "var(--accent)"
                      : "var(--bg-tertiary)",
                  color:
                    passwordType === "pin"
                      ? newPinDigits.join("").length === 6 && confirmPinDigits.join("").length === 6
                        ? "white"
                        : "var(--text-secondary)"
                      : newPassword && confirmPassword
                      ? "white"
                      : "var(--text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  cursor:
                    passwordType === "pin"
                      ? newPinDigits.join("").length === 6 && confirmPinDigits.join("").length === 6
                        ? "pointer"
                        : "not-allowed"
                      : newPassword && confirmPassword
                      ? "pointer"
                      : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  opacity:
                    passwordType === "pin"
                      ? newPinDigits.join("").length === 6 && confirmPinDigits.join("").length === 6
                        ? 1
                        : 0.5
                      : newPassword && confirmPassword
                      ? 1
                      : 0.5,
                }}
              >
                <Lock size={16} />
                Set {passwordType === "pin" ? "PIN" : "Password"}
              </button>
            )}
          </div>

          {/* Remove Password Verification Modal */}
          {showRemoveConfirm && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "var(--bg-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10000,
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "400px",
                  padding: "40px",
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                }}
              >
                <div style={{ textAlign: "center", marginBottom: "32px" }}>
                  <h3
                    style={{
                      fontSize: "24px",
                      fontWeight: "bold",
                      marginBottom: "8px",
                      color: "var(--text-primary)",
                    }}
                  >
                    Verify {getPasswordType() === "pin" ? "PIN" : "Password"} to Remove
                  </h3>
                  <p
                    style={{
                      fontSize: "14px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Please enter your current {getPasswordType() === "pin" ? "PIN" : "password"} to confirm removal.
                  </p>
                </div>

                {getPasswordType() === "pin" ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      justifyContent: "center",
                      marginBottom: "20px",
                      padding: "0 20px",
                    }}
                  >
                    {removePinDigits.map((digit, index) => (
                      <div
                        key={index}
                        style={{
                          width: "50px",
                          height: "60px",
                          position: "relative",
                          backgroundColor: "var(--bg-tertiary)",
                          border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.2s",
                          boxSizing: "border-box",
                          flexShrink: 0,
                        }}
                      >
                        {digit && (
                          <div
                            style={{
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              backgroundColor: "var(--text-primary)",
                              position: "absolute",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <input
                          ref={(el) => (removePasswordInputRefs.current[index] = el)}
                          type="tel"
                          inputMode="numeric"
                          value={digit}
                          onChange={(e) => handleRemovePinDigitChange(index, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Backspace" && !digit && index > 0 && removePasswordInputRefs.current[index - 1]) {
                              removePasswordInputRefs.current[index - 1].focus();
                            }
                          }}
                          maxLength={1}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: "100%",
                            padding: "0",
                            margin: "0",
                            opacity: 0,
                            cursor: "pointer",
                            fontSize: "28px",
                            textAlign: "center",
                            fontFamily: "monospace",
                            fontWeight: "600",
                            outline: "none",
                            border: "none",
                            backgroundColor: "transparent",
                            boxSizing: "border-box",
                          }}
                          onFocus={(e) => {
                            const container = e.target.parentElement;
                            if (container) {
                              container.style.borderColor = "var(--accent)";
                              container.style.borderWidth = "2px";
                            }
                          }}
                          onBlur={(e) => {
                            const container = e.target.parentElement;
                            if (container) {
                              container.style.borderColor = passwordError ? "var(--danger)" : "var(--border-color)";
                              container.style.borderWidth = "1px";
                            }
                          }}
                          autoComplete="off"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ position: "relative", marginBottom: "20px" }}>
                    <input
                      type="password"
                      value={removeVerification}
                      onChange={(e) => {
                        setRemoveVerification(e.target.value);
                        setPasswordError("");
                      }}
                      placeholder="Enter current password"
                      style={{
                        width: "100%",
                        padding: "12px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: passwordError ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                        borderRadius: "8px",
                        color: "var(--text-primary)",
                        fontSize: "16px",
                        outline: "none",
                      }}
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                )}

                {passwordError && (
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "12px",
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--danger)",
                      borderRadius: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--danger)",
                      fontSize: "13px",
                    }}
                  >
                    <AlertCircle size={16} />
                    <span>{passwordError}</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRemoveConfirm(false);
                      setRemoveVerification("");
                      setRemovePinDigits(["", "", "", "", "", ""]);
                      setPasswordError("");
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmRemovePassword}
                    disabled={
                      getPasswordType() === "pin"
                        ? removePinDigits.join("").length !== 6
                        : !removeVerification.trim()
                    }
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor:
                        getPasswordType() === "pin"
                          ? removePinDigits.join("").length === 6
                            ? "var(--danger)"
                            : "var(--bg-tertiary)"
                          : removeVerification.trim()
                          ? "var(--danger)"
                          : "var(--bg-tertiary)",
                      color:
                        getPasswordType() === "pin"
                          ? removePinDigits.join("").length === 6
                            ? "white"
                            : "var(--text-secondary)"
                          : removeVerification.trim()
                          ? "white"
                          : "var(--text-secondary)",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor:
                        getPasswordType() === "pin"
                          ? removePinDigits.join("").length === 6
                            ? "pointer"
                            : "not-allowed"
                          : removeVerification.trim()
                          ? "pointer"
                          : "not-allowed",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      opacity:
                        getPasswordType() === "pin"
                          ? removePinDigits.join("").length === 6
                            ? 1
                            : 0.5
                          : removeVerification.trim()
                          ? 1
                          : 0.5,
                    }}
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Version Checker Section */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <RefreshCw size={20} />
            Version Checker
          </h2>

          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "20px",
              lineHeight: "1.6",
            }}
          >
            Check if you're running the latest version of TradeButler. Updates preserve all your data.
          </p>

          <button
            onClick={checkVersion}
            disabled={isChecking}
            style={{
              padding: "12px 24px",
              backgroundColor: "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isChecking ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: "500",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: isChecking ? 0.6 : 1,
            }}
          >
            {isChecking ? (
              <>
                <RefreshCw size={16} className="spinning" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Check for Updates
              </>
            )}
          </button>

          {error && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "var(--loss)",
              }}
            >
              <AlertCircle size={16} />
              <span style={{ fontSize: "14px" }}>{error}</span>
            </div>
          )}

          {versionInfo && (
            <div
                style={{
                marginTop: "20px",
                padding: "16px",
                backgroundColor: versionInfo.is_up_to_date 
                  ? "rgba(34, 197, 94, 0.1)" 
                  : "rgba(251, 191, 36, 0.1)",
                border: `1px solid ${versionInfo.is_up_to_date 
                  ? "rgba(34, 197, 94, 0.3)" 
                  : "rgba(251, 191, 36, 0.3)"}`,
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "12px",
                }}
              >
                {versionInfo.is_up_to_date ? (
                  <CheckCircle size={20} color="rgb(34, 197, 94)" />
                ) : (
                  <XCircle size={20} color="rgb(251, 191, 36)" />
                )}
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "600",
                    color: versionInfo.is_up_to_date 
                      ? "rgb(34, 197, 94)" 
                      : "rgb(251, 191, 36)",
                  }}
                >
                  {versionInfo.is_up_to_date 
                    ? "You're up to date!" 
                    : "Update available"}
                </span>
              </div>

              <div
                style={{
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  lineHeight: "1.8",
                }}
              >
                <div>
                  <strong>Current Version:</strong> {versionInfo.current}
                </div>
                <div>
                  <strong>Latest Version:</strong> {versionInfo.latest}
                </div>
                <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
                  <strong>Installation Type:</strong> {versionInfo.is_installer ? "Installer" : "Portable"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Update Available Modal */}
      {showUpdateModal && versionInfo && !versionInfo.is_up_to_date && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={handleCancelUpdate}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "500px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "20px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Download size={20} color="var(--accent)" />
              Update Available
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "16px",
                lineHeight: "1.5",
              }}
            >
              A new version of TradeButler is available!
            </p>
            <div
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                lineHeight: "1.6",
              }}
            >
              <div><strong>Current:</strong> {versionInfo.current}</div>
              <div><strong>Latest:</strong> {versionInfo.latest}</div>
              {versionInfo.release_notes && (
                <div style={{ marginTop: "12px" }}>
                  <strong>What's New:</strong>
                  <div
                    style={{
                      marginTop: "4px",
                      maxHeight: "200px",
                      overflowY: "auto",
                      overflowX: "hidden",
                      padding: "8px",
                      backgroundColor: "var(--bg-primary)",
                      borderRadius: "4px",
                      border: "1px solid var(--border-color)",
                      fontSize: "12px",
                      lineHeight: "1.5",
                    }}
                  >
                    <ReactMarkdown
                      components={{
                        h1: ({node, ...props}) => <h1 style={{ fontSize: "16px", fontWeight: "bold", margin: "8px 0 4px 0", color: "var(--text-primary)" }} {...props} />,
                        h2: ({node, ...props}) => <h2 style={{ fontSize: "14px", fontWeight: "bold", margin: "8px 0 4px 0", color: "var(--text-primary)" }} {...props} />,
                        h3: ({node, ...props}) => <h3 style={{ fontSize: "13px", fontWeight: "bold", margin: "6px 0 4px 0", color: "var(--text-primary)" }} {...props} />,
                        p: ({node, ...props}) => <p style={{ margin: "4px 0", color: "var(--text-secondary)" }} {...props} />,
                        strong: ({node, ...props}) => <strong style={{ fontWeight: "bold", color: "var(--text-primary)" }} {...props} />,
                        em: ({node, ...props}) => <em style={{ fontStyle: "italic" }} {...props} />,
                        ul: ({node, ...props}) => <ul style={{ margin: "4px 0", paddingLeft: "20px", color: "var(--text-secondary)" }} {...props} />,
                        ol: ({node, ...props}) => <ol style={{ margin: "4px 0", paddingLeft: "20px", color: "var(--text-secondary)" }} {...props} />,
                        li: ({node, ...props}) => <li style={{ margin: "2px 0" }} {...props} />,
                        code: ({node, ...props}) => <code style={{ backgroundColor: "var(--bg-tertiary)", padding: "2px 4px", borderRadius: "3px", fontSize: "11px", fontFamily: "monospace", color: "var(--accent)" }} {...props} />,
                        a: ({node, ...props}) => <a style={{ color: "var(--accent)", textDecoration: "underline" }} {...props} />,
                      }}
                    >
                      {versionInfo.release_notes}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
                fontStyle: "italic",
              }}
            >
              {versionInfo.is_installer 
                ? "The installer will update your application. Your data will be preserved."
                : "The new version will download and launch automatically. This window will close, and the old version will be automatically deleted. Your data will be preserved."}
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleCancelUpdate}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Later
              </button>
              <button
                onClick={downloadUpdate}
                disabled={isDownloading}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: isDownloading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  opacity: isDownloading ? 0.6 : 1,
                }}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw size={16} className="spinning" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Download Update
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Save Preset Modal */}
      {showSavePresetModal && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => {
            setShowSavePresetModal(false);
            setPresetName("");
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "400px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "20px",
                fontWeight: "600",
                marginBottom: "16px",
                color: "var(--text-primary)",
              }}
            >
              Save Theme Preset
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                marginBottom: "16px",
              }}
            >
              Enter a name for your custom theme preset:
            </p>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="My Custom Theme"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
                if (e.key === "Escape") {
                  setShowSavePresetModal(false);
                  setPresetName("");
                }
              }}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "14px",
                marginBottom: "20px",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowSavePresetModal(false);
                  setPresetName("");
                }}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePreset}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
