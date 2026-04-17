import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { X, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DataMode } from "../utils/dataMode";
import { saveStrategyCustomRuleSets, saveStrategyRuleTexts, type StrategyCustomRuleSet } from "../utils/indicatorsStore";

type SortableHandleSlot = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

type RuleLineRow = { id: string; text: string };

function newRuleLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function DragHandle({ disabled, attributes, listeners }: { disabled: boolean } & SortableHandleSlot) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 40,
        padding: 0,
        border: "1px solid var(--border-color)",
        borderRadius: 8,
        background: "var(--bg-tertiary)",
        color: "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "grab",
        opacity: disabled ? 0.45 : 1,
        touchAction: "none",
      }}
    >
      <GripVertical size={18} aria-hidden />
    </button>
  );
}

function SortableRuleRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handleProps: SortableHandleSlot) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    position: "relative",
    zIndex: isDragging ? 2 : 0,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}

export function JournalRulesStrategyConfigureModal({
  open,
  onClose,
  dataMode,
  strategyId,
  title,
  mode,
  entryOrTpRules,
  customSets,
  ruleSetId,
  onAfterSave,
}: {
  open: boolean;
  onClose: () => void;
  dataMode: DataMode;
  strategyId: number;
  title: string;
  mode: "entry" | "takeProfit" | "customSet";
  entryOrTpRules?: string[];
  customSets?: StrategyCustomRuleSet[];
  ruleSetId?: string;
  onAfterSave: () => void;
}) {
  const [lines, setLines] = useState<RuleLineRow[]>([]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!open) return;
    if (mode === "customSet" && customSets && ruleSetId) {
      const set = customSets.find((s) => s.id === ruleSetId);
      const texts = set ? set.rules : [];
      setLines(texts.map((text) => ({ id: newRuleLineId(), text })));
    } else if (mode === "entry" || mode === "takeProfit") {
      const texts = entryOrTpRules || [];
      setLines(texts.map((text) => ({ id: newRuleLineId(), text })));
    } else {
      setLines([]);
    }
  }, [open, mode, entryOrTpRules, customSets, ruleSetId]);

  const lineIds = lines.map((l) => l.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = lines.findIndex((l) => l.id === active.id);
    const to = lines.findIndex((l) => l.id === over.id);
    if (from === -1 || to === -1) return;
    setLines(arrayMove(lines, from, to));
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const trimmed = lines.map((l) => l.text.trim()).filter((l) => l.length > 0);
      if (mode === "entry") {
        saveStrategyRuleTexts(dataMode, strategyId, "entry", trimmed);
      } else if (mode === "takeProfit") {
        saveStrategyRuleTexts(dataMode, strategyId, "takeProfit", trimmed);
      } else if (mode === "customSet" && customSets && ruleSetId) {
        const nextSets = customSets.map((s) => (s.id === ruleSetId ? { ...s, rules: trimmed } : s));
        saveStrategyCustomRuleSets(dataMode, strategyId, nextSets);
      }
      onAfterSave();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Configure — {title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              borderRadius: 8,
              padding: "6px 8px",
              cursor: "pointer",
              display: "flex",
            }}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "12px 16px", background: "color-mix(in srgb, var(--warning) 12%, transparent)", borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", marginBottom: 4 }}>Strategy template</div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)", lineHeight: 1.45 }}>
            Changes here update this strategy&apos;s rules for <strong>all journal entries</strong> using this strategy.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Drag the <GripVertical size={12} style={{ verticalAlign: "middle", display: "inline" }} aria-hidden /> handle to reorder rules (same as checklist items on the Strategies page).
          </p>
        </div>

        <div style={{ overflow: "auto", padding: 16, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {lines.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>No rules yet. Add text below, then save (empty lines are removed).</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={lineIds} strategy={verticalListSortingStrategy}>
                {lines.map((row) => (
                  <SortableRuleRow key={row.id} id={row.id} disabled={false}>
                    {({ attributes, listeners }) => (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          gap: 8,
                          alignItems: "start",
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid var(--border-color)",
                          background: "var(--bg-primary)",
                        }}
                      >
                        <DragHandle disabled={false} attributes={attributes} listeners={listeners} />
                        <textarea
                          value={row.text}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLines((prev) => prev.map((l) => (l.id === row.id ? { ...l, text: v } : l)));
                          }}
                          rows={3}
                          style={{
                            width: "100%",
                            resize: "vertical",
                            minHeight: 52,
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-secondary)",
                            color: "var(--text-primary)",
                            fontSize: 13,
                            fontFamily: "inherit",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: "var(--text-secondary)",
                            textTransform: "uppercase",
                          }}
                        >
                          Rule
                        </span>
                      </div>
                    )}
                  </SortableRuleRow>
                ))}
              </SortableContext>
            </DndContext>
          )}
          <button
            type="button"
            onClick={() => setLines([...lines, { id: newRuleLineId(), text: "" }])}
            style={{
              alignSelf: "flex-start",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px dashed var(--border-color)",
              background: "transparent",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            + Add rule
          </button>
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Save to strategy"}
          </button>
        </div>
      </div>
    </div>
  );
}
