import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  GridCycle,
  GridFutureSettings,
  GridFutureState,
  GridFutureSlot,
} from "./gridTypes";

interface GridFutureViewProps {
  selectedCycle?: GridCycle;
  settings: GridFutureSettings;
  state: GridFutureState;
  onSettingsChange: (next: Partial<GridFutureSettings>) => void;
}

function fmtNum(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "—";
  const s = n.toFixed(d);
  return s.replace(/\.?0+$/, "");
}

function slotSideLabel(slot: GridFutureSlot): "BUY" | "SELL" {
  if (
    slot.status === "waiting_sell" ||
    slot.status === "partially_filled_sell" ||
    slot.status === "completed" ||
    slot.status === "principal_recovered_holding_free_shares"
  ) {
    return "SELL";
  }
  return "BUY";
}

function projectedPrincipalRecovered(slot: GridFutureSlot): number {
  const actual = slot.principalRecovered ?? 0;
  if (actual > 0) return actual;
  if (slot.status === "waiting_sell" || slot.status === "partially_filled_sell") {
    const qty =
      slot.plannedSellQuantity ?? slot.filledBuyQuantity ?? slot.plannedBuyQuantity ?? 0;
    const px = slot.plannedSellPrice ?? slot.targetSellPrice ?? 0;
    return px > 0 && qty > 0 ? px * qty : 0;
  }
  return 0;
}

function projectedFreeShares(slot: GridFutureSlot): number {
  const actual = slot.freeShareQuantityCreated ?? 0;
  if (actual > 0) return actual;
  if (slot.status === "waiting_sell" || slot.status === "partially_filled_sell") {
    const buyQty = slot.filledBuyQuantity ?? slot.plannedBuyQuantity ?? 0;
    const sellQty =
      slot.plannedSellQuantity ?? slot.filledSellQuantity ?? slot.filledBuyQuantity ?? 0;
    const rem = buyQty - sellQty;
    return rem > 0 ? rem : 0;
  }
  return 0;
}

const FUTURE_VIEW_LAYOUT_KEY = "tradebutler_grid_future_view_layout";

function loadFutureViewLayout() {
  try {
    const raw = localStorage.getItem(FUTURE_VIEW_LAYOUT_KEY);
    if (!raw) return { tableWidthPct: 75, uncheckedHeightPct: 50 };
    const parsed = JSON.parse(raw) as { tableWidthPct?: number; uncheckedHeightPct?: number };
    return {
      tableWidthPct: Math.max(30, Math.min(90, parsed.tableWidthPct ?? 75)),
      uncheckedHeightPct: Math.max(20, Math.min(80, parsed.uncheckedHeightPct ?? 50)),
    };
  } catch {
    return { tableWidthPct: 75, uncheckedHeightPct: 50 };
  }
}

export function GridFutureView({
  selectedCycle,
  settings,
  state,
  onSettingsChange,
}: GridFutureViewProps) {
  const [showUnfilledBuys, setShowUnfilledBuys] = useState(false);
  const [expandedSlotIds, setExpandedSlotIds] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState(loadFutureViewLayout);
  const [resizing, setResizing] = useState<"horizontal" | "vertical" | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(FUTURE_VIEW_LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    if (!resizing) return;
    document.body.style.userSelect = "none";
    const handleMouseMove = (e: MouseEvent) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (resizing === "vertical") {
        const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
        setLayout((prev) => ({ ...prev, tableWidthPct: Math.max(30, Math.min(90, rawPct)) }));
      } else {
        const rawPct = ((e.clientY - rect.top) / rect.height) * 100;
        setLayout((prev) => ({ ...prev, uncheckedHeightPct: Math.max(20, Math.min(80, rawPct)) }));
      }
    };
    const handleMouseUp = () => {
      setResizing(null);
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing]);

  if (!selectedCycle) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)" }}>
        Select a cycle to open Future view planning.
      </div>
    );
  }

  const buyLots = state.buyLots ?? [];
  const summary = state.summary ?? {};
  const { capital, grid, position, freeShareTargets } = summary;
  const slots = state.slots ?? [];
  const matchEvents = state.matchEvents ?? [];
  const openFragments = state.openFragments ?? [];
  const matchEventsBySlot = useMemo(() => {
    const bySlot = new Map<string, typeof matchEvents>();
    matchEvents.forEach((m) => {
      const arr = bySlot.get(m.slotId) ?? [];
      arr.push(m);
      bySlot.set(m.slotId, arr);
    });
    return bySlot;
  }, [matchEvents]);

  const openFragmentsBySlot = useMemo(() => {
    const bySlot = new Map<string, typeof openFragments>();
    openFragments.forEach((f) => {
      const arr = bySlot.get(f.slotId) ?? [];
      arr.push(f);
      bySlot.set(f.slotId, arr);
    });
    return bySlot;
  }, [openFragments]);
  const ladderRows = slots
    .filter((slot) => {
      const isUnfilledBuyRow =
        slot.status === "waiting_buy" || slot.status === "partially_filled_buy";
      const isActionableSellRow =
        slot.status === "waiting_sell" || slot.status === "partially_filled_sell";

      if (isActionableSellRow) return true;
      if (showUnfilledBuys && isUnfilledBuyRow) return true;
      return false;
    })
    .map((slot) => {
      const side = slotSideLabel(slot);
      const orderPrice =
        side === "SELL"
          ? (slot.plannedSellPrice ?? slot.filledSellPrice ?? slot.plannedBuyPrice)
          : slot.plannedBuyPrice;
      return { slot, side, orderPrice };
    })
    .sort((a, b) => b.orderPrice - a.orderPrice);

  const toggleSlotExpanded = (slotId: string) => {
    setExpandedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto auto auto auto minmax(0, 1fr)",
        gap: "8px",
        height: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "8px",
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: "8px",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        <LabeledInput
          label="Anchor"
          value={settings.anchorPrice}
          onChange={(v) => onSettingsChange({ anchorPrice: v })}
        />
        <LabeledInput
          label="Capital"
          value={settings.capitalAllocated}
          onChange={(v) => onSettingsChange({ capitalAllocated: v })}
        />
        <LabeledInput
          label="Levels"
          value={settings.gridLevels}
          onChange={(v) => onSettingsChange({ gridLevels: Math.max(1, Math.floor(v)) })}
        />
        <LabeledInput
          label="Buy step %"
          value={settings.buyStepPercent}
          onChange={(v) => onSettingsChange({ buyStepPercent: v })}
        />
        <LabeledInput
          label="Sell target %"
          value={settings.sellTargetPercent}
          onChange={(v) => onSettingsChange({ sellTargetPercent: v })}
        />
        <ReadOnlyField label="Current price" value={fmtNum(settings.marketPrice ?? 0, 4)} />
      </div>

      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "8px",
          display: "grid",
          gridTemplateColumns: "1.4fr repeat(6, minmax(0, 1fr))",
          gap: "8px",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "4px",
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary)" }}>
            Free-share settings
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            Configure free-share exits separately from core grid settings.
          </div>
        </div>

        <LabeledSelect
          label="Exit mode"
          value={"scale_out_by_grid"}
          onChange={() => {}}
          options={[
            { value: "scale_out_by_grid", label: "Scale out ladder" },
          ]}
          disabled
        />

        <LabeledSelect
          label="Reference cost"
          value={settings.freeShareReferenceCostMode}
          onChange={(v) =>
            onSettingsChange({
              freeShareReferenceCostMode:
                v as GridFutureSettings["freeShareReferenceCostMode"],
            })
          }
          options={[
            { value: "active_grid_average_cost", label: "Active grid avg" },
            { value: "blended_accounting_average_cost", label: "Blended accounting avg" },
            { value: "blended_strategy_average_cost", label: "Blended strategy avg" },
            { value: "manual_reference_price", label: "Manual reference" },
          ]}
        />

        <LabeledInput
          label="Start % above avg"
          value={settings.freeShareStartPercentAboveAvgCost}
          onChange={(v) =>
            onSettingsChange({ freeShareStartPercentAboveAvgCost: v })
          }
        />

        <LabeledInput
          label="Scale-out % step"
          value={settings.freeShareScaleOutPercent}
          onChange={(v) => onSettingsChange({ freeShareScaleOutPercent: v })}
        />

        <LabeledInput
          label="Scale-out levels"
          value={settings.freeShareScaleOutLevels}
          onChange={(v) =>
            onSettingsChange({ freeShareScaleOutLevels: Math.max(1, Math.floor(v)) })
          }
        />

      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        <MetricCard label="Capital / level" value={fmtNum(capital?.capitalPerLevel)} />
        <MetricCard label="Committed" value={fmtNum(capital?.capitalCommittedToOpenBuys)} />
        <MetricCard label="Recovered" value={fmtNum(capital?.capitalRecovered)} />
        <MetricCard label="Available" value={fmtNum(capital?.availableCapitalForNewSlots)} />
        <MetricCard label="Affordable slots" value={String(capital?.affordableOpenSlotCount ?? 0)} />
        <MetricCard label="Bottom grid px" value={fmtNum(grid?.bottomGridPrice, 4)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        <MetricCard label="Active qty" value={fmtNum(position?.activeGridQuantity, 6)} />
        <MetricCard label="Free-share qty" value={fmtNum(position?.freeSharesTotalQuantity, 6)} />
        <MetricCard label="Avg cost" value={fmtNum(position?.activeGridAverageCost, 4)} />
        <MetricCard label="Realized P/L" value={fmtNum(position?.realizedPL)} />
        <MetricCard label="Unrealized (acct)" value={fmtNum(position?.unrealizedPLAccounting)} />
        <MetricCard label="Unrealized (strategy)" value={fmtNum(position?.unrealizedPLStrategy)} />
      </div>

      <div
        ref={layoutRef}
        style={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `${layout.tableWidthPct}% 6px minmax(0, 1fr)`,
          gap: 0,
        }}
      >
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "auto",
            backgroundColor: "var(--bg-primary)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              padding: "6px 8px",
              borderBottom: "1px solid var(--border-color)",
              position: "sticky",
              top: 0,
              zIndex: 2,
              backgroundColor: "var(--bg-primary)",
            }}
          >
            <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              Showing future actionable rows only
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                color: "var(--text-secondary)",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showUnfilledBuys}
                onChange={(e) => setShowUnfilledBuys(e.target.checked)}
              />
              Show unfilled buy target sells
            </label>
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead style={{ position: "sticky", top: 31, backgroundColor: "var(--bg-primary)" }}>
              <tr>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Side</th>
                <th style={thStyle}>Progress</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Notional</th>
                <th style={thStyle}>Target Sell</th>
                <th style={thStyle}>Source Buy</th>
                <th style={thStyle}>Principal Recovered</th>
                <th style={thStyle}>Free Shares</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {ladderRows.map(({ slot, side, orderPrice }) => {
                const slotBuyLots = buyLots.filter((b) => b.slotId === slot.slotId);
                const avgProgress =
                  slotBuyLots.length > 0
                    ? slotBuyLots.reduce((s, b) => s + b.progressPercent, 0) / slotBuyLots.length
                    : side === "SELL"
                    ? 100
                    : 0;
                return (
                <Fragment key={slot.slotId}>
                  <tr>
                    <td style={tdStyle}>{fmtNum(orderPrice, 4)}</td>
                    <td
                      style={{
                        ...tdStyle,
                        color:
                          side === "BUY"
                            ? "var(--success-color, #16a34a)"
                            : "var(--danger-color, #dc2626)",
                        fontWeight: 700,
                      }}
                    >
                      {side}
                    </td>
                    <td style={tdStyle}>
                      <div
                        style={{
                          width: "60px",
                          height: "8px",
                          borderRadius: "4px",
                          backgroundColor: "var(--bg-secondary)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, avgProgress))}%`,
                            height: "100%",
                            backgroundColor: "var(--accent)",
                          }}
                        />
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {fmtNum(
                        side === "SELL"
                          ? (slot.plannedSellQuantity ??
                              slot.filledBuyQuantity ??
                              slot.plannedBuyQuantity)
                          : slot.plannedBuyQuantity,
                        6,
                      )}
                    </td>
                    <td style={tdStyle}>
                      {fmtNum(
                        side === "SELL"
                          ? (slot.plannedSellPrice ?? orderPrice) *
                              (slot.plannedSellQuantity ??
                                slot.filledBuyQuantity ??
                                slot.plannedBuyQuantity)
                          : slot.plannedBuyNotional,
                      )}
                    </td>
                    <td style={tdStyle}>
                      {slot.targetSellPrice != null ? fmtNum(slot.targetSellPrice, 4) : "—"}
                    </td>
                    <td style={tdStyle}>
                      {slot.sourceBuyAveragePrice != null
                        ? `${fmtNum(slot.sourceBuyAveragePrice, 4)}${
                            (slot.sourceBuyFillCount ?? 0) > 1
                              ? ` (${slot.sourceBuyFillCount} fills)`
                              : ""
                          }`
                        : slot.filledBuyPrice != null
                        ? fmtNum(slot.filledBuyPrice, 4)
                        : slot.plannedBuyPrice > 0
                        ? fmtNum(slot.plannedBuyPrice, 4)
                        : "—"}
                    </td>
                    <td style={tdStyle}>{fmtNum(projectedPrincipalRecovered(slot))}</td>
                    <td style={tdStyle}>{fmtNum(projectedFreeShares(slot), 6)}</td>
                    <td style={tdStyle}>{slot.status}</td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => toggleSlotExpanded(slot.slotId)}
                        style={{
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          backgroundColor: "transparent",
                          color: "var(--accent)",
                          fontSize: "11px",
                          padding: "2px 6px",
                          cursor: "pointer",
                        }}
                      >
                        {expandedSlotIds.has(slot.slotId) ? "Hide" : "View"}
                      </button>
                    </td>
                  </tr>
                  {expandedSlotIds.has(slot.slotId) && (
                    <tr key={`${slot.slotId}-details`}>
                      <td
                        colSpan={11}
                        style={{
                          padding: "8px",
                          borderBottom: "1px solid var(--border-color)",
                          backgroundColor: "color-mix(in srgb, var(--bg-secondary) 60%, transparent)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                            gap: "10px",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "6px" }}>
                              Buy lots (progress)
                            </div>
                            {(buyLots.filter((b) => b.slotId === slot.slotId).length === 0) ? (
                              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>No buy lots.</div>
                            ) : (
                              buyLots.filter((b) => b.slotId === slot.slotId).map((b) => (
                                <div key={b.lotId} style={{ fontSize: "11px", marginBottom: "4px" }}>
                                  {fmtNum(b.buyPrice, 4)}: {fmtNum(b.consumedQuantity, 6)}/{fmtNum(b.totalQuantity, 6)} ({fmtNum(b.progressPercent, 1)}%)
                                  <div style={{ width: "80px", height: "4px", borderRadius: "2px", backgroundColor: "var(--bg-secondary)", overflow: "hidden", marginTop: "2px" }}>
                                    <div style={{ width: `${b.progressPercent}%`, height: "100%", backgroundColor: "var(--accent)" }} />
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "6px" }}>
                              Match events (dynamic)
                            </div>
                            {(matchEventsBySlot.get(slot.slotId) ?? []).length === 0 ? (
                              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>No close matches yet.</div>
                            ) : (
                              (matchEventsBySlot.get(slot.slotId) ?? []).map((m) => (
                                <div key={m.matchId} style={{ fontSize: "11px", color: "var(--text-primary)", marginBottom: "4px" }}>
                                  qty {fmtNum(m.matchedQty, 6)}: {fmtNum(m.openPrice, 4)} -&gt; {fmtNum(m.closePrice, 4)} ({new Date(m.closeTime).toLocaleString()})
                                </div>
                              ))
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "6px" }}>
                              Remaining open fragments
                            </div>
                            {(openFragmentsBySlot.get(slot.slotId) ?? []).length === 0 ? (
                              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>No remaining open fragments.</div>
                            ) : (
                              (openFragmentsBySlot.get(slot.slotId) ?? []).map((f) => (
                                <div key={f.fragmentId} style={{ fontSize: "11px", color: "var(--text-primary)", marginBottom: "4px" }}>
                                  {fmtNum(f.quantityRemaining, 6)} @ {fmtNum(f.sourcePrice, 4)} (basis {fmtNum(f.accountingBasisRemaining)})
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
              })}
            </tbody>
          </table>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize table and side panel"
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing("vertical");
          }}
          style={{
            cursor: "col-resize",
            backgroundColor: resizing === "vertical" ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border-color)",
            borderRadius: "4px",
            margin: "0 2px",
            minWidth: "6px",
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateRows: `${layout.uncheckedHeightPct}fr 6px ${100 - layout.uncheckedHeightPct}fr`,
            minHeight: 0,
            gap: 0,
          }}
        >
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "8px",
              backgroundColor: "var(--bg-primary)",
              overflow: "auto",
              minHeight: 0,
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--text-secondary)",
                marginBottom: "8px",
              }}
            >
              Unchecked Buys (Free Share Targets)
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Remaining exposure (notional) not yet offset by sells.
            </div>
            {(() => {
              const unchecked = buyLots.filter((b) => b.remainingQuantity > 1e-12);
              if (unchecked.length === 0) {
                return (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    No remaining buy lots.
                  </div>
                );
              }
              return unchecked.map((lot) => (
                <div
                  key={lot.lotId}
                  style={{
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border-color)",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span>{fmtNum(lot.buyPrice, 4)}</span>
                    <span>
                      ${fmtNum(lot.remainingQuantity * lot.buyPrice, 2)} / ${fmtNum(lot.totalQuantity * lot.buyPrice, 2)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: "6px",
                      borderRadius: "3px",
                      backgroundColor: "var(--bg-secondary)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, lot.progressPercent)}%`,
                        height: "100%",
                        backgroundColor: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              ));
            })()}
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize unchecked buys and scale-out ladder"
            onMouseDown={(e) => {
              e.preventDefault();
              setResizing("horizontal");
            }}
            style={{
              cursor: "row-resize",
              backgroundColor: resizing === "horizontal" ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border-color)",
              borderRadius: "4px",
              margin: "2px 0",
              minHeight: "6px",
            }}
          />

          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "8px",
              backgroundColor: "var(--bg-primary)",
              overflow: "auto",
              minHeight: 0,
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--text-secondary)",
                marginBottom: "8px",
              }}
            >
              Scale-out ladder targets
            </div>
            {(freeShareTargets ?? []).length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                No auto scale-out targets.
              </div>
            ) : (
              (freeShareTargets ?? []).map((t) => (
                <div
                  key={t.level}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "48px 1fr 1fr",
                    gap: "8px",
                    fontSize: "12px",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                >
                  <div>L{t.level}</div>
                  <div>{fmtNum(t.price, 4)}</div>
                  <div>{fmtNum(t.quantity, 6)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-color)",
  fontSize: "11px",
  color: "var(--text-secondary)",
};

const tdStyle: CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-color)",
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        backgroundColor: "var(--bg-primary)",
        padding: "8px",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontSize: "11px",
        color: "var(--text-secondary)",
      }}
    >
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value || 0))}
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          backgroundColor: "var(--bg-secondary)",
          color: "var(--text-primary)",
          padding: "4px 6px",
          fontSize: "12px",
        }}
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontSize: "11px",
        color: "var(--text-secondary)",
      }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          backgroundColor: disabled ? "var(--bg-tertiary)" : "var(--bg-secondary)",
          color: disabled ? "var(--text-secondary)" : "var(--text-primary)",
          padding: "4px 6px",
          fontSize: "12px",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        fontSize: "11px",
        color: "var(--text-secondary)",
      }}
    >
      {label}
      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          padding: "4px 6px",
          fontSize: "12px",
          minHeight: "28px",
          display: "flex",
          alignItems: "center",
        }}
      >
        {value}
      </div>
    </label>
  );
}

