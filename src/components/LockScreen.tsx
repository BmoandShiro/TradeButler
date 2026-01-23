import { useState, useEffect, useRef } from "react";
import { Lock, Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, hasPassword, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordType = getPasswordType();

  useEffect(() => {
    // Focus input on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!input.trim()) {
      setError("Please enter your " + (passwordType === "pin" ? "PIN" : "password"));
      return;
    }

    if (unlockApp(input)) {
      setInput("");
      onUnlock();
    } else {
      setError("Incorrect " + (passwordType === "pin" ? "PIN" : "password"));
      setInput("");
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const handleForgotPassword = () => {
    setShowForgotPassword(true);
  };

  const handleDeleteAllData = async () => {
    if (deleteConfirmText !== "DELETE ALL DATA") {
      setError("Please type 'DELETE ALL DATA' to confirm");
      return;
    }

    try {
      // Delete all data from Rust backend
      await invoke("clear_all_data");
      
      // Delete password
      deletePassword();
      
      // Clear all localStorage (except theme if you want to keep it)
      const themeColors = localStorage.getItem("tradebutler_theme_colors");
      const customPresets = localStorage.getItem("tradebutler_custom_theme_presets");
      localStorage.clear();
      
      // Restore theme if it existed
      if (themeColors) {
        localStorage.setItem("tradebutler_theme_colors", themeColors);
      }
      if (customPresets) {
        localStorage.setItem("tradebutler_custom_theme_presets", customPresets);
      }
      
      // Reload the app
      window.location.reload();
    } catch (error) {
      console.error("Error deleting data:", error);
      setError("Failed to delete data: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  return (
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
          <div
            style={{
              width: "80px",
              height: "80px",
              margin: "0 auto 20px",
              backgroundColor: "var(--bg-tertiary)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--border-color)",
            }}
          >
            <Lock size={40} color="var(--accent)" />
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px", color: "var(--text-primary)" }}>
            TradeButler Locked
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
            Enter your {passwordType === "pin" ? "6-digit PIN" : "password"} to unlock
          </p>
        </div>

        {!showForgotPassword && !showDeleteConfirm && (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "16px" }}>
              <input
                ref={inputRef}
                type={passwordType === "pin" ? "tel" : "password"}
                value={input}
                onChange={(e) => {
                  const value = e.target.value;
                  if (passwordType === "pin") {
                    // Only allow digits and limit to 6
                    const digitsOnly = value.replace(/\D/g, "").slice(0, 6);
                    setInput(digitsOnly);
                  } else {
                    setInput(value);
                  }
                  setError("");
                }}
                placeholder={passwordType === "pin" ? "Enter 6-digit PIN" : "Enter password"}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: error ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: passwordType === "pin" ? "24px" : "16px",
                  textAlign: passwordType === "pin" ? "center" : "left",
                  letterSpacing: passwordType === "pin" ? "8px" : "normal",
                  fontFamily: passwordType === "pin" ? "monospace" : "inherit",
                  outline: "none",
                }}
                autoComplete="off"
                maxLength={passwordType === "pin" ? 6 : undefined}
              />
              {error && (
                <div
                  style={{
                    marginTop: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "var(--danger)",
                    fontSize: "13px",
                  }}
                >
                  <AlertCircle size={14} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontSize: "16px",
                fontWeight: "600",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <Unlock size={18} />
              Unlock
            </button>

            <button
              type="button"
              onClick={handleForgotPassword}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "transparent",
                color: "var(--text-secondary)",
                border: "none",
                fontSize: "13px",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Forgot {passwordType === "pin" ? "PIN" : "Password"}?
            </button>
          </form>
        )}

        {showForgotPassword && !showDeleteConfirm && (
          <div>
            <div style={{ marginBottom: "20px", textAlign: "center" }}>
              <AlertCircle size={32} color="var(--warning)" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
                Forgot {passwordType === "pin" ? "PIN" : "Password"}?
              </h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                If you've forgotten your {passwordType === "pin" ? "PIN" : "password"}, you can reset it by deleting all app data.
                This will remove all your trades, strategies, journal entries, and settings.
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setError("");
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
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: "var(--danger)",
                  color: "white",
                  border: "none",
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
                Delete All Data
              </button>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div>
            <div style={{ marginBottom: "20px", textAlign: "center" }}>
              <AlertCircle size={32} color="var(--danger)" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
                Delete All Data?
              </h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: "1.5", marginBottom: "16px" }}>
                This will permanently delete ALL your data including:
              </p>
              <ul
                style={{
                  textAlign: "left",
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  lineHeight: "1.8",
                  marginBottom: "20px",
                  paddingLeft: "20px",
                }}
              >
                <li>All trades</li>
                <li>All strategies</li>
                <li>All journal entries</li>
                <li>All emotional states</li>
                <li>All settings and preferences</li>
                <li>Your {passwordType === "PIN" ? "PIN" : "password"}</li>
              </ul>
              <p style={{ fontSize: "13px", color: "var(--danger)", fontWeight: "600", marginBottom: "16px" }}>
                This action cannot be undone!
              </p>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  fontWeight: "500",
                }}
              >
                Type <strong>DELETE ALL DATA</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => {
                  setDeleteConfirmText(e.target.value);
                  setError("");
                }}
                placeholder="DELETE ALL DATA"
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: error ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  outline: "none",
                }}
                autoFocus
              />
              {error && (
                <div
                  style={{
                    marginTop: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "var(--danger)",
                    fontSize: "12px",
                  }}
                >
                  <AlertCircle size={12} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                  setError("");
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
                onClick={handleDeleteAllData}
                disabled={deleteConfirmText !== "DELETE ALL DATA"}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: deleteConfirmText === "DELETE ALL DATA" ? "var(--danger)" : "var(--bg-tertiary)",
                  color: deleteConfirmText === "DELETE ALL DATA" ? "white" : "var(--text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: deleteConfirmText === "DELETE ALL DATA" ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  opacity: deleteConfirmText === "DELETE ALL DATA" ? 1 : 0.5,
                }}
              >
                <Trash2 size={16} />
                Delete Everything
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
