import { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { CurrentPriceSyncContext } from "../contexts/CurrentPriceSyncContext";
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
import { getDividendIncomeSession, setDividendIncomeSession } from "../utils/dividendDashboardSessionCache";

export type DividendIncomeDashboardWidgetProps = {
  onRegisterRefresh?: (refresh: () => void) => void;
};

export default function DividendIncomeDashboardWidget({ onRegisterRefresh }: DividendIncomeDashboardWidgetProps = {}) {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [forwardEstimates, setForwardEstimates] = useState<ForwardDividendEstimate[]>(
    () => getDividendIncomeSession(getCurrentDataMode())?.forwardEstimates ?? []
  );
  const [loading, setLoading] = useState(() => {
    if (!hasFinnhubApiKey()) return false;
    const s = getDividendIncomeSession(getCurrentDataMode());
    return !(s && s.forwardEstimates.length > 0);
  });
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(() => {
    const iso = getDividendIncomeSession(getCurrentDataMode())?.lastAtIso;
    return iso ? new Date(iso) : null;
  });
  const [displayMode, setDisplayMode] = useState<ForwardIncomeDisplayMode>(() =>
    readForwardIncomeDisplayMode(DASHBOARD_DIVIDEND_INCOME_SECTION_MODE_KEY)
  );

  const hasKey = hasFinnhubApiKey();
  const priceSync = useContext(CurrentPriceSyncContext);

  useEffect(() => subscribeToDataMode(setDataMode), []);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_DIVIDEND_INCOME_SECTION_MODE_KEY, displayMode);
    } catch {
      /* ignore */
    }
  }, [displayMode]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
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
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const pairingMethod = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
      const { forwardEstimates: fwd } = await loadDividendTrackerRows({
        apiKey,
        dataMode,
        pairingMethod,
      });
      const now = new Date();
      setForwardEstimates(fwd);
      setLastAt(now);
      setDividendIncomeSession(dataMode, { forwardEstimates: fwd, lastAtIso: now.toISOString() });
    } catch (e) {
      console.error(e);
      setError(typeof e === "string" ? e : "Could not load dividend data");
      setForwardEstimates([]);
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    if (!hasKey) return;
    const s = getDividendIncomeSession(dataMode);
    const silent = !!(s && s.forwardEstimates.length > 0);
    void load({ silent });
  }, [hasKey, load, dataMode]);

  useEffect(() => {
    onRegisterRefresh?.(() => load());
    return () => onRegisterRefresh?.(() => {});
  }, [load, onRegisterRefresh]);

  useEffect(() => {
    if (!priceSync?.enabled) return;
    if (priceSync.tick === 0) return;
    if (!hasKey) return;
    void load({ silent: true });
  }, [priceSync?.enabled, priceSync?.tick, hasKey, load]);

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
