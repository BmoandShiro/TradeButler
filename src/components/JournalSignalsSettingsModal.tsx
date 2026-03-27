import { X } from "lucide-react";
import { Link } from "react-router-dom";
import type { Indicator, IndicatorPhase } from "../utils/indicatorsStore";
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
}: {
  open: boolean;
  onClose: () => void;
  phase: IndicatorPhaseT;
  indicators: Indicator[];
  signalFilter: { technical: boolean; candlestick: boolean };
  onSignalFilter: (next: { technical: boolean; candlestick: boolean }) => void;
  canEdit: boolean;
}) {
  if (!open) return null;

  const phaseLabel = phase === "entry" ? "Entry" : "Take Profit";

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
      onClick={onClose}
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
            onClick={onClose}
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
                    onClick={onClose}
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
                      <Link to={`/signals?focus=${encodeURIComponent(ind.id)}`} style={{ color: "var(--accent)", fontWeight: 700 }} onClick={onClose}>
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
            onClick={onClose}
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
