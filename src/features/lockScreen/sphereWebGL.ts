import * as THREE from "three";
import type { SphereThemeSettings } from "../../utils/sphereThemeManager";
import { forEachNeighborPairWithinDistance } from "../../utils/spatialGrid2d";
import type { BurstParticle, ProjectedSphereDot, Ripple, Star } from "./sphereLockTypes";

const MAX_POINTS = 20000;
const MAX_LINE_VERTS = 200000;

export type SphereWebGLApi = {
  renderFrame: (input: SphereWebGLFrameInput) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

export interface SphereWebGLLayer {
  projected: ProjectedSphereDot[];
  connectionDistance: number;
  lineRgb: { r: number; g: number; b: number };
  wireframeRings: number;
  wireframeDotsPerRing: number;
  showConnections: boolean;
  wireframeMode: boolean;
  centerX: number;
  centerY: number;
  offsetX: number;
  offsetY: number;
}

export interface SphereWebGLFrameInput {
  width: number;
  height: number;
  backgroundColor: string;
  stars: Star[];
  starTwinkle: boolean;
  time: number;
  layers: SphereWebGLLayer[];
  settings: SphereThemeSettings;
  ripples: Ripple[];
  particles: BurstParticle[];
  dotRgb: { r: number; g: number; b: number };
}

export function createSphereWebGLApi(mount: HTMLElement, onContextLost: () => void): SphereWebGLApi {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const canvas = renderer.domElement;
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "0";
  mount.appendChild(canvas);

  const scene = new THREE.Scene();
  let width = window.innerWidth;
  let height = window.innerHeight;

  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const pointVertexShader = `
    attribute float pointSize;
    attribute vec4 pointColor;
    varying vec4 vColor;
    void main() {
      vColor = pointColor;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = pointSize;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;
  const pointFragmentShader = `
    varying vec4 vColor;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float r = length(c);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.2, r);
      gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    }
  `;

  const pointPositions = new Float32Array(MAX_POINTS * 3);
  const pointSizes = new Float32Array(MAX_POINTS);
  const pointColors = new Float32Array(MAX_POINTS * 4);
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3).setUsage(THREE.DynamicDrawUsage));
  pointGeo.setAttribute("pointSize", new THREE.BufferAttribute(pointSizes, 1).setUsage(THREE.DynamicDrawUsage));
  pointGeo.setAttribute("pointColor", new THREE.BufferAttribute(pointColors, 4).setUsage(THREE.DynamicDrawUsage));
  pointGeo.setDrawRange(0, 0);

  const pointMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: pointVertexShader,
    fragmentShader: pointFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pointGeo, pointMat);
  scene.add(points);

  const linePositions = new Float32Array(MAX_LINE_VERTS * 3);
  const lineColors = new Float32Array(MAX_LINE_VERTS * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));

  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lines);

  const bgColor = new THREE.Color();
  const tmp = new THREE.Vector3();

  function canvasToWorld(px: number, py: number, out: THREE.Vector3) {
    out.set(px - width / 2, height / 2 - py, 0);
  }

  let lineVertCount = 0;
  let pointCount = 0;

  function pushPoint(px: number, py: number, size: number, r: number, g: number, b: number, a: number) {
    if (pointCount >= MAX_POINTS) return;
    const o = pointCount * 3;
    canvasToWorld(px, py, tmp);
    pointPositions[o] = tmp.x;
    pointPositions[o + 1] = tmp.y;
    pointPositions[o + 2] = tmp.z;
    pointSizes[pointCount] = Math.max(1, size * 2);
    const co = pointCount * 4;
    pointColors[co] = r;
    pointColors[co + 1] = g;
    pointColors[co + 2] = b;
    pointColors[co + 3] = a;
    pointCount++;
  }

  function pushLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    a: number
  ) {
    if (lineVertCount + 2 > MAX_LINE_VERTS) return;
    let o = lineVertCount * 3;
    canvasToWorld(x1, y1, tmp);
    linePositions[o] = tmp.x;
    linePositions[o + 1] = tmp.y;
    linePositions[o + 2] = tmp.z;
    lineColors[o] = r * a;
    lineColors[o + 1] = g * a;
    lineColors[o + 2] = b * a;
    o += 3;
    canvasToWorld(x2, y2, tmp);
    linePositions[o] = tmp.x;
    linePositions[o + 1] = tmp.y;
    linePositions[o + 2] = tmp.z;
    lineColors[o] = r * a;
    lineColors[o + 1] = g * a;
    lineColors[o + 2] = b * a;
    lineVertCount += 2;
  }

  let xsBuf = new Float32Array(4096);
  let ysBuf = new Float32Array(4096);

  const handleLoss = (e: Event) => {
    e.preventDefault();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", handleLoss, false);

  function setSize(w: number, h: number) {
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }
  setSize(width, height);

  return {
    resize: setSize,

    renderFrame(input: SphereWebGLFrameInput) {
      bgColor.set(input.backgroundColor);
      renderer.setClearColor(bgColor, 1);

      pointCount = 0;
      lineVertCount = 0;

      const { stars, starTwinkle, time, settings } = input;
      lineMat.blending = settings.lineBlendSoft
        ? THREE.NormalBlending
        : THREE.AdditiveBlending;

      for (const star of stars) {
        let opacity = star.opacity;
        if (starTwinkle) {
          opacity = star.opacity * (0.5 + 0.5 * Math.sin(time * 2 + star.twinkleOffset));
        }
        pushPoint(star.x, star.y, star.size, 1, 1, 1, opacity);
      }

      for (const layer of input.layers) {
        const { projected, connectionDistance, lineRgb, wireframeRings, wireframeDotsPerRing } = layer;
        const { centerX, centerY, offsetX, offsetY } = layer;
        const lr = lineRgb.r / 255;
        const lg = lineRgb.g / 255;
        const lb = lineRgb.b / 255;

        if (settings.trailsEnabled) {
          for (let pi = 0; pi < projected.length; pi++) {
            const pd = projected[pi];
            const trail = pd.dot.trail;
            if (trail.length > 1) {
              for (let i = 0; i < trail.length - 1; i++) {
                const p0 = trail[i];
                const p1 = trail[i + 1];
                const t0p = 1000 / (1000 + p0.z);
                const t1p = 1000 / (1000 + p1.z);
                const tx0 = centerX + offsetX + p0.x * t0p;
                const ty0 = centerY + offsetY + p0.y * t0p;
                const tx1 = centerX + offsetX + p1.x * t1p;
                const ty1 = centerY + offsetY + p1.y * t1p;
                const trailOpacity = pd.opacity * 0.3 * (1 - pi / projected.length);
                pushLine(
                  tx0,
                  ty0,
                  tx1,
                  ty1,
                  pd.color.r / 255,
                  pd.color.g / 255,
                  pd.color.b / 255,
                  trailOpacity
                );
              }
            }
          }
        }

        const n = projected.length;
        if (layer.showConnections && !layer.wireframeMode && n > 0) {
          let cap = xsBuf.length;
          if (n > cap) {
            cap = n + 256;
            xsBuf = new Float32Array(cap);
            ysBuf = new Float32Array(cap);
          }
          for (let i = 0; i < n; i++) {
            xsBuf[i] = projected[i].screenX;
            ysBuf[i] = projected[i].screenY;
          }
          const cd = connectionDistance;
          forEachNeighborPairWithinDistance(xsBuf, ysBuf, n, cd, (i, j, distance) => {
            const lineOpacity =
              (1 - distance / cd) * 0.15 * Math.min(projected[i].opacity, projected[j].opacity);
            pushLine(
              projected[i].screenX,
              projected[i].screenY,
              projected[j].screenX,
              projected[j].screenY,
              lr,
              lg,
              lb,
              lineOpacity
            );
          });
        }

        if (layer.wireframeMode) {
          for (let i = 0; i < wireframeRings; i++) {
            for (let j = 0; j < wireframeDotsPerRing; j++) {
              const idx1 = i * wireframeDotsPerRing + j;
              const idx2 = i * wireframeDotsPerRing + ((j + 1) % wireframeDotsPerRing);
              if (idx1 < n && idx2 < n) {
                pushLine(
                  projected[idx1].screenX,
                  projected[idx1].screenY,
                  projected[idx2].screenX,
                  projected[idx2].screenY,
                  lr,
                  lg,
                  lb,
                  0.5
                );
              }
              if (i < wireframeRings - 1) {
                const idx3 = (i + 1) * wireframeDotsPerRing + j;
                if (idx3 < n) {
                  pushLine(
                    projected[idx1].screenX,
                    projected[idx1].screenY,
                    projected[idx3].screenX,
                    projected[idx3].screenY,
                    lr,
                    lg,
                    lb,
                    0.5
                  );
                }
              }
            }
          }
        }

        for (const pd of projected) {
          pushPoint(
            pd.screenX,
            pd.screenY,
            pd.size,
            pd.color.r / 255,
            pd.color.g / 255,
            pd.color.b / 255,
            pd.opacity
          );
          if (settings.glowIntensity > 0) {
            pushPoint(
              pd.screenX,
              pd.screenY,
              pd.size * 2,
              pd.color.r / 255,
              pd.color.g / 255,
              pd.color.b / 255,
              pd.opacity * settings.glowIntensity
            );
          }
        }
      }

      const dr = input.dotRgb.r / 255;
      const dg = input.dotRgb.g / 255;
      const db = input.dotRgb.b / 255;
      for (const ripple of input.ripples) {
        const segs = 48;
        for (let s = 0; s < segs; s++) {
          const a0 = (s / segs) * Math.PI * 2;
          const a1 = ((s + 1) / segs) * Math.PI * 2;
          const x0 = ripple.x + Math.cos(a0) * ripple.radius;
          const y0 = ripple.y + Math.sin(a0) * ripple.radius;
          const x1 = ripple.x + Math.cos(a1) * ripple.radius;
          const y1 = ripple.y + Math.sin(a1) * ripple.radius;
          pushLine(x0, y0, x1, y1, dr, dg, db, ripple.opacity);
        }
      }

      for (const p of input.particles) {
        pushPoint(p.x, p.y, p.size * p.life, dr, dg, db, p.life);
      }

      pointGeo.setDrawRange(0, pointCount);
      const posAttr = pointGeo.getAttribute("position") as THREE.BufferAttribute;
      const sizeAttr = pointGeo.getAttribute("pointSize") as THREE.BufferAttribute;
      const colAttr = pointGeo.getAttribute("pointColor") as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      lineGeo.setDrawRange(0, lineVertCount);
      const lp = lineGeo.getAttribute("position") as THREE.BufferAttribute;
      const lcAttr = lineGeo.getAttribute("color") as THREE.BufferAttribute;
      lp.needsUpdate = true;
      lcAttr.needsUpdate = true;

      renderer.render(scene, camera);
    },

    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLoss);
      pointGeo.dispose();
      pointMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();
      mount.removeChild(canvas);
    },
  };
}
