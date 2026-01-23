/**
 * Lock Screen Manager Utility
 * Handles lock screen style preferences
 */

export type LockScreenStyle = "default" | "galaxy" | "aurora" | "milkyway";

const LOCK_SCREEN_STYLE_KEY = "tradebutler_lock_screen_style";

/**
 * Get current lock screen style
 */
export function getLockScreenStyle(): LockScreenStyle {
  const style = localStorage.getItem(LOCK_SCREEN_STYLE_KEY);
  if (style === "galaxy" || style === "aurora" || style === "milkyway") {
    return style;
  }
  return "default";
}

/**
 * Set lock screen style
 */
export function setLockScreenStyle(style: LockScreenStyle): void {
  localStorage.setItem(LOCK_SCREEN_STYLE_KEY, style);
}
