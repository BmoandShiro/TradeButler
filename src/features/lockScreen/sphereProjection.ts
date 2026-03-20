import type { SphereThemeSettings } from "../../utils/sphereThemeManager";
import type { BurstParticle, ProjectedSphereDot, SphereDot } from "./sphereLockTypes";

export interface SphereAngleRef {
  current: { x: number; y: number; z: number };
}

export interface SphereProjectionParams {
  settings: SphereThemeSettings;
  centerX: number;
  centerY: number;
  mouse: { x: number; y: number; pressed: boolean };
  angleRef: SphereAngleRef;
  pulseRef: { current: number };
  waveRef: { current: number };
  scatterRef: { current: boolean };
  explodeRef: { current: boolean };
  particlesRef: { current: BurstParticle[] };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 59, g: 130, b: 246 };
}

function lerpColor(
  color1: { r: number; g: number; b: number },
  color2: { r: number; g: number; b: number },
  t: number
) {
  return {
    r: Math.round(color1.r + (color2.r - color1.r) * t),
    g: Math.round(color1.g + (color2.g - color1.g) * t),
    b: Math.round(color1.b + (color2.b - color1.b) * t),
  };
}

/**
 * Physics + projection for one sphere layer (main, orbital, or reflected).
 */
export function updateAndProjectSphereLayer(
  dots: SphereDot[],
  offsetX: number,
  offsetY: number,
  scale: number,
  colorOverride: { r: number; g: number; b: number } | undefined,
  params: SphereProjectionParams
): ProjectedSphereDot[] {
  const { settings, centerX, centerY, mouse, angleRef, pulseRef, waveRef, scatterRef, explodeRef, particlesRef } =
    params;

  const projectedDots: ProjectedSphereDot[] = [];
  const dotColor = hexToRgb(settings.dotColor);
  const gradientFront = hexToRgb(settings.gradientColorFront);
  const gradientBack = hexToRgb(settings.gradientColorBack);
  const baseColor = colorOverride || dotColor;

  let pulseScale = 1;
  if (settings.pulseEnabled) {
    pulseScale = 1 + Math.sin(pulseRef.current) * settings.pulseIntensity;
  }

  let scatterMultiplier = 1;
  if (scatterRef.current) scatterMultiplier = 3;
  if (explodeRef.current) scatterMultiplier = 5;

  for (const dot of dots) {
    let x = dot.baseX;
    let y = dot.baseY;
    let z = dot.baseZ;

    const cosY = Math.cos(angleRef.current.y);
    const sinY = Math.sin(angleRef.current.y);
    let newX = x * cosY - z * sinY;
    let newZ = x * sinY + z * cosY;
    x = newX;
    z = newZ;

    if (settings.rotateX) {
      const cosX = Math.cos(angleRef.current.x);
      const sinX = Math.sin(angleRef.current.x);
      const newY = y * cosX - z * sinX;
      newZ = y * sinX + z * cosX;
      y = newY;
      z = newZ;
    }

    if (settings.rotateZ) {
      const cosZ = Math.cos(angleRef.current.z);
      const sinZ = Math.sin(angleRef.current.z);
      newX = x * cosZ - y * sinZ;
      const newY = x * sinZ + y * cosZ;
      x = newX;
      y = newY;
    }

    let waveOffset = 0;
    if (settings.waveEnabled) {
      waveOffset = Math.sin(waveRef.current + dot.baseY * 5) * settings.waveAmplitude;
    }

    const radius = settings.sphereRadius * scale * pulseScale;
    const targetX = x * radius + waveOffset;
    const targetY = y * radius;
    const targetZ = z * radius;

    const perspective = 1000 / (1000 + targetZ);
    const screenX = centerX + offsetX + targetX * perspective;
    const screenY = centerY + offsetY + targetY * perspective;

    const dx = screenX - mouse.x;
    const dy = screenY - mouse.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = 150;

    if (distance < minDistance && distance > 0) {
      const force = (minDistance - distance) / minDistance;
      let direction = settings.reverseMouseEffect ? -1 : 1;
      if (settings.gravityWellEnabled && mouse.pressed) {
        direction = -1;
      }
      const pushX = (dx / distance) * force * settings.mouseForce * 50 * direction;
      const pushY = (dy / distance) * force * settings.mouseForce * 50 * direction;
      dot.vx += pushX;
      dot.vy += pushY;

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

    dot.vx += (targetX - dot.x) * settings.returnForce / scatterMultiplier;
    dot.vy += (targetY - dot.y) * settings.returnForce / scatterMultiplier;
    dot.vz += (targetZ - dot.z) * settings.returnForce / scatterMultiplier;

    dot.x += dot.vx;
    dot.y += dot.vy;
    dot.z += dot.vz;
    dot.vx *= settings.friction;
    dot.vy *= settings.friction;
    dot.vz *= settings.friction;

    if (settings.trailsEnabled) {
      dot.trail.unshift({ x: dot.x, y: dot.y, z: dot.z });
      if (dot.trail.length > settings.trailLength) {
        dot.trail.pop();
      }
    }

    const dotPerspective = 1000 / (1000 + dot.z);
    const dotScreenX = centerX + offsetX + dot.x * dotPerspective;
    const dotScreenY = centerY + offsetY + dot.y * dotPerspective;

    const normalizedZ = (dot.z + radius) / (radius * 2);
    let opacity = 0.3 + 0.7 * normalizedZ;

    if (settings.lightSourceEnabled) {
      const lightAngle = (settings.lightSourceAngle * Math.PI) / 180;
      const lightX = Math.cos(lightAngle);
      const lightZ = Math.sin(lightAngle);
      const lightDot = (x * lightX + z * lightZ + 1) / 2;
      opacity *= 0.3 + 0.7 * lightDot;
    }

    const size = settings.dotSize * dotPerspective * 1.5 * scale;

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

  projectedDots.sort((a, b) => a.z - b.z);
  return projectedDots;
}
