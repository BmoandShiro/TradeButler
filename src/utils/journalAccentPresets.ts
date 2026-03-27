/** Theme swatches shared by EMA/MA length chips and custom "other signal" journal chips. */
export const ACCENT_PRESET_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: "#7C3AED", label: "Purple" },
  { hex: "#2563EB", label: "Blue" },
  { hex: "#0EA5E9", label: "Sky" },
  { hex: "#10B981", label: "Green" },
  { hex: "#22C55E", label: "Emerald" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#EC4899", label: "Pink" },
  { hex: "#64748B", label: "Slate" },
];

export type AccentCustomPreset = { id: string; hex: string; label: string };

export const CUSTOM_ACCENT_PRESETS_KEY = "tradebutler_ma_accent_custom_presets_v1";

export function normalizeHexInput(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (!t.startsWith("#")) t = `#${t}`;
  if (/^#[0-9A-Fa-f]{6}$/i.test(t)) return t.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/i.test(t)) {
    const r = t[1]!,
      g = t[2]!,
      b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(245,158,11,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function parseChipColorHex(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return /^#[0-9A-Fa-f]{6}$/i.test(t) ? t.toUpperCase() : undefined;
}

export function newPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `cp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function loadCustomAccentPresets(): AccentCustomPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_ACCENT_PRESETS_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: AccentCustomPreset[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const hex = parseChipColorHex(o.hex);
      const label = String(o.label ?? "").trim().slice(0, 48);
      const id = String(o.id ?? "").trim();
      if (!hex || !label) continue;
      out.push({ id: id || newPresetId(), hex, label });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustomAccentPresets(presets: AccentCustomPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_ACCENT_PRESETS_KEY, JSON.stringify(presets));
}
