/**
 * Galaxy Theme Manager Utility
 * Handles galaxy lock screen theme customization settings
 */

export interface GalaxyThemeSettings {
  particleColor: string;
  lineColor: string;
  backgroundColor: string;
  particleCount: number;
  friction: number;
  reverseGravity: boolean;
  mouseForce: number;
  connectionDistance: number;
  particleSize: {
    min: number;
    max: number;
  };
  particleCollisions: boolean;
  orbitAroundCenter: boolean;
  orbitSpeed: number;
  orbitRadius: number;
  orbitGravity: number;
  useAsBackground: boolean;
}

const GALAXY_THEME_KEY = "tradebutler_galaxy_theme_settings";

const defaultSettings: GalaxyThemeSettings = {
  particleColor: "#6496ff",
  lineColor: "#6496ff",
  backgroundColor: "#000011",
  particleCount: 100,
  friction: 0.98,
  reverseGravity: false,
  mouseForce: 0.5,
  connectionDistance: 150,
  particleSize: {
    min: 1,
    max: 3,
  },
  particleCollisions: false,
  orbitAroundCenter: false,
  orbitSpeed: 0.5,
  orbitRadius: 200,
  orbitGravity: 0.0001,
  useAsBackground: false,
};

/**
 * Get current galaxy theme settings
 */
export function getGalaxyThemeSettings(): GalaxyThemeSettings {
  const stored = localStorage.getItem(GALAXY_THEME_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all properties exist
      return { ...defaultSettings, ...parsed };
    } catch (e) {
      console.error("Error parsing galaxy theme settings:", e);
    }
  }
  return { ...defaultSettings };
}

/**
 * Set galaxy theme settings
 */
export function setGalaxyThemeSettings(settings: Partial<GalaxyThemeSettings>): void {
  const current = getGalaxyThemeSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(GALAXY_THEME_KEY, JSON.stringify(updated));
}

/**
 * Reset galaxy theme settings to defaults
 */
export function resetGalaxyThemeSettings(): void {
  localStorage.setItem(GALAXY_THEME_KEY, JSON.stringify(defaultSettings));
}
