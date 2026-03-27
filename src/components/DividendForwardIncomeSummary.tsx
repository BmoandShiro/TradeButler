import { Sparkles } from "lucide-react";
import {
  formatDividendMoney,
  forwardIncomeBreakdown,
  type ForwardIncomeDisplayMode,
} from "../utils/dividendTrackerData";

export type DividendForwardIncomeSummaryProps = {
  /** Sum of per-symbol forward annual (latest rate × shares × payments/year), already filtered. */
  forwardAnnualUsd: number;
  compact?: boolean;
  /** Which metric cards to show; `all` shows monthly, quarterly, and annual. */
  mode?: ForwardIncomeDisplayMode;
};

const METRIC_DEF = [
  { key: "m" as const, mode: "monthly" as const, label: "Est. monthly (avg.)", sub: "Annual ÷ 12" },
  { key: "q" as const, mode: "quarterly" as const, label: "Est. quarterly (avg.)", sub: "Annual ÷ 4" },
  { key: "a" as const, mode: "annual" as const, label: "Est. annual (run-rate)", sub: "~12 months" },
];

/**
 * Estimated monthly / quarterly / annual income from the same forward ~12 mo run-rate used elsewhere.
 */
export default function DividendForwardIncomeSummary({
  forwardAnnualUsd,
  compact = false,
  mode = "all",
}: DividendForwardIncomeSummaryProps) {
  const { monthly, quarterly, annual } = forwardIncomeBreakdown(forwardAnnualUsd);
  const hasData = annual > 0;

  const visibleMetrics = METRIC_DEF.filter((m) => mode === "all" || mode === m.mode);

  const pad = compact ? "10px 12px" : "14px 16px";
  const titleFs = compact ? "12px" : "14px";
  const valueFs = compact ? "15px" : "22px";
  const labelFs = compact ? "9px" : "10px";
  const gap = compact ? "8px" : "12px";

  return (
    <div
      style={{
        borderRadius: "12px",
        border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border-color))",
        background:
          "linear-gradient(145deg, color-mix(in srgb, var(--accent) 10%, var(--bg-secondary)) 0%, var(--bg-secondary) 55%, color-mix(in srgb, var(--profit) 6%, var(--bg-secondary)) 100%)",
        padding: pad,
        boxShadow: "0 1px 0 color-mix(in srgb, var(--text-primary) 6%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: gap,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: compact ? 28 : 32,
            height: compact ? 28 : 32,
            borderRadius: "8px",
            backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Sparkles size={compact ? 14 : 18} strokeWidth={2} />
        </span>
        <div>
          <div style={{ fontSize: titleFs, fontWeight: "700", color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            Forward dividend estimates
          </div>
          <div style={{ fontSize: compact ? "10px" : "11px", color: "var(--text-secondary)", marginTop: "2px", lineHeight: 1.45 }}>
            Based on latest rate × open shares × payments/year (same ~12 mo run-rate as the tracker). Monthly and quarterly are
            averages for planning, not payment dates.
          </div>
        </div>
      </div>

      {!hasData ? (
        <div
          style={{
            fontSize: compact ? "11px" : "12px",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            padding: "8px 10px",
            borderRadius: "8px",
            backgroundColor: "color-mix(in srgb, var(--text-secondary) 8%, transparent)",
            border: "1px dashed var(--border-color)",
          }}
        >
          No forward annual figure yet — need at least one dividend with an amount in the feed for your symbols (or widen symbol
          filters).
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
            gap,
          }}
        >
          {visibleMetrics.map(({ key, label, sub, mode: m }) => {
            const value = m === "monthly" ? monthly : m === "quarterly" ? quarterly : annual;
            return (
            <div
              key={key}
              style={{
                borderRadius: "10px",
                padding: compact ? "10px 12px" : "12px 14px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid color-mix(in srgb, var(--border-color) 70%, transparent)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: labelFs,
                  fontWeight: "700",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-secondary)",
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: valueFs,
                  fontWeight: "700",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.03em",
                  color: "var(--profit)",
                }}
              >
                {formatDividendMoney(value, 2)}
              </span>
              <span style={{ fontSize: compact ? "9px" : "10px", color: "var(--text-secondary)", opacity: 0.9 }}>{sub}</span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ForwardIncomeModeSelect({
  value,
  onChange,
  compact = false,
  id = "forward-income-mode",
}: {
  value: ForwardIncomeDisplayMode;
  onChange: (v: ForwardIncomeDisplayMode) => void;
  compact?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label="Forward income metrics"
      value={value}
      onChange={(e) => onChange(e.target.value as ForwardIncomeDisplayMode)}
      style={{
        fontSize: compact ? "11px" : "13px",
        padding: compact ? "4px 8px" : "6px 10px",
        borderRadius: "8px",
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--bg-tertiary)",
        color: "var(--text-primary)",
        cursor: "pointer",
        maxWidth: "100%",
        fontWeight: "600",
      }}
    >
      <option value="all">All metrics</option>
      <option value="monthly">Monthly only</option>
      <option value="quarterly">Quarterly only</option>
      <option value="annual">Annual only</option>
    </select>
  );
}
