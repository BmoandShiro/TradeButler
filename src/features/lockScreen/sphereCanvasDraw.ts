import type { SphereThemeSettings } from "../../utils/sphereThemeManager";
import { forEachNeighborPairWithinDistance } from "../../utils/spatialGrid2d";
import type { ProjectedSphereDot } from "./sphereLockTypes";

export function drawSphereLayerOnCanvas(
  ctx: CanvasRenderingContext2D,
  projectedDots: ProjectedSphereDot[],
  settings: SphereThemeSettings,
  lineColor: { r: number; g: number; b: number },
  centerX: number,
  centerY: number,
  offsetX: number,
  offsetY: number,
  wireframeRings: number,
  wireframeDotsPerRing: number
): void {
  if (settings.trailsEnabled) {
    for (let pi = 0; pi < projectedDots.length; pi++) {
      const pd = projectedDots[pi];
      const trail = pd.dot.trail;
      if (trail.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const trailPerspective = 1000 / (1000 + trail[i].z);
          const tx = centerX + offsetX + trail[i].x * trailPerspective;
          const ty = centerY + offsetY + trail[i].y * trailPerspective;
          if (i === 0) ctx.moveTo(tx, ty);
          else ctx.lineTo(tx, ty);
        }
        const trailOpacity = pd.opacity * 0.3 * (1 - pi / projectedDots.length);
        ctx.strokeStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${trailOpacity})`;
        ctx.lineWidth = pd.size * 0.5;
        ctx.stroke();
      }
    }
  }

  const n = projectedDots.length;
  if (settings.showConnections && !settings.wireframeMode && n > 0) {
    ctx.lineWidth = 1;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = projectedDots[i].screenX;
      ys[i] = projectedDots[i].screenY;
    }
    const cd = settings.connectionDistance;
    forEachNeighborPairWithinDistance(xs, ys, n, cd, (i, j, distance) => {
      const lineOpacity =
        (1 - distance / cd) * 0.15 * Math.min(projectedDots[i].opacity, projectedDots[j].opacity);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${lineOpacity})`;
      ctx.moveTo(projectedDots[i].screenX, projectedDots[i].screenY);
      ctx.lineTo(projectedDots[j].screenX, projectedDots[j].screenY);
      ctx.stroke();
    });
  }

  if (settings.wireframeMode) {
    ctx.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, 0.5)`;
    ctx.lineWidth = 1;
    for (let i = 0; i < wireframeRings; i++) {
      for (let j = 0; j < wireframeDotsPerRing; j++) {
        const idx1 = i * wireframeDotsPerRing + j;
        const idx2 = i * wireframeDotsPerRing + ((j + 1) % wireframeDotsPerRing);
        if (idx1 < projectedDots.length && idx2 < projectedDots.length) {
          ctx.beginPath();
          ctx.moveTo(projectedDots[idx1].screenX, projectedDots[idx1].screenY);
          ctx.lineTo(projectedDots[idx2].screenX, projectedDots[idx2].screenY);
          ctx.stroke();
        }
        if (i < wireframeRings - 1) {
          const idx3 = (i + 1) * wireframeDotsPerRing + j;
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

  for (const pd of projectedDots) {
    ctx.beginPath();
    ctx.arc(pd.screenX, pd.screenY, pd.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${pd.opacity})`;
    ctx.fill();

    if (settings.glowIntensity > 0) {
      ctx.beginPath();
      ctx.arc(pd.screenX, pd.screenY, pd.size * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pd.color.r}, ${pd.color.g}, ${pd.color.b}, ${pd.opacity * settings.glowIntensity})`;
      ctx.fill();
    }
  }
}
