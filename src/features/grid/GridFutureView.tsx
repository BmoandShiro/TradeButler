import type { CSSProperties } from "react";
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
  return n.toFixed(d);
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

export function GridFutureView({
  selectedCycle,
  settings,
  state,
  onSettingsChange,
}: GridFutureViewProps) {
  if (!selectedCycle) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)" }}>
        Select a cycle to open Future view planning.
      </div>
    );
  }

  const { capital, grid, position, freeShareTargets } = state.summary;
  const ladderRows = state.slots
    .map((slot) => {
      const side = slotSideLabel(slot);
      const orderPrice =
        side === "SELL"
          ? (slot.plannedSellPrice ?? slot.filledSellPrice ?? slot.plannedBuyPrice)
          : slot.plannedBuyPrice;
      return { slot, side, orderPrice };
    })
    .sort((a, b) => b.orderPrice - a.orderPrice);

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
        <LabeledInput
          label="Market"
          value={settings.marketPrice ?? 0}
          onChange={(v) => onSettingsChange({ marketPrice: v })}
        />
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
        <MetricCard label="Capital / level" value={fmtNum(capital.capitalPerLevel)} />
        <MetricCard label="Committed" value={fmtNum(capital.capitalCommittedToOpenBuys)} />
        <MetricCard label="Recovered" value={fmtNum(capital.capitalRecovered)} />
        <MetricCard label="Available" value={fmtNum(capital.availableCapitalForNewSlots)} />
        <MetricCard label="Affordable slots" value={String(capital.affordableOpenSlotCount)} />
        <MetricCard label="Bottom grid px" value={fmtNum(grid.bottomGridPrice, 4)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        <MetricCard label="Active qty" value={fmtNum(position.activeGridQuantity, 6)} />
        <MetricCard label="Free-share qty" value={fmtNum(position.freeSharesTotalQuantity, 6)} />
        <MetricCard label="Avg cost" value={fmtNum(position.activeGridAverageCost, 4)} />
        <MetricCard label="Realized P/L" value={fmtNum(position.realizedPL)} />
        <MetricCard label="Unrealized (acct)" value={fmtNum(position.unrealizedPLAccounting)} />
        <MetricCard label="Unrealized (strategy)" value={fmtNum(position.unrealizedPLStrategy)} />
      </div>

      <div
        style={{
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1.2fr)",
          gap: "8px",
        }}
      >
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "auto",
            backgroundColor: "var(--bg-primary)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--bg-primary)" }}>
              <tr>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Side</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Notional</th>
                <th style={thStyle}>Target Sell</th>
                <th style={thStyle}>Target Buy</th>
                <th style={thStyle}>Principal Recovered</th>
                <th style={thStyle}>Free Shares</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {ladderRows.map(({ slot, side, orderPrice }) => (
                <tr key={slot.slotId}>
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
                    {slot.targetBuyPrice != null ? fmtNum(slot.targetBuyPrice, 4) : "—"}
                  </td>
                  <td style={tdStyle}>{fmtNum(slot.principalRecovered)}</td>
                  <td style={tdStyle}>{fmtNum(slot.freeShareQuantityCreated, 6)}</td>
                  <td style={tdStyle}>{slot.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "8px",
            backgroundColor: "var(--bg-primary)",
            overflow: "auto",
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
            Free-share targets
          </div>
          {freeShareTargets.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              No auto free-share targets.
            </div>
          ) : (
            freeShareTargets.map((t) => (
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

