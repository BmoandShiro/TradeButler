import { GridCycle } from "./gridTypes";

interface GridCycleTimelineProps {
  cycle: GridCycle | undefined;
}

type Lot = { price: number; remainingQty: number };

export function GridCycleTimeline({ cycle }: GridCycleTimelineProps) {
  if (!cycle || cycle.fills.length === 0) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)" }}>
        Select a cycle to view timeline progression.
      </div>
    );
  }

  const firstFill = cycle.fills.find((f) => f.kind !== "ORDER") ?? cycle.fills[0];
  const isLong = firstFill?.side === "BUY";

  const EPS = 0;
  const lots: Lot[] = [];

  const rows = cycle.fills.map((fill) => {
    // For a long cycle: BUY opens, SELL closes.
    // For a short cycle: SELL opens, BUY closes.
    const shouldOpen =
      isLong ? fill.side === "BUY" : fill.side === "SELL";
    const shouldClose =
      isLong ? fill.side === "SELL" : fill.side === "BUY";

    if (shouldOpen) {
      lots.push({ price: fill.price, remainingQty: fill.quantity });
    } else if (shouldClose) {
      let remainingToClose = fill.quantity;
      while (remainingToClose > EPS && lots.length > 0) {
        const earliest = lots[0];
        const matchedQty = Math.min(earliest.remainingQty, remainingToClose);
        earliest.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
        if (earliest.remainingQty <= EPS) lots.shift();
      }
    }

    const openQty = lots.reduce((sum, l) => sum + l.remainingQty, 0);
    const openCost = lots.reduce((sum, l) => sum + l.price * l.remainingQty, 0);
    const avgCost = openQty > EPS ? openCost / openQty : null;
    const status = openQty > EPS ? "Open position" : "Closed position";

    return {
      fill,
      openQty,
      avgCost,
      status,
    };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
        {cycle.cycleName} ({cycle.status === "completed" ? "Completed" : "Open"})
      </div>
      <div style={{ overflow: "auto", borderRadius: "8px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--bg-primary)", zIndex: 1 }}>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Time</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>Side</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Price</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Open Qty</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>Avg Cost</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.fill.id}-${idx}`} style={{ backgroundColor: r.status === "Closed position" ? "transparent" : "transparent" }}>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                  {new Date(r.fill.timestamp).toLocaleString()}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "center",
                    fontWeight: 700,
                    color:
                      r.fill.side === "BUY"
                        ? "var(--success-color, #16a34a)"
                        : "var(--danger-color, #dc2626)",
                  }}
                >
                  {r.fill.side === "BUY" ? "BUY" : "SELL"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {r.fill.quantity.toFixed(4)}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {r.fill.price.toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    color:
                      r.openQty > EPS
                        ? "var(--accent)"
                        : "var(--text-secondary)",
                    fontWeight: r.openQty > EPS ? 600 : 400,
                  }}
                >
                  {r.openQty > EPS ? r.openQty.toFixed(4) : "—"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  {r.avgCost != null ? `$${r.avgCost.toFixed(2)}` : "—"}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 6px",
                      borderRadius: "999px",
                      fontSize: "10px",
                      backgroundColor:
                        r.status === "Open position"
                          ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                          : "var(--bg-secondary)",
                    }}
                  >
                    {r.status === "Open position" ? "Open" : "Closed"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

