/**
 * Sphere Theme Manager Utility
 * Handles sphere lock screen theme customization settings
 */

export type SphereShape = "sphere" | "torus" | "cube" | "helix" | "doubleHelix";

export interface SphereThemeSettings {
  // Colors
  dotColor: string;
  lineColor: string;
  /** When true, connection/wireframe lines use each layer’s dot color instead of Line Color. */
  linesMatchDotColor: boolean;
  /** WebGL only: normal alpha blending for lines instead of additive (less blown-out overlaps). */
  lineBlendSoft: boolean;
  backgroundColor: string;
  gradientEnabled: boolean;
  gradientColorFront: string;
  gradientColorBack: string;
  
  // Structure
  sphereRadius: number;
  rings: number;
  dotsPerRing: number;
  dotSize: number;
  shape: SphereShape;
  wireframeMode: boolean;
  hollowMode: boolean;
  
  // Animation
  rotationSpeed: number;
  rotateX: boolean;
  rotateY: boolean;
  rotateZ: boolean;
  pulseEnabled: boolean;
  pulseSpeed: number;
  pulseIntensity: number;
  waveEnabled: boolean;
  waveSpeed: number;
  waveAmplitude: number;
  
  // Mouse Interaction
  mouseForce: number;
  returnForce: number;
  friction: number;
  reverseMouseEffect: boolean;
  gravityWellEnabled: boolean;
  
  // Effects
  connectionDistance: number;
  showConnections: boolean;
  glowIntensity: number;
  trailsEnabled: boolean;
  trailLength: number;
  particleBurstEnabled: boolean;
  
  // Multiple Spheres
  multipleSpheresEnabled: boolean;
  additionalSphereCount: number;
  orbitingSpheresSpeed: number;
  orbitingSpheresScale: number;
  orbitingSpheresDistance: number;
  orbitingSpheresColor: string;
  /** Line/wireframe color for orbiting spheres (ignored when Lines match dot color). */
  orbitingSpheresLineColor: string;
  orbitingSpheresSameColor: boolean;
  orbitingSpheresRings: number;
  orbitingSpheresDotsPerRing: number;
  orbitingSpheresDotSize: number;
  
  // Ambient
  starsEnabled: boolean;
  starCount: number;
  starTwinkle: boolean;
  reflectionEnabled: boolean;
  reflectionOpacity: number;
  lightSourceEnabled: boolean;
  lightSourceAngle: number;
  
  // Interactive
  clickRippleEnabled: boolean;
  scatterOnWrongPin: boolean;
  explodeOnUnlock: boolean;
}

const SPHERE_THEME_KEY = "tradebutler_sphere_theme_settings";

const defaultSettings: SphereThemeSettings = {
  // Colors
  dotColor: "#3b82f6",
  lineColor: "#3b82f6",
  linesMatchDotColor: false,
  lineBlendSoft: false,
  backgroundColor: "#050510",
  gradientEnabled: false,
  gradientColorFront: "#3b82f6",
  gradientColorBack: "#8b5cf6",
  
  // Structure
  sphereRadius: 350,
  rings: 12,
  dotsPerRing: 24,
  dotSize: 3,
  shape: "sphere",
  wireframeMode: false,
  hollowMode: false,
  
  // Animation
  rotationSpeed: 0.003,
  rotateX: false,
  rotateY: true,
  rotateZ: false,
  pulseEnabled: false,
  pulseSpeed: 0.02,
  pulseIntensity: 0.1,
  waveEnabled: false,
  waveSpeed: 0.05,
  waveAmplitude: 20,
  
  // Mouse Interaction
  mouseForce: 0.15,
  returnForce: 0.03,
  friction: 0.92,
  reverseMouseEffect: false,
  gravityWellEnabled: false,
  
  // Effects
  connectionDistance: 60,
  showConnections: true,
  glowIntensity: 0.2,
  trailsEnabled: false,
  trailLength: 5,
  particleBurstEnabled: false,
  
  // Multiple Spheres
  multipleSpheresEnabled: false,
  additionalSphereCount: 2,
  orbitingSpheresSpeed: 0.01,
  orbitingSpheresScale: 0.3,
  orbitingSpheresDistance: 1.5,
  orbitingSpheresColor: "#8b5cf6",
  orbitingSpheresLineColor: "#3b82f6",
  orbitingSpheresSameColor: false,
  orbitingSpheresRings: 6,
  orbitingSpheresDotsPerRing: 12,
  orbitingSpheresDotSize: 2,
  
  // Ambient
  starsEnabled: false,
  starCount: 100,
  starTwinkle: true,
  reflectionEnabled: false,
  reflectionOpacity: 0.3,
  lightSourceEnabled: false,
  lightSourceAngle: 45,
  
  // Interactive
  clickRippleEnabled: false,
  scatterOnWrongPin: false,
  explodeOnUnlock: false,
};

/**
 * Get current sphere theme settings
 */
export function getSphereThemeSettings(): SphereThemeSettings {
  const stored = localStorage.getItem(SPHERE_THEME_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const merged = { ...defaultSettings, ...parsed } as SphereThemeSettings;
      if (!Object.prototype.hasOwnProperty.call(parsed, "orbitingSpheresLineColor")) {
        merged.orbitingSpheresLineColor = merged.lineColor;
      }
      return merged;
    } catch (e) {
      console.error("Error parsing sphere theme settings:", e);
    }
  }
  return { ...defaultSettings };
}

/**
 * Set sphere theme settings
 */
export function setSphereThemeSettings(settings: Partial<SphereThemeSettings>): void {
  const current = getSphereThemeSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SPHERE_THEME_KEY, JSON.stringify(updated));
}

/**
 * Reset sphere theme settings to defaults
 */
export function resetSphereThemeSettings(): void {
  localStorage.setItem(SPHERE_THEME_KEY, JSON.stringify(defaultSettings));
}
