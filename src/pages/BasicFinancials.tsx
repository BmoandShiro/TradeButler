import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Search,
  RefreshCw,
  AlertCircle,
  DollarSign,
  Target,
  BarChart3,
  Settings,
  ExternalLink,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  Globe,
  Calendar,
  PieChart,
  Percent,
  Activity,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
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
  gross_margin: number | null;
  operating_margin: number | null;
  profit_margin: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  peg_ratio: number | null;
  price_to_sales: number | null;
  free_cash_flow_per_share: number | null;
  revenue_growth_3y: number | null;
  revenue_growth_5y: number | null;
  eps_growth_3y: number | null;
  eps_growth_5y: number | null;
  dividend_growth_5y: number | null;
  payout_ratio: number | null;
  book_value_per_share: number | null;
  tangible_book_value_per_share: number | null;
  enterprise_value: number | null;
  ev_to_ebitda: number | null;
  forward_pe: number | null;
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

interface CompanyProfile {
  symbol: string;
  name: string | null;
  country: string | null;
  currency: string | null;
  exchange: string | null;
  industry: string | null;
  sector: string | null;
  ipo: string | null;
  market_cap: number | null;
  shares_outstanding: number | null;
  logo: string | null;
  phone: string | null;
  weburl: string | null;
}

interface EarningsSurprise {
  symbol: string;
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprise_percent: number | null;
}

interface ChartDataPoint {
  date: string;
  price: number;
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
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [peers, setPeers] = useState<string[]>([]);
  const [earningsSurprises, setEarningsSurprises] = useState<EarningsSurprise[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<"1M" | "3M" | "6M" | "1Y" | "5Y">("1Y");

  const hasApiKey = hasFinnhubApiKey();

  useEffect(() => {
    if (initialSymbol && hasApiKey) {
      fetchData(initialSymbol);
    }
  }, [initialSymbol]);

  const fetchChartData = async (sym: string, range: string) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      let period1: number;
      let interval: string;
      
      switch (range) {
        case "1M":
          period1 = now - 30 * 24 * 60 * 60;
          interval = "1d";
          break;
        case "3M":
          period1 = now - 90 * 24 * 60 * 60;
          interval = "1d";
          break;
        case "6M":
          period1 = now - 180 * 24 * 60 * 60;
          interval = "1d";
          break;
        case "1Y":
          period1 = now - 365 * 24 * 60 * 60;
          interval = "1d";
          break;
        case "5Y":
          period1 = now - 5 * 365 * 24 * 60 * 60;
          interval = "1wk";
          break;
        default:
          period1 = now - 365 * 24 * 60 * 60;
          interval = "1d";
      }

      const data = await invoke<any>("fetch_chart_data", {
        symbol: sym,
        period1,
        period2: now,
        interval,
      });

      if (data?.chart?.result?.[0]) {
        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        
        const chartPoints: ChartDataPoint[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null && closes[i] !== undefined) {
            chartPoints.push({
              date: new Date(timestamps[i] * 1000).toLocaleDateString(),
              price: closes[i],
            });
          }
        }
        setChartData(chartPoints);
      }
    } catch (e) {
      console.warn("Failed to fetch chart data:", e);
    }
  };

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
      const [
        financialsData,
        priceTargetData,
        recommendationsData,
        quoteData,
        profileData,
        peersData,
        earningsData,
      ] = await Promise.allSettled([
        invoke<BasicFinancials>("fetch_finnhub_basic_financials", { apiKey, symbol: sym }),
        invoke<PriceTarget>("fetch_finnhub_price_target", { apiKey, symbol: sym }),
        invoke<Recommendation[]>("fetch_finnhub_recommendations", { apiKey, symbol: sym }),
        invoke<any>("fetch_stock_quote", { symbol: sym }),
        invoke<CompanyProfile>("fetch_finnhub_company_profile", { apiKey, symbol: sym }),
        invoke<string[]>("fetch_finnhub_peers", { apiKey, symbol: sym }),
        invoke<EarningsSurprise[]>("fetch_finnhub_earnings_surprises", { apiKey, symbol: sym }),
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
      if (quoteData.status === "fulfilled") {
        const quote = quoteData.value;
        if (quote.current_price) setCurrentPrice(quote.current_price);
      }
      if (profileData.status === "fulfilled") {
        setCompanyProfile(profileData.value);
      }
      if (peersData.status === "fulfilled") {
        setPeers(peersData.value);
      }
      if (earningsData.status === "fulfilled") {
        setEarningsSurprises(earningsData.value);
      }

      // Fetch chart data
      await fetchChartData(sym, chartRange);
    } catch (e) {
      console.error("Failed to fetch financials:", e);
      setError(typeof e === "string" ? e : "Failed to fetch financial data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (symbol) {
      fetchChartData(symbol, chartRange);
    }
  }, [chartRange]);

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

  const formatPercent = (num: number | null | undefined, alreadyPercent = false): string => {
    if (num === null || num === undefined) return "—";
    const value = alreadyPercent ? num : num * 100;
    return `${value.toFixed(2)}%`;
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

  const MetricItem = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>{label}</p>
      <p style={{ fontSize: "15px", fontWeight: "600", color: color || "var(--text-primary)" }}>{value}</p>
    </div>
  );

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
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
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
          {/* Company Header */}
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "12px",
              border: "1px solid var(--border-color)",
              padding: "20px",
              marginBottom: "24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "20px" }}>
              {companyProfile?.logo && (
                <img
                  src={companyProfile.logo}
                  alt={`${symbol} logo`}
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "12px",
                    objectFit: "contain",
                    backgroundColor: "white",
                    padding: "8px",
                  }}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "4px" }}>
                  <h2 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                    {symbol}
                  </h2>
                  {companyProfile?.name && (
                    <span style={{ fontSize: "16px", color: "var(--text-secondary)" }}>{companyProfile.name}</span>
                  )}
                </div>
                {currentPrice && (
                  <p style={{ fontSize: "24px", color: "var(--text-primary)", fontWeight: "500", margin: "4px 0" }}>
                    ${formatNumber(currentPrice)}
                  </p>
                )}
                <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
                  {companyProfile?.industry && (
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Building2 size={14} /> {companyProfile.industry}
                    </span>
                  )}
                  {companyProfile?.exchange && (
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Globe size={14} /> {companyProfile.exchange}
                    </span>
                  )}
                  {companyProfile?.ipo && (
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Calendar size={14} /> IPO: {companyProfile.ipo}
                    </span>
                  )}
                  {companyProfile?.weburl && (
                    <a
                      href={companyProfile.weburl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "13px", color: "var(--accent)", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
                    >
                      <ExternalLink size={14} /> Website
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Price Chart */}
          {chartData.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                  <Activity size={18} />
                  Price History
                </h3>
                <div style={{ display: "flex", gap: "4px" }}>
                  {(["1M", "3M", "6M", "1Y", "5Y"] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => setChartRange(range)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: chartRange === range ? "var(--accent)" : "var(--bg-primary)",
                        color: chartRange === range ? "white" : "var(--text-secondary)",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border-color)" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#priceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
            {/* Valuation Metrics Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <BarChart3 size={18} />
                Valuation
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <MetricItem label="P/E Ratio" value={formatNumber(financials?.pe_ratio)} />
                <MetricItem label="Forward P/E" value={formatNumber(financials?.forward_pe)} />
                <MetricItem label="PEG Ratio" value={formatNumber(financials?.peg_ratio)} />
                <MetricItem label="Price/Book" value={formatNumber(financials?.price_to_book)} />
                <MetricItem label="Price/Sales" value={formatNumber(financials?.price_to_sales)} />
                <MetricItem label="EV/EBITDA" value={formatNumber(financials?.ev_to_ebitda)} />
                <MetricItem label="Market Cap" value={formatLargeNumber(financials?.market_cap ? financials.market_cap * 1e6 : null)} />
                <MetricItem label="Enterprise Value" value={formatLargeNumber(financials?.enterprise_value ? financials.enterprise_value * 1e6 : null)} />
              </div>
            </div>

            {/* Profitability Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Percent size={18} />
                Profitability
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <MetricItem label="Gross Margin" value={formatPercent(financials?.gross_margin, true)} />
                <MetricItem label="Operating Margin" value={formatPercent(financials?.operating_margin, true)} />
                <MetricItem label="Profit Margin" value={formatPercent(financials?.profit_margin, true)} />
                <MetricItem label="ROE" value={formatPercent(financials?.return_on_equity, true)} />
                <MetricItem label="EPS (TTM)" value={`$${formatNumber(financials?.eps)}`} />
                <MetricItem label="Revenue/Share" value={`$${formatNumber(financials?.revenue_per_share)}`} />
                <MetricItem label="Free Cash Flow/Share" value={`$${formatNumber(financials?.free_cash_flow_per_share)}`} />
                <MetricItem label="Book Value/Share" value={`$${formatNumber(financials?.book_value_per_share)}`} />
              </div>
            </div>

            {/* Growth Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <TrendingUp size={18} />
                Growth
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <MetricItem 
                  label="Revenue Growth (3Y)" 
                  value={formatPercent(financials?.revenue_growth_3y, true)} 
                  color={financials?.revenue_growth_3y && financials.revenue_growth_3y > 0 ? "#10B981" : financials?.revenue_growth_3y && financials.revenue_growth_3y < 0 ? "#EF4444" : undefined}
                />
                <MetricItem 
                  label="Revenue Growth (5Y)" 
                  value={formatPercent(financials?.revenue_growth_5y, true)}
                  color={financials?.revenue_growth_5y && financials.revenue_growth_5y > 0 ? "#10B981" : financials?.revenue_growth_5y && financials.revenue_growth_5y < 0 ? "#EF4444" : undefined}
                />
                <MetricItem 
                  label="EPS Growth (3Y)" 
                  value={formatPercent(financials?.eps_growth_3y, true)}
                  color={financials?.eps_growth_3y && financials.eps_growth_3y > 0 ? "#10B981" : financials?.eps_growth_3y && financials.eps_growth_3y < 0 ? "#EF4444" : undefined}
                />
                <MetricItem 
                  label="EPS Growth (5Y)" 
                  value={formatPercent(financials?.eps_growth_5y, true)}
                  color={financials?.eps_growth_5y && financials.eps_growth_5y > 0 ? "#10B981" : financials?.eps_growth_5y && financials.eps_growth_5y < 0 ? "#EF4444" : undefined}
                />
                <MetricItem 
                  label="Dividend Growth (5Y)" 
                  value={formatPercent(financials?.dividend_growth_5y, true)}
                  color={financials?.dividend_growth_5y && financials.dividend_growth_5y > 0 ? "#10B981" : undefined}
                />
                <MetricItem label="Beta" value={formatNumber(financials?.beta)} />
              </div>
            </div>

            {/* Financial Health Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <PieChart size={18} />
                Financial Health
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <MetricItem label="Current Ratio" value={formatNumber(financials?.current_ratio)} />
                <MetricItem label="Quick Ratio" value={formatNumber(financials?.quick_ratio)} />
                <MetricItem label="Debt/Equity" value={formatNumber(financials?.debt_to_equity)} />
                <MetricItem label="52W High" value={`$${formatNumber(financials?.week_52_high)}`} color="#10B981" />
                <MetricItem label="52W Low" value={`$${formatNumber(financials?.week_52_low)}`} color="#EF4444" />
                {financials?.week_52_high && financials?.week_52_low && currentPrice && (
                  <div style={{ gridColumn: "span 2" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>52-Week Range</p>
                    <div style={{ position: "relative", height: "8px", backgroundColor: "var(--bg-primary)", borderRadius: "4px" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: `${((currentPrice - financials.week_52_low) / (financials.week_52_high - financials.week_52_low)) * 100}%`,
                          top: "-4px",
                          width: "4px",
                          height: "16px",
                          backgroundColor: "var(--accent)",
                          borderRadius: "2px",
                          transform: "translateX(-50%)",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Dividends Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <DollarSign size={18} />
                Dividends
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <MetricItem label="Dividend Yield" value={formatPercent(financials?.dividend_yield ? financials.dividend_yield / 100 : null)} />
                <MetricItem label="Payout Ratio" value={formatPercent(financials?.payout_ratio, true)} />
                <MetricItem 
                  label="Dividend Growth (5Y)" 
                  value={formatPercent(financials?.dividend_growth_5y, true)}
                  color={financials?.dividend_growth_5y && financials.dividend_growth_5y > 0 ? "#10B981" : undefined}
                />
              </div>
            </div>

            {/* Price Targets Card */}
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Target size={18} />
                Price Targets
              </h3>
              {priceTarget && (priceTarget.target_mean || priceTarget.target_high || priceTarget.target_low) ? (
                <>
                  <div style={{ textAlign: "center", marginBottom: "16px" }}>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Mean Target</p>
                    <p style={{ fontSize: "28px", fontWeight: "700", color: "var(--accent)" }}>
                      ${formatNumber(priceTarget.target_mean)}
                    </p>
                    {currentPrice && priceTarget.target_mean && (
                      <p style={{ 
                        fontSize: "14px", 
                        color: priceTarget.target_mean > currentPrice ? "#10B981" : "#EF4444",
                        fontWeight: "500",
                      }}>
                        {priceTarget.target_mean > currentPrice ? "+" : ""}
                        {(((priceTarget.target_mean - currentPrice) / currentPrice) * 100).toFixed(1)}% upside
                      </p>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", textAlign: "center" }}>
                    <div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>Low</p>
                      <p style={{ fontSize: "14px", fontWeight: "600", color: "#EF4444" }}>${formatNumber(priceTarget.target_low)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>Median</p>
                      <p style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>${formatNumber(priceTarget.target_median)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>High</p>
                      <p style={{ fontSize: "14px", fontWeight: "600", color: "#10B981" }}>${formatNumber(priceTarget.target_high)}</p>
                    </div>
                  </div>
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
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Users size={18} />
                Analyst Recommendations
              </h3>
              {latestRec ? (
                <>
                  <div style={{ 
                    textAlign: "center", 
                    marginBottom: "20px",
                    padding: "16px",
                    backgroundColor: "var(--bg-primary)",
                    borderRadius: "8px",
                  }}>
                    <p
                      style={{
                        fontSize: "28px",
                        fontWeight: "700",
                        color: getConsensusColor(getConsensus(latestRec)),
                        marginBottom: "4px",
                      }}
                    >
                      {getConsensus(latestRec)}
                    </p>
                    <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      {getTotalAnalysts(latestRec)} analysts · {latestRec.period}
                    </p>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {[
                      { label: "Strong Buy", value: latestRec.strong_buy, color: "#059669" },
                      { label: "Buy", value: latestRec.buy, color: "#10B981" },
                      { label: "Hold", value: latestRec.hold, color: "#6B7280" },
                      { label: "Sell", value: latestRec.sell, color: "#F87171" },
                      { label: "Strong Sell", value: latestRec.strong_sell, color: "#EF4444" },
                    ].map(({ label, value, color }) => {
                      const total = getTotalAnalysts(latestRec);
                      const percent = total > 0 ? (value / total) * 100 : 0;
                      return (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ width: "75px", fontSize: "12px", color: "var(--text-secondary)", flexShrink: 0 }}>
                            {label}
                          </span>
                          <div style={{ flex: 1, height: "16px", backgroundColor: "var(--bg-primary)", borderRadius: "4px", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                backgroundColor: color,
                                borderRadius: "4px",
                                minWidth: value > 0 ? "4px" : "0",
                              }}
                            />
                          </div>
                          <span style={{ width: "24px", fontSize: "13px", fontWeight: "600", color: value > 0 ? color : "var(--text-secondary)", textAlign: "right", flexShrink: 0 }}>
                            {value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No recommendation data available</p>
              )}
            </div>

            {/* Earnings History Card */}
            {earningsSurprises.length > 0 && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  padding: "20px",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <BarChart3 size={18} />
                  Earnings History
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {earningsSurprises.slice(0, 6).map((earning, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 12px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "6px",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{earning.period}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Est: </span>
                          <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                            ${earning.estimate?.toFixed(2) ?? "—"}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Act: </span>
                          <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                            ${earning.actual?.toFixed(2) ?? "—"}
                          </span>
                        </div>
                        {earning.surprise_percent !== null && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              backgroundColor: earning.surprise_percent >= 0 ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                              color: earning.surprise_percent >= 0 ? "#10B981" : "#EF4444",
                              fontSize: "12px",
                              fontWeight: "600",
                              minWidth: "60px",
                              justifyContent: "center",
                            }}
                          >
                            {earning.surprise_percent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {earning.surprise_percent >= 0 ? "+" : ""}{earning.surprise_percent.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Peers Card */}
            {peers.length > 0 && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  padding: "20px",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Building2 size={18} />
                  Similar Companies
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {peers.map((peer) => (
                    <button
                      key={peer}
                      onClick={() => {
                        setSearchInput(peer);
                        fetchData(peer);
                      }}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "6px",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                        fontWeight: "500",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "var(--accent)";
                        e.currentTarget.style.color = "white";
                        e.currentTarget.style.borderColor = "var(--accent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "var(--bg-primary)";
                        e.currentTarget.style.color = "var(--text-primary)";
                        e.currentTarget.style.borderColor = "var(--border-color)";
                      }}
                    >
                      {peer}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty State */}
      {!symbol && !isLoading && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "var(--text-secondary)",
          }}
        >
          <BarChart3 size={48} style={{ marginBottom: "16px", opacity: 0.5 }} />
          <p style={{ fontSize: "16px" }}>Enter a symbol above to view financial data</p>
        </div>
      )}
    </div>
  );
}
