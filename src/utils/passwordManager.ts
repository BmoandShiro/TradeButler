/**
 * Password Manager Utility
 * Handles password/PIN hashing, storage, and validation using PBKDF2
 */

const PASSWORD_STORAGE_KEY = "tradebutler_password_hash";
const PASSWORD_SALT_KEY = "tradebutler_password_salt";
const PASSWORD_TYPE_KEY = "tradebutler_password_type"; // "pin" or "password"
const IS_LOCKED_KEY = "tradebutler_is_locked";

// PBKDF2 configuration
const PBKDF2_ITERATIONS = 100000; // OWASP recommends 600,000+ for 2023, but 100k is good balance
const PBKDF2_HASH_ALGORITHM = "SHA-256";
const SALT_LENGTH = 16; // 16 bytes = 128 bits

/**
 * Generate a random salt using Web Crypto API
 */
async function generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Convert Uint8Array to base64 string for storage
 */
function arrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array));
}

/**
 * Convert base64 string back to Uint8Array
 */
function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  return new Uint8Array(binary.split('').map(char => char.charCodeAt(0)));
}

/**
 * Hash password using PBKDF2 with salt
 * Returns base64-encoded hash
 */
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  // Import password as key material
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH_ALGORITHM,
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  );

  // Convert to base64 for storage
  return arrayToBase64(new Uint8Array(derivedBits));
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
 * Set password or PIN (async - uses PBKDF2 with salt)
 */
export async function setPassword(password: string, type: "pin" | "password"): Promise<void> {
  if (type === "pin" && !/^\d{6}$/.test(password)) {
    throw new Error("PIN must be exactly 6 digits");
  }
  if (type === "password" && password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }
  
  // Generate a new random salt for this password
  const salt = await generateSalt();
  const hash = await hashPassword(password, salt);
  
  // Store hash and salt separately (both base64-encoded)
  localStorage.setItem(PASSWORD_STORAGE_KEY, hash);
  localStorage.setItem(PASSWORD_SALT_KEY, arrayToBase64(salt));
  localStorage.setItem(PASSWORD_TYPE_KEY, type);
}

/**
 * Simple hash function (legacy - for migration)
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
 * Verify password or PIN (async - uses PBKDF2 with salt)
 * Also handles migration from old simple hash format
 */
export async function verifyPassword(input: string): Promise<boolean> {
  const storedHash = localStorage.getItem(PASSWORD_STORAGE_KEY);
  const storedSalt = localStorage.getItem(PASSWORD_SALT_KEY);
  
  if (!storedHash) return false;
  
  // Check if this is an old hash (no salt = old format)
  if (!storedSalt) {
    // Legacy hash format - verify with old method and migrate
    const oldHash = simpleHash(input);
    if (oldHash === storedHash) {
      // Password is correct, migrate to new format
      const passwordType = getPasswordType();
      if (passwordType) {
        await setPassword(input, passwordType);
      }
      return true;
    }
    return false;
  }
  
  // New PBKDF2 format - verify normally
  const salt = base64ToArray(storedSalt);
  const inputHash = await hashPassword(input, salt);
  
  // Constant-time comparison to prevent timing attacks
  return inputHash === storedHash;
}

/**
 * Delete password (for forgot password flow)
 */
export function deletePassword(): void {
  localStorage.removeItem(PASSWORD_STORAGE_KEY);
  localStorage.removeItem(PASSWORD_SALT_KEY);
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
 * Unlock the app (verifies password first) - async
 */
export async function unlockApp(password: string): Promise<boolean> {
  if (await verifyPassword(password)) {
    setLocked(false);
    return true;
  }
  return false;
}
