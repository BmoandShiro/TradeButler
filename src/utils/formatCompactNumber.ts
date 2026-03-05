/**
 * Format a number with comma thousands separators (e.g. 1000 -> "1,000", 1234567.89 -> "1,234,567.89").
 */
export function formatWithCommas(
  value: number,
  options?: { decimals?: number; minDecimals?: number; maxDecimals?: number }
): string {
  const { decimals, minDecimals, maxDecimals } = options ?? {};
  if (decimals != null) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  if (minDecimals != null || maxDecimals != null) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: minDecimals ?? 0,
      maximumFractionDigits: maxDecimals ?? 2,
    });
  }
  return value.toLocaleString("en-US");
}

/**
 * Format a number in compact form: k (thousands), M (millions), B (billions), T (trillions).
 * At 1000k (1e6) we switch to M, then 1000M to B, then 1000B to T.
 */
export function formatCompactNumber(
  value: number,
  options?: { decimals?: number; prefix?: string; suffix?: string }
): string {
  const decimals = options?.decimals ?? 1;
  const prefix = options?.prefix ?? "";
  const suffix = options?.suffix ?? "";
  const n = Math.abs(value);
  if (n >= 1e12) {
    return `${prefix}${(value / 1e12).toFixed(decimals)}T${suffix}`;
  }
  if (n >= 1e9) {
    return `${prefix}${(value / 1e9).toFixed(decimals)}B${suffix}`;
  }
  if (n >= 1e6) {
    return `${prefix}${(value / 1e6).toFixed(decimals)}M${suffix}`;
  }
  if (n >= 1e3) {
    return `${prefix}${(value / 1e3).toFixed(decimals)}k${suffix}`;
  }
  return `${prefix}${value.toFixed(decimals)}${suffix}`;
}
