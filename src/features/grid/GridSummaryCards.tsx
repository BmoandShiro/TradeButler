import { GridExposureSummary, GridPnLSummary } from "./gridTypes";

interface GridSummaryCardsProps {
  pnl: GridPnLSummary;
  exposure: GridExposureSummary;
  currentPrice: number | null;
}

/** Compare at 2 dp so “same as” matches what we show on the card. */
function avgOpenCostDisplayColor(
  avg: number | null | undefined,
  price: number | null,
): string | undefined {
  if (
    avg == null ||
    price == null ||
    !Number.isFinite(avg) ||
    !Number.isFinite(price)
  ) {
    return undefined;
  }
  const a = Math.round(avg * 100) / 100;
  const p = Math.round(price * 100) / 100;
  if (a === p) return "var(--accent, #3b82f6)";
  // Above spot = underwater on a long → red; below spot → green.
  if (avg > price) return "var(--danger-color, #dc2626)";
  return "var(--success-color, #16a34a)";
}

export function GridSummaryCards({
  pnl,
  exposure,
  currentPrice,
}: GridSummaryCardsProps) {
  const avgOpenCostColor = avgOpenCostDisplayColor(
    exposure.weightedAvgOpenEntry,
    currentPrice,
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "8px",
      }}
    >
      <SummaryCard label="Realized PnL" value={pnl.realizedPnl} />
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
        valueColorOverride={
          avgOpenCostColor ??
          (exposure.weightedAvgOpenEntry != null &&
          (currentPrice == null || !Number.isFinite(currentPrice))
            ? "var(--text-primary)"
            : undefined)
        }
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
  /** When set, used for the value color instead of signed P/L coloring. */
  valueColorOverride?: string;
}

function SummaryCard({
  label,
  value,
  emphasize,
  isCount,
  valueColorOverride,
}: SummaryCardProps) {
  const formatted =
    value == null
      ? "—"
      : isCount
      ? value.toString()
      : value.toFixed(2).replace(/\.?0+$/, "");

  const color =
    valueColorOverride ??
    (!isCount && value != null
      ? value > 0
        ? "var(--success-color, #16a34a)"
        : value < 0
        ? "var(--danger-color, #dc2626)"
        : "var(--text-secondary)"
      : "var(--text-primary)");

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

