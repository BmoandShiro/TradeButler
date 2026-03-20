import type { GalaxyThemeSettings } from "../../utils/galaxyThemeManager";

export interface GalaxyParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Stable display variation 0..1 (replaces per-frame Math.random for fill alpha). */
  shade: number;
}

export function createGalaxyParticles(
  settings: GalaxyThemeSettings,
  width: number,
  height: number
): GalaxyParticle[] {
  const particles: GalaxyParticle[] = [];
  for (let i = 0; i < settings.particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.random() * (settings.particleSize.max - settings.particleSize.min) + settings.particleSize.min,
      shade: Math.random(),
    });
  }
  return particles;
}

/**
 * Single simulation step for all galaxy particles (canvas + WebGL share this).
 */
export function stepGalaxyParticles(
  particles: GalaxyParticle[],
  settings: GalaxyThemeSettings,
  mouse: { x: number; y: number },
  width: number,
  height: number
): void {
  const centerX = width / 2;
  const centerY = height / 2;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    if (settings.orbitAroundCenter) {
      const dxToCenter = p.x - centerX;
      const dyToCenter = p.y - centerY;
      const distanceToCenter = Math.sqrt(dxToCenter * dxToCenter + dyToCenter * dyToCenter);

      if (distanceToCenter > 0) {
        const angleToCenter = Math.atan2(dyToCenter, dxToCenter);
        const tangentialAngle = angleToCenter + Math.PI / 2;
        const orbitalForce = settings.orbitSpeed * 0.01;
        p.vx += Math.cos(tangentialAngle) * orbitalForce;
        p.vy += Math.sin(tangentialAngle) * orbitalForce;
        const centripetalForce = (distanceToCenter - settings.orbitRadius) * settings.orbitGravity;
        p.vx -= Math.cos(angleToCenter) * centripetalForce;
        p.vy -= Math.sin(angleToCenter) * centripetalForce;
      }
    }

    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = 100;

    if (distance < minDistance) {
      const force = (minDistance - distance) / minDistance;
      const angle = Math.atan2(dy, dx);
      const forceMultiplier = settings.reverseGravity ? -1 : 1;
      p.vx += Math.cos(angle) * force * settings.mouseForce * forceMultiplier;
      p.vy += Math.sin(angle) * force * settings.mouseForce * forceMultiplier;
    }

    if (settings.particleCollisions) {
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const ddx = p.x - p2.x;
        const ddy = p.y - p2.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        const minDist = p.radius + p2.radius;

        if (dist < minDist && dist > 0) {
          const angle = Math.atan2(ddy, ddx);
          const sin = Math.sin(angle);
          const cos = Math.cos(angle);

          const vx1 = p.vx * cos + p.vy * sin;
          const vy1 = p.vy * cos - p.vx * sin;
          const vx2 = p2.vx * cos + p2.vy * sin;
          const vy2 = p2.vy * cos - p2.vx * sin;

          const swappedVx1 = vx2;
          const swappedVx2 = vx1;

          p.vx = swappedVx1 * cos - vy1 * sin;
          p.vy = vy1 * cos + swappedVx1 * sin;
          p2.vx = swappedVx2 * cos - vy2 * sin;
          p2.vy = vy2 * cos + swappedVx2 * sin;

          const overlap = minDist - dist;
          const separationX = (ddx / dist) * overlap * 0.5;
          const separationY = (ddy / dist) * overlap * 0.5;
          p.x += separationX;
          p.y += separationY;
          p2.x -= separationX;
          p2.y -= separationY;
        }
      }
    }

    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) p.x = width;
    if (p.x > width) p.x = 0;
    if (p.y < 0) p.y = height;
    if (p.y > height) p.y = 0;

    p.vx *= settings.friction;
    p.vy *= settings.friction;
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 150, b: 255 };
}
