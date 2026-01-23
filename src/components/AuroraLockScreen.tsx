import { useState, useEffect, useRef } from "react";
import { Lock, Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, hasPassword, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";

interface AuroraLockScreenProps {
  onUnlock: () => void;
}

interface AuroraBand {
  y: number;
  speed: number;
  amplitude: number;
  frequency: number;
  phase: number;
  color: { r: number; g: number; b: number };
  opacity: number;
}

export default function AuroraLockScreen({ onUnlock }: AuroraLockScreenProps) {
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
  const auroraBandsRef = useRef<AuroraBand[]>([]);
  const starsRef = useRef<Array<{ x: number; y: number; brightness: number }>>([]);
  const timeRef = useRef(0);
  const passwordType = getPasswordType();

  // Initialize aurora bands and stars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Create aurora bands
      const bands: AuroraBand[] = [
        {
          y: canvas.height * 0.2,
          speed: 0.3,
          amplitude: 80,
          frequency: 0.002,
          phase: 0,
          color: { r: 0, g: 255, b: 150 }, // Green
          opacity: 0.25,
        },
        {
          y: canvas.height * 0.35,
          speed: 0.25,
          amplitude: 100,
          frequency: 0.0015,
          phase: Math.PI / 3,
          color: { r: 0, g: 200, b: 255 }, // Cyan
          opacity: 0.2,
        },
        {
          y: canvas.height * 0.5,
          speed: 0.2,
          amplitude: 120,
          frequency: 0.0012,
          phase: Math.PI / 2,
          color: { r: 138, g: 43, b: 226 }, // Purple
          opacity: 0.18,
        },
        {
          y: canvas.height * 0.65,
          speed: 0.35,
          amplitude: 90,
          frequency: 0.0018,
          phase: Math.PI,
          color: { r: 255, g: 20, b: 147 }, // Pink
          opacity: 0.15,
        },
      ];
      auroraBandsRef.current = bands;

      // Create background stars
      const stars: Array<{ x: number; y: number; brightness: number }> = [];
      for (let i = 0; i < 200; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          brightness: Math.random() * 0.8 + 0.2,
        });
      }
      starsRef.current = stars;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Create initial aurora bands
    const bands: AuroraBand[] = [
      {
        y: canvas.height * 0.2,
        speed: 0.3,
        amplitude: 80,
        frequency: 0.002,
        phase: 0,
        color: { r: 0, g: 255, b: 150 },
        opacity: 0.25,
      },
      {
        y: canvas.height * 0.35,
        speed: 0.25,
        amplitude: 100,
        frequency: 0.0015,
        phase: Math.PI / 3,
        color: { r: 0, g: 200, b: 255 },
        opacity: 0.2,
      },
      {
        y: canvas.height * 0.5,
        speed: 0.2,
        amplitude: 120,
        frequency: 0.0012,
        phase: Math.PI / 2,
        color: { r: 138, g: 43, b: 226 },
        opacity: 0.18,
      },
      {
        y: canvas.height * 0.65,
        speed: 0.35,
        amplitude: 90,
        frequency: 0.0018,
        phase: Math.PI,
        color: { r: 255, g: 20, b: 147 },
        opacity: 0.15,
      },
    ];
    auroraBandsRef.current = bands;

    // Create initial stars
    const stars: Array<{ x: number; y: number; brightness: number }> = [];
    for (let i = 0; i < 200; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        brightness: Math.random() * 0.8 + 0.2,
      });
    }
    starsRef.current = stars;

    // Animation loop
    const animate = () => {
      timeRef.current += 0.016; // ~60fps
      
      ctx.fillStyle = "#000011";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw stars
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(timeRef.current * 2 + star.x * 0.01) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(star.x, star.y, 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness * twinkle * 0.6})`;
        ctx.fill();
      });

      const bands = auroraBandsRef.current;

      // Draw aurora bands
      bands.forEach((band) => {
        // Update band position with smoother movement
        band.y += band.speed * Math.sin(timeRef.current * 0.3 + band.phase) * 0.3;
        if (band.y < -200) band.y = canvas.height + 200;
        if (band.y > canvas.height + 200) band.y = -200;

        // Create flowing wave pattern with smoother curves
        const points: Array<{ x: number; y: number }> = [];
        const segments = 400; // More segments for smoother curves
        
        for (let i = 0; i <= segments; i++) {
          const x = (canvas.width / segments) * i;
          // Smoother wave calculations with reduced frequency variations
          const wave1 = Math.sin(x * band.frequency + timeRef.current * 0.4 + band.phase) * band.amplitude;
          const wave2 = Math.sin(x * band.frequency * 1.5 + timeRef.current * 0.6 + band.phase) * (band.amplitude * 0.4);
          const wave3 = Math.sin(x * band.frequency * 0.7 + timeRef.current * 0.25 + band.phase) * (band.amplitude * 0.25);
          const y = band.y + wave1 + wave2 + wave3;
          points.push({ x, y });
        }

        // Draw aurora with gradient and glow
        for (let layer = 0; layer < 3; layer++) {
          const layerOpacity = band.opacity * (1 - layer * 0.4);
          const layerWidth = 180 - layer * 50;
          
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          
          // Create ultra-smooth curve through points using better control points
          for (let i = 1; i < points.length; i++) {
            const prev = points[Math.max(i - 1, 0)];
            const curr = points[i];
            const next = points[Math.min(i + 1, points.length - 1)];
            
            // Calculate smoother control points for more fluid curves
            const dx = (next.x - prev.x) * 0.3;
            const dy = (next.y - prev.y) * 0.3;
            
            const cp1x = prev.x + dx;
            const cp1y = prev.y + dy;
            const cp2x = curr.x - dx;
            const cp2y = curr.y - dy;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
          }

          // Draw top edge with same smooth wave pattern
          for (let i = points.length - 1; i >= 0; i--) {
            const point = points[i];
            const wave1 = Math.sin(point.x * band.frequency + timeRef.current * 0.4 + band.phase) * band.amplitude;
            const wave2 = Math.sin(point.x * band.frequency * 1.5 + timeRef.current * 0.6 + band.phase) * (band.amplitude * 0.4);
            const wave3 = Math.sin(point.x * band.frequency * 0.7 + timeRef.current * 0.25 + band.phase) * (band.amplitude * 0.25);
            const topY = band.y + wave1 + wave2 + wave3 - layerWidth;
            ctx.lineTo(point.x, topY);
          }
          
          ctx.closePath();

          // Create gradient for aurora with smoother fade
          const gradient = ctx.createLinearGradient(0, band.y - layerWidth, 0, band.y + layerWidth);
          const alpha = layerOpacity;
          gradient.addColorStop(0, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, 0)`);
          gradient.addColorStop(0.2, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${alpha * 0.15})`);
          gradient.addColorStop(0.4, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${alpha * 0.4})`);
          gradient.addColorStop(0.5, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${alpha * 0.6})`);
          gradient.addColorStop(0.6, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${alpha * 0.4})`);
          gradient.addColorStop(0.8, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${alpha * 0.15})`);
          gradient.addColorStop(1, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, 0)`);
          
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // Add subtle particle sparkles along the aurora
        for (let i = 0; i < 15; i++) {
          const sparkleX = (canvas.width / 15) * i + Math.sin(timeRef.current + i) * 50;
          const wave1 = Math.sin(sparkleX * band.frequency + timeRef.current * 0.4 + band.phase) * band.amplitude;
          const wave2 = Math.sin(sparkleX * band.frequency * 1.5 + timeRef.current * 0.6 + band.phase) * (band.amplitude * 0.4);
          const wave3 = Math.sin(sparkleX * band.frequency * 0.7 + timeRef.current * 0.25 + band.phase) * (band.amplitude * 0.25);
          const sparkleY = band.y + wave1 + wave2 + wave3;
          
          const sparkleSize = Math.sin(timeRef.current * 3 + i) * 1.5 + 2;
          const sparkleOpacity = (Math.sin(timeRef.current * 2 + i) * 0.3 + 0.3) * band.opacity;
          
          ctx.beginPath();
          ctx.arc(sparkleX, sparkleY, sparkleSize, 0, Math.PI * 2);
          const sparkleGradient = ctx.createRadialGradient(sparkleX, sparkleY, 0, sparkleX, sparkleY, sparkleSize * 3);
          sparkleGradient.addColorStop(0, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${sparkleOpacity})`);
          sparkleGradient.addColorStop(0.5, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, ${sparkleOpacity * 0.5})`);
          sparkleGradient.addColorStop(1, `rgba(${band.color.r}, ${band.color.g}, ${band.color.b}, 0)`);
          ctx.fillStyle = sparkleGradient;
          ctx.fill();
        }
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
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
        backgroundColor: "#000011",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        overflow: "hidden",
      }}
    >
      {/* Aurora Canvas Background */}
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
          backgroundColor: "rgba(5, 5, 15, 0.85)",
          borderRadius: "12px",
          border: "1px solid rgba(0, 255, 150, 0.3)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.7), 0 0 40px rgba(0, 255, 150, 0.1)",
          position: "relative",
          zIndex: 1,
          backdropFilter: "blur(15px)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              width: "80px",
              height: "80px",
              margin: "0 auto 20px",
              backgroundColor: "rgba(0, 255, 150, 0.15)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid rgba(0, 255, 150, 0.4)",
              boxShadow: "0 0 20px rgba(0, 255, 150, 0.3)",
            }}
          >
            <Lock size={40} color="#00ff96" />
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "8px", color: "#ffffff", textShadow: "0 0 10px rgba(0, 255, 150, 0.5)" }}>
            TradeButler Locked
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.8)" }}>
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
                        backgroundColor: "rgba(5, 5, 15, 0.9)",
                        border: error ? "2px solid #ff4444" : "1px solid rgba(0, 255, 150, 0.4)",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "all 0.2s",
                        boxSizing: "border-box",
                        flexShrink: 0,
                        boxShadow: error ? "0 0 10px rgba(255, 68, 68, 0.5)" : "0 0 10px rgba(0, 255, 150, 0.2)",
                      }}
                    >
                      {digit && (
                        <div
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: "#00ff96",
                            position: "absolute",
                            pointerEvents: "none",
                            boxShadow: "0 0 8px rgba(0, 255, 150, 0.8)",
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
                            container.style.borderColor = "#00ff96";
                            container.style.borderWidth = "2px";
                            container.style.boxShadow = "0 0 15px rgba(0, 255, 150, 0.6)";
                          }
                        }}
                        onBlur={(e) => {
                          const container = e.target.parentElement;
                          if (container) {
                            container.style.borderColor = error ? "#ff4444" : "rgba(0, 255, 150, 0.4)";
                            container.style.borderWidth = "1px";
                            container.style.boxShadow = error ? "0 0 10px rgba(255, 68, 68, 0.5)" : "0 0 10px rgba(0, 255, 150, 0.2)";
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
                    backgroundColor: "rgba(5, 5, 15, 0.9)",
                    border: error ? "2px solid #ff4444" : "1px solid rgba(0, 255, 150, 0.4)",
                    borderRadius: "8px",
                    color: "#ffffff",
                    fontSize: "16px",
                    textAlign: "left",
                    outline: "none",
                    boxShadow: error ? "0 0 10px rgba(255, 68, 68, 0.5)" : "0 0 10px rgba(0, 255, 150, 0.2)",
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
                  backgroundColor: "#00ff96",
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
                  boxShadow: "0 0 20px rgba(0, 255, 150, 0.5)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 30px rgba(0, 255, 150, 0.8)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 255, 150, 0.5)";
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
                  backgroundColor: "rgba(5, 5, 15, 0.9)",
                  color: "#ffffff",
                  border: "1px solid rgba(0, 255, 150, 0.4)",
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
                  backgroundColor: "rgba(5, 5, 15, 0.9)",
                  border: error ? "2px solid #ff4444" : "1px solid rgba(0, 255, 150, 0.4)",
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
                  backgroundColor: "rgba(5, 5, 15, 0.9)",
                  color: "#ffffff",
                  border: "1px solid rgba(0, 255, 150, 0.4)",
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
                  backgroundColor: deleteConfirmText === "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" ? "#ff4444" : "rgba(5, 5, 15, 0.9)",
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
