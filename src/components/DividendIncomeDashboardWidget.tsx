import { useState, useEffect, useCallback, useMemo } from "react";
import { getFinnhubApiKey, hasFinnhubApiKey } from "../utils/finnhubManager";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  loadDividendTrackerRows,
  type ForwardDividendEstimate,
  type ForwardIncomeDisplayMode,
  readForwardIncomeDisplayMode,
  DASHBOARD_DIVIDEND_INCOME_SECTION_MODE_KEY,
} from "../utils/dividendTrackerData";
import DividendForwardIncomeSummary, { ForwardIncomeModeSelect } from "./DividendForwardIncomeSummary";

export type DividendIncomeDashboardWidgetProps = {
  onRegisterRefresh?: (refresh: () => void) => void;
};

export default function DividendIncomeDashboardWidget({ onRegisterRefresh }: DividendIncomeDashboardWidgetProps = {}) {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [forwardEstimates, setForwardEstimates] = useState<ForwardDividendEstimate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const [displayMode, setDisplayMode] = useState<ForwardIncomeDisplayMode>(() =>
    readForwardIncomeDisplayMode(DASHBOARD_DIVIDEND_INCOME_SECTION_MODE_KEY)
  );

  const hasKey = hasFinnhubApiKey();

  useEffect(() => subscribeToDataMode(setDataMode), []);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DIVIDEND_INCOME_SECTION_MODE_KEY, displayMode);
    } catch {
      /* ignore */
    }
  }, [displayMode]);

  const load = useCallback(async () => {
    const apiKey = getFinnhubApiKey();
    if (!apiKey) {
      setError("Add a Finnhub API key in Settings.");
      setForwardEstimates([]);
      return;
    }
    if (dataMode === "sandbox") {
      setForwardEstimates([]);
      setError(null);
      setLastAt(new Date());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { forwardEstimates: fwd } = await loadDividendTrackerRows({
        apiKey,
        dataMode,
        pairingMethod,
      });
      setForwardEstimates(fwd);
      setLastAt(new Date());
    } catch (e) {
      console.error(e);
      setError(typeof e === "string" ? e : "Could not load dividend data");
      setForwardEstimates([]);
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    if (hasKey) void load();
  }, [hasKey, load]);

  useEffect(() => {
    onRegisterRefresh?.(load);
    return () => onRegisterRefresh?.(() => {});
  }, [load, onRegisterRefresh]);

  const forwardAnnual = useMemo(
    () => forwardEstimates.reduce((s, e) => s + e.forwardAnnualUsd, 0),
    [forwardEstimates]
  );

  if (!hasKey) {
    return (
      <div style={{ padding: "12px 0", fontSize: "13px", color: "var(--text-secondary)", textAlign: "center" }}>
        Configure a Finnhub API key in Settings to load forward estimates.
      </div>
    );
  }

  if (dataMode === "sandbox") {
    return (
      <div style={{ padding: "12px 0", fontSize: "13px", color: "var(--text-secondary)" }}>
        Switch to Real or Paper data mode to see dividend income estimates.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-secondary)" }}>VIEW</span>
          <ForwardIncomeModeSelect
            id="dividend-income-section-mode"
            value={displayMode}
            onChange={setDisplayMode}
            compact
          />
        </div>
        {loading && <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Loading…</span>}
        {lastAt && !loading && (
          <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Updated {lastAt.toLocaleTimeString()}</span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: "12px", color: "var(--loss)", padding: "8px", borderRadius: "6px", backgroundColor: "rgba(239, 68, 68, 0.08)" }}>
          {error}
        </div>
      )}

      <DividendForwardIncomeSummary forwardAnnualUsd={forwardAnnual} compact mode={displayMode} />
    </div>
  );
}
