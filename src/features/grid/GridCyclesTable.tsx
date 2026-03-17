import React from "react";
import { GridCycle } from "./gridTypes";

interface GridCyclesTableProps {
  cycles: GridCycle[];
  selectedCycleId?: string;
  onSelectCycle?: (cycleId: string) => void;
}

export function GridCyclesTable({
  cycles,
  selectedCycleId,
  onSelectCycle,
}: GridCyclesTableProps) {
  if (!cycles.length) {
    return (
      <div style={{ padding: "12px", color: "var(--text-secondary)" }}>
        No completed grid cycles yet.
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: "8px",
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--bg-primary)",
        overflow: "hidden",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "12px",
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Entry</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Exit</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}>Gross PnL</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Open</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Close</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => {
            const isSelected = cycle.id === selectedCycleId;
            const pnlColor =
              cycle.grossPnl > 0
                ? "var(--success-color, #16a34a)"
                : cycle.grossPnl < 0
                ? "var(--danger-color, #dc2626)"
                : "var(--text-secondary)";

            return (
              <tr
                key={cycle.id}
                onClick={() => onSelectCycle?.(cycle.id)}
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected
                    ? "color-mix(in srgb, var(--accent) 10%, var(--bg-primary))"
                    : "transparent",
                }}
              >
                <td style={{ padding: "4px 8px" }}>
                  {cycle.entryPrice.toFixed(2)} {cycle.entrySide}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {cycle.exitPrice.toFixed(2)}
                </td>
                <td style={{ textAlign: "right", padding: "4px 8px" }}>
                  {cycle.quantity.toFixed(4)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "4px 8px",
                    color: pnlColor,
                  }}
                >
                  {cycle.grossPnl.toFixed(2)}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {new Date(cycle.openTime).toLocaleString()}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  {new Date(cycle.closeTime).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

