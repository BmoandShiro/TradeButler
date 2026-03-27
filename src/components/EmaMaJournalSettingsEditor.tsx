import { useEffect, useState } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { loadEmaMaJournalRowVisibility, saveEmaMaJournalRowVisibility, type EmaMaJournalRowVisibility } from "../utils/indicatorsStore";
import { JournalSignalAccentColorRow } from "./JournalSignalAccentColorRow";
import {
  hexToRgba,
  loadCustomAccentPresets,
  newPresetId,
  parseChipColorHex,
  saveCustomAccentPresets,
  type AccentCustomPreset,
} from "../utils/journalAccentPresets";

const EMA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ema_default_lengths_config_v1";
const MA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ma_default_lengths_config_v1";
const LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY = "tradebutler_ma_default_lengths_v1";
const MA_DEFAULT_LENGTHS_FALLBACK = ["50", "100", "200", "500"];

type MaLengthChip = { len: string; enabled: boolean; journalKind: "value" | "checkbox"; chipColor?: string };

function MaSortableLengthChip({
  chip,
  customPresets,
  onAddCustomPreset,
  onRemoveCustomPreset,
  onToggleEnabled,
  onJournalKind,
  onChipColor,
  onClearChipColor,
  onRemove,
}: {
  chip: MaLengthChip;
  customPresets: AccentCustomPreset[];
  onAddCustomPreset: (label: string, hex: string) => void;
  onRemoveCustomPreset: (id: string) => void;
  onToggleEnabled: (next: boolean) => void;
  onJournalKind: (k: "value" | "checkbox") => void;
  onChipColor: (hex: string) => void;
  onClearChipColor: () => void;
  onRemove: () => void;
}) {
  const accent = chip.chipColor;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chip.len });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : chip.enabled ? 1 : 0.85,
  };

  const seg = (active: boolean) => {
    if (accent) {
      return {
        border: `1px solid ${hexToRgba(accent, active ? 0.95 : 0.4)}`,
        background: active ? accent : "transparent",
        color: active ? "#fff" : "var(--text-secondary)",
        borderRadius: 4,
        padding: "2px 5px",
        fontSize: 9,
        fontWeight: 800,
        cursor: "pointer",
      } as const;
    }
    return {
      border: `1px solid ${active ? "var(--accent)" : "var(--border-color)"}`,
      background: active ? "var(--accent)" : "transparent",
      color: active ? "#fff" : "var(--text-secondary)",
      borderRadius: 4,
      padding: "2px 5px",
      fontSize: 9,
      fontWeight: 800,
      cursor: "pointer",
    } as const;
  };

  const cardBorder = accent
    ? `1px solid ${hexToRgba(accent, chip.enabled ? 0.55 : 0.28)}`
    : "1px solid var(--border-color)";
  const cardBg = accent
    ? hexToRgba(accent, chip.enabled ? 0.16 : 0.07)
    : chip.enabled
      ? "var(--bg-tertiary)"
      : "rgba(148,163,184,0.14)";

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 10,
        border: cardBorder,
        background: cardBg,
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          style={{
            border: "none",
            background: "transparent",
            color: accent ? hexToRgba(accent, 0.75) : "var(--text-secondary)",
            cursor: "grab",
            padding: 0,
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <GripVertical size={14} />
        </button>
        <input
          type="checkbox"
          checked={chip.enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 14, height: 14, ...(accent ? { accentColor: accent } : {}) }}
          title="Show in Journal"
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: chip.enabled ? (accent ?? "var(--text-primary)") : "var(--text-secondary)",
            flex: 1,
            minWidth: 0,
          }}
        >
          {chip.len}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: "none",
            background: "transparent",
            color: accent ? hexToRgba(accent, 0.65) : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 900,
            lineHeight: 1,
          }}
          title="Remove"
        >
          ×
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Journal</span>
        <button type="button" onClick={() => onJournalKind("value")} style={seg(chip.journalKind === "value")}>
          Values
        </button>
        <button type="button" onClick={() => onJournalKind("checkbox")} style={seg(chip.journalKind === "checkbox")}>
          Checkboxes
        </button>
      </div>
      <JournalSignalAccentColorRow
        accent={chip.chipColor}
        onChipColor={onChipColor}
        onClearChipColor={onClearChipColor}
        customPresets={customPresets}
        onAddCustomPreset={onAddCustomPreset}
        onRemoveCustomPreset={onRemoveCustomPreset}
      />
    </div>
  );
}

function parseLengthsCsv(csv: string): string[] {
  const parts = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) continue;
    const asInt = String(Math.trunc(n));
    if (asInt === "0") continue;
    if (seen.has(asInt)) continue;
    seen.add(asInt);
    out.push(asInt);
  }
  return out.length ? out : MA_DEFAULT_LENGTHS_FALLBACK;
}

function normalizeLengthValue(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  const asInt = Math.trunc(n);
  if (asInt <= 0) return null;
  return String(asInt);
}

export function EmaMaJournalSettingsEditor({ indicatorId }: { indicatorId: "ema" | "ma" }) {
  const [maDefaultLengths, setMaDefaultLengths] = useState<MaLengthChip[]>(
    MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true, journalKind: "value" }))
  );
  const [maJournalRowVisibility, setMaJournalRowVisibility] = useState<EmaMaJournalRowVisibility>({
    showCrossingRow: true,
    showCoilingRow: true,
  });
  const [customAccentPresets, setCustomAccentPresets] = useState<AccentCustomPreset[]>(() =>
    typeof window !== "undefined" ? loadCustomAccentPresets() : []
  );
  const [maAddDraft, setMaAddDraft] = useState("");
  const [maIsAdding, setMaIsAdding] = useState(false);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleMaDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setMaDefaultLengths((items) => {
      const oldIndex = items.findIndex((c) => c.len === active.id);
      const newIndex = items.findIndex((c) => c.len === over.id);
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cfgKey = indicatorId === "ema" ? EMA_DEFAULT_LENGTHS_CONFIG_KEY : MA_DEFAULT_LENGTHS_CONFIG_KEY;
    const legacyRaw = window.localStorage.getItem(LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY);

    const rawCfg = window.localStorage.getItem(cfgKey);
    let nextChips: MaLengthChip[] | null = null;
    if (rawCfg && rawCfg.trim()) {
      try {
        const parsed = JSON.parse(rawCfg);
        if (Array.isArray(parsed)) {
          nextChips = parsed
            .map((x: unknown) => {
              if (typeof x === "number")
                return { len: String(x), enabled: true, journalKind: "value" as const };
              if (typeof x === "string") return { len: x, enabled: true, journalKind: "value" as const };
              if (x && typeof x === "object" && x !== null && "len" in x) {
                const o = x as Record<string, unknown>;
                const len = o.len;
                const enabled = "enabled" in o ? Boolean(o.enabled) : true;
                const jk = o.journalKind === "checkbox" ? "checkbox" : "value";
                const chipColor = parseChipColorHex(o.chipColor);
                const base = len != null ? { len: String(len), enabled, journalKind: jk } : null;
                if (!base) return null;
                return chipColor ? { ...base, chipColor } : base;
              }
              return null;
            })
            .filter(Boolean) as MaLengthChip[];
        }
      } catch {
        /* ignore */
      }
    }

    if (!nextChips || nextChips.length === 0) {
      const legacyNums = parseLengthsCsv(legacyRaw ?? "");
      nextChips = legacyNums.map((len) => ({ len, enabled: true, journalKind: "value" as const }));
    }

    const seen = new Set<string>();
    nextChips = nextChips.filter((c) => {
      if (seen.has(c.len)) return false;
      seen.add(c.len);
      return true;
    });

    setMaDefaultLengths(nextChips ?? MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true, journalKind: "value" as const })));
    setMaJournalRowVisibility(loadEmaMaJournalRowVisibility(indicatorId));
    setMaIsAdding(false);
    setMaAddDraft("");
  }, [indicatorId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cfgKey = indicatorId === "ema" ? EMA_DEFAULT_LENGTHS_CONFIG_KEY : MA_DEFAULT_LENGTHS_CONFIG_KEY;
    window.localStorage.setItem(cfgKey, JSON.stringify(maDefaultLengths));
    saveEmaMaJournalRowVisibility(indicatorId, maJournalRowVisibility);
  }, [maDefaultLengths, maJournalRowVisibility, indicatorId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    saveCustomAccentPresets(customAccentPresets);
  }, [customAccentPresets]);

  const title = indicatorId === "ema" ? "EMA default lengths" : "MA default lengths";

  return (
    <div
      style={{
        border: "1px solid var(--border-color)",
        borderRadius: 12,
        overflow: "visible",
        background: "var(--bg-secondary)",
        colorScheme: "dark",
      }}
    >
      <style>{`
        .ema-ma-accent-color-native {
          appearance: none;
          -webkit-appearance: none;
          width: 26px;
          height: 22px;
          padding: 2px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--bg-tertiary);
          cursor: pointer;
          flex-shrink: 0;
        }
        .ema-ma-accent-color-native::-webkit-color-swatch-wrapper {
          padding: 0;
        }
        .ema-ma-accent-color-native::-webkit-color-swatch {
          border: none;
          border-radius: 4px;
        }
        .ema-ma-accent-color-native::-moz-color-swatch {
          border: none;
          border-radius: 4px;
        }
      `}</style>
      <div
        style={{
          padding: "7px 10px",
          borderBottom: "1px solid var(--border-color)",
          color: "var(--text-secondary)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderRadius: "12px 12px 0 0",
        }}
      >
        {title}
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, overflow: "visible" }}>
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleMaDragEnd}>
          <SortableContext items={maDefaultLengths.map((c) => c.len)} strategy={rectSortingStrategy}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 6,
                width: "100%",
                overflow: "visible",
                paddingBottom: 0,
              }}
            >
              {maDefaultLengths.map((chip, idx) => (
                <MaSortableLengthChip
                  key={chip.len}
                  chip={chip}
                  customPresets={customAccentPresets}
                  onAddCustomPreset={(label, hex) => {
                    setCustomAccentPresets((prev) => [...prev, { id: newPresetId(), hex, label }]);
                  }}
                  onRemoveCustomPreset={(id) => setCustomAccentPresets((prev) => prev.filter((p) => p.id !== id))}
                  onToggleEnabled={(next) => setMaDefaultLengths((prev) => prev.map((x, i) => (i === idx ? { ...x, enabled: next } : x)))}
                  onJournalKind={(k) => setMaDefaultLengths((prev) => prev.map((x, i) => (i === idx ? { ...x, journalKind: k } : x)))}
                  onChipColor={(hex) => setMaDefaultLengths((prev) => prev.map((x, i) => (i === idx ? { ...x, chipColor: hex } : x)))}
                  onClearChipColor={() => setMaDefaultLengths((prev) => prev.map((x, i) => (i === idx ? { ...x, chipColor: undefined } : x)))}
                  onRemove={() => setMaDefaultLengths((prev) => prev.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {!maIsAdding ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setMaIsAdding(true)}
              style={{ border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontWeight: 800, fontSize: 11 }}
            >
              Add value
            </button>
            <button
              type="button"
              onClick={() => setMaDefaultLengths(MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true, journalKind: "value" as const })))}
              style={{ border: "none", background: "var(--accent)", color: "white", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontWeight: 800, fontSize: 11 }}
            >
              Reset
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              inputMode="numeric"
              value={maAddDraft}
              onChange={(e) => setMaAddDraft(e.target.value)}
              placeholder="e.g. 250"
              style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", outline: "none", fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => {
                const normalized = normalizeLengthValue(maAddDraft);
                if (!normalized) return;
                setMaDefaultLengths((prev) =>
                  prev.some((x) => x.len === normalized) ? prev : [...prev, { len: normalized, enabled: true, journalKind: "value" }]
                );
                setMaAddDraft("");
                setMaIsAdding(false);
              }}
              style={{ border: "none", background: "var(--accent)", color: "white", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 900, fontSize: 11 }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setMaAddDraft("");
                setMaIsAdding(false);
              }}
              style={{ border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 900, fontSize: 11 }}
            >
              Cancel
            </button>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-secondary)", letterSpacing: "0.03em" }}>Crossing & Coiling</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.35 }}>
            Hide rows in the journal entry (per timeframe). Length values still apply.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontWeight: 650 }}>
            <input
              type="checkbox"
              checked={maJournalRowVisibility.showCrossingRow}
              onChange={(e) => setMaJournalRowVisibility((v) => ({ ...v, showCrossingRow: e.target.checked }))}
              style={{ width: 14, height: 14 }}
            />
            Crossing row
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--text-primary)", fontSize: 11, fontWeight: 650 }}>
            <input
              type="checkbox"
              checked={maJournalRowVisibility.showCoilingRow}
              onChange={(e) => setMaJournalRowVisibility((v) => ({ ...v, showCoilingRow: e.target.checked }))}
              style={{ width: 14, height: 14 }}
            />
            Coiling row
          </label>
        </div>
      </div>
    </div>
  );
}
