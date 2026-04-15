import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";
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

type SortableHandleSlot = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

const EMPTY_PLACEHOLDER = "__empty_custom_checklist_placeholder__";

export type JournalChecklistItem = {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
  parent_id: number | null;
  description?: string | null;
  high_is_good?: boolean | null;
  survey_format?: string | null;
  survey_allow_na?: boolean | null;
};

function isSurveyType(t: string): boolean {
  return t === "survey" || t.startsWith("survey_");
}

type SurveyFmt = "scale" | "yes_no";

function normalizedSurveyFormat(f: string | null | undefined): SurveyFmt {
  if (f === "yes_no") return "yes_no";
  return "scale";
}

function surveyNaForInvoke(checklistType: string, item: { survey_allow_na?: boolean | null }): boolean | undefined {
  if (!isSurveyType(checklistType)) return undefined;
  return Boolean(item.survey_allow_na);
}

function buildTreeState(items: JournalChecklistItem[]) {
  const filtered = items.filter((i) => i.item_text !== EMPTY_PLACEHOLDER);
  const topLevel = filtered
    .filter((i) => i.parent_id == null)
    .sort((a, b) => a.item_order - b.item_order)
    .map((i) => ({ ...i }));
  const childMap = new Map<number, JournalChecklistItem[]>();
  for (const i of filtered) {
    if (i.parent_id != null) {
      const arr = childMap.get(i.parent_id) ?? [];
      arr.push({ ...i });
      childMap.set(i.parent_id, arr);
    }
  }
  for (const [, arr] of childMap) {
    arr.sort((a, b) => a.item_order - b.item_order);
  }
  return { topLevel, childMap };
}

function renumberTopLevel(topLevel: JournalChecklistItem[]) {
  topLevel.forEach((item, idx) => {
    item.item_order = idx;
  });
}

function renumberChildren(children: JournalChecklistItem[]) {
  children.forEach((item, idx) => {
    item.item_order = idx;
  });
}

function DragHandle({ disabled, attributes, listeners }: { disabled: boolean } & SortableHandleSlot) {
  return (
    <button
      type="button"
      className="journal-checklist-dnd-handle"
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

function SortableConfigureBlock({
  id,
  disabled,
  children,
}: {
  id: number;
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

export function JournalChecklistStrategyConfigureModal({
  open,
  onClose,
  dataMode,
  strategyId,
  checklistType,
  sectionTitle,
  sourceItems,
  onAfterSave,
}: {
  open: boolean;
  onClose: () => void;
  dataMode: DataMode;
  strategyId: number;
  checklistType: string;
  sectionTitle: string;
  sourceItems: JournalChecklistItem[];
  onAfterSave: () => void;
}) {
  const [topLevel, setTopLevel] = useState<JournalChecklistItem[]>([]);
  const [childMap, setChildMap] = useState<Map<number, JournalChecklistItem[]>>(new Map());
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!open) return;
    const { topLevel: tl, childMap: cm } = buildTreeState(sourceItems);
    setTopLevel(tl);
    setChildMap(new Map(cm));
  }, [open, sourceItems]);

  const flatForSave = useMemo(() => {
    const out: JournalChecklistItem[] = [];
    for (const p of topLevel) {
      out.push(p);
      const ch = childMap.get(p.id);
      if (ch?.length) out.push(...ch);
    }
    return out;
  }, [topLevel, childMap]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aid = Number(active.id);
    const oid = Number(over.id);

    const topFrom = topLevel.findIndex((i) => i.id === aid);
    const topTo = topLevel.findIndex((i) => i.id === oid);
    if (topFrom !== -1 && topTo !== -1) {
      const next = arrayMove(topLevel, topFrom, topTo);
      renumberTopLevel(next);
      setTopLevel(next);
      return;
    }

    let parentA: number | null = null;
    let parentO: number | null = null;
    for (const [pid, arr] of childMap) {
      if (arr.some((c) => c.id === aid)) parentA = pid;
      if (arr.some((c) => c.id === oid)) parentO = pid;
    }
    if (parentA != null && parentA === parentO) {
      const arr = [...(childMap.get(parentA) || [])];
      const ci = arr.findIndex((c) => c.id === aid);
      const oi = arr.findIndex((c) => c.id === oid);
      if (ci !== -1 && oi !== -1) {
        const moved = arrayMove(arr, ci, oi);
        renumberChildren(moved);
        const nextMap = new Map(childMap);
        nextMap.set(parentA, moved);
        setChildMap(nextMap);
      }
    }
  };

  const updateItemText = (id: number, text: string) => {
    const inTop = topLevel.find((i) => i.id === id);
    if (inTop) {
      setTopLevel(topLevel.map((i) => (i.id === id ? { ...i, item_text: text } : i)));
      return;
    }
    const nextMap = new Map(childMap);
    for (const [pid, arr] of nextMap) {
      if (arr.some((c) => c.id === id)) {
        nextMap.set(
          pid,
          arr.map((c) => (c.id === id ? { ...c, item_text: text } : c))
        );
        setChildMap(nextMap);
        return;
      }
    }
  };

  const handleSave = async () => {
    if (dataMode === "sandbox") return;
    setSaving(true);
    try {
      for (const item of flatForSave) {
        await invoke("save_strategy_checklist_item", {
          id: item.id,
          strategyId,
          itemText: item.item_text.trim(),
          isChecked: item.is_checked,
          itemOrder: item.item_order,
          checklistType,
          parentId: item.parent_id,
          high_is_good: isSurveyType(checklistType) ? (item.high_is_good ?? true) : undefined,
          description: item.description ?? null,
          survey_format: isSurveyType(checklistType) ? normalizedSurveyFormat(item.survey_format) : undefined,
          survey_allow_na: surveyNaForInvoke(checklistType, item),
        });
      }
      onAfterSave();
      onClose();
    } catch (e) {
      console.error(e);
      alert("Failed to save checklist: " + e);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const sandboxLocked = dataMode === "sandbox";
  const topIds = topLevel.map((r) => r.id);

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
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Configure — {sectionTitle}</div>
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
            Changes here update this strategy for <strong>all journal entries</strong> that use it, not only this entry.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Drag the <GripVertical size={12} style={{ verticalAlign: "middle", display: "inline" }} aria-hidden /> handle to reorder items (same as on the Strategies page).
          </p>
          {sandboxLocked ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--danger)" }}>
              Checklist templates cannot be edited from the journal in Demo mode. Switch to Real or Paper data.
            </p>
          ) : null}
        </div>

        <div style={{ overflow: "auto", padding: 16, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {topLevel.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>No checklist items to configure.</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={topIds} strategy={verticalListSortingStrategy}>
                {topLevel.map((row) => {
                  const children = childMap.get(row.id) || [];
                  const isGroup = children.length > 0;
                  const childIds = children.map((c) => c.id);
                  return (
                    <div key={row.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <SortableConfigureBlock id={row.id} disabled={sandboxLocked}>
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
                            <DragHandle disabled={sandboxLocked} attributes={attributes} listeners={listeners} />
                            <textarea
                              value={row.item_text}
                              disabled={sandboxLocked}
                              onChange={(e) => updateItemText(row.id, e.target.value)}
                              rows={2}
                              style={{
                                width: "100%",
                                resize: "vertical",
                                minHeight: 44,
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
                              {isGroup ? "Group" : "Item"}
                            </span>
                          </div>
                        )}
                      </SortableConfigureBlock>

                      {childIds.length > 0 ? (
                        <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                          {children.map((ch) => (
                            <SortableConfigureBlock key={ch.id} id={ch.id} disabled={sandboxLocked}>
                              {({ attributes, listeners }) => (
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "auto 1fr",
                                    gap: 8,
                                    alignItems: "start",
                                    marginLeft: 20,
                                    padding: 10,
                                    borderRadius: 10,
                                    border: "1px dashed color-mix(in srgb, var(--accent) 35%, var(--border-color))",
                                    background: "var(--bg-primary)",
                                  }}
                                >
                                  <DragHandle disabled={sandboxLocked} attributes={attributes} listeners={listeners} />
                                  <textarea
                                    value={ch.item_text}
                                    disabled={sandboxLocked}
                                    onChange={(e) => updateItemText(ch.id, e.target.value)}
                                    rows={2}
                                    style={{
                                      width: "100%",
                                      resize: "vertical",
                                      minHeight: 44,
                                      padding: "8px 10px",
                                      borderRadius: 8,
                                      border: "1px solid var(--border-color)",
                                      background: "var(--bg-secondary)",
                                      color: "var(--text-primary)",
                                      fontSize: 13,
                                      fontFamily: "inherit",
                                    }}
                                  />
                                </div>
                              )}
                            </SortableConfigureBlock>
                          ))}
                        </SortableContext>
                      ) : null}
                    </div>
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
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
            disabled={sandboxLocked || saving || topLevel.length === 0}
            onClick={() => void handleSave()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: sandboxLocked || topLevel.length === 0 ? "var(--bg-tertiary)" : "var(--accent)",
              color: sandboxLocked || topLevel.length === 0 ? "var(--text-secondary)" : "white",
              cursor: sandboxLocked || topLevel.length === 0 ? "not-allowed" : "pointer",
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
