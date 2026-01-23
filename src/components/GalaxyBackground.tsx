import { useEffect, useRef } from "react";
import { getGalaxyThemeSettings } from "../utils/galaxyThemeManager";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export default function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const settingsRef = useRef(getGalaxyThemeSettings());

  // Update settings when they change
  useEffect(() => {
    settingsRef.current = getGalaxyThemeSettings();
  }, []);

  // Listen for storage changes to update settings dynamically
  useEffect(() => {
    const handleStorageChange = () => {
      const newSettings = getGalaxyThemeSettings();
      const oldSettings = settingsRef.current;
      settingsRef.current = newSettings;
      
      // Recreate particles if count changed
      const canvas = canvasRef.current;
      if (canvas && oldSettings.particleCount !== newSettings.particleCount) {
        const particles: Particle[] = [];
        for (let i = 0; i < newSettings.particleCount; i++) {
          particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            radius: Math.random() * (newSettings.particleSize.max - newSettings.particleSize.min) + newSettings.particleSize.min,
          });
        }
        particlesRef.current = particles;
      }
    };
    window.addEventListener("storage", handleStorageChange);
    // Also check periodically for same-tab updates
    const interval = setInterval(() => {
      const newSettings = getGalaxyThemeSettings();
      const oldSettings = settingsRef.current;
      if (JSON.stringify(newSettings) !== JSON.stringify(oldSettings)) {
        settingsRef.current = newSettings;
        
        // Recreate particles if count changed
        const canvas = canvasRef.current;
        if (canvas && oldSettings.particleCount !== newSettings.particleCount) {
          const particles: Particle[] = [];
          for (let i = 0; i < newSettings.particleCount; i++) {
            particles.push({
              x: Math.random() * canvas.width,
              y: Math.random() * canvas.height,
              vx: (Math.random() - 0.5) * 0.5,
              vy: (Math.random() - 0.5) * 0.5,
              radius: Math.random() * (newSettings.particleSize.max - newSettings.particleSize.min) + newSettings.particleSize.min,
            });
          }
          particlesRef.current = particles;
        }
      }
    }, 100);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Initialize particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        // Recreate particles on resize
        const settings = settingsRef.current;
        const particles: Particle[] = [];
        for (let i = 0; i < settings.particleCount; i++) {
          particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            radius: Math.random() * (settings.particleSize.max - settings.particleSize.min) + settings.particleSize.min,
          });
        }
        particlesRef.current = particles;
      }
    };
    
    // Get container once and reuse
    const container = canvas.parentElement;
    
    // Initial resize
    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    
    if (container) {
      observer.observe(container);
      resizeCanvas();
    }

    // Create initial particles
    const settings = settingsRef.current;
    const particles: Particle[] = [];
    for (let i = 0; i < settings.particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * (settings.particleSize.max - settings.particleSize.min) + settings.particleSize.min,
      });
    }
    particlesRef.current = particles;

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      if (container) {
        const rect = container.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
    };
    
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
    }

    // Helper function to convert hex to rgba
    const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
          }
        : { r: 100, g: 150, b: 255 };
    };

    // Animation loop
    const animate = () => {
      const settings = settingsRef.current;
      const particleColor = hexToRgb(settings.particleColor);
      const lineColor = hexToRgb(settings.lineColor);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = settings.backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Calculate center of container
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Orbital motion around center
        if (settings.orbitAroundCenter) {
          const dxToCenter = p.x - centerX;
          const dyToCenter = p.y - centerY;
          const distanceToCenter = Math.sqrt(dxToCenter * dxToCenter + dyToCenter * dyToCenter);
          
          if (distanceToCenter > 0) {
            // Calculate angle from center to particle
            const angleToCenter = Math.atan2(dyToCenter, dxToCenter);
            // Apply tangential force (perpendicular to radius) for orbital motion
            const tangentialAngle = angleToCenter + Math.PI / 2; // 90 degrees from radius
            const orbitalForce = settings.orbitSpeed * 0.01; // Slow orbital motion
            p.vx += Math.cos(tangentialAngle) * orbitalForce;
            p.vy += Math.sin(tangentialAngle) * orbitalForce;
            
            // Optional: slight centripetal force to maintain orbit radius
            const centripetalForce = (distanceToCenter - settings.orbitRadius) * settings.orbitGravity; // Pull towards ideal radius
            p.vx -= Math.cos(angleToCenter) * centripetalForce;
            p.vy -= Math.sin(angleToCenter) * centripetalForce;
          }
        }

        // Calculate distance from mouse
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = 100;

        // Apply mouse force (push away or pull towards)
        if (distance < minDistance) {
          const force = (minDistance - distance) / minDistance;
          const angle = Math.atan2(dy, dx);
          const forceMultiplier = settings.reverseGravity ? -1 : 1;
          p.vx += Math.cos(angle) * force * settings.mouseForce * forceMultiplier;
          p.vy += Math.sin(angle) * force * settings.mouseForce * forceMultiplier;
        }

        // Particle collisions (bounce off each other)
        if (settings.particleCollisions) {
          for (let j = i + 1; j < particles.length; j++) {
            const p2 = particles[j];
            const dx = p.x - p2.x;
            const dy = p.y - p2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDist = p.radius + p2.radius;

            if (distance < minDist && distance > 0) {
              // Calculate collision angle
              const angle = Math.atan2(dy, dx);
              const sin = Math.sin(angle);
              const cos = Math.cos(angle);

              // Rotate velocities to collision frame
              const vx1 = p.vx * cos + p.vy * sin;
              const vy1 = p.vy * cos - p.vx * sin;
              const vx2 = p2.vx * cos + p2.vy * sin;
              const vy2 = p2.vy * cos - p2.vx * sin;

              // Swap velocities (elastic collision with equal mass)
              const swappedVx1 = vx2;
              const swappedVx2 = vx1;

              // Rotate back to world frame
              p.vx = swappedVx1 * cos - vy1 * sin;
              p.vy = vy1 * cos + swappedVx1 * sin;
              p2.vx = swappedVx2 * cos - vy2 * sin;
              p2.vy = vy2 * cos + swappedVx2 * sin;

              // Separate particles to prevent overlap
              const overlap = minDist - distance;
              const separationX = (dx / distance) * overlap * 0.5;
              const separationY = (dy / distance) * overlap * 0.5;
              p.x += separationX;
              p.y += separationY;
              p2.x -= separationX;
              p2.y -= separationY;
            }
          }
        }

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Boundary wrapping
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        // Apply friction
        p.vx *= settings.friction;
        p.vy *= settings.friction;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${particleColor.r}, ${particleColor.g}, ${particleColor.b}, ${0.6 + Math.random() * 0.4})`;
        ctx.fill();
      }

      // Draw connections between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < settings.connectionDistance) {
            const opacity = 1 - distance / settings.connectionDistance;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${opacity * 0.3})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      observer.disconnect();
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    console.log("GalaxyBackground mounted, canvas ref:", canvasRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
