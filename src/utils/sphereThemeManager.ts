/**
 * Sphere Theme Manager Utility
 * Handles sphere lock screen theme customization settings
 */

export interface SphereThemeSettings {
  dotColor: string;
  lineColor: string;
  backgroundColor: string;
  sphereRadius: number;
  rings: number;
  dotsPerRing: number;
  dotSize: number;
  rotationSpeed: number;
  mouseForce: number;
  returnForce: number;
  friction: number;
  connectionDistance: number;
  showConnections: boolean;
  glowIntensity: number;
  reverseMouseEffect: boolean;
}

const SPHERE_THEME_KEY = "tradebutler_sphere_theme_settings";

const defaultSettings: SphereThemeSettings = {
  dotColor: "#3b82f6",
  lineColor: "#3b82f6",
  backgroundColor: "#050510",
  sphereRadius: 350,
  rings: 12,
  dotsPerRing: 24,
  dotSize: 3,
  rotationSpeed: 0.003,
  mouseForce: 0.15,
  returnForce: 0.03,
  friction: 0.92,
  connectionDistance: 60,
  showConnections: true,
  glowIntensity: 0.2,
  reverseMouseEffect: false,
};

/**
 * Get current sphere theme settings
 */
export function getSphereThemeSettings(): SphereThemeSettings {
  const stored = localStorage.getItem(SPHERE_THEME_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return { ...defaultSettings, ...parsed };
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
