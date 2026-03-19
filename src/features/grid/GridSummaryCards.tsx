import { GridExposureSummary, GridPnLSummary } from "./gridTypes";

interface GridSummaryCardsProps {
  pnl: GridPnLSummary;
  exposure: GridExposureSummary;
  currentPrice: number | null;
}

export function GridSummaryCards({
  pnl,
  exposure,
  currentPrice,
}: GridSummaryCardsProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "8px",
      }}
    >
      <SummaryCard
        label="Realized PnL"
        value={pnl.realizedPnl}
        emphasize
      />
      <SummaryCard
        label="Unrealized PnL"
        value={pnl.unrealizedPnl}
      />
      <SummaryCard
        label="Total PnL"
        value={pnl.totalPnl}
      />
      <SummaryCard
        label="Completed cycles"
        value={pnl.completedCyclesCount}
        isCount
      />
      <SummaryCard
        label="Open quantity"
        value={exposure.totalOpenQty}
      />
      <SummaryCard
        label="Avg open cost"
        value={exposure.weightedAvgOpenEntry ?? null}
      />
      <SummaryCard
        label="Capital in open inventory"
        value={pnl.capitalInOpenInventory}
      />
      <SummaryCard
        label="Current price"
        value={currentPrice}
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number | null;
  emphasize?: boolean;
  isCount?: boolean;
}

function SummaryCard({
  label,
  value,
  emphasize,
  isCount,
}: SummaryCardProps) {
  const formatted =
    value == null
      ? "—"
      : isCount
      ? value.toString()
      : value.toFixed(2).replace(/\.?0+$/, "");

  const color =
    !isCount && value != null
      ? value > 0
        ? "var(--success-color, #16a34a)"
        : value < 0
        ? "var(--danger-color, #dc2626)"
        : "var(--text-secondary)"
      : "var(--text-primary)";

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "8px",
        border: emphasize
          ? "1px solid var(--accent)"
          : "1px solid var(--border-color)",
        backgroundColor: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: emphasize ? "18px" : "14px",
          fontWeight: emphasize ? 700 : 600,
          color,
        }}
      >
        {formatted}
      </div>
    </div>
  );
}

