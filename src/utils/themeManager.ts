/**
 * Theme Manager Utility
 * Handles theme color customization and CSS variable updates
 */

export interface ThemeColors {
  // Background colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;
  
  // Border
  borderColor: string;
  
  // Text colors
  textPrimary: string;
  textSecondary: string;
  
  // Accent colors
  accent: string;
  accentHover: string;
  
  // Status colors
  success: string;
  danger: string;
  warning: string;
  profit: string;
  loss: string;
}

export const defaultTheme: ThemeColors = {
  bgPrimary: "#0a0a0a",
  bgSecondary: "#141414",
  bgTertiary: "#1a1a1a",
  bgHover: "#242424",
  borderColor: "#2a2a2a",
  textPrimary: "#e0e0e0",
  textSecondary: "#a0a0a0",
  accent: "#3b82f6",
  accentHover: "#2563eb",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  profit: "#10b981",
  loss: "#ef4444",
};

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
  isCustom: boolean;
}

// Built-in preset themes
export const presetThemes: ThemePreset[] = [
  {
    id: "dark",
    name: "Dark (Default)",
    isCustom: false,
    colors: {
      bgPrimary: "#0a0a0a",
      bgSecondary: "#141414",
      bgTertiary: "#1a1a1a",
      bgHover: "#242424",
      borderColor: "#2a2a2a",
      textPrimary: "#e0e0e0",
      textSecondary: "#a0a0a0",
      accent: "#3b82f6",
      accentHover: "#2563eb",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      profit: "#10b981",
      loss: "#ef4444",
    },
  },
  {
    id: "light",
    name: "Light",
    isCustom: false,
    colors: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f5f5f5",
      bgTertiary: "#e5e5e5",
      bgHover: "#d4d4d4",
      borderColor: "#d1d5db",
      textPrimary: "#1f2937",
      textSecondary: "#6b7280",
      accent: "#3b82f6",
      accentHover: "#2563eb",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      profit: "#10b981",
      loss: "#ef4444",
    },
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    isCustom: false,
    colors: {
      bgPrimary: "#000000",
      bgSecondary: "#1a1a1a",
      bgTertiary: "#2a2a2a",
      bgHover: "#3a3a3a",
      borderColor: "#ffffff",
      textPrimary: "#ffffff",
      textSecondary: "#cccccc",
      accent: "#00ffff",
      accentHover: "#00cccc",
      success: "#00ff00",
      danger: "#ff0000",
      warning: "#ffff00",
      profit: "#00ff00",
      loss: "#ff0000",
    },
  },
  {
    id: "blue",
    name: "Blue",
    isCustom: false,
    colors: {
      bgPrimary: "#0f172a",
      bgSecondary: "#1e293b",
      bgTertiary: "#334155",
      bgHover: "#475569",
      borderColor: "#64748b",
      textPrimary: "#e2e8f0",
      textSecondary: "#94a3b8",
      accent: "#3b82f6",
      accentHover: "#2563eb",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      profit: "#10b981",
      loss: "#ef4444",
    },
  },
  {
    id: "green",
    name: "Green",
    isCustom: false,
    colors: {
      bgPrimary: "#0a1f0a",
      bgSecondary: "#142814",
      bgTertiary: "#1e3a1e",
      bgHover: "#284c28",
      borderColor: "#2a5a2a",
      textPrimary: "#e0f0e0",
      textSecondary: "#a0c0a0",
      accent: "#22c55e",
      accentHover: "#16a34a",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      profit: "#10b981",
      loss: "#ef4444",
    },
  },
  {
    id: "purple",
    name: "Purple",
    isCustom: false,
    colors: {
      bgPrimary: "#1a0a1a",
      bgSecondary: "#241424",
      bgTertiary: "#2e1e2e",
      bgHover: "#382838",
      borderColor: "#3a2a3a",
      textPrimary: "#f0e0f0",
      textSecondary: "#c0a0c0",
      accent: "#a855f7",
      accentHover: "#9333ea",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      profit: "#10b981",
      loss: "#ef4444",
    },
  },
  {
    id: "spooky",
    name: "Spooky",
    isCustom: false,
    colors: {
      bgPrimary: "#0d0d0d",
      bgSecondary: "#1a1a1a",
      bgTertiary: "#262626",
      bgHover: "#333333",
      borderColor: "#404040",
      textPrimary: "#e8e0e8",
      textSecondary: "#a090a0",
      accent: "#f97316",
      accentHover: "#ea580c",
      success: "#22c55e",
      danger: "#dc2626",
      warning: "#a855f7",
      profit: "#22c55e",
      loss: "#dc2626",
    },
  },
  {
    id: "neon",
    name: "Neon",
    isCustom: false,
    colors: {
      bgPrimary: "#0a0a0a",
      bgSecondary: "#141414",
      bgTertiary: "#1c1c1c",
      bgHover: "#252525",
      borderColor: "#2e2e2e",
      textPrimary: "#e0e0e0",
      textSecondary: "#888888",
      accent: "#00f5ff",
      accentHover: "#00c4cc",
      success: "#39ff14",
      danger: "#ff073a",
      warning: "#bf00ff",
      profit: "#39ff14",
      loss: "#ff073a",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    isCustom: false,
    colors: {
      bgPrimary: "#3B1B50",
      bgSecondary: "#493F46",
      bgTertiary: "#5a4a52",
      bgHover: "#6E5B6E",
      borderColor: "#7a6a7a",
      textPrimary: "#e8e0e0",
      textSecondary: "#b0a0a0",
      accent: "#D0886A",
      accentHover: "#b87252",
      success: "#22c55e",
      danger: "#dc2626",
      warning: "#a855f7",
      profit: "#22c55e",
      loss: "#dc2626",
    },
  },
  {
    id: "cotton-candy",
    name: "Cotton Candy",
    isCustom: false,
    colors: {
      bgPrimary: "#F0F8FF",
      bgSecondary: "#e6f2ff",
      bgTertiary: "#d4e8f7",
      bgHover: "#b8d4e8",
      borderColor: "#87CEEB",
      textPrimary: "#2a2a2a",
      textSecondary: "#6A809A",
      accent: "#FFB6C1",
      accentHover: "#ff8fab",
      success: "#22c55e",
      danger: "#ef4444",
      warning: "#FFA07A",
      profit: "#22c55e",
      loss: "#ef4444",
    },
  },
  {
    id: "chalk",
    name: "Chalk",
    isCustom: false,
    colors: {
      bgPrimary: "#361A19",
      bgSecondary: "#4a2524",
      bgTertiary: "#644B66",
      bgHover: "#735a75",
      borderColor: "#7a6a7c",
      textPrimary: "#f0e8e4",
      textSecondary: "#b0a0a0",
      accent: "#FA5D5A",
      accentHover: "#e04a47",
      success: "#22c55e",
      danger: "#FA5D5A",
      warning: "#FFC08E",
      profit: "#22c55e",
      loss: "#FA5D5A",
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    isCustom: false,
    colors: {
      bgPrimary: "#0a1218",
      bgSecondary: "#0f1a22",
      bgTertiary: "#152230",
      bgHover: "#1e2d40",
      borderColor: "#2a3f52",
      textPrimary: "#e8f0f4",
      textSecondary: "#94a8b8",
      accent: "#2dd4bf",
      accentHover: "#14b8a6",
      success: "#4ade80",
      danger: "#f43f5e",
      warning: "#a78bfa",
      profit: "#4ade80",
      loss: "#f43f5e",
    },
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    isCustom: false,
    colors: {
      bgPrimary: "#1a0a2e",
      bgSecondary: "#251535",
      bgTertiary: "#2e1a45",
      bgHover: "#3d2560",
      borderColor: "#5c3d80",
      textPrimary: "#f0e8f8",
      textSecondary: "#b8a0c8",
      accent: "#ff6ec7",
      accentHover: "#ff3db5",
      success: "#00fff5",
      danger: "#ff3366",
      warning: "#fff700",
      profit: "#00fff5",
      loss: "#ff3366",
    },
  },
  {
    id: "meadow",
    name: "Meadow",
    isCustom: false,
    colors: {
      bgPrimary: "#141810",
      bgSecondary: "#1c2218",
      bgTertiary: "#262e20",
      bgHover: "#363e2a",
      borderColor: "#4a5440",
      textPrimary: "#e8f0e4",
      textSecondary: "#a0b098",
      accent: "#c4b5fd",
      accentHover: "#a78bfa",
      success: "#86efac",
      danger: "#fda4af",
      warning: "#fde047",
      profit: "#86efac",
      loss: "#fda4af",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    isCustom: false,
    colors: {
      bgPrimary: "#0c1929",
      bgSecondary: "#0f2438",
      bgTertiary: "#143044",
      bgHover: "#1e4a66",
      borderColor: "#2a5f7a",
      textPrimary: "#e0f2f7",
      textSecondary: "#8eb8c8",
      accent: "#22d3ee",
      accentHover: "#06b6d4",
      success: "#2dd4bf",
      danger: "#f43f5e",
      warning: "#fbbf24",
      profit: "#2dd4bf",
      loss: "#f43f5e",
    },
  },
  {
    id: "rose-gold",
    name: "Rose Gold",
    isCustom: false,
    colors: {
      bgPrimary: "#1a1514",
      bgSecondary: "#252019",
      bgTertiary: "#322a24",
      bgHover: "#4a3f35",
      borderColor: "#5c5045",
      textPrimary: "#f5ebe0",
      textSecondary: "#c4b5a5",
      accent: "#e8b4b8",
      accentHover: "#d4959a",
      success: "#86efac",
      danger: "#fca5a5",
      warning: "#fcd34d",
      profit: "#86efac",
      loss: "#fca5a5",
    },
  },
];

const THEME_STORAGE_KEY = "tradebutler_theme_colors";
const CUSTOM_PRESETS_KEY = "tradebutler_custom_theme_presets";

/**
 * Load theme from localStorage
 */
export function loadTheme(): ThemeColors {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure all properties exist
      return { ...defaultTheme, ...parsed };
    } catch (e) {
      console.error("Error loading theme:", e);
      return defaultTheme;
    }
  }
  return defaultTheme;
}

/**
 * Save theme to localStorage
 */
export function saveTheme(theme: ThemeColors): void {
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
}

/**
 * Apply theme to CSS variables
 */
export function applyTheme(theme: ThemeColors): void {
  const root = document.documentElement;
  
  root.style.setProperty("--bg-primary", theme.bgPrimary);
  root.style.setProperty("--bg-secondary", theme.bgSecondary);
  root.style.setProperty("--bg-tertiary", theme.bgTertiary);
  root.style.setProperty("--bg-hover", theme.bgHover);
  root.style.setProperty("--border-color", theme.borderColor);
  root.style.setProperty("--text-primary", theme.textPrimary);
  root.style.setProperty("--text-secondary", theme.textSecondary);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-hover", theme.accentHover);
  root.style.setProperty("--success", theme.success);
  root.style.setProperty("--danger", theme.danger);
  root.style.setProperty("--warning", theme.warning);
  root.style.setProperty("--profit", theme.profit);
  root.style.setProperty("--loss", theme.loss);
}

/**
 * Reset theme to defaults
 */
export function resetTheme(): void {
  saveTheme(defaultTheme);
  applyTheme(defaultTheme);
}

/**
 * Initialize theme on app load
 */
export function initializeTheme(): void {
  const theme = loadTheme();
  applyTheme(theme);
}

/**
 * Get all custom presets
 */
export function getCustomPresets(): ThemePreset[] {
  const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error("Error loading custom presets:", e);
      return [];
    }
  }
  return [];
}

/**
 * Save a custom preset
 */
export function saveCustomPreset(preset: ThemePreset): void {
  const presets = getCustomPresets();
  // Check if preset with same ID exists
  const existingIndex = presets.findIndex(p => p.id === preset.id);
  if (existingIndex >= 0) {
    presets[existingIndex] = preset;
  } else {
    presets.push(preset);
  }
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

/**
 * Delete a custom preset
 */
export function deleteCustomPreset(presetId: string): void {
  const presets = getCustomPresets();
  const filtered = presets.filter(p => p.id !== presetId);
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(filtered));
}

/**
 * Get preset by ID (built-in or custom)
 */
export function getPresetById(presetId: string): ThemePreset | null {
  // Check built-in presets first
  const builtIn = presetThemes.find(p => p.id === presetId);
  if (builtIn) return builtIn;
  
  // Check custom presets
  const custom = getCustomPresets().find(p => p.id === presetId);
  return custom || null;
}

/**
 * Create a custom preset from current theme
 */
export function createPresetFromCurrentTheme(name: string): ThemePreset {
  const currentTheme = loadTheme();
  const preset: ThemePreset = {
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    colors: currentTheme,
    isCustom: true,
  };
  saveCustomPreset(preset);
  return preset;
}

/**
 * Get all presets (built-in + custom)
 */
export function getAllPresets(): ThemePreset[] {
  return [...presetThemes, ...getCustomPresets()];
}
