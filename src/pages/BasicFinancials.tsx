import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  DollarSign,
  Target,
  BarChart3,
  Settings,
  ExternalLink,
} from "lucide-react";
import { getFinnhubApiKey, hasFinnhubApiKey } from "../utils/finnhubManager";

interface BasicFinancials {
  symbol: string;
  pe_ratio: number | null;
  eps: number | null;
  market_cap: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  beta: number | null;
  dividend_yield: number | null;
  price_to_book: number | null;
  debt_to_equity: number | null;
  revenue_per_share: number | null;
  return_on_equity: number | null;
}

interface PriceTarget {
  symbol: string;
  target_high: number | null;
  target_low: number | null;
  target_mean: number | null;
  target_median: number | null;
  last_updated: string | null;
}

interface Recommendation {
  symbol: string;
  period: string;
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
}

export default function BasicFinancials() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialSymbol = searchParams.get("symbol") || "";
  
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchInput, setSearchInput] = useState(initialSymbol);
  const [financials, setFinancials] = useState<BasicFinancials | null>(null);
  const [priceTarget, setPriceTarget] = useState<PriceTarget | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasApiKey = hasFinnhubApiKey();

  useEffect(() => {
    if (initialSymbol && hasApiKey) {
      fetchData(initialSymbol);
    }
  }, [initialSymbol]);

  const fetchData = async (sym: string) => {
    if (!sym.trim()) return;
    
    const apiKey = getFinnhubApiKey();
    if (!apiKey) {
      setError("Please configure your Finnhub API key in Settings");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSymbol(sym.toUpperCase());

    try {
      const [financialsData, priceTargetData, recommendationsData, quoteData] = await Promise.allSettled([
        invoke<BasicFinancials>("fetch_finnhub_basic_financials", { apiKey, symbol: sym }),
        invoke<PriceTarget>("fetch_finnhub_price_target", { apiKey, symbol: sym }),
        invoke<Recommendation[]>("fetch_finnhub_recommendations", { apiKey, symbol: sym }),
        invoke<{ current_price?: number }>("fetch_stock_quote", { symbol: sym }),
      ]);

      if (financialsData.status === "fulfilled") {
        setFinancials(financialsData.value);
      }
      if (priceTargetData.status === "fulfilled") {
        setPriceTarget(priceTargetData.value);
      }
      if (recommendationsData.status === "fulfilled") {
        setRecommendations(recommendationsData.value);
      }
      if (quoteData.status === "fulfilled" && quoteData.value.current_price) {
        setCurrentPrice(quoteData.value.current_price);
      }
    } catch (e) {
      console.error("Failed to fetch financials:", e);
      setError(typeof e === "string" ? e : "Failed to fetch financial data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    if (searchInput.trim()) {
      fetchData(searchInput.trim());
    }
  };

  const formatNumber = (num: number | null | undefined, decimals = 2): string => {
    if (num === null || num === undefined) return "—";
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatLargeNumber = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return "—";
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${num.toLocaleString()}`;
  };

  const formatPercent = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return "—";
    return `${(num * 100).toFixed(2)}%`;
  };

  const getLatestRecommendation = (): Recommendation | null => {
    if (recommendations.length === 0) return null;
    return recommendations[0];
  };

  const getTotalAnalysts = (rec: Recommendation): number => {
    return rec.strong_buy + rec.buy + rec.hold + rec.sell + rec.strong_sell;
  };

  const getConsensus = (rec: Recommendation): string => {
    const total = getTotalAnalysts(rec);
    if (total === 0) return "No Data";
    
    const bullish = rec.strong_buy + rec.buy;
    const bearish = rec.sell + rec.strong_sell;
    
    if (bullish > bearish + rec.hold) return "Buy";
    if (bearish > bullish + rec.hold) return "Sell";
    return "Hold";
  };

  const getConsensusColor = (consensus: string): string => {
    switch (consensus) {
      case "Buy": return "#10B981";
      case "Sell": return "#EF4444";
      default: return "var(--text-secondary)";
    }
  };

  if (!hasApiKey) {
    return (
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
            border: "1px solid var(--border-color)",
          }}
        >
          <AlertCircle size={48} color="var(--text-secondary)" style={{ marginBottom: "16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>
            Finnhub API Key Required
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
            To use Basic Financials, you need to configure a Finnhub API key. It's free to sign up!
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <a
              href="https://finnhub.io/register"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <ExternalLink size={16} />
              Get Free API Key
            </a>
            <button
              onClick={() => navigate("/settings")}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                backgroundColor: "var(--accent)",
                color: "white",
                border: "none",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Settings size={16} />
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  const latestRec = getLatestRecommendation();

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Search Bar */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
            <Search
              size={18}
              style={{
                position: "absolute",
                left: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-secondary)",
              }}
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Enter symbol (e.g., AAPL)"
              style={{
                width: "100%",
                padding: "12px 14px 12px 44px",
                borderRadius: "10px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={isLoading || !searchInput.trim()}
            style={{
              padding: "12px 24px",
              borderRadius: "10px",
              border: "none",
              backgroundColor: "var(--accent)",
              color: "white",
              fontSize: "14px",
              fontWeight: "500",
              cursor: isLoading || !searchInput.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !searchInput.trim() ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            {isLoading ? "Loading..." : "Search"}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#EF4444",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* Results */}
      {symbol && !error && (
        <>
          {/* Header */}
          <div style={{ marginBottom: "24px" }}>
            <h2
              style={{
                fontSize: "28px",
                fontWeight: "700",
                color: "var(--text-primary)",
                marginBottom: "8px",
              }}
            >
              {symbol}
            </h2>
            {currentPrice && (
              <p style={{ fontSize: "24px", color: "var(--text-primary)", fontWeight: "500" }}>
                ${formatNumber(currentPrice)}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "24px" }}>
            {/* Key Metrics Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <BarChart3 size={18} />
                Key Metrics
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>P/E Ratio</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatNumber(financials?.pe_ratio)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>EPS</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    ${formatNumber(financials?.eps)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Market Cap</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatLargeNumber(financials?.market_cap ? financials.market_cap * 1e6 : null)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Beta</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatNumber(financials?.beta)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>52W High</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "#10B981" }}>
                    ${formatNumber(financials?.week_52_high)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>52W Low</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "#EF4444" }}>
                    ${formatNumber(financials?.week_52_low)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Dividend Yield</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatPercent(financials?.dividend_yield ? financials.dividend_yield / 100 : null)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>P/B Ratio</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatNumber(financials?.price_to_book)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>D/E Ratio</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatNumber(financials?.debt_to_equity)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>ROE</p>
                  <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatPercent(financials?.return_on_equity ? financials.return_on_equity / 100 : null)}
                  </p>
                </div>
              </div>
            </div>

            {/* Price Target Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <Target size={18} />
                Analyst Price Targets
              </h3>
              {priceTarget && currentPrice ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
                    <div>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Target High</p>
                      <p style={{ fontSize: "16px", fontWeight: "600", color: "#10B981" }}>
                        ${formatNumber(priceTarget.target_high)}
                        {priceTarget.target_high && currentPrice && (
                          <span style={{ fontSize: "12px", marginLeft: "8px" }}>
                            ({((priceTarget.target_high - currentPrice) / currentPrice * 100).toFixed(1)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Target Low</p>
                      <p style={{ fontSize: "16px", fontWeight: "600", color: "#EF4444" }}>
                        ${formatNumber(priceTarget.target_low)}
                        {priceTarget.target_low && currentPrice && (
                          <span style={{ fontSize: "12px", marginLeft: "8px" }}>
                            ({((priceTarget.target_low - currentPrice) / currentPrice * 100).toFixed(1)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Target Mean</p>
                      <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--accent)" }}>
                        ${formatNumber(priceTarget.target_mean)}
                        {priceTarget.target_mean && currentPrice && (
                          <span style={{ fontSize: "12px", marginLeft: "8px" }}>
                            ({((priceTarget.target_mean - currentPrice) / currentPrice * 100).toFixed(1)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Target Median</p>
                      <p style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                        ${formatNumber(priceTarget.target_median)}
                      </p>
                    </div>
                  </div>
                  {/* Price Target Bar */}
                  {priceTarget.target_low && priceTarget.target_high && currentPrice && (
                    <div style={{ marginTop: "16px" }}>
                      <div
                        style={{
                          position: "relative",
                          height: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: `${Math.max(0, Math.min(100, ((currentPrice - priceTarget.target_low) / (priceTarget.target_high - priceTarget.target_low)) * 100))}%`,
                            top: "-4px",
                            width: "4px",
                            height: "16px",
                            backgroundColor: "var(--accent)",
                            borderRadius: "2px",
                            transform: "translateX(-50%)",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                        <span style={{ fontSize: "11px", color: "#EF4444" }}>
                          ${formatNumber(priceTarget.target_low, 0)}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--accent)" }}>
                          Current: ${formatNumber(currentPrice, 0)}
                        </span>
                        <span style={{ fontSize: "11px", color: "#10B981" }}>
                          ${formatNumber(priceTarget.target_high, 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No price target data available</p>
              )}
            </div>

            {/* Analyst Recommendations Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <DollarSign size={18} />
                Analyst Recommendations
              </h3>
              {latestRec ? (
                <>
                  <div style={{ textAlign: "center", marginBottom: "20px" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                      Consensus ({latestRec.period})
                    </p>
                    <p
                      style={{
                        fontSize: "24px",
                        fontWeight: "700",
                        color: getConsensusColor(getConsensus(latestRec)),
                      }}
                    >
                      {getConsensus(latestRec)}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Based on {getTotalAnalysts(latestRec)} analysts
                    </p>
                  </div>
                  {/* Recommendation Bar */}
                  <div style={{ marginBottom: "16px" }}>
                    <div
                      style={{
                        display: "flex",
                        height: "24px",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      {latestRec.strong_buy > 0 && (
                        <div
                          style={{
                            flex: latestRec.strong_buy,
                            backgroundColor: "#059669",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "white", fontWeight: "600" }}>
                            {latestRec.strong_buy}
                          </span>
                        </div>
                      )}
                      {latestRec.buy > 0 && (
                        <div
                          style={{
                            flex: latestRec.buy,
                            backgroundColor: "#10B981",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "white", fontWeight: "600" }}>
                            {latestRec.buy}
                          </span>
                        </div>
                      )}
                      {latestRec.hold > 0 && (
                        <div
                          style={{
                            flex: latestRec.hold,
                            backgroundColor: "#6B7280",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "white", fontWeight: "600" }}>
                            {latestRec.hold}
                          </span>
                        </div>
                      )}
                      {latestRec.sell > 0 && (
                        <div
                          style={{
                            flex: latestRec.sell,
                            backgroundColor: "#F87171",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "white", fontWeight: "600" }}>
                            {latestRec.sell}
                          </span>
                        </div>
                      )}
                      {latestRec.strong_sell > 0 && (
                        <div
                          style={{
                            flex: latestRec.strong_sell,
                            backgroundColor: "#EF4444",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span style={{ fontSize: "10px", color: "white", fontWeight: "600" }}>
                            {latestRec.strong_sell}
                          </span>
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "8px",
                        fontSize: "11px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <span style={{ color: "#059669" }}>Strong Buy</span>
                      <span style={{ color: "#10B981" }}>Buy</span>
                      <span>Hold</span>
                      <span style={{ color: "#F87171" }}>Sell</span>
                      <span style={{ color: "#EF4444" }}>Strong Sell</span>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No recommendation data available</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
      {!symbol && !isLoading && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            padding: "48px 24px",
            textAlign: "center",
            border: "1px solid var(--border-color)",
          }}
        >
          <BarChart3 size={48} color="var(--text-secondary)" style={{ marginBottom: "16px" }} />
          <p style={{ color: "var(--text-secondary)", fontSize: "16px", marginBottom: "8px" }}>
            Search for a symbol to view financial data
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
            Enter a stock ticker like AAPL, MSFT, or NVDA
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
