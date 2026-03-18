import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

type MarketMetric = {
  value: string;
  updatedAt?: string;
  source?: string;
};

type MarketMetricCache = {
  value: string;
  updatedAt?: string;
  source?: string;
};

const TOTAL_MARKET_CAP_CACHE_KEY = "tradebutler_market_total_market_cap_cache_v1";
const ALTCOIN_SEASON_CACHE_KEY = "tradebutler_market_altcoin_season_index_cache_v1";

function loadCache(key: string): MarketMetricCache | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketMetricCache;
    if (!parsed || typeof parsed.value !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(key: string, cache: MarketMetricCache) {
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* optional */
  }
}

function normalizeMetric(payload: any): MarketMetric {
  const rawValue = payload?.value ?? payload?.metric_value ?? payload?.result ?? payload;
  const value = rawValue == null ? "—" : String(rawValue);
  const updatedAt = payload?.updatedAt ?? payload?.updated_at ?? payload?.timestamp;
  const source = payload?.source ?? payload?.sourceName ?? payload?.from;
  return { value, updatedAt: updatedAt != null ? String(updatedAt) : undefined, source: source != null ? String(source) : undefined };
}

export default function MarketPage() {
  const [totalMarketCap, setTotalMarketCap] = useState<MarketMetric | null>(null);
  const [altcoinSeasonIndex, setAltcoinSeasonIndex] = useState<MarketMetric | null>(null);

  useEffect(() => {
    const totalCached = loadCache(TOTAL_MARKET_CAP_CACHE_KEY);
    const altCached = loadCache(ALTCOIN_SEASON_CACHE_KEY);

    // Default to cached values immediately so the UI never flashes blank.
    setTotalMarketCap(totalCached ? totalCached : { value: "—" });
    setAltcoinSeasonIndex(altCached ? altCached : { value: "—" });

    (async () => {
      try {
        const [tmc, asi] = await Promise.all([
          invoke<any>("fetch_crypto_total_market_cap"),
          invoke<any>("fetch_crypto_altcoin_season_index"),
        ]);

        const totalNormalized = normalizeMetric(tmc);
        const altNormalized = normalizeMetric(asi);

        setTotalMarketCap(totalNormalized);
        setAltcoinSeasonIndex(altNormalized);

        saveCache(TOTAL_MARKET_CAP_CACHE_KEY, {
          value: totalNormalized.value,
          updatedAt: totalNormalized.updatedAt,
          source: totalNormalized.source,
        });
        saveCache(ALTCOIN_SEASON_CACHE_KEY, {
          value: altNormalized.value,
          updatedAt: altNormalized.updatedAt,
          source: altNormalized.source,
        });
      } catch {
        // If network/scrape fails, we already showed cached values.
      }
    })();
  }, []);

  const renderMetricCard = (title: string, metric: MarketMetric | null) => (
    <div style={{ flex: "1 1 360px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{metric?.value ?? "—"}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
        {metric?.source ? `Source: ${metric.source}` : ""}
        {metric?.updatedAt ? `${metric?.source ? " · " : ""}Updated: ${new Date(metric.updatedAt).toLocaleString()}` : ""}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "20px 24px", background: "var(--bg-primary)" }}>
      <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em" }}>Market</h1>
      <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 14 }}>Crypto market metrics.</div>

      <div style={{ display: "flex", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
        {renderMetricCard("Total Market Cap", totalMarketCap)}
        {renderMetricCard("Altcoin Season Index", altcoinSeasonIndex)}
      </div>
    </div>
  );
}

