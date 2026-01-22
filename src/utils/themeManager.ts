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

const THEME_STORAGE_KEY = "tradebutler_theme_colors";

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
