import * as THREE from "three";

export interface MilkyWayStarGPU {
  x2d: number;
  y2d: number;
  size: number;
  brightness: number;
}

export type MilkyWayWebGLApi = {
  renderFrame: (input: {
    width: number;
    height: number;
    stars: MilkyWayStarGPU[];
    timeMs: number;
  }) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

const MAX_STARS = 4096;

export function createMilkyWayWebGLApi(mount: HTMLElement, onContextLost: () => void): MilkyWayWebGLApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:0";
  mount.appendChild(canvas);

  const scene = new THREE.Scene();
  let width = window.innerWidth;
  let height = window.innerHeight;
  renderer.setSize(width, height, false);

  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const starPos = new Float32Array(MAX_STARS * 3);
  const starCol = new Float32Array(MAX_STARS * 4);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3).setUsage(THREE.DynamicDrawUsage));
  starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 4).setUsage(THREE.DynamicDrawUsage));
  starGeo.setDrawRange(0, 0);

  const starMat = new THREE.PointsMaterial({
    size: 3,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.renderOrder = 0;
  scene.add(starPoints);

  const nebulaMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uResolution;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 fragCoord = vUv * uResolution;
        vec2 center = uResolution * 0.5;
        float t = uTime * 0.0001;
        float a = 0.0;
        vec3 rgb = vec3(0.0);

        vec2 n0 = vec2(uResolution.x * (1.0 / 6.0), center.y + sin(t) * 100.0);
        float d0 = distance(fragCoord, n0);
        float a0 = (1.0 - smoothstep(0.0, 300.0, d0)) * 0.15;
        rgb += vec3(138.0/255.0, 43.0/255.0, 226.0/255.0) * a0;
        a += a0;

        vec2 n1 = vec2(uResolution.x * 0.5, center.y + sin(t + 2.0) * 100.0);
        float d1 = distance(fragCoord, n1);
        float a1 = (1.0 - smoothstep(0.0, 300.0, d1)) * 0.12;
        rgb += vec3(0.0, 191.0/255.0, 1.0) * a1;
        a += a1;

        vec2 n2 = vec2(uResolution.x * (5.0 / 6.0), center.y + sin(t + 4.0) * 100.0);
        float d2 = distance(fragCoord, n2);
        float a2 = (1.0 - smoothstep(0.0, 300.0, d2)) * 0.1;
        rgb += vec3(1.0, 20.0/255.0, 147.0/255.0) * a2;
        a += a2;

        gl_FragColor = vec4(rgb, clamp(a, 0.0, 0.5));
      }
    `,
  });
  const nebulaMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), nebulaMat);
  nebulaMesh.position.z = 1;
  nebulaMesh.renderOrder = 1;
  scene.add(nebulaMesh);

  const handleLoss = (e: Event) => {
    e.preventDefault();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", handleLoss, false);

  return {
    resize(w: number, h: number) {
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      (nebulaMat.uniforms.uResolution.value as THREE.Vector2).set(w, h);
      nebulaMesh.geometry.dispose();
      nebulaMesh.geometry = new THREE.PlaneGeometry(w, h);
      camera.left = -w / 2;
      camera.right = w / 2;
      camera.top = h / 2;
      camera.bottom = -h / 2;
      camera.updateProjectionMatrix();
    },

    renderFrame(input: { width: number; height: number; stars: MilkyWayStarGPU[]; timeMs: number }) {
      nebulaMat.uniforms.uTime.value = input.timeMs;
      const n = Math.min(input.stars.length, MAX_STARS);
      for (let i = 0; i < n; i++) {
        const s = input.stars[i];
        const o = i * 3;
        starPos[o] = s.x2d - width / 2;
        starPos[o + 1] = height / 2 - s.y2d;
        starPos[o + 2] = 0;
        const co = i * 4;
        starCol[co] = 1;
        starCol[co + 1] = 1;
        starCol[co + 2] = 1;
        starCol[co + 3] = s.brightness;
      }
      starGeo.setDrawRange(0, n);
      (starGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (starGeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

      renderer.setClearColor(0x000000, 1);
      renderer.render(scene, camera);
    },

    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLoss);
      starGeo.dispose();
      starMat.dispose();
      nebulaMesh.geometry.dispose();
      nebulaMat.dispose();
      renderer.dispose();
      mount.removeChild(canvas);
    },
  };
}
