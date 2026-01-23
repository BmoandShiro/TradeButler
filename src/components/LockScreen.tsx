import { useState, useEffect, useRef } from "react";
import { Lock, Unlock, AlertCircle, Trash2, Eye, EyeOff } from "lucide-react";
import { unlockApp, hasPassword, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";

interface LockScreenProps {
  onUnlock: () => void;
}

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [input, setInput] = useState("");
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showPin, setShowPin] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordType = getPasswordType();

  useEffect(() => {
    // Focus first input on mount
    if (passwordType === "pin" && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    } else if (passwordType === "password" && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [passwordType]);

  // Auto-unlock when PIN is complete and correct
  useEffect(() => {
    if (passwordType === "pin") {
      const pinString = pinDigits.join("");
      if (pinString.length === 6) {
        // Small delay to ensure all digits are set
        const timer = setTimeout(() => {
          if (unlockApp(pinString)) {
            setPinDigits(["", "", "", "", "", ""]);
            onUnlock();
          } else {
            setError("Incorrect PIN");
            setPinDigits(["", "", "", "", "", ""]);
            if (inputRefs.current[0]) {
              inputRefs.current[0].focus();
            }
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [pinDigits, passwordType, onUnlock]);

  const handlePinDigitChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(0, 1);
    
    const newDigits = [...pinDigits];
    newDigits[index] = digit;
    setPinDigits(newDigits);
    setError("");

    // Auto-focus next input
    if (digit && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === "Backspace" && !pinDigits[index] && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
    // Handle paste
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        const digits = text.replace(/\D/g, "").slice(0, 6).split("");
        const newDigits = [...pinDigits];
        digits.forEach((digit, i) => {
          if (index + i < 6) {
            newDigits[index + i] = digit;
          }
        });
        setPinDigits(newDigits);
        // Focus the last filled input or the last input
        const lastFilledIndex = Math.min(index + digits.length - 1, 5);
        if (inputRefs.current[lastFilledIndex]) {
          inputRefs.current[lastFilledIndex].focus();
        }
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (passwordType === "pin") {
      const pinString = pinDigits.join("");
      if (pinString.length !== 6) {
        setError("Please enter your 6-digit PIN");
        return;
      }
      if (unlockApp(pinString)) {
        setPinDigits(["", "", "", "", "", ""]);
        onUnlock();
      } else {
        setError("Incorrect PIN");
        setPinDigits(["", "", "", "", "", ""]);
        if (inputRefs.current[0]) {
          inputRefs.current[0].focus();
        }
      }
    } else {
      if (!input.trim()) {
        setError("Please enter your password");
        return;
      }
      if (unlockApp(input)) {
        setInput("");
        onUnlock();
      } else {
        setError("Incorrect password");
        setInput("");
        if (passwordInputRef.current) {
          passwordInputRef.current.focus();
        }
      }
    }
  };

  const handleForgotPassword = () => {
    setShowForgotPassword(true);
  };

  const handleDeleteAllData = async () => {
    if (deleteConfirmText !== "I FORGOT MY PASSWORD I WILL LOSE ALL DATA") {
      setError("Please type 'I FORGOT MY PASSWORD I WILL LOSE ALL DATA' to confirm");
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
              {passwordType === "pin" ? (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    justifyContent: "center",
                    marginBottom: "16px",
                    padding: "0 20px",
                  }}
                >
                  {pinDigits.map((digit, index) => (
                    <div
                      key={index}
                      style={{
                        width: "50px",
                        height: "60px",
                        position: "relative",
                        backgroundColor: "var(--bg-tertiary)",
                        border: error ? "2px solid var(--danger)" : "1px solid var(--border-color)",
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
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="tel"
                        inputMode="numeric"
                        value={digit}
                        onChange={(e) => handlePinDigitChange(index, e.target.value)}
                        onKeyDown={(e) => handlePinKeyDown(index, e)}
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
                            container.style.borderColor = error ? "var(--danger)" : "var(--border-color)";
                            container.style.borderWidth = "1px";
                          }
                        }}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <input
                  ref={passwordInputRef}
                  type="password"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError("");
                  }}
                  placeholder="Enter password"
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: error ? "2px solid var(--danger)" : "1px solid var(--border-color)",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                    fontSize: "16px",
                    textAlign: "left",
                    outline: "none",
                  }}
                  autoComplete="off"
                />
              )}
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

            {passwordType === "password" && (
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
            )}

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
                Type <strong>I FORGOT MY PASSWORD I WILL LOSE ALL DATA</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => {
                  setDeleteConfirmText(e.target.value);
                  setError("");
                }}
                placeholder="I FORGOT MY PASSWORD I WILL LOSE ALL DATA"
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
                disabled={deleteConfirmText !== "I FORGOT MY PASSWORD I WILL LOSE ALL DATA"}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "var(--danger)" : "var(--bg-tertiary)",
                  color: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "white" : "var(--text-secondary)",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  opacity: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? 1 : 0.5,
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
