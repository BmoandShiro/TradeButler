import type { SphereShape } from "../../utils/sphereThemeManager";

export interface SphereDot {
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

export interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleOffset: number;
}

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

export interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface ProjectedSphereDot {
  screenX: number;
  screenY: number;
  z: number;
  opacity: number;
  size: number;
  color: { r: number; g: number; b: number };
  dot: SphereDot;
}

export function generateDots(
  shape: SphereShape,
  rings: number,
  dotsPerRing: number,
  radius: number,
  dotSize: number,
  hollow: boolean
): SphereDot[] {
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
            baseX: x,
            baseY: y,
            baseZ: z,
            x: x * radius,
            y: y * radius,
            z: z * radius,
            vx: 0,
            vy: 0,
            vz: 0,
            radius: dotSize,
            trail: [],
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
            baseX: x,
            baseY: y,
            baseZ: z,
            x: x * radius,
            y: y * radius,
            z: z * radius,
            vx: 0,
            vy: 0,
            vz: 0,
            radius: dotSize,
            trail: [],
          });
        }
      }
      break;
    }
    case "cube": {
      const size = 1;
      const dotsPerEdge = Math.ceil(Math.cbrt((rings * dotsPerRing) / 6));
      for (let face = 0; face < 6; face++) {
        for (let i = 0; i < dotsPerEdge; i++) {
          for (let j = 0; j < dotsPerEdge; j++) {
            const u = (i / (dotsPerEdge - 1)) * 2 - 1;
            const v = (j / (dotsPerEdge - 1)) * 2 - 1;
            let x = 0,
              y = 0,
              z = 0;
            switch (face) {
              case 0:
                x = size;
                y = u;
                z = v;
                break;
              case 1:
                x = -size;
                y = u;
                z = v;
                break;
              case 2:
                x = u;
                y = size;
                z = v;
                break;
              case 3:
                x = u;
                y = -size;
                z = v;
                break;
              case 4:
                x = u;
                y = v;
                z = size;
                break;
              case 5:
                x = u;
                y = v;
                z = -size;
                break;
            }
            dots.push({
              baseX: x,
              baseY: y,
              baseZ: z,
              x: x * radius * 0.7,
              y: y * radius * 0.7,
              z: z * radius * 0.7,
              vx: 0,
              vy: 0,
              vz: 0,
              radius: dotSize,
              trail: [],
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
          baseX: x,
          baseY: y,
          baseZ: z,
          x: x * radius,
          y: y * radius,
          z: z * radius,
          vx: 0,
          vy: 0,
          vz: 0,
          radius: dotSize,
          trail: [],
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
            baseX: x,
            baseY: y,
            baseZ: z,
            x: x * radius,
            y: y * radius,
            z: z * radius,
            vx: 0,
            vy: 0,
            vz: 0,
            radius: dotSize,
            trail: [],
          });
        }
      }
      break;
    }
  }

  return dots;
}
