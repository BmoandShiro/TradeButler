import { useState, useEffect, useRef } from "react";
import { Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";
import { getSphereThemeSettings } from "../utils/sphereThemeManager";

interface SphereLockScreenProps {
  onUnlock: () => void;
}

interface SphereDot {
  baseX: number;
  baseY: number;
  baseZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
}

export default function SphereLockScreen({ onUnlock }: SphereLockScreenProps) {
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
  const dotsRef = useRef<SphereDot[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const angleRef = useRef(0);
  const settingsRef = useRef(getSphereThemeSettings());
  const passwordType = getPasswordType();

  // Update settings when they change
  useEffect(() => {
    settingsRef.current = getSphereThemeSettings();
  }, []);

  // Listen for storage changes to update settings dynamically
  useEffect(() => {
    const handleStorageChange = () => {
      const newSettings = getSphereThemeSettings();
      const oldSettings = settingsRef.current;
      settingsRef.current = newSettings;
      
      // Recreate dots if count changed
      const canvas = canvasRef.current;
      if (canvas && (oldSettings.rings !== newSettings.rings || oldSettings.dotsPerRing !== newSettings.dotsPerRing)) {
        const dots: SphereDot[] = [];
        for (let i = 0; i < newSettings.rings; i++) {
          const phi = Math.PI * (i / (newSettings.rings - 1));
          for (let j = 0; j < newSettings.dotsPerRing; j++) {
            const theta = (2 * Math.PI * j) / newSettings.dotsPerRing;
            const x = Math.sin(phi) * Math.cos(theta);
            const y = Math.cos(phi);
            const z = Math.sin(phi) * Math.sin(theta);
            dots.push({
              baseX: x,
              baseY: y,
              baseZ: z,
              x: x * newSettings.sphereRadius,
              y: y * newSettings.sphereRadius,
              z: z * newSettings.sphereRadius,
              vx: 0,
              vy: 0,
              vz: 0,
              radius: newSettings.dotSize,
            });
          }
        }
        dotsRef.current = dots;
      }
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(() => {
      const newSettings = getSphereThemeSettings();
      const oldSettings = settingsRef.current;
      if (JSON.stringify(newSettings) !== JSON.stringify(oldSettings)) {
        handleStorageChange();
      }
    }, 100);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Initialize sphere dots and animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Create sphere dots
    const settings = settingsRef.current;
    const dots: SphereDot[] = [];
    for (let i = 0; i < settings.rings; i++) {
      const phi = Math.PI * (i / (settings.rings - 1));
      for (let j = 0; j < settings.dotsPerRing; j++) {
        const theta = (2 * Math.PI * j) / settings.dotsPerRing;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        dots.push({
          baseX: x,
          baseY: y,
          baseZ: z,
          x: x * settings.sphereRadius,
          y: y * settings.sphereRadius,
          z: z * settings.sphereRadius,
          vx: 0,
          vy: 0,
          vz: 0,
          radius: settings.dotSize,
        });
      }
    }
    dotsRef.current = dots;

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Convert hex to RGB
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 59, g: 130, b: 246 };
    };

    // Animation loop
    const animate = () => {
      const settings = settingsRef.current;
      const dotColor = hexToRgb(settings.dotColor);
      const lineColor = hexToRgb(settings.lineColor);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Background
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const mouse = mouseRef.current;

      // Update rotation angle
      angleRef.current += settings.rotationSpeed;
      const angle = angleRef.current;

      // Calculate rotated positions and apply mouse interaction
      const projectedDots: Array<{ screenX: number; screenY: number; z: number; opacity: number; size: number }> = [];

      for (const dot of dotsRef.current) {
        // Rotate around Y axis
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        
        // Target position (rotated base position)
        const targetX = (dot.baseX * cosA - dot.baseZ * sinA) * settings.sphereRadius;
        const targetY = dot.baseY * settings.sphereRadius;
        const targetZ = (dot.baseX * sinA + dot.baseZ * cosA) * settings.sphereRadius;

        // Calculate screen position for mouse interaction
        const perspective = 1000 / (1000 + targetZ);
        const screenX = centerX + targetX * perspective;
        const screenY = centerY + targetY * perspective;

        // Mouse interaction - push dots away from cursor (or pull if reversed)
        const dx = screenX - mouse.x;
        const dy = screenY - mouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = 150;

        if (distance < minDistance && distance > 0) {
          const force = (minDistance - distance) / minDistance;
          const direction = settings.reverseMouseEffect ? -1 : 1;
          const pushX = (dx / distance) * force * settings.mouseForce * 50 * direction;
          const pushY = (dy / distance) * force * settings.mouseForce * 50 * direction;
          dot.vx += pushX;
          dot.vy += pushY;
        }

        // Spring force back to target position
        dot.vx += (targetX - dot.x) * settings.returnForce;
        dot.vy += (targetY - dot.y) * settings.returnForce;
        dot.vz += (targetZ - dot.z) * settings.returnForce;

        // Apply velocity with friction
        dot.x += dot.vx;
        dot.y += dot.vy;
        dot.z += dot.vz;
        dot.vx *= settings.friction;
        dot.vy *= settings.friction;
        dot.vz *= settings.friction;

        // Project to 2D
        const dotPerspective = 1000 / (1000 + dot.z);
        const dotScreenX = centerX + dot.x * dotPerspective;
        const dotScreenY = centerY + dot.y * dotPerspective;
        const opacity = 0.3 + 0.7 * ((dot.z + settings.sphereRadius) / (settings.sphereRadius * 2));
        const size = settings.dotSize * dotPerspective * 1.5;

        projectedDots.push({
          screenX: dotScreenX,
          screenY: dotScreenY,
          z: dot.z,
          opacity,
          size,
        });
      }

      // Sort by z-depth (back to front)
      projectedDots.sort((a, b) => a.z - b.z);

      // Draw connections between nearby dots
      if (settings.showConnections) {
        ctx.lineWidth = 1;
        for (let i = 0; i < projectedDots.length; i++) {
          for (let j = i + 1; j < projectedDots.length; j++) {
            const dx = projectedDots[i].screenX - projectedDots[j].screenX;
            const dy = projectedDots[i].screenY - projectedDots[j].screenY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < settings.connectionDistance) {
              const lineOpacity = (1 - distance / settings.connectionDistance) * 0.15 * Math.min(projectedDots[i].opacity, projectedDots[j].opacity);
              ctx.beginPath();
              ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${lineOpacity})`;
              ctx.moveTo(projectedDots[i].screenX, projectedDots[i].screenY);
              ctx.lineTo(projectedDots[j].screenX, projectedDots[j].screenY);
              ctx.stroke();
            }
          }
        }
      }

      // Draw dots
      for (const dot of projectedDots) {
        ctx.beginPath();
        ctx.arc(dot.screenX, dot.screenY, dot.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${dotColor.r}, ${dotColor.g}, ${dotColor.b}, ${dot.opacity})`;
        ctx.fill();
        
        // Glow effect
        if (settings.glowIntensity > 0) {
          ctx.beginPath();
          ctx.arc(dot.screenX, dot.screenY, dot.size * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${dotColor.r}, ${dotColor.g}, ${dotColor.b}, ${dot.opacity * settings.glowIntensity})`;
          ctx.fill();
        }
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
    if (passwordType === "pin" && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    } else if (passwordType === "password" && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, [passwordType]);

  useEffect(() => {
    if (passwordType === "pin") {
      const pinString = pinDigits.join("");
      if (pinString.length === 6) {
        const timer = setTimeout(async () => {
          const unlocked = await unlockApp(pinString);
          if (unlocked) {
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
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pinDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (passwordType === "pin") {
      const pinString = pinDigits.join("");
      if (pinString.length !== 6) {
        setError("Please enter your 6-digit PIN");
        return;
      }
      const unlocked = await unlockApp(pinString);
      if (unlocked) {
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
      const unlocked = await unlockApp(input);
      if (unlocked) {
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
        backgroundColor: "#050510",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        overflow: "hidden",
      }}
    >
      {/* Sphere Canvas Background */}
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
          backgroundColor: "rgba(20, 20, 30, 0.85)",
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 60px rgba(59, 130, 246, 0.1)",
          backdropFilter: "blur(20px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              width: "80px",
              height: "80px",
              margin: "0 auto 20px",
              backgroundColor: "rgba(59, 130, 246, 0.15)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid rgba(59, 130, 246, 0.3)",
              boxShadow: "0 0 30px rgba(59, 130, 246, 0.2)",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: "radial-gradient(circle at 30% 30%, var(--accent), transparent 70%)",
                boxShadow: "0 0 20px var(--accent)",
              }}
            />
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px", color: "#e0e0e0" }}>
            TradeButler Locked
          </h1>
          <p style={{ fontSize: "14px", color: "#a0a0a0" }}>
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
                        backgroundColor: "rgba(30, 30, 40, 0.8)",
                        border: error ? "2px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.15)",
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
                            backgroundColor: "var(--accent)",
                            boxShadow: "0 0 8px var(--accent)",
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
                            container.style.boxShadow = "0 0 12px var(--accent)";
                          }
                        }}
                        onBlur={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = error ? "#ef4444" : "rgba(255, 255, 255, 0.15)";
                            container.style.borderWidth = "1px";
                            container.style.boxShadow = "none";
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
                    backgroundColor: "rgba(30, 30, 40, 0.8)",
                    border: error ? "2px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "8px",
                    color: "#e0e0e0",
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
                    color: "#ef4444",
                    fontSize: "13px",
                    justifyContent: "center",
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
                  boxShadow: "0 0 20px rgba(59, 130, 246, 0.3)",
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
                color: "#a0a0a0",
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
              <AlertCircle size={32} color="#f59e0b" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "#e0e0e0" }}>
                Forgot {passwordType === "pin" ? "PIN" : "Password"}?
              </h2>
              <p style={{ fontSize: "14px", color: "#a0a0a0", lineHeight: "1.5" }}>
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
                  backgroundColor: "rgba(30, 30, 40, 0.8)",
                  color: "#e0e0e0",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
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
                  backgroundColor: "#ef4444",
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
              <AlertCircle size={32} color="#ef4444" style={{ marginBottom: "12px" }} />
              <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "#e0e0e0" }}>
                Delete All Data?
              </h2>
              <p style={{ fontSize: "14px", color: "#a0a0a0", lineHeight: "1.5", marginBottom: "16px" }}>
                This will permanently delete ALL your data including:
              </p>
              <ul
                style={{
                  textAlign: "left",
                  fontSize: "13px",
                  color: "#a0a0a0",
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
                <li>Your {passwordType === "pin" ? "PIN" : "password"}</li>
              </ul>
              <p style={{ fontSize: "13px", color: "#ef4444", fontWeight: "600", marginBottom: "16px" }}>
                This action cannot be undone!
              </p>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "13px",
                  color: "#a0a0a0",
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
                  backgroundColor: "rgba(30, 30, 40, 0.8)",
                  border: error ? "2px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  color: "#e0e0e0",
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
                    color: "#ef4444",
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
                  backgroundColor: "rgba(30, 30, 40, 0.8)",
                  color: "#e0e0e0",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
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
                  backgroundColor: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "#ef4444" : "rgba(30, 30, 40, 0.8)",
                  color: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "white" : "#a0a0a0",
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
