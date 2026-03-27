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
import { JournalSignalAccentColorRow } from "./JournalSignalAccentColorRow";
import {
  hexToRgba,
  loadCustomAccentPresets,
  newPresetId,
  saveCustomAccentPresets,
  type AccentCustomPreset,
} from "../utils/journalAccentPresets";
import {
  addJournalFieldToPrefs,
  loadIndicatorSignalPrefs,
  removeJournalFieldFromPrefs,
  resetJournalFieldsPrefsToBase,
  saveIndicatorSignalPrefs,
  type IndicatorSignalPrefs,
} from "../utils/indicatorsStore";

function CustomSortableSignalChip({
  label,
  chipColor,
  journalKind,
  onJournalKind,
  onChipColor,
  onClearChipColor,
  onRemove,
  removeTitle,
  customPresets,
  onAddCustomPreset,
  onRemoveCustomPreset,
}: {
  label: string;
  chipColor?: string;
  journalKind: "value" | "checkbox";
  onJournalKind: (k: "value" | "checkbox") => void;
  onChipColor: (hex: string) => void;
  onClearChipColor: () => void;
  onRemove: () => void;
  removeTitle?: string;
  customPresets: AccentCustomPreset[];
  onAddCustomPreset: (name: string, hex: string) => void;
  onRemoveCustomPreset: (id: string) => void;
}) {
  const accent = chipColor;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };
  const seg = (active: boolean) =>
    accent
      ? ({
          border: `1px solid ${hexToRgba(accent, active ? 0.95 : 0.4)}`,
          background: active ? accent : "transparent",
          color: active ? "#fff" : "var(--text-secondary)",
          borderRadius: 6,
          padding: "3px 8px",
          fontSize: 10,
          fontWeight: 800,
          cursor: "pointer",
        } as const)
      : ({
          border: `1px solid ${active ? "var(--accent)" : "var(--border-color)"}`,
          background: active ? "var(--accent)" : "transparent",
          color: active ? "#fff" : "var(--text-secondary)",
          borderRadius: 6,
          padding: "3px 8px",
          fontSize: 10,
          fontWeight: 800,
          cursor: "pointer",
        } as const);

  const cardBorder = accent ? `1px solid ${hexToRgba(accent, 0.5)}` : "1px solid var(--border-color)";
  const cardBg = accent ? hexToRgba(accent, 0.14) : "var(--bg-tertiary)";

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 12,
        border: cardBorder,
        background: cardBg,
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          <GripVertical size={16} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 800, color: accent ?? "var(--text-primary)", flex: 1, minWidth: 0 }}>{label}</span>
        <button
          type="button"
          onClick={onRemove}
          title={removeTitle ?? "Remove from journal"}
          style={{
            border: "none",
            background: "transparent",
            color: accent ? hexToRgba(accent, 0.65) : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 900,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", width: "100%" }}>In Journal</span>
        <button type="button" onClick={() => onJournalKind("value")} style={seg(journalKind === "value")}>
          Values
        </button>
        <button type="button" onClick={() => onJournalKind("checkbox")} style={seg(journalKind === "checkbox")}>
          Checkboxes
        </button>
      </div>
      <JournalSignalAccentColorRow
        accent={chipColor}
        onChipColor={onChipColor}
        onClearChipColor={onClearChipColor}
        customPresets={customPresets}
        onAddCustomPreset={onAddCustomPreset}
        onRemoveCustomPreset={onRemoveCustomPreset}
      />
    </div>
  );
}

export function CustomOtherSignalsSettingsPanel({
  indicatorId,
  otherSignals,
  /** When set (e.g. on Signals → Edit), use Add signal next to Reset instead of "Add value" (journal-only). */
  hideInlineAddField,
  /** Signals page: add/remove labels on the indicator (saved with Save changes). */
  onAddSignalToIndicator,
  onRemoveSignalFromIndicator,
}: {
  indicatorId: string;
  otherSignals: string[];
  hideInlineAddField?: boolean;
  onAddSignalToIndicator?: (label: string) => void;
  onRemoveSignalFromIndicator?: (label: string) => void;
}) {
  const [prefs, setPrefs] = useState<IndicatorSignalPrefs | null>(null);
  const [customAccentPresets, setCustomAccentPresets] = useState<AccentCustomPreset[]>(() =>
    typeof window !== "undefined" ? loadCustomAccentPresets() : []
  );
  const [isAdding, setIsAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [isAddingIndicatorSignal, setIsAddingIndicatorSignal] = useState(false);
  const [indicatorAddDraft, setIndicatorAddDraft] = useState("");

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const otherKey = otherSignals.join("\u0001");

  useEffect(() => {
    setPrefs(loadIndicatorSignalPrefs(indicatorId, otherSignals));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- otherKey tracks otherSignals content
  }, [indicatorId, otherKey]);

  useEffect(() => {
    saveCustomAccentPresets(customAccentPresets);
  }, [customAccentPresets]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!prefs) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = [...prefs.order];
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextOrder = arrayMove(order, oldIndex, newIndex);
    const next: IndicatorSignalPrefs = { ...prefs, order: nextOrder };
    setPrefs(next);
    saveIndicatorSignalPrefs(indicatorId, next);
  };

  if (!prefs) return null;

  const base = otherSignals;

  return (
    <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "visible", background: "var(--bg-secondary)" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Other signals — journal layout
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ padding: "0 0 8px", color: "var(--text-secondary)", fontSize: 11, fontWeight: 800, letterSpacing: "0.04em" }}>
          {hideInlineAddField ? (
            <>
              Use Add signal to define fields for this indicator. Drag to reorder; × removes the signal from the indicator (save with Save changes). Colors use the
              same presets as EMA/MA.
            </>
          ) : (
            <>
              Drag to reorder; use Add value for journal-only fields, or define signals on the Signals page. Remove hides a field until re-added. Colors use the
              same presets as EMA/MA.
            </>
          )}
        </div>
        {prefs.order.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 10 }}>
            {hideInlineAddField
              ? "No signals yet. Click Add signal below."
              : "No journal fields yet. Add a field name below (or define other signals on the Signals page)."}
          </div>
        ) : null}
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={prefs.order} strategy={rectSortingStrategy}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
                width: "100%",
                overflow: "visible",
              }}
            >
              {prefs.order.map((label) => (
                <CustomSortableSignalChip
                  key={label}
                  label={label}
                  chipColor={prefs.chipColorByLabel?.[label]}
                  journalKind={prefs.journalKindByLabel[label] ?? "checkbox"}
                  removeTitle={hideInlineAddField && onRemoveSignalFromIndicator ? "Remove signal from indicator" : undefined}
                  customPresets={customAccentPresets}
                  onAddCustomPreset={(name, hex) => {
                    setCustomAccentPresets((prev) => [...prev, { id: newPresetId(), hex, label: name }]);
                  }}
                  onRemoveCustomPreset={(id) => setCustomAccentPresets((prev) => prev.filter((p) => p.id !== id))}
                  onRemove={() => {
                    if (hideInlineAddField && onRemoveSignalFromIndicator) {
                      onRemoveSignalFromIndicator(label);
                      return;
                    }
                    const next = removeJournalFieldFromPrefs(prefs, base, label);
                    setPrefs(next);
                    saveIndicatorSignalPrefs(indicatorId, next);
                  }}
                  onJournalKind={(k) => {
                    const next: IndicatorSignalPrefs = {
                      ...prefs,
                      journalKindByLabel: { ...prefs.journalKindByLabel, [label]: k },
                    };
                    setPrefs(next);
                    saveIndicatorSignalPrefs(indicatorId, next);
                  }}
                  onChipColor={(hex) => {
                    const nextColors = { ...(prefs.chipColorByLabel ?? {}), [label]: hex };
                    const next: IndicatorSignalPrefs = { ...prefs, chipColorByLabel: nextColors };
                    setPrefs(next);
                    saveIndicatorSignalPrefs(indicatorId, next);
                  }}
                  onClearChipColor={() => {
                    const nextColors = { ...(prefs.chipColorByLabel ?? {}) };
                    delete nextColors[label];
                    const next: IndicatorSignalPrefs = {
                      ...prefs,
                      ...(Object.keys(nextColors).length ? { chipColorByLabel: nextColors } : { chipColorByLabel: undefined }),
                    };
                    setPrefs(next);
                    saveIndicatorSignalPrefs(indicatorId, next);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {hideInlineAddField && onAddSignalToIndicator && isAddingIndicatorSignal ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              value={indicatorAddDraft}
              onChange={(e) => setIndicatorAddDraft(e.target.value)}
              placeholder="Signal label"
              autoFocus
              style={{
                flex: "1 1 160px",
                minWidth: 0,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                outline: "none",
                fontSize: 12,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = indicatorAddDraft.trim();
                  if (!t) return;
                  onAddSignalToIndicator(t);
                  setIndicatorAddDraft("");
                  setIsAddingIndicatorSignal(false);
                }
                if (e.key === "Escape") {
                  setIndicatorAddDraft("");
                  setIsAddingIndicatorSignal(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const t = indicatorAddDraft.trim();
                if (!t) return;
                onAddSignalToIndicator(t);
                setIndicatorAddDraft("");
                setIsAddingIndicatorSignal(false);
              }}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 11,
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setIndicatorAddDraft("");
                setIsAddingIndicatorSignal(false);
              }}
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 11,
              }}
            >
              Cancel
            </button>
          </div>
        ) : hideInlineAddField && onAddSignalToIndicator ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setIsAddingIndicatorSignal(true)}
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              Add signal
            </button>
            <button
              type="button"
              onClick={() => {
                const next = resetJournalFieldsPrefsToBase(base);
                setPrefs(next);
                saveIndicatorSignalPrefs(indicatorId, next);
              }}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              Reset
            </button>
          </div>
        ) : hideInlineAddField ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              onClick={() => {
                const next = resetJournalFieldsPrefsToBase(base);
                setPrefs(next);
                saveIndicatorSignalPrefs(indicatorId, next);
              }}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              Reset
            </button>
          </div>
        ) : !isAdding ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              Add value
            </button>
            <button
              type="button"
              onClick={() => {
                const next = resetJournalFieldsPrefsToBase(base);
                setPrefs(next);
                saveIndicatorSignalPrefs(indicatorId, next);
              }}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              Reset
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
            <input
              type="text"
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              placeholder="Field name (e.g. RSI)"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
                outline: "none",
                fontSize: 12,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const next = addJournalFieldToPrefs(prefs, base, addDraft);
                  if (next) {
                    setPrefs(next);
                    saveIndicatorSignalPrefs(indicatorId, next);
                    setAddDraft("");
                    setIsAdding(false);
                  }
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const next = addJournalFieldToPrefs(prefs, base, addDraft);
                if (next) {
                  setPrefs(next);
                  saveIndicatorSignalPrefs(indicatorId, next);
                  setAddDraft("");
                  setIsAdding(false);
                }
              }}
              style={{
                border: "none",
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 11,
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAddDraft("");
                setIsAdding(false);
              }}
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 11,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
