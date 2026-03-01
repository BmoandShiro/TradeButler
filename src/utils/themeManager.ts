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
  // Dracula and similar dark + vibrant accent themes (dark base)
  {
    id: "dracula",
    name: "Dracula",
    isCustom: false,
    colors: {
      bgPrimary: "#181920",
      bgSecondary: "#1e1f2a",
      bgTertiary: "#252631",
      bgHover: "#343746",
      borderColor: "#44475a",
      textPrimary: "#f8f8f2",
      textSecondary: "#6272a4",
      accent: "#bd93f9",
      accentHover: "#a78bfa",
      success: "#50fa7b",
      danger: "#ff5555",
      warning: "#ffb86c",
      profit: "#50fa7b",
      loss: "#ff5555",
    },
  },
  {
    id: "dracula-pink",
    name: "Dracula (Pink accent)",
    isCustom: false,
    colors: {
      bgPrimary: "#181920",
      bgSecondary: "#1e1f2a",
      bgTertiary: "#252631",
      bgHover: "#343746",
      borderColor: "#44475a",
      textPrimary: "#f8f8f2",
      textSecondary: "#6272a4",
      accent: "#ff79c6",
      accentHover: "#ff5dad",
      success: "#50fa7b",
      danger: "#ff5555",
      warning: "#f1fa8c",
      profit: "#50fa7b",
      loss: "#ff5555",
    },
  },
  {
    id: "nord",
    name: "Nord",
    isCustom: false,
    colors: {
      bgPrimary: "#1e222a",
      bgSecondary: "#252b33",
      bgTertiary: "#2e3540",
      bgHover: "#3b4252",
      borderColor: "#3b4252",
      textPrimary: "#eceff4",
      textSecondary: "#8f9bb3",
      accent: "#88c0d0",
      accentHover: "#81a1c1",
      success: "#a3be8c",
      danger: "#bf616a",
      warning: "#ebcb8b",
      profit: "#a3be8c",
      loss: "#bf616a",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    isCustom: false,
    colors: {
      bgPrimary: "#0f0f14",
      bgSecondary: "#16161e",
      bgTertiary: "#1f2335",
      bgHover: "#292e42",
      borderColor: "#3b4261",
      textPrimary: "#c0caf5",
      textSecondary: "#787c99",
      accent: "#7aa2f7",
      accentHover: "#7dcfff",
      success: "#9ece6a",
      danger: "#f7768e",
      warning: "#e0af68",
      profit: "#9ece6a",
      loss: "#f7768e",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    isCustom: false,
    colors: {
      bgPrimary: "#11111b",
      bgSecondary: "#181825",
      bgTertiary: "#1e1e2e",
      bgHover: "#313244",
      borderColor: "#45475a",
      textPrimary: "#cdd6f4",
      textSecondary: "#6c7086",
      accent: "#cba6f7",
      accentHover: "#b4befe",
      success: "#a6e3a1",
      danger: "#f38ba8",
      warning: "#f9e2af",
      profit: "#a6e3a1",
      loss: "#f38ba8",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    isCustom: false,
    colors: {
      bgPrimary: "#1d2021",
      bgSecondary: "#282828",
      bgTertiary: "#3c3836",
      bgHover: "#504945",
      borderColor: "#504945",
      textPrimary: "#ebdbb2",
      textSecondary: "#928374",
      accent: "#fe8019",
      accentHover: "#d65d0e",
      success: "#b8bb26",
      danger: "#fb4934",
      warning: "#fabd2f",
      profit: "#b8bb26",
      loss: "#fb4934",
    },
  },
  // Hacker / terminal-style themes
  {
    id: "terminal-green",
    name: "Terminal Green",
    isCustom: false,
    colors: {
      bgPrimary: "#0a0e0a",
      bgSecondary: "#0f140f",
      bgTertiary: "#141c14",
      bgHover: "#1a241a",
      borderColor: "#1e2e1e",
      textPrimary: "#00ff41",
      textSecondary: "#00cc33",
      accent: "#00ff41",
      accentHover: "#33ff66",
      success: "#00ff41",
      danger: "#ff3333",
      warning: "#ffcc00",
      profit: "#00ff41",
      loss: "#ff3333",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    isCustom: false,
    colors: {
      bgPrimary: "#0d0d0d",
      bgSecondary: "#0a1210",
      bgTertiary: "#0f1a14",
      bgHover: "#152018",
      borderColor: "#1a2e22",
      textPrimary: "#20c060",
      textSecondary: "#168040",
      accent: "#28d070",
      accentHover: "#38e080",
      success: "#20c060",
      danger: "#c04040",
      warning: "#28d070",
      profit: "#20c060",
      loss: "#c04040",
    },
  },
  {
    id: "cyber-cyan",
    name: "Cyber Cyan",
    isCustom: false,
    colors: {
      bgPrimary: "#0a0d12",
      bgSecondary: "#0f1419",
      bgTertiary: "#141c24",
      bgHover: "#1a2430",
      borderColor: "#1e2d3d",
      textPrimary: "#20a0a8",
      textSecondary: "#187078",
      accent: "#28b8c0",
      accentHover: "#40d0d8",
      success: "#20a868",
      danger: "#b04050",
      warning: "#28b8c0",
      profit: "#20a868",
      loss: "#b04050",
    },
  },
  {
    id: "amber-phosphor",
    name: "Amber Phosphor",
    isCustom: false,
    colors: {
      bgPrimary: "#0d0a08",
      bgSecondary: "#141008",
      bgTertiary: "#1a150c",
      bgHover: "#241c10",
      borderColor: "#2e2414",
      textPrimary: "#ffb000",
      textSecondary: "#cc8c00",
      accent: "#ffb000",
      accentHover: "#ffc233",
      success: "#00cc66",
      danger: "#ff4444",
      warning: "#ffb000",
      profit: "#00cc66",
      loss: "#ff4444",
    },
  },
  {
    id: "red-alert",
    name: "Red Alert",
    isCustom: false,
    colors: {
      bgPrimary: "#0d0808",
      bgSecondary: "#140c0c",
      bgTertiary: "#1a1010",
      bgHover: "#241414",
      borderColor: "#2e1a1a",
      textPrimary: "#ff3333",
      textSecondary: "#cc2929",
      accent: "#ff4444",
      accentHover: "#ff6666",
      success: "#00cc52",
      danger: "#ff3333",
      warning: "#ff8844",
      profit: "#00cc52",
      loss: "#ff3333",
    },
  },
  {
    id: "murder-red",
    name: "Murder Red",
    isCustom: false,
    colors: {
      bgPrimary: "#0d0808",
      bgSecondary: "#140a0a",
      bgTertiary: "#1a0c0c",
      bgHover: "#241010",
      borderColor: "#2e1818",
      textPrimary: "#e8c0c0",
      textSecondary: "#a06060",
      accent: "#8b2020",
      accentHover: "#a82828",
      success: "#308030",
      danger: "#8b2020",
      warning: "#a06020",
      profit: "#308030",
      loss: "#8b2020",
    },
  },
  {
    id: "haunted",
    name: "Haunted",
    isCustom: false,
    colors: {
      bgPrimary: "#0f0d12",
      bgSecondary: "#16141a",
      bgTertiary: "#1e1a24",
      bgHover: "#28242e",
      borderColor: "#3a3442",
      textPrimary: "#d8d0e0",
      textSecondary: "#807890",
      accent: "#6b5b80",
      accentHover: "#8a7899",
      success: "#408060",
      danger: "#804050",
      warning: "#907060",
      profit: "#408060",
      loss: "#804050",
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
