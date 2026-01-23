/**
 * Password Manager Utility
 * Handles password/PIN hashing, storage, and validation
 */

const PASSWORD_STORAGE_KEY = "tradebutler_password_hash";
const PASSWORD_TYPE_KEY = "tradebutler_password_type"; // "pin" or "password"
const IS_LOCKED_KEY = "tradebutler_is_locked";

/**
 * Simple hash function (not cryptographically secure, but sufficient for local app)
 * In production, consider using Web Crypto API or a proper hashing library
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Check if a password/PIN is set
 */
export function hasPassword(): boolean {
  return localStorage.getItem(PASSWORD_STORAGE_KEY) !== null;
}

/**
 * Get password type (pin or password)
 */
export function getPasswordType(): "pin" | "password" | null {
  const type = localStorage.getItem(PASSWORD_TYPE_KEY);
  return type === "pin" || type === "password" ? type : null;
}

/**
 * Set password or PIN
 */
export function setPassword(password: string, type: "pin" | "password"): void {
  if (type === "pin" && !/^\d{6}$/.test(password)) {
    throw new Error("PIN must be exactly 6 digits");
  }
  if (type === "password" && password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }
  
  const hash = simpleHash(password);
  localStorage.setItem(PASSWORD_STORAGE_KEY, hash);
  localStorage.setItem(PASSWORD_TYPE_KEY, type);
}

/**
 * Verify password or PIN
 */
export function verifyPassword(input: string): boolean {
  const storedHash = localStorage.getItem(PASSWORD_STORAGE_KEY);
  if (!storedHash) return false;
  
  const inputHash = simpleHash(input);
  return inputHash === storedHash;
}

/**
 * Delete password (for forgot password flow)
 */
export function deletePassword(): void {
  localStorage.removeItem(PASSWORD_STORAGE_KEY);
  localStorage.removeItem(PASSWORD_TYPE_KEY);
  localStorage.removeItem(IS_LOCKED_KEY);
}

/**
 * Check if app is currently locked
 */
export function isLocked(): boolean {
  const locked = localStorage.getItem(IS_LOCKED_KEY);
  return locked === "true";
}

/**
 * Set lock state
 */
export function setLocked(locked: boolean): void {
  if (locked) {
    localStorage.setItem(IS_LOCKED_KEY, "true");
  } else {
    localStorage.removeItem(IS_LOCKED_KEY);
  }
}

/**
 * Lock the app (requires password to unlock)
 */
export function lockApp(): void {
  if (hasPassword()) {
    setLocked(true);
  }
}

/**
 * Unlock the app (verifies password first)
 */
export function unlockApp(password: string): boolean {
  if (verifyPassword(password)) {
    setLocked(false);
    return true;
  }
  return false;
}
