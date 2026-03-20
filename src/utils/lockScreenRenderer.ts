/**
 * Lock screen background renderer preference (2D canvas vs WebGL).
 */

export type LockScreenRendererMode = "webgl" | "canvas";

const KEY = "tradebutler_lock_screen_renderer";

export function getLockScreenRendererPreference(): LockScreenRendererMode {
  const v = localStorage.getItem(KEY);
  if (v === "canvas") return "canvas";
  return "webgl";
}

export function setLockScreenRendererPreference(mode: LockScreenRendererMode): void {
  localStorage.setItem(KEY, mode);
}

let webgl2Probe: boolean | null = null;

/**
 * Probes WebGL2 availability (offscreen). Result is cached for the session.
 */
export function canUseWebGL2(): boolean {
  if (webgl2Probe !== null) return webgl2Probe;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    webgl2Probe = !!gl;
    if (gl) {
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext?.();
    }
  } catch {
    webgl2Probe = false;
  }
  return webgl2Probe;
}

export function invalidateWebGL2ProbeCache(): void {
  webgl2Probe = null;
}

/**
 * True when user wants WebGL and the runtime supports it.
 */
export function shouldUseWebGLLockBackground(): boolean {
  return getLockScreenRendererPreference() === "webgl" && canUseWebGL2();
}
