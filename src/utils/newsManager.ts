/**
 * News Manager - Utility functions for managing news settings and state
 */

// LocalStorage keys
export const NEWS_WATCHED_SYMBOLS_KEY = "tradebutler_news_watched_symbols";
export const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";
export const NEWS_AUTO_REFRESH_KEY = "tradebutler_news_auto_refresh";
export const NEWS_NOTIFICATIONS_ENABLED_KEY = "tradebutler_news_notifications_enabled";
export const NEWS_NOTIFICATION_INTERVAL_KEY = "tradebutler_news_notification_interval";
export const NEWS_LAST_SEEN_IDS_KEY = "tradebutler_news_last_seen_ids";
export const NEWS_LAST_FETCH_KEY = "tradebutler_news_last_fetch";

// Calendar settings keys
export const CALENDAR_SHOW_EARNINGS_KEY = "tradebutler_calendar_show_earnings";
export const CALENDAR_SHOW_DIVIDENDS_KEY = "tradebutler_calendar_show_dividends";
export const CALENDAR_SHOW_ECONOMIC_KEY = "tradebutler_calendar_show_economic";

// Interfaces
export interface NewsSettings {
  watchedSymbols: string[];
  includeOpenPositions: boolean;
  autoRefreshMinutes: number;
  notificationsEnabled: boolean;
  notificationIntervalMinutes: number;
}

export interface CalendarEventSettings {
  showEarnings: boolean;
  showDividends: boolean;
  showEconomicEvents: boolean;
}

// Default settings
export const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  watchedSymbols: [],
  includeOpenPositions: true,
  autoRefreshMinutes: 0,
  notificationsEnabled: true,
  notificationIntervalMinutes: 5,
};

export const DEFAULT_CALENDAR_EVENT_SETTINGS: CalendarEventSettings = {
  showEarnings: true,
  showDividends: true,
  showEconomicEvents: true,
};

// Load news settings from localStorage
export function loadNewsSettings(): NewsSettings {
  return {
    watchedSymbols: loadWatchedSymbols(),
    includeOpenPositions: loadIncludePositions(),
    autoRefreshMinutes: loadAutoRefreshMinutes(),
    notificationsEnabled: loadNotificationsEnabled(),
    notificationIntervalMinutes: loadNotificationInterval(),
  };
}

// Save news settings to localStorage
export function saveNewsSettings(settings: Partial<NewsSettings>): void {
  if (settings.watchedSymbols !== undefined) {
    saveWatchedSymbols(settings.watchedSymbols);
  }
  if (settings.includeOpenPositions !== undefined) {
    localStorage.setItem(NEWS_INCLUDE_POSITIONS_KEY, JSON.stringify(settings.includeOpenPositions));
  }
  if (settings.autoRefreshMinutes !== undefined) {
    localStorage.setItem(NEWS_AUTO_REFRESH_KEY, settings.autoRefreshMinutes.toString());
  }
  if (settings.notificationsEnabled !== undefined) {
    localStorage.setItem(NEWS_NOTIFICATIONS_ENABLED_KEY, JSON.stringify(settings.notificationsEnabled));
  }
  if (settings.notificationIntervalMinutes !== undefined) {
    localStorage.setItem(NEWS_NOTIFICATION_INTERVAL_KEY, settings.notificationIntervalMinutes.toString());
  }
}

// Watched symbols management
export function loadWatchedSymbols(): string[] {
  const saved = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  }
  return [];
}

export function saveWatchedSymbols(symbols: string[]): void {
  localStorage.setItem(NEWS_WATCHED_SYMBOLS_KEY, JSON.stringify(symbols));
}

export function addWatchedSymbol(symbol: string): string[] {
  const symbols = loadWatchedSymbols();
  const normalized = symbol.toUpperCase().trim();
  if (normalized && !symbols.includes(normalized)) {
    symbols.push(normalized);
    saveWatchedSymbols(symbols);
  }
  return symbols;
}

export function removeWatchedSymbol(symbol: string): string[] {
  let symbols = loadWatchedSymbols();
  symbols = symbols.filter(s => s !== symbol.toUpperCase());
  saveWatchedSymbols(symbols);
  return symbols;
}

// Include open positions setting
export function loadIncludePositions(): boolean {
  const saved = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_NEWS_SETTINGS.includeOpenPositions;
    }
  }
  return DEFAULT_NEWS_SETTINGS.includeOpenPositions;
}

// Auto refresh setting
export function loadAutoRefreshMinutes(): number {
  const saved = localStorage.getItem(NEWS_AUTO_REFRESH_KEY);
  if (saved) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return DEFAULT_NEWS_SETTINGS.autoRefreshMinutes;
}

// Notifications enabled setting
export function loadNotificationsEnabled(): boolean {
  const saved = localStorage.getItem(NEWS_NOTIFICATIONS_ENABLED_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_NEWS_SETTINGS.notificationsEnabled;
    }
  }
  return DEFAULT_NEWS_SETTINGS.notificationsEnabled;
}

// Notification interval setting
export function loadNotificationInterval(): number {
  const saved = localStorage.getItem(NEWS_NOTIFICATION_INTERVAL_KEY);
  if (saved) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return DEFAULT_NEWS_SETTINGS.notificationIntervalMinutes;
}

// Calendar event settings
export function loadCalendarEventSettings(): CalendarEventSettings {
  return {
    showEarnings: loadBooleanSetting(CALENDAR_SHOW_EARNINGS_KEY, DEFAULT_CALENDAR_EVENT_SETTINGS.showEarnings),
    showDividends: loadBooleanSetting(CALENDAR_SHOW_DIVIDENDS_KEY, DEFAULT_CALENDAR_EVENT_SETTINGS.showDividends),
    showEconomicEvents: loadBooleanSetting(CALENDAR_SHOW_ECONOMIC_KEY, DEFAULT_CALENDAR_EVENT_SETTINGS.showEconomicEvents),
  };
}

export function saveCalendarEventSettings(settings: Partial<CalendarEventSettings>): void {
  if (settings.showEarnings !== undefined) {
    localStorage.setItem(CALENDAR_SHOW_EARNINGS_KEY, JSON.stringify(settings.showEarnings));
  }
  if (settings.showDividends !== undefined) {
    localStorage.setItem(CALENDAR_SHOW_DIVIDENDS_KEY, JSON.stringify(settings.showDividends));
  }
  if (settings.showEconomicEvents !== undefined) {
    localStorage.setItem(CALENDAR_SHOW_ECONOMIC_KEY, JSON.stringify(settings.showEconomicEvents));
  }
}

// Helper function to load boolean setting
function loadBooleanSetting(key: string, defaultValue: boolean): boolean {
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

// Seen news IDs management (for notifications)
export function loadSeenNewsIds(): Set<string> {
  const saved = localStorage.getItem(NEWS_LAST_SEEN_IDS_KEY);
  if (saved) {
    try {
      return new Set(JSON.parse(saved));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

export function saveSeenNewsIds(ids: Set<string>, maxSize: number = 100): void {
  const idsArray = Array.from(ids).slice(-maxSize);
  localStorage.setItem(NEWS_LAST_SEEN_IDS_KEY, JSON.stringify(idsArray));
}

export function markNewsAsSeen(id: string): void {
  const ids = loadSeenNewsIds();
  ids.add(id);
  saveSeenNewsIds(ids);
}

// Last fetch timestamp
export function loadLastFetchTime(): Date | null {
  const saved = localStorage.getItem(NEWS_LAST_FETCH_KEY);
  if (saved) {
    const timestamp = parseInt(saved, 10);
    if (!isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }
  return null;
}

export function saveLastFetchTime(date: Date = new Date()): void {
  localStorage.setItem(NEWS_LAST_FETCH_KEY, date.getTime().toString());
}

// Clear all news-related settings
export function clearNewsSettings(): void {
  localStorage.removeItem(NEWS_WATCHED_SYMBOLS_KEY);
  localStorage.removeItem(NEWS_INCLUDE_POSITIONS_KEY);
  localStorage.removeItem(NEWS_AUTO_REFRESH_KEY);
  localStorage.removeItem(NEWS_NOTIFICATIONS_ENABLED_KEY);
  localStorage.removeItem(NEWS_NOTIFICATION_INTERVAL_KEY);
  localStorage.removeItem(NEWS_LAST_SEEN_IDS_KEY);
  localStorage.removeItem(NEWS_LAST_FETCH_KEY);
  localStorage.removeItem(CALENDAR_SHOW_EARNINGS_KEY);
  localStorage.removeItem(CALENDAR_SHOW_DIVIDENDS_KEY);
  localStorage.removeItem(CALENDAR_SHOW_ECONOMIC_KEY);
}

// Subscribe to news settings changes (for cross-component sync)
type NewsSettingsListener = (settings: NewsSettings) => void;
const listeners: Set<NewsSettingsListener> = new Set();

export function subscribeToNewsSettings(listener: NewsSettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyNewsSettingsChange(): void {
  const settings = loadNewsSettings();
  listeners.forEach(listener => listener(settings));
}
