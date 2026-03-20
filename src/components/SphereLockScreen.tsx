import { useState, useEffect, useRef, useCallback } from "react";
import { Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";
import { getSphereThemeSettings } from "../utils/sphereThemeManager";
import { getLockScreenRendererPreference, canUseWebGL2 } from "../utils/lockScreenRenderer";
import {
  generateDots,
  type SphereDot,
  type Star,
  type Ripple,
  type BurstParticle,
} from "../features/lockScreen/sphereLockTypes";
import { updateAndProjectSphereLayer } from "../features/lockScreen/sphereProjection";
import { drawSphereLayerOnCanvas } from "../features/lockScreen/sphereCanvasDraw";
import { createSphereWebGLApi, type SphereWebGLApi } from "../features/lockScreen/sphereWebGL";

interface SphereLockScreenProps {
  onUnlock: () => void;
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
  const mountRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();
  const dotsRef = useRef<SphereDot[]>([]);
  const orbitingDotsRef = useRef<SphereDot[][]>([]);
  const starsRef = useRef<Star[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const particlesRef = useRef<BurstParticle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const angleRef = useRef({ x: 0, y: 0, z: 0 });
  const pulseRef = useRef(0);
  const waveRef = useRef(0);
  const settingsRef = useRef(getSphereThemeSettings());
  const scatterRef = useRef(false);
  const explodeRef = useRef(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const wantWebgl = getLockScreenRendererPreference() === "webgl" && canUseWebGL2();
  const useWebgl = wantWebgl && !webglFailed;
  const passwordType = getPasswordType();

  // Update settings when they change
  useEffect(() => {
    settingsRef.current = getSphereThemeSettings();
  }, []);

  // Listen for storage changes
  useEffect(() => {
    const handleStorageChange = () => {
      const newSettings = getSphereThemeSettings();
      const oldSettings = settingsRef.current;
      settingsRef.current = newSettings;
      
      // Recreate dots if structure changed
      if (oldSettings.rings !== newSettings.rings || 
          oldSettings.dotsPerRing !== newSettings.dotsPerRing ||
          oldSettings.shape !== newSettings.shape ||
          oldSettings.hollowMode !== newSettings.hollowMode) {
        dotsRef.current = generateDots(
          newSettings.shape, newSettings.rings, newSettings.dotsPerRing,
          newSettings.sphereRadius, newSettings.dotSize, newSettings.hollowMode
        );
        
        // Recreate orbiting spheres
        if (newSettings.multipleSpheresEnabled) {
          orbitingDotsRef.current = [];
          for (let i = 0; i < newSettings.additionalSphereCount; i++) {
            orbitingDotsRef.current.push(generateDots(
              newSettings.shape, 
              newSettings.orbitingSpheresRings, 
              newSettings.orbitingSpheresDotsPerRing,
              newSettings.sphereRadius * newSettings.orbitingSpheresScale, 
              newSettings.orbitingSpheresDotSize, 
              newSettings.hollowMode
            ));
          }
        }
      }
      
      // Recreate stars if needed
      if (newSettings.starsEnabled && starsRef.current.length !== newSettings.starCount) {
        const w = canvasRef.current?.width ?? window.innerWidth;
        const h = canvasRef.current?.height ?? window.innerHeight;
        starsRef.current = [];
        for (let i = 0; i < newSettings.starCount; i++) {
          starsRef.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.5 + 0.3,
            twinkleOffset: Math.random() * Math.PI * 2,
          });
        }
      }
    };
    
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(() => {
      const newSettings = getSphereThemeSettings();
      if (JSON.stringify(newSettings) !== JSON.stringify(settingsRef.current)) {
        handleStorageChange();
      }
    }, 100);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const settings = settingsRef.current;
    if (settings.clickRippleEnabled) {
      const rect = backgroundRef.current?.getBoundingClientRect();
      if (rect) {
        ripplesRef.current.push({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          radius: 0,
          maxRadius: 300,
          opacity: 1,
        });
      }
    }
  }, []);

  useEffect(() => {
    let webglApi: SphereWebGLApi | null = null;

    const resizeCanvas = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const c = canvasRef.current;
      if (c) {
        c.width = w;
        c.height = h;
      }
      const settings = settingsRef.current;
      if (settings.starsEnabled) {
        starsRef.current = [];
        for (let i = 0; i < settings.starCount; i++) {
          starsRef.current.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.5 + 0.3,
            twinkleOffset: Math.random() * Math.PI * 2,
          });
        }
      }
      webglApi?.resize(w, h);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    if (useWebgl && mountRef.current) {
      const api = createSphereWebGLApi(mountRef.current, () => setWebglFailed(true));
      webglApi = api;
      api.resize(window.innerWidth, window.innerHeight);
    }

    const settingsInit = settingsRef.current;
    dotsRef.current = generateDots(
      settingsInit.shape,
      settingsInit.rings,
      settingsInit.dotsPerRing,
      settingsInit.sphereRadius,
      settingsInit.dotSize,
      settingsInit.hollowMode
    );

    if (settingsInit.multipleSpheresEnabled) {
      orbitingDotsRef.current = [];
      for (let i = 0; i < settingsInit.additionalSphereCount; i++) {
        orbitingDotsRef.current.push(
          generateDots(
            settingsInit.shape,
            settingsInit.orbitingSpheresRings,
            settingsInit.orbitingSpheresDotsPerRing,
            settingsInit.sphereRadius * settingsInit.orbitingSpheresScale,
            settingsInit.orbitingSpheresDotSize,
            settingsInit.hollowMode
          )
        );
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const handleMouseDown = () => {
      mouseRef.current.pressed = true;
    };
    const handleMouseUp = () => {
      mouseRef.current.pressed = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 59, g: 130, b: 246 };
    };

    let time = 0;

    const animate = () => {
      const settings = settingsRef.current;
      time += 0.016;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const centerX = w / 2;
      const centerY = h / 2;

      const projectionParams = {
        settings,
        centerX,
        centerY,
        mouse: mouseRef.current,
        angleRef,
        pulseRef,
        waveRef,
        scatterRef,
        explodeRef,
        particlesRef,
      };

      if (settings.rotateX) angleRef.current.x += settings.rotationSpeed;
      if (settings.rotateY) angleRef.current.y += settings.rotationSpeed;
      if (settings.rotateZ) angleRef.current.z += settings.rotationSpeed;
      if (settings.pulseEnabled) pulseRef.current += settings.pulseSpeed;
      if (settings.waveEnabled) waveRef.current += settings.waveSpeed;

      const dotColor = hexToRgb(settings.dotColor);
      const lineColorRgb = hexToRgb(settings.lineColor);
      const orbitingLineColorRgb = hexToRgb(settings.orbitingSpheresLineColor);
      const mainLineRgb = settings.linesMatchDotColor ? dotColor : lineColorRgb;

      const mainProjected = updateAndProjectSphereLayer(
        dotsRef.current,
        0,
        0,
        1,
        undefined,
        projectionParams
      );

      if (webglApi) {
        const layers = [
          {
            projected: mainProjected,
            connectionDistance: settings.connectionDistance,
            lineRgb: mainLineRgb,
            wireframeRings: settings.rings,
            wireframeDotsPerRing: settings.dotsPerRing,
            showConnections: settings.showConnections,
            wireframeMode: settings.wireframeMode,
            centerX,
            centerY,
            offsetX: 0,
            offsetY: 0,
          },
        ];

        if (settings.multipleSpheresEnabled) {
          for (let i = 0; i < orbitingDotsRef.current.length; i++) {
            const orbitAngle =
              time * settings.orbitingSpheresSpeed +
              (i * 2 * Math.PI) / settings.additionalSphereCount;
            const orbitRadius = settings.sphereRadius * settings.orbitingSpheresDistance;
            const offsetX = Math.cos(orbitAngle) * orbitRadius;
            const offsetY = Math.sin(orbitAngle * 0.5) * orbitRadius * 0.3;
            const orbColor = settings.orbitingSpheresSameColor
              ? dotColor
              : hexToRgb(settings.orbitingSpheresColor);
            const orbLineRgb = settings.linesMatchDotColor ? orbColor : orbitingLineColorRgb;
            layers.push({
              projected: updateAndProjectSphereLayer(
                orbitingDotsRef.current[i],
                offsetX,
                offsetY,
                settings.orbitingSpheresScale,
                orbColor,
                projectionParams
              ),
              connectionDistance: settings.connectionDistance,
              lineRgb: orbLineRgb,
              wireframeRings: settings.orbitingSpheresRings,
              wireframeDotsPerRing: settings.orbitingSpheresDotsPerRing,
              showConnections: settings.showConnections,
              wireframeMode: settings.wireframeMode,
              centerX,
              centerY,
              offsetX,
              offsetY,
            });
          }
        }

        if (settings.clickRippleEnabled) {
          for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
            const ripple = ripplesRef.current[i];
            ripple.radius += 5;
            ripple.opacity -= 0.02;
            if (ripple.opacity <= 0 || ripple.radius >= ripple.maxRadius) {
              ripplesRef.current.splice(i, 1);
              continue;
            }
            for (const pd of mainProjected) {
              const dx = pd.screenX - ripple.x;
              const dy = pd.screenY - ripple.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0 && Math.abs(dist - ripple.radius) < 30) {
                const force = ripple.opacity * 0.5;
                pd.dot.vx += (dx / dist) * force;
                pd.dot.vy += (dy / dist) * force;
              }
            }
          }
        }

        if (settings.particleBurstEnabled) {
          for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            if (p.life <= 0) {
              particlesRef.current.splice(i, 1);
            }
          }
        }

        webglApi.renderFrame({
          width: w,
          height: h,
          backgroundColor: settings.backgroundColor,
          stars: starsRef.current,
          starTwinkle: settings.starTwinkle,
          time,
          layers,
          settings,
          ripples: [...ripplesRef.current],
          particles: [...particlesRef.current],
          dotRgb: dotColor,
        });

        if (scatterRef.current) {
          setTimeout(() => {
            scatterRef.current = false;
          }, 1000);
        }
        if (explodeRef.current) {
          setTimeout(() => {
            explodeRef.current = false;
          }, 500);
        }

        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (settings.starsEnabled) {
        for (const star of starsRef.current) {
          let opacity = star.opacity;
          if (settings.starTwinkle) {
            opacity = star.opacity * (0.5 + 0.5 * Math.sin(time * 2 + star.twinkleOffset));
          }
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.fill();
        }
      }

      drawSphereLayerOnCanvas(
        ctx,
        mainProjected,
        settings,
        mainLineRgb,
        centerX,
        centerY,
        0,
        0,
        settings.rings,
        settings.dotsPerRing
      );

      if (settings.reflectionEnabled) {
        ctx.save();
        ctx.globalAlpha = settings.reflectionOpacity;
        ctx.scale(1, -0.3);
        ctx.translate(0, -canvas.height * 2.5);
        drawSphereLayerOnCanvas(
          ctx,
          mainProjected,
          settings,
          mainLineRgb,
          centerX,
          centerY,
          0,
          0,
          settings.rings,
          settings.dotsPerRing
        );
        ctx.restore();
      }

      if (settings.multipleSpheresEnabled) {
          const orbitingColor = settings.orbitingSpheresSameColor
          ? dotColor
          : hexToRgb(settings.orbitingSpheresColor);
        for (let i = 0; i < orbitingDotsRef.current.length; i++) {
          const orbitAngle =
            time * settings.orbitingSpheresSpeed +
            (i * 2 * Math.PI) / settings.additionalSphereCount;
          const orbitRadius = settings.sphereRadius * settings.orbitingSpheresDistance;
          const offsetX = Math.cos(orbitAngle) * orbitRadius;
          const offsetY = Math.sin(orbitAngle * 0.5) * orbitRadius * 0.3;
          const orbProj = updateAndProjectSphereLayer(
            orbitingDotsRef.current[i],
            offsetX,
            offsetY,
            settings.orbitingSpheresScale,
            orbitingColor,
            projectionParams
          );
          const orbLineRgb = settings.linesMatchDotColor ? orbitingColor : orbitingLineColorRgb;
          drawSphereLayerOnCanvas(
            ctx,
            orbProj,
            settings,
            orbLineRgb,
            centerX,
            centerY,
            offsetX,
            offsetY,
            settings.orbitingSpheresRings,
            settings.orbitingSpheresDotsPerRing
          );
        }
      }

      if (settings.clickRippleEnabled) {
        for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
          const ripple = ripplesRef.current[i];
          ripple.radius += 5;
          ripple.opacity -= 0.02;
          if (ripple.opacity <= 0 || ripple.radius >= ripple.maxRadius) {
            ripplesRef.current.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${dotColor.r}, ${dotColor.g}, ${dotColor.b}, ${ripple.opacity})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          for (const pd of mainProjected) {
            const dx = pd.screenX - ripple.x;
            const dy = pd.screenY - ripple.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0 && Math.abs(dist - ripple.radius) < 30) {
              const force = ripple.opacity * 0.5;
              pd.dot.vx += (dx / dist) * force;
              pd.dot.vy += (dy / dist) * force;
            }
          }
        }
      }

      if (settings.particleBurstEnabled) {
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.02;
          if (p.life <= 0) {
            particlesRef.current.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${dotColor.r}, ${dotColor.g}, ${dotColor.b}, ${p.life})`;
          ctx.fill();
        }
      }

      if (scatterRef.current) {
        setTimeout(() => {
          scatterRef.current = false;
        }, 1000);
      }
      if (explodeRef.current) {
        setTimeout(() => {
          explodeRef.current = false;
        }, 500);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      webglApi?.dispose();
    };
  }, [useWebgl]);

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
            if (settingsRef.current.explodeOnUnlock) {
              explodeRef.current = true;
              setTimeout(() => {
                setPinDigits(["", "", "", "", "", ""]);
                onUnlock();
              }, 600);
            } else {
              setPinDigits(["", "", "", "", "", ""]);
              onUnlock();
            }
          } else {
            setError("Incorrect PIN");
            if (settingsRef.current.scatterOnWrongPin) {
              scatterRef.current = true;
            }
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
        if (settingsRef.current.explodeOnUnlock) {
          explodeRef.current = true;
          setTimeout(() => {
            setPinDigits(["", "", "", "", "", ""]);
            onUnlock();
          }, 600);
        } else {
          setPinDigits(["", "", "", "", "", ""]);
          onUnlock();
        }
      } else {
        setError("Incorrect PIN");
        if (settingsRef.current.scatterOnWrongPin) {
          scatterRef.current = true;
        }
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
        if (settingsRef.current.explodeOnUnlock) {
          explodeRef.current = true;
          setTimeout(() => {
            setInput("");
            onUnlock();
          }, 600);
        } else {
          setInput("");
          onUnlock();
        }
      } else {
        setError("Incorrect password");
        if (settingsRef.current.scatterOnWrongPin) {
          scatterRef.current = true;
        }
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
      <div
        ref={backgroundRef}
        onClick={handleBackgroundClick}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
          cursor: settingsRef.current.clickRippleEnabled ? "pointer" : "default",
        }}
      >
        <div
          ref={mountRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        {!useWebgl && (
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
            }}
          />
        )}
      </div>

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
