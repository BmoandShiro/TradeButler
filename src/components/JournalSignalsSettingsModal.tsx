import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { X, GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
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
import type { Indicator, IndicatorPhase } from "../utils/indicatorsStore";

type SortableHandleSlot = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;
import { EmaMaJournalSettingsEditor } from "./EmaMaJournalSettingsEditor";
import { CustomOtherSignalsSettingsPanel } from "./CustomOtherSignalsSettingsPanel";

type IndicatorPhaseT = IndicatorPhase;

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(245,158,11,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function JournalSignalsSettingsModal({
  open,
  onClose,
  phase,
  indicators,
  signalFilter,
  onSignalFilter,
  canEdit,
  strategyIndicatorsInOrder,
  onPersistIndicatorOrder,
  showStrategyTemplateNotice,
}: {
  open: boolean;
  onClose: () => void;
  phase: IndicatorPhaseT;
  indicators: Indicator[];
  signalFilter: { technical: boolean; candlestick: boolean };
  onSignalFilter: (next: { technical: boolean; candlestick: boolean }) => void;
  canEdit: boolean;
  /** Full strategy indicator list (display order). Used to reorder signals on the strategy. */
  strategyIndicatorsInOrder?: Indicator[];
  onPersistIndicatorOrder?: (orderedIds: string[]) => void;
  showStrategyTemplateNotice?: boolean;
}) {
  const [orderedForStrategy, setOrderedForStrategy] = useState<Indicator[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (open && strategyIndicatorsInOrder?.length) {
      setOrderedForStrategy([...strategyIndicatorsInOrder]);
    } else if (open) {
      setOrderedForStrategy([]);
    }
  }, [open, strategyIndicatorsInOrder]);

  const persistOrderIfNeeded = () => {
    if (!onPersistIndicatorOrder || !strategyIndicatorsInOrder?.length || !orderedForStrategy.length) return;
    const before = strategyIndicatorsInOrder.map((i) => i.id).join(",");
    const after = orderedForStrategy.map((i) => i.id).join(",");
    if (before !== after) onPersistIndicatorOrder(orderedForStrategy.map((i) => i.id));
  };

  const finish = () => {
    persistOrderIfNeeded();
    onClose();
  };

  if (!open) return null;

  const phaseLabel = phase === "entry" ? "Entry" : "Take Profit";
  const showReorder = Boolean(canEdit && onPersistIndicatorOrder && strategyIndicatorsInOrder && strategyIndicatorsInOrder.length > 0);

  const indicatorOrderIds = orderedForStrategy.map((i) => i.id);

  const handleIndicatorDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderedForStrategy.findIndex((i) => i.id === active.id);
    const to = orderedForStrategy.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;
    setOrderedForStrategy(arrayMove(orderedForStrategy, from, to));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={finish}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "88vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Signal settings — {phaseLabel}</div>
          <button
            type="button"
            onClick={finish}
            style={{
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              borderRadius: 10,
              padding: "8px 10px",
              cursor: "pointer",
              display: "flex",
            }}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {showStrategyTemplateNotice ? (
            <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, padding: 12, background: "color-mix(in srgb, var(--warning) 12%, transparent)" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "var(--warning)", letterSpacing: "0.06em", marginBottom: 8 }}>Strategy template</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
                Reordering signals updates this strategy for <strong>all journal entries</strong> that use it. Per-indicator options below apply wherever these signals appear.
              </p>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Drag the <GripVertical size={12} style={{ verticalAlign: "middle", display: "inline" }} aria-hidden /> handle to change display order.
              </p>
            </div>
          ) : null}

          {showReorder ? (
            <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, padding: 12, background: "var(--bg-secondary)" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 10 }}>
                Signal order on strategy
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleIndicatorDragEnd}>
                <SortableContext items={indicatorOrderIds} strategy={verticalListSortingStrategy}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {orderedForStrategy.map((ind) => (
                      <SortableStrategyIndicatorRow key={ind.id} id={ind.id} disabled={!canEdit}>
                        {({ attributes, listeners }) => (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "auto 1fr",
                              gap: 10,
                              alignItems: "center",
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--border-color)",
                              background: "var(--bg-primary)",
                            }}
                          >
                            <SignalOrderDragHandle disabled={!canEdit} attributes={attributes} listeners={listeners} />
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  padding: "3px 7px",
                                  borderRadius: 8,
                                  background: hexToRgba(ind.accentColor ?? "#F59E0B", 0.18),
                                  border: `1px solid ${hexToRgba(ind.accentColor ?? "#F59E0B", 0.55)}`,
                                  color: ind.accentColor ?? "#F59E0B",
                                  flexShrink: 0,
                                }}
                              >
                                {ind.abbreviation}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ind.name}</span>
                            </div>
                          </div>
                        )}
                      </SortableStrategyIndicatorRow>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ) : null}

          <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, padding: 12, background: "var(--bg-secondary)" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 10 }}>Display</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: canEdit ? "pointer" : "default", color: "var(--text-secondary)", fontSize: 12, fontWeight: 650 }}>
                <input
                  type="checkbox"
                  checked={signalFilter.technical}
                  disabled={!canEdit}
                  onChange={(e) => onSignalFilter({ ...signalFilter, technical: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                Technical Patterns
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: canEdit ? "pointer" : "default", color: "var(--text-secondary)", fontSize: 12, fontWeight: 650 }}>
                <input
                  type="checkbox"
                  checked={signalFilter.candlestick}
                  disabled={!canEdit}
                  onChange={(e) => onSignalFilter({ ...signalFilter, candlestick: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                Candlesticks
              </label>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.06em" }}>Per-indicator (shown in this journal)</div>

          {indicators.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>No indicators match the current pattern filters.</div>
          ) : (
            indicators.map((ind) => (
              <div
                key={ind.id}
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: 12,
                  overflow: "visible",
                  background: "var(--bg-secondary)",
                }}
              >
                <div
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "3px 7px",
                        borderRadius: 8,
                        background: hexToRgba(ind.accentColor ?? "#F59E0B", 0.18),
                        border: `1px solid ${hexToRgba(ind.accentColor ?? "#F59E0B", 0.55)}`,
                        color: ind.accentColor ?? "#F59E0B",
                      }}
                    >
                      {ind.abbreviation}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{ind.name}</span>
                  </div>
                  <Link
                    to={`/signals?focus=${encodeURIComponent(ind.id)}`}
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
                    onClick={finish}
                  >
                    Open in Signals
                  </Link>
                </div>
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {ind.id === "ema" || ind.id === "ma" ? (
                    <EmaMaJournalSettingsEditor indicatorId={ind.id} />
                  ) : ind.kind === "custom" ? (
                    <CustomOtherSignalsSettingsPanel indicatorId={ind.id} otherSignals={ind.otherSignals ?? []} />
                  ) : (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>
                      Thumbnail, code, and full library details are on the Signals page. Use{" "}
                      <Link to={`/signals?focus=${encodeURIComponent(ind.id)}`} style={{ color: "var(--accent)", fontWeight: 700 }} onClick={finish}>
                        Open in Signals
                      </Link>{" "}
                      to edit.
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={finish}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SignalOrderDragHandle({ disabled, attributes, listeners }: { disabled: boolean } & SortableHandleSlot) {
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
        height: 36,
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

function SortableStrategyIndicatorRow({
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
