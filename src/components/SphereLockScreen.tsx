import { useState, useEffect, useRef, useCallback } from "react";
import { Unlock, AlertCircle, Trash2 } from "lucide-react";
import { unlockApp, getPasswordType, deletePassword } from "../utils/passwordManager";
import { invoke } from "@tauri-apps/api/tauri";
import { getSphereThemeSettings, SphereShape } from "../utils/sphereThemeManager";

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
  trail: Array<{ x: number; y: number; z: number }>;
}

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleOffset: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

// Generate dots based on shape
function generateDots(shape: SphereShape, rings: number, dotsPerRing: number, radius: number, dotSize: number, hollow: boolean): SphereDot[] {
  const dots: SphereDot[] = [];
  
  switch (shape) {
    case "sphere": {
      const startRing = hollow ? 0 : 0;
      const endRing = rings;
      for (let i = startRing; i < endRing; i++) {
        const phi = Math.PI * (i / (rings - 1));
        for (let j = 0; j < dotsPerRing; j++) {
          const theta = (2 * Math.PI * j) / dotsPerRing;
          const x = Math.sin(phi) * Math.cos(theta);
          const y = Math.cos(phi);
          const z = Math.sin(phi) * Math.sin(theta);
          dots.push({
            baseX: x, baseY: y, baseZ: z,
            x: x * radius, y: y * radius, z: z * radius,
            vx: 0, vy: 0, vz: 0, radius: dotSize, trail: [],
          });
        }
      }
      break;
    }
    case "torus": {
      const majorRadius = 1;
      const minorRadius = 0.4;
      for (let i = 0; i < rings; i++) {
        const u = (2 * Math.PI * i) / rings;
        for (let j = 0; j < dotsPerRing; j++) {
          const v = (2 * Math.PI * j) / dotsPerRing;
          const x = (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u);
          const y = minorRadius * Math.sin(v);
          const z = (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u);
          dots.push({
            baseX: x, baseY: y, baseZ: z,
            x: x * radius, y: y * radius, z: z * radius,
            vx: 0, vy: 0, vz: 0, radius: dotSize, trail: [],
          });
        }
      }
      break;
    }
    case "cube": {
      const size = 1;
      const dotsPerEdge = Math.ceil(Math.cbrt(rings * dotsPerRing / 6));
      // Generate dots on each face
      for (let face = 0; face < 6; face++) {
        for (let i = 0; i < dotsPerEdge; i++) {
          for (let j = 0; j < dotsPerEdge; j++) {
            const u = (i / (dotsPerEdge - 1)) * 2 - 1;
            const v = (j / (dotsPerEdge - 1)) * 2 - 1;
            let x = 0, y = 0, z = 0;
            switch (face) {
              case 0: x = size; y = u; z = v; break;
              case 1: x = -size; y = u; z = v; break;
              case 2: x = u; y = size; z = v; break;
              case 3: x = u; y = -size; z = v; break;
              case 4: x = u; y = v; z = size; break;
              case 5: x = u; y = v; z = -size; break;
            }
            dots.push({
              baseX: x, baseY: y, baseZ: z,
              x: x * radius * 0.7, y: y * radius * 0.7, z: z * radius * 0.7,
              vx: 0, vy: 0, vz: 0, radius: dotSize, trail: [],
            });
          }
        }
      }
      break;
    }
    case "helix": {
      const turns = 3;
      const totalDots = rings * dotsPerRing;
      for (let i = 0; i < totalDots; i++) {
        const t = i / totalDots;
        const angle = t * turns * 2 * Math.PI;
        const x = Math.cos(angle) * 0.5;
        const y = t * 2 - 1;
        const z = Math.sin(angle) * 0.5;
        dots.push({
          baseX: x, baseY: y, baseZ: z,
          x: x * radius, y: y * radius, z: z * radius,
          vx: 0, vy: 0, vz: 0, radius: dotSize, trail: [],
        });
      }
      break;
    }
    case "doubleHelix": {
      const turns = 3;
      const totalDots = (rings * dotsPerRing) / 2;
      for (let strand = 0; strand < 2; strand++) {
        const offset = strand * Math.PI;
        for (let i = 0; i < totalDots; i++) {
          const t = i / totalDots;
          const angle = t * turns * 2 * Math.PI + offset;
          const x = Math.cos(angle) * 0.5;
          const y = t * 2 - 1;
          const z = Math.sin(angle) * 0.5;
          dots.push({
            baseX: x, baseY: y, baseZ: z,
            x: x * radius, y: y * radius, z: z * radius,
            vx: 0, vy: 0, vz: 0, radius: dotSize, trail: [],
          });
        }
      }
      break;
    }
  }
  
  return dots;
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
  const orbitingDotsRef = useRef<SphereDot[][]>([]);
  const starsRef = useRef<Star[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const angleRef = useRef({ x: 0, y: 0, z: 0 });
  const pulseRef = useRef(0);
  const waveRef = useRef(0);
  const settingsRef = useRef(getSphereThemeSettings());
  const scatterRef = useRef(false);
  const explodeRef = useRef(false);
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
        const canvas = canvasRef.current;
        if (canvas) {
          starsRef.current = [];
          for (let i = 0; i < newSettings.starCount; i++) {
            starsRef.current.push({
              x: Math.random() * canvas.width,
              y: Math.random() * canvas.height,
              size: Math.random() * 2 + 0.5,
              opacity: Math.random() * 0.5 + 0.3,
              twinkleOffset: Math.random() * Math.PI * 2,
            });
          }
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

  // Handle click for ripples
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const settings = settingsRef.current;
    if (settings.clickRippleEnabled) {
      const rect = canvasRef.current?.getBoundingClientRect();
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

  // Initialize animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Recreate stars on resize
      const settings = settingsRef.current;
      if (settings.starsEnabled) {
        starsRef.current = [];
        for (let i = 0; i < settings.starCount; i++) {
          starsRef.current.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.5 + 0.3,
            twinkleOffset: Math.random() * Math.PI * 2,
          });
        }
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Create initial dots
    const settings = settingsRef.current;
    dotsRef.current = generateDots(
      settings.shape, settings.rings, settings.dotsPerRing,
      settings.sphereRadius, settings.dotSize, settings.hollowMode
    );
    
    // Create orbiting spheres
    if (settings.multipleSpheresEnabled) {
      orbitingDotsRef.current = [];
      for (let i = 0; i < settings.additionalSphereCount; i++) {
        orbitingDotsRef.current.push(generateDots(
          settings.shape, 
          settings.orbitingSpheresRings, 
          settings.orbitingSpheresDotsPerRing,
          settings.sphereRadius * settings.orbitingSpheresScale, 
          settings.orbitingSpheresDotSize, 
          settings.hollowMode
        ));
      }
    }
    
    // Create stars
    if (settings.starsEnabled) {
      for (let i = 0; i < settings.starCount; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 2 + 0.5,
          opacity: Math.random() * 0.5 + 0.3,
          twinkleOffset: Math.random() * Math.PI * 2,
        });
      }
    }

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const handleMouseDown = () => { mouseRef.current.pressed = true; };
    const handleMouseUp = () => { mouseRef.current.pressed = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    // Helper functions
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 59, g: 130, b: 246 };
    };
    
    const lerpColor = (color1: {r: number, g: number, b: number}, color2: {r: number, g: number, b: number}, t: number) => {
      return {
        r: Math.round(color1.r + (color2.r - color1.r) * t),
        g: Math.round(color1.g + (color2.g - color1.g) * t),
        b: Math.round(color1.b + (color2.b - color1.b) * t),
      };
    };

    let time = 0;

    // Animation loop
    const animate = () => {
      const settings = settingsRef.current;
      time += 0.016;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Background
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const mouse = mouseRef.current;

      // Draw stars
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

      // Update rotation angles
      if (settings.rotateX) angleRef.current.x += settings.rotationSpeed;
      if (settings.rotateY) angleRef.current.y += settings.rotationSpeed;
      if (settings.rotateZ) angleRef.current.z += settings.rotationSpeed;
      
      // Update pulse
      if (settings.pulseEnabled) {
        pulseRef.current += settings.pulseSpeed;
      }
      
      // Update wave
      if (settings.waveEnabled) {
        waveRef.current += settings.waveSpeed;
      }

      const dotColor = hexToRgb(settings.dotColor);
      const lineColor = hexToRgb(settings.lineColor);
      const gradientFront = hexToRgb(settings.gradientColorFront);
      const gradientBack = hexToRgb(settings.gradientColorBack);

      // Process main sphere dots
      const processDots = (dots: SphereDot[], offsetX: number, offsetY: number, scale: number, colorOverride?: {r: number, g: number, b: number}) => {
        const projectedDots: Array<{ 
          screenX: number; screenY: number; z: number; 
          opacity: number; size: number; color: {r: number, g: number, b: number};
          dot: SphereDot;
        }> = [];
        
        const baseColor = colorOverride || dotColor;

        // Pulse scale
        let pulseScale = 1;
        if (settings.pulseEnabled) {
          pulseScale = 1 + Math.sin(pulseRef.current) * settings.pulseIntensity;
        }

        // Scatter/explode multiplier
        let scatterMultiplier = 1;
        if (scatterRef.current) {
          scatterMultiplier = 3;
        }
        if (explodeRef.current) {
          scatterMultiplier = 5;
        }

        for (const dot of dots) {
          // Rotate around all axes
          let x = dot.baseX;
          let y = dot.baseY;
          let z = dot.baseZ;
          
          // Y rotation
          const cosY = Math.cos(angleRef.current.y);
          const sinY = Math.sin(angleRef.current.y);
          let newX = x * cosY - z * sinY;
          let newZ = x * sinY + z * cosY;
          x = newX;
          z = newZ;
          
          // X rotation
          if (settings.rotateX) {
            const cosX = Math.cos(angleRef.current.x);
            const sinX = Math.sin(angleRef.current.x);
            const newY = y * cosX - z * sinX;
            newZ = y * sinX + z * cosX;
            y = newY;
            z = newZ;
          }
          
          // Z rotation
          if (settings.rotateZ) {
            const cosZ = Math.cos(angleRef.current.z);
            const sinZ = Math.sin(angleRef.current.z);
            newX = x * cosZ - y * sinZ;
            const newY = x * sinZ + y * cosZ;
            x = newX;
            y = newY;
          }

          // Apply wave distortion
          let waveOffset = 0;
          if (settings.waveEnabled) {
            waveOffset = Math.sin(waveRef.current + dot.baseY * 5) * settings.waveAmplitude;
          }

          // Target position
          const radius = settings.sphereRadius * scale * pulseScale;
          const targetX = x * radius + waveOffset;
          const targetY = y * radius;
          const targetZ = z * radius;

          // Calculate screen position for mouse interaction
          const perspective = 1000 / (1000 + targetZ);
          const screenX = centerX + offsetX + targetX * perspective;
          const screenY = centerY + offsetY + targetY * perspective;

          // Mouse interaction
          const dx = screenX - mouse.x;
          const dy = screenY - mouse.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = 150;

          if (distance < minDistance && distance > 0) {
            const force = (minDistance - distance) / minDistance;
            let direction = settings.reverseMouseEffect ? -1 : 1;
            
            // Gravity well - pull when mouse pressed
            if (settings.gravityWellEnabled && mouse.pressed) {
              direction = -1;
            }
            
            const pushX = (dx / distance) * force * settings.mouseForce * 50 * direction;
            const pushY = (dy / distance) * force * settings.mouseForce * 50 * direction;
            dot.vx += pushX;
            dot.vy += pushY;
            
            // Particle burst
            if (settings.particleBurstEnabled && Math.random() < 0.1) {
              particlesRef.current.push({
                x: screenX,
                y: screenY,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                life: 1,
                maxLife: 1,
                size: Math.random() * 2 + 1,
              });
            }
          }

          // Spring force back to target
          dot.vx += (targetX - dot.x) * settings.returnForce / scatterMultiplier;
          dot.vy += (targetY - dot.y) * settings.returnForce / scatterMultiplier;
          dot.vz += (targetZ - dot.z) * settings.returnForce / scatterMultiplier;

          // Apply velocity
          dot.x += dot.vx;
          dot.y += dot.vy;
          dot.z += dot.vz;
          dot.vx *= settings.friction;
          dot.vy *= settings.friction;
          dot.vz *= settings.friction;

          // Store trail
          if (settings.trailsEnabled) {
            dot.trail.unshift({ x: dot.x, y: dot.y, z: dot.z });
            if (dot.trail.length > settings.trailLength) {
              dot.trail.pop();
            }
          }

          // Project to 2D
          const dotPerspective = 1000 / (1000 + dot.z);
          const dotScreenX = centerX + offsetX + dot.x * dotPerspective;
          const dotScreenY = centerY + offsetY + dot.y * dotPerspective;
          
          // Calculate opacity based on depth
          const normalizedZ = (dot.z + radius) / (radius * 2);
          let opacity = 0.3 + 0.7 * normalizedZ;
          
          // Light source effect
          if (settings.lightSourceEnabled) {
            const lightAngle = settings.lightSourceAngle * Math.PI / 180;
            const lightX = Math.cos(lightAngle);
            const lightZ = Math.sin(lightAngle);
            const lightDot = (x * lightX + z * lightZ + 1) / 2;
            opacity *= 0.3 + 0.7 * lightDot;
          }
          
          const size = settings.dotSize * dotPerspective * 1.5 * scale;

          // Color based on gradient or solid (use colorOverride if provided)
          let color = baseColor;
          if (settings.gradientEnabled && !colorOverride) {
            color = lerpColor(gradientBack, gradientFront, normalizedZ);
          }

          projectedDots.push({
            screenX: dotScreenX,
            screenY: dotScreenY,
            z: dot.z,
            opacity,
            size,
            color,
            dot,
          });
        }

        // Sort by z-depth
        projectedDots.sort((a, b) => a.z - b.z);

        // Draw trails
        if (settings.trailsEnabled) {
          for (const pd of projectedDots) {
            const trail = pd.dot.trail;
            if (trail.length > 1) {
              ctx.beginPath();
              for (let i = 0; i < trail.length; i++) {
                const trailPerspective = 1000 / (1000 + trail[i].z);
                const tx = centerX + offsetX + trail[i].x * trailPerspective;
                const ty = centerY + offsetY + trail[i].y * trailPerspective;
                if (i === 0) {
                  ctx.moveTo(tx, ty);
                } else {
                  ctx.lineTo(tx, ty);
                }
              }
              const trailOpacity = pd.opacity * 0.3 * (1 - projectedDots.indexOf(pd) / projectedDots.length);
              ctx.strokeStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${trailOpacity})`;
              ctx.lineWidth = pd.size * 0.5;
              ctx.stroke();
            }
          }
        }

        // Draw connections
        if (settings.showConnections && !settings.wireframeMode) {
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

        // Wireframe mode - connect adjacent dots
        if (settings.wireframeMode) {
          ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, 0.5)`;
          ctx.lineWidth = 1;
          // Connect dots in rings
          for (let i = 0; i < settings.rings; i++) {
            for (let j = 0; j < settings.dotsPerRing; j++) {
              const idx1 = i * settings.dotsPerRing + j;
              const idx2 = i * settings.dotsPerRing + ((j + 1) % settings.dotsPerRing);
              if (idx1 < projectedDots.length && idx2 < projectedDots.length) {
                ctx.beginPath();
                ctx.moveTo(projectedDots[idx1].screenX, projectedDots[idx1].screenY);
                ctx.lineTo(projectedDots[idx2].screenX, projectedDots[idx2].screenY);
                ctx.stroke();
              }
              // Connect to next ring
              if (i < settings.rings - 1) {
                const idx3 = (i + 1) * settings.dotsPerRing + j;
                if (idx3 < projectedDots.length) {
                  ctx.beginPath();
                  ctx.moveTo(projectedDots[idx1].screenX, projectedDots[idx1].screenY);
                  ctx.lineTo(projectedDots[idx3].screenX, projectedDots[idx3].screenY);
                  ctx.stroke();
                }
              }
            }
          }
        }

        // Draw dots
        for (const pd of projectedDots) {
          ctx.beginPath();
          ctx.arc(pd.screenX, pd.screenY, pd.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${pd.opacity})`;
          ctx.fill();
          
          // Glow effect
          if (settings.glowIntensity > 0) {
            ctx.beginPath();
            ctx.arc(pd.screenX, pd.screenY, pd.size * 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${pd.opacity * settings.glowIntensity})`;
            ctx.fill();
          }
        }

        return projectedDots;
      };

      // Draw main sphere
      const mainProjected = processDots(dotsRef.current, 0, 0, 1);

      // Draw reflection
      if (settings.reflectionEnabled) {
        ctx.save();
        ctx.globalAlpha = settings.reflectionOpacity;
        ctx.scale(1, -0.3);
        ctx.translate(0, -canvas.height * 2.5);
        processDots(dotsRef.current, 0, 0, 1);
        ctx.restore();
      }

      // Draw orbiting spheres
      if (settings.multipleSpheresEnabled) {
        const orbitingColor = settings.orbitingSpheresSameColor ? dotColor : hexToRgb(settings.orbitingSpheresColor);
        for (let i = 0; i < orbitingDotsRef.current.length; i++) {
          const orbitAngle = time * settings.orbitingSpheresSpeed + (i * 2 * Math.PI / settings.additionalSphereCount);
          const orbitRadius = settings.sphereRadius * settings.orbitingSpheresDistance;
          const offsetX = Math.cos(orbitAngle) * orbitRadius;
          const offsetY = Math.sin(orbitAngle * 0.5) * orbitRadius * 0.3;
          processDots(orbitingDotsRef.current[i], offsetX, offsetY, settings.orbitingSpheresScale, orbitingColor);
        }
      }

      // Draw ripples
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
          
          // Apply ripple force to nearby dots
          for (const pd of mainProjected) {
            const dx = pd.screenX - ripple.x;
            const dy = pd.screenY - ripple.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (Math.abs(dist - ripple.radius) < 30) {
              const force = ripple.opacity * 0.5;
              pd.dot.vx += (dx / dist) * force;
              pd.dot.vy += (dy / dist) * force;
            }
          }
        }
      }

      // Draw particles
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

      // Decay scatter/explode
      if (scatterRef.current) {
        setTimeout(() => { scatterRef.current = false; }, 1000);
      }
      if (explodeRef.current) {
        setTimeout(() => { explodeRef.current = false; }, 500);
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
      {/* Sphere Canvas Background */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          cursor: settingsRef.current.clickRippleEnabled ? "pointer" : "default",
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
