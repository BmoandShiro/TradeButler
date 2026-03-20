import * as THREE from "three";

export interface AuroraBandGPU {
  y: number;
  speed: number;
  amplitude: number;
  frequency: number;
  phase: number;
  color: { r: number; g: number; b: number };
  opacity: number;
}

export type AuroraWebGLApi = {
  renderFrame: (input: { time: number; width: number; height: number; bands: AuroraBandGPU[] }) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

const MAX_BANDS = 6;

export function createAuroraWebGLApi(mount: HTMLElement, onContextLost: () => void): AuroraWebGLApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:0";
  mount.appendChild(canvas);

  const scene = new THREE.Scene();
  let width = window.innerWidth;
  let height = window.innerHeight;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uBandCount: { value: 0 },
      uBandY: { value: new Float32Array(MAX_BANDS) },
      uBandAmp: { value: new Float32Array(MAX_BANDS) },
      uBandFreq: { value: new Float32Array(MAX_BANDS) },
      uBandPhase: { value: new Float32Array(MAX_BANDS) },
      uBandOpacity: { value: new Float32Array(MAX_BANDS) },
      uBandColor: { value: new Float32Array(MAX_BANDS * 3) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uResolution;
      uniform int uBandCount;
      uniform float uBandY[${MAX_BANDS}];
      uniform float uBandAmp[${MAX_BANDS}];
      uniform float uBandFreq[${MAX_BANDS}];
      uniform float uBandPhase[${MAX_BANDS}];
      uniform float uBandOpacity[${MAX_BANDS}];
      uniform float uBandColor[${MAX_BANDS * 3}];
      varying vec2 vUv;

      float waveY(float x, float amp, float freq, float phase, float t) {
        float w1 = sin(x * freq + t * 0.4 + phase) * amp;
        float w2 = sin(x * freq * 1.5 + t * 0.6 + phase) * (amp * 0.4);
        float w3 = sin(x * freq * 0.7 + t * 0.25 + phase) * (amp * 0.25);
        return w1 + w2 + w3;
      }

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec2 fragCoord = vUv * uResolution;
        float x = fragCoord.x;
        float y = fragCoord.y;

        vec3 col = vec3(0.0, 0.0, 0.067);

        for (int i = 0; i < ${MAX_BANDS}; i++) {
          if (i >= uBandCount) break;
          float baseY = uBandY[i];
          float amp = uBandAmp[i];
          float freq = uBandFreq[i];
          float phase = uBandPhase[i];
          float op = uBandOpacity[i];
          vec3 bcol = vec3(uBandColor[i*3], uBandColor[i*3+1], uBandColor[i*3+2]) / 255.0;

          float cy = baseY + waveY(x, amp, freq, phase, uTime);
          float layerWidth = 160.0;
          float d = abs(y - cy);
          float layer = 0.0;
          for (int L = 0; L < 3; L++) {
            float lw = layerWidth - float(L) * 50.0;
            float lo = op * (1.0 - float(L) * 0.4);
            float a = smoothstep(lw, 0.0, d) * smoothstep(lw * 2.0, lw * 0.3, lw - d + lw * 0.5);
            a *= lo * 0.5;
            layer += a;
          }
          col += bcol * layer;
        }

        float tw = sin(uTime * 2.0 + x * 0.01) * 0.3 + 0.7;
        float st = step(0.992, hash(floor(fragCoord * 0.5)));
        col += vec3(1.0) * st * 0.35 * tw * 0.4;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  const handleLoss = (e: Event) => {
    e.preventDefault();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", handleLoss, false);

  renderer.setSize(width, height, false);

  return {
    resize(w: number, h: number) {
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      (mat.uniforms.uResolution.value as THREE.Vector2).set(w, h);
    },

    renderFrame(input: { time: number; width: number; height: number; bands: AuroraBandGPU[] }) {
      const { time, bands } = input;
      renderer.setClearColor(0x000011, 1);
      mat.uniforms.uTime.value = time;
      const n = Math.min(bands.length, MAX_BANDS);
      mat.uniforms.uBandCount.value = n;
      const yArr = mat.uniforms.uBandY.value as Float32Array;
      const ampArr = mat.uniforms.uBandAmp.value as Float32Array;
      const freqArr = mat.uniforms.uBandFreq.value as Float32Array;
      const phaseArr = mat.uniforms.uBandPhase.value as Float32Array;
      const opArr = mat.uniforms.uBandOpacity.value as Float32Array;
      const colArr = mat.uniforms.uBandColor.value as Float32Array;
      for (let i = 0; i < n; i++) {
        const b = bands[i];
        yArr[i] = b.y;
        ampArr[i] = b.amplitude;
        freqArr[i] = b.frequency;
        phaseArr[i] = b.phase;
        opArr[i] = b.opacity;
        colArr[i * 3] = b.color.r;
        colArr[i * 3 + 1] = b.color.g;
        colArr[i * 3 + 2] = b.color.b;
      }
      renderer.render(scene, camera);
    },

    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLoss);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      mount.removeChild(canvas);
    },
  };
}
