import { useMemo, useState } from "react";
import { GridCycle } from "./gridTypes";

interface GridCycleTimelineProps {
  cycle: GridCycle | undefined;
}

type Lot = { price: number; remainingQty: number };
const EPS = 1e-12;
type TimelineSortKey = "time" | "side" | "qty" | "price" | "notional" | "openQty" | "avgCost" | "status";
type SortDirection = "asc" | "desc";

export function GridCycleTimeline({ cycle }: GridCycleTimelineProps) {
  const [sortKey, setSortKey] = useState<TimelineSortKey>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  if (!cycle || cycle.fills.length === 0) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)" }}>
        Select a cycle to view timeline progression.
      </div>
    );
  }

  const firstFill = cycle.fills.find((f) => f.kind !== "ORDER") ?? cycle.fills[0];
  const isLong = firstFill?.side === "BUY";

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
      // Dynamic matching: eligible = remainingQty > 0, price eligible for close
      // Long: buyPrice <= sellPrice, sort buyPrice desc. Short: sellPrice >= buyPrice, sort sellPrice asc.
      const eligible = isLong
        ? lots.filter((l) => l.remainingQty > EPS && l.price <= fill.price).sort((a, b) => b.price - a.price)
        : lots.filter((l) => l.remainingQty > EPS && l.price >= fill.price).sort((a, b) => a.price - b.price);

      let remainingToClose = fill.quantity;
      for (const lot of eligible) {
        if (remainingToClose <= EPS) break;
        const matchedQty = Math.min(lot.remainingQty, remainingToClose);
        lot.remainingQty -= matchedQty;
        remainingToClose -= matchedQty;
      }
      for (let i = lots.length - 1; i >= 0; i--) {
        if (lots[i].remainingQty <= EPS) lots.splice(i, 1);
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

  const sortedRows = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case "time":
          av = new Date(a.fill.timestamp).getTime();
          bv = new Date(b.fill.timestamp).getTime();
          break;
        case "side":
          av = a.fill.side;
          bv = b.fill.side;
          break;
        case "qty":
          av = a.fill.quantity;
          bv = b.fill.quantity;
          break;
        case "price":
          av = a.fill.price;
          bv = b.fill.price;
          break;
        case "notional":
          av = a.fill.price * a.fill.quantity;
          bv = b.fill.price * b.fill.quantity;
          break;
        case "openQty":
          av = a.openQty;
          bv = b.openQty;
          break;
        case "avgCost":
          av = a.avgCost ?? -1;
          bv = b.avgCost ?? -1;
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, sortDirection, sortKey]);

  const toggleSort = (nextKey: TimelineSortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "time" ? "desc" : "asc");
  };

  const sortMarker = (key: TimelineSortKey) =>
    sortKey === key ? (sortDirection === "asc" ? " ▲" : " ▼") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", height: "100%" }}>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
        {cycle.cycleName} ({cycle.status === "completed" ? "Completed" : "Open"})
      </div>
      <div style={{ overflow: "auto", borderRadius: "8px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--bg-primary)", zIndex: 1 }}>
            <tr>
              <th onClick={() => toggleSort("time")} style={{ textAlign: "left", padding: "6px 8px", cursor: "pointer" }}>Time{sortMarker("time")}</th>
              <th onClick={() => toggleSort("side")} style={{ textAlign: "center", padding: "6px 8px", cursor: "pointer" }}>Side{sortMarker("side")}</th>
              <th onClick={() => toggleSort("qty")} style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer" }}>Qty{sortMarker("qty")}</th>
              <th onClick={() => toggleSort("price")} style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer" }}>Price{sortMarker("price")}</th>
              <th onClick={() => toggleSort("notional")} style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer" }}>Notional{sortMarker("notional")}</th>
              <th onClick={() => toggleSort("openQty")} style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer" }}>Open Qty{sortMarker("openQty")}</th>
              <th onClick={() => toggleSort("avgCost")} style={{ textAlign: "right", padding: "6px 8px", cursor: "pointer" }}>Avg Cost{sortMarker("avgCost")}</th>
              <th onClick={() => toggleSort("status")} style={{ textAlign: "center", padding: "6px 8px", cursor: "pointer" }}>Status{sortMarker("status")}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, idx) => (
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
                <td style={{ padding: "4px 8px", textAlign: "right" }}>
                  ${(r.fill.price * r.fill.quantity).toFixed(2)}
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

