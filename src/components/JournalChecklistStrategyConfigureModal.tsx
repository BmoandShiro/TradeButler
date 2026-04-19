import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { X, GripVertical, Trash2, Scale, ListChecks, FolderPlus, Folder, Lock, Unlock } from "lucide-react";
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
import { saveStrategyRuleTexts, STRATEGY_RULE_SECTION_PREFIX } from "../utils/indicatorsStore";
import { ConfirmDialog } from "./ConfirmDialog";

type SortableHandleSlot = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

type EmbeddedRuleLine = { id: string; text: string };
type EmbeddedRuleSection = { id: string; title: string; lines: EmbeddedRuleLine[] };

function parseEmbeddedRuleSectionsFromInitial(initial: string[]): EmbeddedRuleSection[] {
  if (initial.length === 0) return [{ id: newEmbeddedRuleLineId(), title: "", lines: [] }];
  if (!initial.some((l) => l.trimStart().startsWith(STRATEGY_RULE_SECTION_PREFIX))) {
    return [{ id: newEmbeddedRuleLineId(), title: "", lines: initial.map((text) => ({ id: newEmbeddedRuleLineId(), text })) }];
  }
  const sections: EmbeddedRuleSection[] = [];
  let cur: EmbeddedRuleSection = { id: newEmbeddedRuleLineId(), title: "", lines: [] };
  for (const raw of initial) {
    const lead = raw.trimStart();
    if (lead.startsWith(STRATEGY_RULE_SECTION_PREFIX)) {
      if (cur.lines.length > 0 || cur.title) sections.push(cur);
      cur = { id: newEmbeddedRuleLineId(), title: lead.slice(STRATEGY_RULE_SECTION_PREFIX.length).trim(), lines: [] };
    } else if (raw.trim()) {
      cur.lines.push({ id: newEmbeddedRuleLineId(), text: raw });
    }
  }
  sections.push(cur);
  return sections;
}

function serializeEmbeddedRuleSections(sections: EmbeddedRuleSection[]): string[] {
  const out: string[] = [];
  for (const sec of sections) {
    if (sec.title.trim()) out.push(`${STRATEGY_RULE_SECTION_PREFIX}${sec.title.trim()}`);
    for (const ln of sec.lines) {
      const t = ln.text.trim();
      if (t) out.push(ln.text);
    }
  }
  return out;
}

function newEmbeddedRuleLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `emb-rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function EmbeddedRuleDragHandle({ disabled, attributes, listeners }: { disabled: boolean } & SortableHandleSlot) {
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

function EmbeddedRuleSortableRow({
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
  embeddedStrategyRules,
}: {
  open: boolean;
  onClose: () => void;
  dataMode: DataMode;
  strategyId: number;
  checklistType: string;
  sectionTitle: string;
  sourceItems: JournalChecklistItem[];
  onAfterSave: () => void;
  /** When configuring Entry or Take profit checklist, edit matching strategy rule lines in the same dialog. */
  embeddedStrategyRules?: { kind: "entry" | "takeProfit"; initialRules: string[] };
}) {
  const [topLevel, setTopLevel] = useState<JournalChecklistItem[]>([]);
  const [childMap, setChildMap] = useState<Map<number, JournalChecklistItem[]>>(new Map());
  const [embeddedRuleSections, setEmbeddedRuleSections] = useState<EmbeddedRuleSection[]>([]);
  const [selectedChecklistIds, setSelectedChecklistIds] = useState<Set<number>>(() => new Set());
  const [selectedRuleLineIds, setSelectedRuleLineIds] = useState<Set<string>>(() => new Set());
  const [checklistGroupModalOpen, setChecklistGroupModalOpen] = useState(false);
  const [ruleGroupModalOpen, setRuleGroupModalOpen] = useState(false);
  const [pendingGroupName, setPendingGroupName] = useState("");
  /** When false, checklist + rules are view-only until the user unlocks (separate from Demo/sandbox lock). */
  const [configureUnlocked, setConfigureUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    id: number;
    parentId: number | null;
    preview: string;
    subItemCount: number;
    /** Snapshot when opening the dialog (top-level groups only). */
    childIds: number[];
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const embeddedRuleSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!open) return;
    const { topLevel: tl, childMap: cm } = buildTreeState(sourceItems);
    setTopLevel(tl);
    setChildMap(new Map(cm));
  }, [open, sourceItems]);

  useEffect(() => {
    if (!open || !embeddedStrategyRules) {
      setEmbeddedRuleSections([]);
      return;
    }
    setEmbeddedRuleSections(parseEmbeddedRuleSectionsFromInitial(embeddedStrategyRules.initialRules));
  }, [open, embeddedStrategyRules]);

  useEffect(() => {
    if (!open) setDeleteDialog(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelectedChecklistIds(new Set());
      setSelectedRuleLineIds(new Set());
      setChecklistGroupModalOpen(false);
      setRuleGroupModalOpen(false);
      setPendingGroupName("");
    } else {
      setConfigureUnlocked(false);
    }
  }, [open]);

  const flatForSave = useMemo(() => {
    const out: JournalChecklistItem[] = [];
    for (const p of topLevel) {
      out.push(p);
      const ch = childMap.get(p.id);
      if (ch?.length) out.push(...ch);
    }
    return out;
  }, [topLevel, childMap]);

  const handleRuleSectionDragEnd =
    (sectionId: string) =>
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setEmbeddedRuleSections((prev) =>
        prev.map((sec) => {
          if (sec.id !== sectionId) return sec;
          const lines = [...sec.lines];
          const from = lines.findIndex((l) => l.id === active.id);
          const to = lines.findIndex((l) => l.id === over.id);
          if (from === -1 || to === -1) return sec;
          return { ...sec, lines: arrayMove(lines, from, to) };
        })
      );
    };

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
    if (dataMode === "sandbox" || !configureUnlocked) return;
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

  const beginDeleteItem = (id: number) => {
    if (dataMode === "sandbox" || !configureUnlocked) return;

    const topRow = topLevel.find((i) => i.id === id);
    if (topRow) {
      const children = childMap.get(id) || [];
      const raw = (topRow.item_text || "").trim().slice(0, 72) || "this item";
      const preview = raw.length >= 72 ? `${raw}…` : raw;
      setDeleteDialog({
        id,
        parentId: null,
        preview,
        subItemCount: children.length,
        childIds: children.map((c) => c.id),
      });
      return;
    }

    let parentId: number | null = null;
    for (const [pid, arr] of childMap) {
      if (arr.some((c) => c.id === id)) {
        parentId = pid;
        break;
      }
    }
    if (parentId == null) return;
    const ch = childMap.get(parentId)?.find((c) => c.id === id);
    if (!ch) return;
    const raw = (ch.item_text || "").trim().slice(0, 72) || "this item";
    const preview = raw.length >= 72 ? `${raw}…` : raw;
    setDeleteDialog({ id, parentId, preview, subItemCount: 0, childIds: [] });
  };

  const confirmDeleteItem = async () => {
    if (!deleteDialog || dataMode === "sandbox" || !configureUnlocked) {
      setDeleteDialog(null);
      return;
    }
    const { id, parentId, childIds } = deleteDialog;
    setDeleteDialog(null);

    try {
      if (parentId === null) {
        for (const cid of childIds) {
          await invoke("delete_strategy_checklist_item", { id: cid });
        }
        await invoke("delete_strategy_checklist_item", { id });
        setChildMap((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setTopLevel((prev) => {
          const next = prev.filter((i) => i.id !== id);
          renumberTopLevel(next);
          return next;
        });
      } else {
        await invoke("delete_strategy_checklist_item", { id });
        setChildMap((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(parentId) || [])];
          const filtered = arr.filter((c) => c.id !== id);
          renumberChildren(filtered);
          next.set(parentId, filtered);
          return next;
        });
      }
      onAfterSave();
    } catch (e) {
      console.error(e);
      alert("Failed to delete checklist item: " + e);
    }
  };

  const addTopLevelChecklistItem = async () => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    try {
      const order = topLevel.length;
      const newId = await invoke<number>("save_strategy_checklist_item", {
        id: null,
        strategyId,
        itemText: "New checklist item",
        isChecked: false,
        itemOrder: order,
        checklistType,
        parentId: null,
        high_is_good: isSurveyType(checklistType) ? true : undefined,
        description: null,
        survey_format: isSurveyType(checklistType) ? normalizedSurveyFormat(undefined) : undefined,
        survey_allow_na: surveyNaForInvoke(checklistType, {}),
      });
      const newItem: JournalChecklistItem = {
        id: newId,
        strategy_id: strategyId,
        item_text: "New checklist item",
        is_checked: false,
        item_order: order,
        checklist_type: checklistType,
        parent_id: null,
        high_is_good: isSurveyType(checklistType) ? true : undefined,
        survey_format: isSurveyType(checklistType) ? normalizedSurveyFormat(undefined) : undefined,
        survey_allow_na: isSurveyType(checklistType) ? false : undefined,
      };
      setTopLevel((prev) => [...prev, newItem]);
      onAfterSave();
    } catch (e) {
      console.error(e);
      alert("Failed to add checklist item: " + e);
    }
  };

  const removeRuleLineById = (ruleId: string) => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setEmbeddedRuleSections((prev) => {
      const mapped = prev.map((sec) => ({
        ...sec,
        lines: sec.lines.filter((l) => l.id !== ruleId),
      }));
      const nonEmpty = mapped.filter((sec) => sec.title.trim() || sec.lines.length > 0);
      return nonEmpty.length > 0 ? nonEmpty : [{ id: newEmbeddedRuleLineId(), title: "", lines: [] }];
    });
    setSelectedRuleLineIds((prev) => {
      const next = new Set(prev);
      next.delete(ruleId);
      return next;
    });
  };

  const addRuleLineToLastSection = () => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setEmbeddedRuleSections((prev) => {
      if (prev.length === 0) return [{ id: newEmbeddedRuleLineId(), title: "", lines: [{ id: newEmbeddedRuleLineId(), text: "" }] }];
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, lines: [...last.lines, { id: newEmbeddedRuleLineId(), text: "" }] };
      return next;
    });
  };

  const addEmbeddedRuleSection = () => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setEmbeddedRuleSections((prev) => [...prev, { id: newEmbeddedRuleLineId(), title: "New section", lines: [] }]);
  };

  const updateRuleSectionTitle = (sectionId: string, title: string) => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setEmbeddedRuleSections((prev) => prev.map((sec) => (sec.id === sectionId ? { ...sec, title } : sec)));
  };

  const flattenEmbeddedRuleSections = () => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setEmbeddedRuleSections((prev) => {
      const allLines = prev.flatMap((s) => s.lines);
      return [{ id: newEmbeddedRuleLineId(), title: "", lines: allLines }];
    });
    setSelectedRuleLineIds(new Set());
  };

  const submitRuleGroupFromSelection = (groupTitle: string) => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    const title = groupTitle.trim();
    if (!title || selectedRuleLineIds.size === 0) return;
    const ids = Array.from(selectedRuleLineIds);
    setEmbeddedRuleSections((prev) => {
      const collected: EmbeddedRuleLine[] = [];
      const stripped = prev.map((sec) => {
        const keep: EmbeddedRuleLine[] = [];
        for (const ln of sec.lines) {
          if (ids.includes(ln.id)) collected.push(ln);
          else keep.push(ln);
        }
        return { ...sec, lines: keep };
      });
      const cleaned = stripped.filter((sec) => sec.title.trim() || sec.lines.length > 0);
      const newSec: EmbeddedRuleSection = { id: newEmbeddedRuleLineId(), title, lines: collected };
      return [...cleaned, newSec];
    });
    setSelectedRuleLineIds(new Set());
    setRuleGroupModalOpen(false);
    setPendingGroupName("");
  };

  const moveSelectedRuleLinesToSection = (targetSectionId: string) => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    const ids = Array.from(selectedRuleLineIds);
    if (ids.length === 0) return;
    setEmbeddedRuleSections((prev) => {
      const collected: EmbeddedRuleLine[] = [];
      const stripped = prev.map((sec) => {
        const keep: EmbeddedRuleLine[] = [];
        for (const ln of sec.lines) {
          if (ids.includes(ln.id)) collected.push(ln);
          else keep.push(ln);
        }
        return { ...sec, lines: keep };
      });
      return stripped.map((sec) =>
        sec.id === targetSectionId ? { ...sec, lines: [...sec.lines, ...collected] } : sec
      );
    });
    setSelectedRuleLineIds(new Set());
  };

  const submitChecklistGroup = async () => {
    const name = pendingGroupName.trim();
    const ids = Array.from(selectedChecklistIds);
    if (dataMode === "sandbox" || !configureUnlocked || ids.length === 0 || !name) return;
    try {
      await invoke("group_checklist_items", {
        itemIds: ids,
        groupName: name,
        strategyId,
        checklistType,
      });
      setSelectedChecklistIds(new Set());
      setChecklistGroupModalOpen(false);
      setPendingGroupName("");
      onAfterSave();
    } catch (e) {
      console.error(e);
      alert("Failed to group checklist items: " + e);
    }
  };

  const ungroupSelectedChecklistItems = async () => {
    const ids = Array.from(selectedChecklistIds);
    if (dataMode === "sandbox" || !configureUnlocked || ids.length === 0) return;
    try {
      await invoke("ungroup_checklist_items", { itemIds: ids });
      setSelectedChecklistIds(new Set());
      onAfterSave();
    } catch (e) {
      console.error(e);
      alert("Failed to ungroup checklist items: " + e);
    }
  };

  const moveChecklistItemsToGroup = async (targetGroupId: number) => {
    const ids = Array.from(selectedChecklistIds).filter((id) => id !== targetGroupId);
    if (dataMode === "sandbox" || !configureUnlocked || ids.length === 0) return;
    const targetChildren = childMap.get(targetGroupId) || [];
    const maxOrder = targetChildren.length > 0 ? Math.max(...targetChildren.map((c) => c.item_order)) : -1;
    let offset = 0;
    try {
      for (const itemId of ids) {
        const item = flatForSave.find((i) => i.id === itemId);
        if (!item) continue;
        const newOrder = maxOrder + 1 + offset;
        offset++;
        await invoke("save_strategy_checklist_item", {
          id: itemId,
          strategyId,
          itemText: item.item_text.trim(),
          isChecked: item.is_checked,
          itemOrder: newOrder,
          checklistType,
          parentId: targetGroupId,
          high_is_good: isSurveyType(checklistType) ? (item.high_is_good ?? true) : undefined,
          description: item.description ?? null,
          survey_format: isSurveyType(checklistType) ? normalizedSurveyFormat(item.survey_format) : undefined,
          survey_allow_na: surveyNaForInvoke(checklistType, item),
        });
      }
      setSelectedChecklistIds(new Set());
      onAfterSave();
    } catch (e) {
      console.error(e);
      alert("Failed to move items to group: " + e);
    }
  };

  const handleSave = async () => {
    if (dataMode === "sandbox" || !configureUnlocked) return;
    setSaving(true);
    try {
      if (topLevel.length > 0) {
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
      }
      if (embeddedStrategyRules) {
        const serialized = serializeEmbeddedRuleSections(embeddedRuleSections);
        saveStrategyRuleTexts(dataMode, strategyId, embeddedStrategyRules.kind, serialized);
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

  const toggleConfigureLock = () => {
    setConfigureUnlocked((u) => {
      if (u) {
        setChecklistGroupModalOpen(false);
        setRuleGroupModalOpen(false);
        setPendingGroupName("");
      }
      return !u;
    });
  };

  if (!open) return null;

  const sandboxLocked = dataMode === "sandbox";
  const editLocked = sandboxLocked || !configureUnlocked;
  const topIds = topLevel.map((r) => r.id);
  const isEmbeddedRules = Boolean(embeddedStrategyRules);
  const rulesColumnTitle =
    embeddedStrategyRules?.kind === "entry"
      ? "Entry rules"
      : embeddedStrategyRules?.kind === "takeProfit"
        ? "Take profit rules"
        : "";

  const renderColumnLockPill = (tone: "accent" | "warning") => {
    if (sandboxLocked) return null;
    const c = tone === "accent" ? "var(--accent)" : "var(--warning)";
    return (
      <button
        type="button"
        onClick={toggleConfigureLock}
        title={configureUnlocked ? "Lock template (read-only)" : "Unlock to edit checklist and rules"}
        style={{
          flexShrink: 0,
          padding: "5px 11px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          border: configureUnlocked ? `1px solid ${c}` : `2px solid color-mix(in srgb, ${c} 55%, var(--border-color))`,
          background: configureUnlocked ? `color-mix(in srgb, ${c} 14%, transparent)` : `color-mix(in srgb, ${c} 22%, transparent)`,
          color: c,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          boxShadow: configureUnlocked ? "none" : `0 0 16px color-mix(in srgb, ${c} 28%, transparent)`,
        }}
      >
        {configureUnlocked ? <Unlock size={13} aria-hidden /> : <Lock size={13} aria-hidden />}
        {configureUnlocked ? "Edit" : "Locked"}
      </button>
    );
  };

  const checklistGroupRows = topLevel.filter((r) => (childMap.get(r.id)?.length ?? 0) > 0);

  const toggleChecklistSelect = (id: number, selected: boolean) => {
    setSelectedChecklistIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const checklistSelectionToolbar =
    !editLocked && selectedChecklistIds.size > 0 ? (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--border-color)",
          background: "var(--bg-primary)",
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setPendingGroupName("");
            setChecklistGroupModalOpen(true);
          }}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            color: "white",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <FolderPlus size={14} aria-hidden />
          New group ({selectedChecklistIds.size})
        </button>
        {checklistGroupRows.length > 0 ? (
          <select
            aria-label="Move selected to group"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                void moveChecklistItemsToGroup(Number(v));
                e.target.selectedIndex = 0;
              }
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
              maxWidth: 220,
            }}
          >
            <option value="" disabled>
              Move to group…
            </option>
            {checklistGroupRows.map((g) => (
              <option key={g.id} value={g.id}>
                {g.item_text.trim() || "Group"}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => void ungroupSelectedChecklistItems()}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            padding: "6px 12px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Ungroup
        </button>
        <button
          type="button"
          onClick={() => setSelectedChecklistIds(new Set())}
          style={{
            background: "transparent",
            border: "1px dashed var(--border-color)",
            borderRadius: 8,
            padding: "6px 12px",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Clear selection
        </button>
      </div>
    ) : null;

  const textareaStyleNoResize: CSSProperties = {
    width: "100%",
    resize: "none",
    minHeight: 36,
    maxHeight: 220,
    padding: "6px 10px",
    lineHeight: 1.35,
    borderRadius: 8,
    border: "1px solid var(--border-color)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "inherit",
    overflow: "auto",
  };

  const ruleLineTextareaStyle: CSSProperties = {
    ...textareaStyleNoResize,
    border: "1px solid color-mix(in srgb, var(--warning) 28%, var(--border-color))",
  };

  const ruleSelectionToolbar =
    !editLocked && selectedRuleLineIds.size > 0 ? (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: 10,
          borderRadius: 8,
          border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
          background: "var(--bg-primary)",
          marginBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setPendingGroupName("");
            setRuleGroupModalOpen(true);
          }}
          style={{
            background: "color-mix(in srgb, var(--warning) 85%, var(--accent))",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            color: "white",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <FolderPlus size={14} aria-hidden />
          New group ({selectedRuleLineIds.size})
        </button>
        {embeddedRuleSections.length > 1 ? (
          <select
            aria-label="Move selected rules to section"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                moveSelectedRuleLinesToSection(v);
                e.target.selectedIndex = 0;
              }
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
              maxWidth: 220,
            }}
          >
            <option value="" disabled>
              Move to section…
            </option>
            {embeddedRuleSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.trim() || "Rules"}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={flattenEmbeddedRuleSections}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
            borderRadius: 8,
            padding: "6px 12px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Ungroup all
        </button>
        <button
          type="button"
          onClick={() => setSelectedRuleLineIds(new Set())}
          style={{
            background: "transparent",
            border: "1px dashed var(--border-color)",
            borderRadius: 8,
            padding: "6px 12px",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Clear selection
        </button>
      </div>
    ) : null;

  const toggleRuleLineSelect = (lineId: string, selected: boolean) => {
    setSelectedRuleLineIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  };

  const rulesColumnEmpty =
    embeddedRuleSections.length === 1 &&
    !embeddedRuleSections[0].title.trim() &&
    embeddedRuleSections[0].lines.length === 0;

  const renderChecklistEditor = () => {
    if (topLevel.length === 0) {
      return (
        <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          {isEmbeddedRules
            ? 'No checklist items yet. Use "Add checklist item" above.'
            : "No checklist items to configure."}
        </div>
      );
    }
    return (
      <>
        {checklistSelectionToolbar}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={topIds} strategy={verticalListSortingStrategy}>
            {topLevel.map((row) => {
              const children = childMap.get(row.id) || [];
              const childIds = children.map((c) => c.id);
              return (
                <div key={row.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <SortableConfigureBlock id={row.id} disabled={editLocked}>
                    {({ attributes, listeners }) => (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto auto 1fr auto",
                          gap: 8,
                          alignItems: "center",
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid var(--border-color)",
                          background: "var(--bg-primary)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedChecklistIds.has(row.id)}
                          disabled={editLocked}
                          onChange={(e) => toggleChecklistSelect(row.id, e.target.checked)}
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{ width: 16, height: 16, cursor: editLocked ? "not-allowed" : "pointer", accentColor: "var(--accent)" }}
                          title="Select for grouping"
                          aria-label="Select checklist row"
                        />
                        <DragHandle disabled={editLocked} attributes={attributes} listeners={listeners} />
                        <textarea
                          value={row.item_text}
                          disabled={editLocked}
                          onChange={(e) => updateItemText(row.id, e.target.value)}
                          rows={1}
                          style={textareaStyleNoResize}
                        />
                        <button
                          type="button"
                          disabled={editLocked}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            beginDeleteItem(row.id);
                          }}
                          title="Delete item"
                          aria-label="Delete checklist item"
                          style={{
                            flexShrink: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 36,
                            height: 36,
                            padding: 0,
                            borderRadius: 8,
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-tertiary)",
                            color: "var(--danger, #ef4444)",
                            cursor: editLocked ? "not-allowed" : "pointer",
                            opacity: editLocked ? 0.45 : 1,
                          }}
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      </div>
                    )}
                  </SortableConfigureBlock>

                  {childIds.length > 0 ? (
                    <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                      {children.map((ch) => (
                        <SortableConfigureBlock key={ch.id} id={ch.id} disabled={editLocked}>
                          {({ attributes, listeners }) => (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "auto auto 1fr auto",
                                gap: 8,
                                alignItems: "center",
                                marginLeft: 20,
                                padding: 10,
                                borderRadius: 10,
                                border: "1px dashed color-mix(in srgb, var(--accent) 35%, var(--border-color))",
                                background: "var(--bg-primary)",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedChecklistIds.has(ch.id)}
                                disabled={editLocked}
                                onChange={(e) => toggleChecklistSelect(ch.id, e.target.checked)}
                                onPointerDown={(e) => e.stopPropagation()}
                                style={{ width: 16, height: 16, cursor: editLocked ? "not-allowed" : "pointer", accentColor: "var(--accent)" }}
                                title="Select for grouping"
                                aria-label="Select checklist sub-item"
                              />
                              <DragHandle disabled={editLocked} attributes={attributes} listeners={listeners} />
                              <textarea
                                value={ch.item_text}
                                disabled={editLocked}
                                onChange={(e) => updateItemText(ch.id, e.target.value)}
                                rows={1}
                                style={textareaStyleNoResize}
                              />
                              <button
                                type="button"
                                disabled={editLocked}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  beginDeleteItem(ch.id);
                                }}
                                title="Delete sub-item"
                                aria-label="Delete checklist sub-item"
                                style={{
                                  flexShrink: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 36,
                                  height: 36,
                                  padding: 0,
                                  borderRadius: 8,
                                  border: "1px solid var(--border-color)",
                                  background: "var(--bg-tertiary)",
                                  color: "var(--danger, #ef4444)",
                                  cursor: editLocked ? "not-allowed" : "pointer",
                                  opacity: editLocked ? 0.45 : 1,
                                }}
                              >
                                <Trash2 size={16} aria-hidden />
                              </button>
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
      </>
    );
  };

  return (
    <>
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
          maxWidth: isEmbeddedRules ? 1120 : 560,
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

        <div
          style={{
            padding: "8px 14px",
            background: "color-mix(in srgb, var(--warning) 10%, transparent)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700, color: "var(--warning)" }}>Strategy template</span>
            {" · "}
            Edits apply to <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>all</strong> journal entries using this strategy. Drag{" "}
            <GripVertical size={12} style={{ verticalAlign: "middle", display: "inline" }} aria-hidden /> to reorder.
          </p>
          {sandboxLocked ? (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--danger)", lineHeight: 1.35 }}>
              Demo mode: switch to Real or Paper to edit.
            </p>
          ) : !configureUnlocked ? (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.35 }}>
              View-only — unlock using the bar or <strong>Locked</strong> pills next to the columns.
            </p>
          ) : null}
        </div>

        <div
          style={{
            overflow: "auto",
            padding: 16,
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            colorScheme: "dark",
          }}
        >
          {!sandboxLocked ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
                padding: "14px 16px",
                borderRadius: 12,
                border: configureUnlocked
                  ? "1px solid color-mix(in srgb, var(--accent) 45%, var(--border-color))"
                  : "2px solid color-mix(in srgb, var(--warning) 50%, var(--border-color))",
                background: configureUnlocked
                  ? "color-mix(in srgb, var(--accent) 9%, var(--bg-secondary))"
                  : "color-mix(in srgb, var(--warning) 12%, var(--bg-primary))",
                boxShadow: configureUnlocked ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "0 4px 20px rgba(0,0,0,0.35), 0 0 0 1px rgba(245, 158, 11, 0.12)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: "1 1 220px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    flexShrink: 0,
                    background: configureUnlocked
                      ? "color-mix(in srgb, var(--accent) 22%, transparent)"
                      : "color-mix(in srgb, var(--warning) 28%, transparent)",
                    border: configureUnlocked
                      ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)"
                      : "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
                  }}
                >
                  {configureUnlocked ? (
                    <Unlock size={22} style={{ color: "var(--accent)" }} aria-hidden />
                  ) : (
                    <Lock size={22} style={{ color: "var(--warning)" }} aria-hidden />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", lineHeight: 1.25 }}>
                    {configureUnlocked ? "Editing checklist & rules" : "Checklist & rules are locked"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                    {configureUnlocked
                      ? "Click Lock when you are done to avoid accidental changes."
                      : "Click Unlock to reorder, edit text, group items, and save to the strategy."}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleConfigureLock}
                style={{
                  padding: "12px 22px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  flexShrink: 0,
                  background: configureUnlocked ? "var(--bg-tertiary)" : "var(--warning)",
                  color: configureUnlocked ? "var(--text-primary)" : "white",
                  borderWidth: configureUnlocked ? 1 : 0,
                  borderStyle: "solid",
                  borderColor: configureUnlocked ? "var(--border-color)" : "transparent",
                  boxShadow: configureUnlocked ? "none" : "0 4px 16px rgba(245, 158, 11, 0.35)",
                }}
                title={configureUnlocked ? "Lock (read-only)" : "Unlock to edit"}
              >
                {configureUnlocked ? (
                  <>
                    <Lock size={20} aria-hidden />
                    Lock
                  </>
                ) : (
                  <>
                    <Unlock size={20} aria-hidden />
                    Unlock to edit
                  </>
                )}
              </button>
            </div>
          ) : null}
          {isEmbeddedRules && embeddedStrategyRules ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
                gap: 20,
                alignItems: "stretch",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minWidth: 0,
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border-color))",
                  background: "color-mix(in srgb, var(--accent) 5%, var(--bg-secondary))",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <ListChecks size={16} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{sectionTitle}</span>
                    {renderColumnLockPill("accent")}
                  </div>
                  <button
                    type="button"
                    disabled={editLocked}
                    onClick={() => void addTopLevelChecklistItem()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px dashed color-mix(in srgb, var(--accent) 45%, var(--border-color))",
                      background: "transparent",
                      color: "var(--accent)",
                      cursor: editLocked ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    + Add checklist item
                  </button>
                </div>
                {renderChecklistEditor()}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minWidth: 0,
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
                  background: "color-mix(in srgb, var(--warning) 6%, var(--bg-secondary))",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <Scale size={16} style={{ color: "var(--warning)", flexShrink: 0 }} aria-hidden />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--warning)" }}>{rulesColumnTitle}</span>
                    {renderColumnLockPill("warning")}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={editLocked}
                      onClick={() => addRuleLineToLastSection()}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px dashed color-mix(in srgb, var(--warning) 50%, var(--border-color))",
                        background: "transparent",
                        color: "var(--warning)",
                        cursor: editLocked ? "not-allowed" : "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      + Add rule
                    </button>
                    <button
                      type="button"
                      disabled={editLocked}
                      onClick={() => addEmbeddedRuleSection()}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px dashed color-mix(in srgb, var(--warning) 50%, var(--border-color))",
                        background: "transparent",
                        color: "var(--warning)",
                        cursor: editLocked ? "not-allowed" : "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      + Add section
                    </button>
                  </div>
                </div>
                {ruleSelectionToolbar}
                {rulesColumnEmpty ? (
                  <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>No rules yet. Use &ldquo;Add rule&rdquo; above.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {embeddedRuleSections.map((sec) => (
                      <div key={sec.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {embeddedRuleSections.length > 1 || sec.title.trim() ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 0",
                            }}
                          >
                            <Folder size={14} style={{ color: "var(--warning)", flexShrink: 0, opacity: 0.9 }} aria-hidden />
                            <input
                              type="text"
                              value={sec.title}
                              disabled={editLocked}
                              onChange={(e) => updateRuleSectionTitle(sec.id, e.target.value)}
                              placeholder="Section name (optional)"
                              style={{
                                flex: 1,
                                minWidth: 0,
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
                                background: "var(--bg-primary)",
                                color: "var(--text-primary)",
                                fontSize: 13,
                                fontWeight: 600,
                              }}
                            />
                          </div>
                        ) : null}
                        {sec.lines.length === 0 ? (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>No lines in this section.</div>
                        ) : (
                          <DndContext
                            sensors={embeddedRuleSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleRuleSectionDragEnd(sec.id)}
                          >
                            <SortableContext items={sec.lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                              {sec.lines.map((row) => (
                                <EmbeddedRuleSortableRow key={row.id} id={row.id} disabled={editLocked}>
                                  {({ attributes, listeners }) => (
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "auto auto 1fr auto",
                                        gap: 8,
                                        alignItems: "center",
                                        padding: 10,
                                        borderRadius: 10,
                                        border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
                                        background: "var(--bg-primary)",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedRuleLineIds.has(row.id)}
                                        disabled={editLocked}
                                        onChange={(e) => toggleRuleLineSelect(row.id, e.target.checked)}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        style={{
                                          width: 16,
                                          height: 16,
                                          cursor: editLocked ? "not-allowed" : "pointer",
                                          accentColor: "var(--warning)",
                                        }}
                                        title="Select for grouping"
                                        aria-label="Select rule line"
                                      />
                                      <EmbeddedRuleDragHandle disabled={editLocked} attributes={attributes} listeners={listeners} />
                                      <textarea
                                        value={row.text}
                                        disabled={editLocked}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setEmbeddedRuleSections((prev) =>
                                            prev.map((s) =>
                                              s.id === sec.id
                                                ? {
                                                    ...s,
                                                    lines: s.lines.map((l) => (l.id === row.id ? { ...l, text: v } : l)),
                                                  }
                                                : s
                                            )
                                          );
                                        }}
                                        rows={1}
                                        style={ruleLineTextareaStyle}
                                      />
                                      <button
                                        type="button"
                                        disabled={editLocked}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeRuleLineById(row.id);
                                        }}
                                        title="Delete rule"
                                        aria-label="Delete rule"
                                        style={{
                                          flexShrink: 0,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          width: 36,
                                          height: 36,
                                          padding: 0,
                                          borderRadius: 8,
                                          border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border-color))",
                                          background: "var(--bg-tertiary)",
                                          color: "var(--danger, #ef4444)",
                                          cursor: editLocked ? "not-allowed" : "pointer",
                                          opacity: editLocked ? 0.45 : 1,
                                        }}
                                      >
                                        <Trash2 size={16} aria-hidden />
                                      </button>
                                    </div>
                                  )}
                                </EmbeddedRuleSortableRow>
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{sectionTitle}</span>
                  {renderColumnLockPill("accent")}
                </div>
                <button
                  type="button"
                  disabled={editLocked}
                  onClick={() => void addTopLevelChecklistItem()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px dashed color-mix(in srgb, var(--accent) 45%, var(--border-color))",
                    background: "transparent",
                    color: "var(--accent)",
                    cursor: editLocked ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  + Add checklist item
                </button>
              </div>
              {renderChecklistEditor()}
            </>
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
            disabled={editLocked || saving || (topLevel.length === 0 && !embeddedStrategyRules)}
            onClick={() => void handleSave()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: editLocked || (topLevel.length === 0 && !embeddedStrategyRules) ? "var(--bg-tertiary)" : "var(--accent)",
              color: editLocked || (topLevel.length === 0 && !embeddedStrategyRules) ? "var(--text-secondary)" : "white",
              cursor: editLocked || (topLevel.length === 0 && !embeddedStrategyRules) ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Save to strategy"}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      open={deleteDialog != null}
      title={deleteDialog && deleteDialog.parentId === null && deleteDialog.subItemCount > 0 ? "Delete checklist group?" : "Delete checklist item?"}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      zIndex={1200}
      onCancel={() => setDeleteDialog(null)}
      onConfirm={() => void confirmDeleteItem()}
    >
      {deleteDialog && deleteDialog.parentId === null && deleteDialog.subItemCount > 0 ? (
        <p style={{ margin: "0 0 12px" }}>
          This removes <strong>{deleteDialog.subItemCount}</strong> nested sub-item{deleteDialog.subItemCount === 1 ? "" : "s"} under this group. This cannot be undone.
        </p>
      ) : (
        <p style={{ margin: "0 0 12px" }}>This cannot be undone.</p>
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>&ldquo;{deleteDialog?.preview}&rdquo;</span>
      </p>
    </ConfirmDialog>

    {checklistGroupModalOpen ? (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1150,
          background: "rgba(0,0,0,0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        onClick={() => setChecklistGroupModalOpen(false)}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="checklist-group-modal-title"
        >
          <h3 id="checklist-group-modal-title" style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            Create checklist group
          </h3>
          <input
            type="text"
            value={pendingGroupName}
            onChange={(e) => setPendingGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pendingGroupName.trim()) void submitChecklistGroup();
              if (e.key === "Escape") setChecklistGroupModalOpen(false);
            }}
            placeholder="Group name…"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              marginBottom: 16,
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              onClick={() => setChecklistGroupModalOpen(false)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!pendingGroupName.trim()}
              onClick={() => void submitChecklistGroup()}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: pendingGroupName.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                color: pendingGroupName.trim() ? "white" : "var(--text-secondary)",
                cursor: pendingGroupName.trim() ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {ruleGroupModalOpen ? (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1150,
          background: "rgba(0,0,0,0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
        onClick={() => setRuleGroupModalOpen(false)}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rule-group-modal-title"
        >
          <h3 id="rule-group-modal-title" style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
            New rule group
          </h3>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Selected lines will be placed under this section header.
          </p>
          <input
            type="text"
            value={pendingGroupName}
            onChange={(e) => setPendingGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pendingGroupName.trim()) submitRuleGroupFromSelection(pendingGroupName);
              if (e.key === "Escape") setRuleGroupModalOpen(false);
            }}
            placeholder="Section name…"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              marginBottom: 16,
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              onClick={() => setRuleGroupModalOpen(false)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!pendingGroupName.trim()}
              onClick={() => submitRuleGroupFromSelection(pendingGroupName)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: pendingGroupName.trim() ? "var(--warning)" : "var(--bg-tertiary)",
                color: pendingGroupName.trim() ? "white" : "var(--text-secondary)",
                cursor: pendingGroupName.trim() ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
