import * as THREE from "three";
import type { GalaxyThemeSettings } from "../../utils/galaxyThemeManager";
import type { GalaxyParticle } from "./galaxyPhysics";
import { hexToRgb } from "./galaxyPhysics";
import { forEachNeighborPairWithinDistance } from "../../utils/spatialGrid2d";

const MAX_SEGMENTS_PER_PARTICLE = 48;

export type GalaxyWebGLApi = {
  renderFrame: (particles: GalaxyParticle[], settings: GalaxyThemeSettings) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

export function createGalaxyWebGLApi(
  mount: HTMLElement,
  onContextLost: () => void
): GalaxyWebGLApi {
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

  const camera = new THREE.OrthographicCamera(
    -width / 2,
    width / 2,
    height / 2,
    -height / 2,
    0.1,
    100
  );
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

  const maxParticles = 8192;
  const pointPositions = new Float32Array(maxParticles * 3);
  const pointSizes = new Float32Array(maxParticles);
  const pointColors = new Float32Array(maxParticles * 4);

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

  const maxSegments = maxParticles * MAX_SEGMENTS_PER_PARTICLE;
  const linePositions = new Float32Array(maxSegments * 2 * 3);
  const lineColors = new Float32Array(maxSegments * 2 * 3);

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

  const xs = new Float32Array(maxParticles);
  const ys = new Float32Array(maxParticles);

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

  function canvasToWorld(px: number, py: number, out: THREE.Vector3) {
    out.set(px - width / 2, height / 2 - py, 0);
  }

  const tmp = new THREE.Vector3();
  const bgColor = new THREE.Color();

  return {
    resize: setSize,

    renderFrame(particles: GalaxyParticle[], settings: GalaxyThemeSettings) {
      const n = particles.length;
      if (n === 0) return;

      bgColor.set(settings.backgroundColor);
      renderer.setClearColor(bgColor, 1);

      const pc = hexToRgb(settings.particleColor);
      const lc = hexToRgb(settings.lineColor);

      for (let i = 0; i < n; i++) {
        const p = particles[i];
        const o = i * 3;
        pointPositions[o] = p.x - width / 2;
        pointPositions[o + 1] = height / 2 - p.y;
        pointPositions[o + 2] = 0;
        pointSizes[i] = Math.max(1, p.radius * 2);
        const alpha = 0.6 + p.shade * 0.4;
        const co = i * 4;
        pointColors[co] = pc.r / 255;
        pointColors[co + 1] = pc.g / 255;
        pointColors[co + 2] = pc.b / 255;
        pointColors[co + 3] = alpha;
      }

      pointGeo.setDrawRange(0, n);
      const posAttr = pointGeo.getAttribute("position") as THREE.BufferAttribute;
      const sizeAttr = pointGeo.getAttribute("pointSize") as THREE.BufferAttribute;
      const colAttr = pointGeo.getAttribute("pointColor") as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      for (let i = 0; i < n; i++) {
        xs[i] = particles[i].x;
        ys[i] = particles[i].y;
      }

      const cd = settings.connectionDistance;
      let segCount = 0;
      const maxSeg = maxSegments;

      forEachNeighborPairWithinDistance(xs, ys, n, cd, (i, j, dist) => {
        if (segCount >= maxSeg) return;
        const opacity = (1 - dist / cd) * 0.3;
        const o = segCount * 6;
        canvasToWorld(particles[i].x, particles[i].y, tmp);
        linePositions[o] = tmp.x;
        linePositions[o + 1] = tmp.y;
        linePositions[o + 2] = tmp.z;
        canvasToWorld(particles[j].x, particles[j].y, tmp);
        linePositions[o + 3] = tmp.x;
        linePositions[o + 4] = tmp.y;
        linePositions[o + 5] = tmp.z;

        const r = (lc.r / 255) * opacity;
        const g = (lc.g / 255) * opacity;
        const b = (lc.b / 255) * opacity;
        const co = segCount * 6;
        lineColors[co] = r;
        lineColors[co + 1] = g;
        lineColors[co + 2] = b;
        lineColors[co + 3] = r;
        lineColors[co + 4] = g;
        lineColors[co + 5] = b;

        segCount++;
      });

      lineGeo.setDrawRange(0, segCount * 2);
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
