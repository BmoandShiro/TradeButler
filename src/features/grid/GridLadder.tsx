import { GridExposureSummary, GridLevelAggregate } from "./gridTypes";

interface GridLadderProps {
  aggregates: GridLevelAggregate[];
  currentPrice: number | null;
  exposure: GridExposureSummary;
  selectedLevelId?: string;
  onSelectLevel?: (levelId: string) => void;
  showPositionMetrics?: boolean;
}

export function GridLadder({
  aggregates,
  currentPrice,
  selectedLevelId,
  onSelectLevel,
  showPositionMetrics = true,
}: GridLadderProps) {
  if (!aggregates.length) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)" }}>
        No ladder levels available for this symbol yet.
      </div>
    );
  }

  const minPrice = aggregates[aggregates.length - 1]?.level.price ?? 0;
  const maxPrice = aggregates[0]?.level.price ?? 0;

  const pricePosition =
    currentPrice == null || maxPrice === minPrice
      ? null
      : (currentPrice - minPrice) / (maxPrice - minPrice);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 12px",
        gap: "8px",
        height: "100%",
      }}
    >
      <div
        style={{
          overflow: "auto",
          borderRadius: "8px",
          border: "1px solid var(--border-color)",
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
          <thead
            style={{
              position: "sticky",
              top: 0,
              backgroundColor: "var(--bg-primary)",
              zIndex: 1,
            }}
          >
            <tr>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Price</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>Buys</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>Sells</th>
              {showPositionMetrics && (
                <>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Open</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Avg Cost</th>
                  <th style={{ textAlign: "center", padding: "6px 8px" }}>Status</th>
                </>
              )}
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Exposure</th>
            </tr>
          </thead>
          <tbody>
            {aggregates.map((agg) => {
              const isSelected = agg.level.id === selectedLevelId;
              const isCurrentPriceRow =
                currentPrice != null &&
                Math.abs(currentPrice - agg.level.price) /
                  Math.max(agg.level.price, 1) <
                  0.0005;

              const backgroundColor = isSelected
                ? "color-mix(in srgb, var(--accent) 12%, var(--bg-primary))"
                : isCurrentPriceRow
                ? "color-mix(in srgb, var(--accent) 6%, var(--bg-primary))"
                : "transparent";

              const EPS = 1e-9;
              const hasOpen = Math.abs(agg.netOpenQty) > EPS;
              const borderLeftColor = showPositionMetrics
                ? agg.rowStatus === "open-long" || agg.rowStatus === "partially-closed"
                  ? "var(--accent)"
                  : agg.rowStatus === "completed"
                  ? "var(--border-color)"
                  : "transparent"
                : hasOpen
                ? "var(--accent)"
                : "transparent";

              const exposureWidth = `${Math.round(
                (agg.exposureScore || 0) * 100,
              )}%`;

              return (
                <tr
                  key={agg.level.id}
                  onClick={() => onSelectLevel?.(agg.level.id)}
                  style={{
                    cursor: "pointer",
                    backgroundColor,
                    borderLeft:
                      borderLeftColor === "transparent"
                        ? undefined
                        : `2px solid ${borderLeftColor}`,
                  }}
                >
                  <td style={{ textAlign: "right", padding: "4px 8px" }}>
                    {agg.level.price.toFixed(2)}
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      padding: "4px 8px",
                      color: "var(--success-color, #16a34a)",
                    }}
                  >
                    {agg.totalBuyQty > 0 ? agg.totalBuyQty.toFixed(4) : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      padding: "4px 8px",
                      color: "var(--warning-color, #f97316)",
                    }}
                  >
                    {agg.totalSellQty > 0 ? agg.totalSellQty.toFixed(4) : "—"}
                  </td>
                  {showPositionMetrics && (
                    <>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {Math.abs(agg.netOpenQty) > 0.000000001
                          ? Math.abs(agg.netOpenQty).toFixed(4)
                          : "—"}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {Math.abs(agg.netOpenQty) > 0.000000001 &&
                        agg.avgOpenEntry != null
                          ? agg.avgOpenEntry.toFixed(2)
                          : "—"}
                      </td>
                      <td style={{ textAlign: "center", padding: "4px 8px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 6px",
                            borderRadius: "999px",
                            fontSize: "10px",
                            backgroundColor:
                              agg.rowStatus === "open-long"
                                ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                                : agg.rowStatus === "partially-closed"
                                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                                : agg.rowStatus === "completed"
                                ? "var(--bg-secondary)"
                                : "transparent",
                          }}
                        >
                          {agg.rowStatus === "no-activity" && "No activity"}
                          {agg.rowStatus === "open-long" && "Open position"}
                          {agg.rowStatus === "partially-closed" && "Partially closed"}
                          {agg.rowStatus === "completed" && "Closed position"}
                          {agg.rowStatus === "imbalanced" && "Imbalanced"}
                        </span>
                      </td>
                    </>
                  )}
                  <td style={{ padding: "4px 8px" }}>
                    <div
                      style={{
                        position: "relative",
                        height: "6px",
                        borderRadius: "999px",
                        backgroundColor: "var(--bg-secondary)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: exposureWidth,
                          background:
                            "linear-gradient(90deg, var(--accent), transparent)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          position: "relative",
          borderRadius: "8px",
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        {pricePosition != null && pricePosition >= 0 && pricePosition <= 1 && (
          <div
            style={{
              position: "absolute",
              left: "2px",
              right: "2px",
              height: "2px",
              backgroundColor: "var(--accent)",
              top: `${(1 - pricePosition) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

