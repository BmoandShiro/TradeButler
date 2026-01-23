import { useState, useEffect, useRef } from "react";
import { Lock, Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, hasPassword, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";

interface MilkyWayLockScreenProps {
  onUnlock: () => void;
}

interface Star {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  size: number;
  brightness: number;
}

export default function MilkyWayLockScreen({ onUnlock }: MilkyWayLockScreenProps) {
  const [input, setInput] = useState("");
  const [pinDigits, setPinDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const starsRef = useRef<Star[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const passwordType = getPasswordType();

  // Initialize stars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Recreate stars on resize
      const starCount = 2000;
      const stars: Star[] = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: (Math.random() - 0.5) * canvas.width * 2,
          y: (Math.random() - 0.5) * canvas.height * 2,
          z: Math.random() * 2000,
          vx: 0,
          vy: 0,
          size: Math.random() * 2 + 0.5,
          brightness: Math.random() * 0.8 + 0.2,
        });
      }
      starsRef.current = stars;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Create initial stars
    const starCount = 2000;
    const stars: Star[] = [];
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: (Math.random() - 0.5) * canvas.width * 2,
        y: (Math.random() - 0.5) * canvas.height * 2,
        z: Math.random() * 2000,
        vx: 0,
        vy: 0,
        size: Math.random() * 2 + 0.5,
        brightness: Math.random() * 0.8 + 0.2,
      });
    }
    starsRef.current = stars;

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Animation loop
    const animate = () => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const stars = starsRef.current;
      const mouse = mouseRef.current;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Update and draw stars
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Move star forward (toward viewer)
        star.z -= 2;

        // Reset star if it's too close
        if (star.z <= 0) {
          star.z = 2000;
          star.x = (Math.random() - 0.5) * canvas.width * 2;
          star.y = (Math.random() - 0.5) * canvas.height * 2;
        }

        // Calculate 2D position from 3D
        const perspective = 500;
        const scale = perspective / (perspective + star.z);
        const x2d = centerX + star.x * scale;
        const y2d = centerY + star.y * scale;

        // Calculate size and brightness based on distance
        const size = star.size * scale;
        const brightness = star.brightness * scale;

        // Draw star
        ctx.beginPath();
        ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
        
        // Star glow effect
        const starGradient = ctx.createRadialGradient(x2d, y2d, 0, x2d, y2d, size * 3);
        starGradient.addColorStop(0, `rgba(255, 255, 255, ${brightness})`);
        starGradient.addColorStop(0.5, `rgba(255, 255, 255, ${brightness * 0.5})`);
        starGradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
        ctx.fillStyle = starGradient;
        ctx.fill();

        // Draw star trail for fast-moving stars
        if (scale > 0.3) {
          const prevX = centerX + star.x * (perspective / (perspective + star.z + 10));
          const prevY = centerY + star.y * (perspective / (perspective + star.z + 10));
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x2d, y2d);
          ctx.strokeStyle = `rgba(255, 255, 255, ${brightness * 0.3})`;
          ctx.lineWidth = size * 0.5;
          ctx.stroke();
        }
      }

      // Draw nebula clouds (colored regions)
      const nebulaCount = 3;
      for (let n = 0; n < nebulaCount; n++) {
        const nebulaX = (canvas.width / nebulaCount) * (n + 0.5);
        const nebulaY = centerY + (Math.sin(Date.now() * 0.0001 + n) * 100);
        const nebulaGradient = ctx.createRadialGradient(nebulaX, nebulaY, 0, nebulaX, nebulaY, 300);
        
        if (n === 0) {
          // Purple nebula
          nebulaGradient.addColorStop(0, "rgba(138, 43, 226, 0.15)");
          nebulaGradient.addColorStop(1, "rgba(138, 43, 226, 0)");
        } else if (n === 1) {
          // Blue nebula
          nebulaGradient.addColorStop(0, "rgba(0, 191, 255, 0.12)");
          nebulaGradient.addColorStop(1, "rgba(0, 191, 255, 0)");
        } else {
          // Pink nebula
          nebulaGradient.addColorStop(0, "rgba(255, 20, 147, 0.1)");
          nebulaGradient.addColorStop(1, "rgba(255, 20, 147, 0)");
        }
        
        ctx.fillStyle = nebulaGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", handleMouseMove);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

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
    const digit = value.replace(/\D/g, "").slice(0, 1);
    const newDigits = [...pinDigits];
    newDigits[index] = digit;
    setPinDigits(newDigits);
    setError("");

    if (digit && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
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
      await invoke("clear_all_data");
      deletePassword();
      const themeColors = localStorage.getItem("tradebutler_theme_colors");
      const customPresets = localStorage.getItem("tradebutler_custom_theme_presets");
      localStorage.clear();
      if (themeColors) {
        localStorage.setItem("tradebutler_theme_colors", themeColors);
      }
      if (customPresets) {
        localStorage.setItem("tradebutler_custom_theme_presets", customPresets);
      }
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
        backgroundColor: "#000000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        overflow: "hidden",
      }}
    >
      {/* Milky Way Canvas Background */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
        }}
      />

      {/* Lock Screen Content */}
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          padding: "40px",
          backgroundColor: "rgba(10, 10, 20, 0.9)",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.7)",
          position: "relative",
          zIndex: 1,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              width: "80px",
              height: "80px",
              margin: "0 auto 20px",
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid rgba(255, 255, 255, 0.3)",
            }}
          >
            <Lock size={40} color="#ffffff" />
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px", color: "#ffffff" }}>
            TradeButler Locked
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.7)" }}>
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
                        backgroundColor: "rgba(10, 10, 20, 0.8)",
                        border: error ? "2px solid #ff4444" : "1px solid rgba(255, 255, 255, 0.3)",
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
                            backgroundColor: "#ffffff",
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
                            container.style.borderColor = "#ffffff";
                            container.style.borderWidth = "2px";
                          }
                        }}
                        onBlur={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = error ? "#ff4444" : "rgba(255, 255, 255, 0.3)";
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
                    backgroundColor: "rgba(10, 10, 20, 0.8)",
                    border: error ? "2px solid #ff4444" : "1px solid rgba(255, 255, 255, 0.3)",
                    borderRadius: "8px",
                    color: "#ffffff",
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
                    color: "#ff4444",
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
                  backgroundColor: "#ffffff",
                  color: "#000000",
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
                color: "rgba(255, 255, 255, 0.7)",
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
              <AlertCircle size={32} color="#ffaa00" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "#ffffff" }}>
                Forgot {passwordType === "pin" ? "PIN" : "Password"}?
              </h2>
              <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.7)", lineHeight: "1.5" }}>
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
                  backgroundColor: "rgba(10, 10, 20, 0.8)",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
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
                  backgroundColor: "#ff4444",
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
              <AlertCircle size={32} color="#ff4444" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "#ffffff" }}>
                Delete All Data?
              </h2>
              <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.7)", lineHeight: "1.5", marginBottom: "16px" }}>
                This will permanently delete ALL your data including:
              </p>
              <ul
                style={{
                  textAlign: "left",
                  fontSize: "13px",
                  color: "rgba(255, 255, 255, 0.7)",
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
              <p style={{ fontSize: "13px", color: "#ff4444", fontWeight: "600", marginBottom: "16px" }}>
                This action cannot be undone!
              </p>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "rgba(255, 255, 255, 0.7)",
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
                  backgroundColor: "rgba(10, 10, 20, 0.8)",
                  border: error ? "2px solid #ff4444" : "1px solid rgba(255, 255, 255, 0.3)",
                  borderRadius: "8px",
                  color: "#ffffff",
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
                    color: "#ff4444",
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
                  backgroundColor: "rgba(10, 10, 20, 0.8)",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
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
                  backgroundColor: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "#ff4444" : "rgba(10, 10, 20, 0.8)",
                  color: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "white" : "rgba(255, 255, 255, 0.5)",
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
