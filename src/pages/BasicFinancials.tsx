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
  FileText,
  UserCheck,
  ArrowUpRight,
  ArrowDownRight,
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

interface DividendInfo {
  symbol: string;
  ex_date: string | null;
  payment_date: string | null;
  record_date: string | null;
  declaration_date: string | null;
  amount: number | null;
  frequency: string | null;
  dividend_type: string | null;
}

interface InsiderTransaction {
  symbol: string;
  name: string | null;
  share: number | null;
  change: number | null;
  filing_date: string | null;
  transaction_date: string | null;
  transaction_code: string | null;
  transaction_price: number | null;
}

interface SecFiling {
  symbol: string;
  access_number: string | null;
  form: string | null;
  filed_date: string | null;
  accepted_date: string | null;
  report_url: string | null;
  filing_url: string | null;
}

interface PricePerformance {
  symbol: string;
  current_price: number | null;
  change_1d: number | null;
  change_1d_percent: number | null;
  change_1w: number | null;
  change_1w_percent: number | null;
  change_1m: number | null;
  change_1m_percent: number | null;
  change_3m: number | null;
  change_3m_percent: number | null;
  change_ytd: number | null;
  change_ytd_percent: number | null;
  change_1y: number | null;
  change_1y_percent: number | null;
}

interface ShortInterest {
  symbol: string;
  short_interest: number | null;
  short_ratio: number | null;
  short_percent_of_float: number | null;
  shares_short_prior_month: number | null;
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
  const [dividendHistory, setDividendHistory] = useState<DividendInfo[]>([]);
  const [insiderTransactions, setInsiderTransactions] = useState<InsiderTransaction[]>([]);
  const [secFilings, setSecFilings] = useState<SecFiling[]>([]);
  const [pricePerformance, setPricePerformance] = useState<PricePerformance | null>(null);
  const [shortInterest, setShortInterest] = useState<ShortInterest | null>(null);
  const [earningsDate, setEarningsDate] = useState<string | null>(null);
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
        dividendsData,
        insidersData,
        filingsData,
        perfData,
        shortData,
        earningsDateData,
      ] = await Promise.allSettled([
        invoke<BasicFinancials>("fetch_finnhub_basic_financials", { apiKey, symbol: sym }),
        invoke<PriceTarget>("fetch_finnhub_price_target", { apiKey, symbol: sym }),
        invoke<Recommendation[]>("fetch_finnhub_recommendations", { apiKey, symbol: sym }),
        invoke<any>("fetch_stock_quote", { symbol: sym }),
        invoke<CompanyProfile>("fetch_finnhub_company_profile", { apiKey, symbol: sym }),
        invoke<string[]>("fetch_finnhub_peers", { apiKey, symbol: sym }),
        invoke<EarningsSurprise[]>("fetch_finnhub_earnings_surprises", { apiKey, symbol: sym }),
        invoke<DividendInfo[]>("fetch_finnhub_dividends", { apiKey, symbol: sym }),
        invoke<InsiderTransaction[]>("fetch_finnhub_insider_transactions", { apiKey, symbol: sym }),
        invoke<SecFiling[]>("fetch_finnhub_sec_filings", { apiKey, symbol: sym }),
        invoke<PricePerformance>("fetch_price_performance", { symbol: sym }),
        invoke<ShortInterest>("fetch_short_interest", { symbol: sym }),
        invoke<string | null>("fetch_earnings_date", { symbol: sym }),
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
      if (dividendsData.status === "fulfilled") {
        setDividendHistory(dividendsData.value);
      }
      if (earningsData.status === "fulfilled") {
        setEarningsSurprises(earningsData.value);
      }
      if (insidersData.status === "fulfilled") {
        setInsiderTransactions(insidersData.value);
      }
      if (filingsData.status === "fulfilled") {
        setSecFilings(filingsData.value);
      }
      if (perfData.status === "fulfilled") {
        setPricePerformance(perfData.value);
      }
      if (shortData.status === "fulfilled") {
        setShortInterest(shortData.value);
      }
      if (earningsDateData.status === "fulfilled") {
        setEarningsDate(earningsDateData.value);
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
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "12px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={companyProfile.logo}
                    alt={`${symbol} logo`}
                    style={{
                      maxWidth: "48px",
                      maxHeight: "48px",
                      objectFit: "contain",
                    }}
                    onError={(e) => (e.currentTarget.parentElement!.style.display = "none")}
                  />
                </div>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: dividendHistory.length > 0 ? "16px" : 0 }}>
                <MetricItem label="Dividend Yield" value={formatPercent(financials?.dividend_yield ? financials.dividend_yield / 100 : null)} />
                <MetricItem label="Payout Ratio" value={formatPercent(financials?.payout_ratio, true)} />
                <MetricItem 
                  label="Dividend Growth (5Y)" 
                  value={formatPercent(financials?.dividend_growth_5y, true)}
                  color={financials?.dividend_growth_5y && financials.dividend_growth_5y > 0 ? "#10B981" : undefined}
                />
                {dividendHistory.length > 0 && dividendHistory[0].amount && (
                  <MetricItem label="Last Dividend" value={`$${dividendHistory[0].amount.toFixed(4)}`} />
                )}
              </div>
              
              {/* Upcoming/Recent Dividend Dates */}
              {dividendHistory.length > 0 && (() => {
                const today = new Date().toISOString().split('T')[0];
                const upcomingDividends = dividendHistory.filter(d => d.ex_date && d.ex_date >= today);
                const nextDividend = upcomingDividends.length > 0 ? upcomingDividends[upcomingDividends.length - 1] : null;
                
                return (
                  <>
                    {nextDividend && (
                      <div style={{ 
                        padding: "12px", 
                        backgroundColor: "rgba(16, 185, 129, 0.1)", 
                        borderRadius: "8px", 
                        marginBottom: "12px",
                        border: "1px solid rgba(16, 185, 129, 0.2)",
                      }}>
                        <p style={{ fontSize: "12px", color: "#10B981", fontWeight: "600", marginBottom: "8px" }}>
                          Upcoming Dividend
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          {nextDividend.ex_date && (
                            <div>
                              <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Ex-Dividend Date</p>
                              <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>{nextDividend.ex_date}</p>
                            </div>
                          )}
                          {nextDividend.payment_date && (
                            <div>
                              <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Payment Date</p>
                              <p style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>{nextDividend.payment_date}</p>
                            </div>
                          )}
                          {nextDividend.amount && (
                            <div>
                              <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Amount</p>
                              <p style={{ fontSize: "13px", fontWeight: "600", color: "#10B981" }}>${nextDividend.amount.toFixed(4)}</p>
                            </div>
                          )}
                          {nextDividend.frequency && (
                            <div>
                              <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Frequency</p>
                              <p style={{ fontSize: "13px", fontWeight: "500", color: "var(--text-primary)" }}>{nextDividend.frequency}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Dividend History */}
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", fontWeight: "600" }}>
                      Recent Dividend History
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                      {dividendHistory.slice(0, 6).map((div, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "8px 10px",
                            backgroundColor: "var(--bg-primary)",
                            borderRadius: "6px",
                            fontSize: "12px",
                          }}
                        >
                          <span style={{ color: "var(--text-secondary)" }}>{div.ex_date || "—"}</span>
                          <span style={{ color: "var(--text-primary)", fontWeight: "600" }}>
                            ${div.amount?.toFixed(4) || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              
              {dividendHistory.length === 0 && !financials?.dividend_yield && (
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontStyle: "italic" }}>
                  No dividend data available
                </p>
              )}
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

            {/* Price Performance Card */}
            {pricePerformance && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  padding: "20px",
                  overflow: "hidden",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Activity size={18} />
                  Price Performance
                </h3>
                
                {/* Upcoming Earnings Alert */}
                {earningsDate && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 14px",
                      backgroundColor: "rgba(139, 92, 246, 0.15)",
                      borderRadius: "8px",
                      marginBottom: "16px",
                      border: "1px solid rgba(139, 92, 246, 0.3)",
                    }}
                  >
                    <Calendar size={18} style={{ color: "#8B5CF6", flexShrink: 0 }} />
                    <div style={{ overflow: "hidden" }}>
                      <p style={{ margin: 0, fontSize: "13px", fontWeight: "600", color: "#8B5CF6" }}>
                        Upcoming Earnings
                      </p>
                      <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {earningsDate}
                      </p>
                    </div>
                  </div>
                )}
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                  {[
                    { label: "1 Day", value: pricePerformance.change_1d_percent },
                    { label: "1 Week", value: pricePerformance.change_1w_percent },
                    { label: "1 Month", value: pricePerformance.change_1m_percent },
                    { label: "3 Months", value: pricePerformance.change_3m_percent },
                    { label: "YTD", value: pricePerformance.change_ytd_percent },
                    { label: "1 Year", value: pricePerformance.change_1y_percent },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        padding: "10px 8px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "8px",
                        textAlign: "center",
                        minWidth: 0,
                        overflow: "hidden",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "10px", color: "var(--text-secondary)", marginBottom: "4px", whiteSpace: "nowrap" }}>
                        {item.label}
                      </p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                        {item.value !== null && item.value !== undefined ? (
                          <>
                            {item.value >= 0 ? (
                              <ArrowUpRight size={12} style={{ color: "#10B981", flexShrink: 0 }} />
                            ) : (
                              <ArrowDownRight size={12} style={{ color: "#EF4444", flexShrink: 0 }} />
                            )}
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: "600",
                                color: item.value >= 0 ? "#10B981" : "#EF4444",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.value >= 0 ? "+" : ""}{item.value.toFixed(2)}%
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Short Interest Card */}
            {shortInterest && (shortInterest.short_interest || shortInterest.short_ratio || shortInterest.short_percent_of_float) && (
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
                  Short Interest
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
                  <div style={{ padding: "14px", backgroundColor: "var(--bg-primary)", borderRadius: "8px" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Shares Short</p>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                      {shortInterest.short_interest ? `${(shortInterest.short_interest / 1e6).toFixed(2)}M` : "—"}
                    </p>
                  </div>
                  <div style={{ padding: "14px", backgroundColor: "var(--bg-primary)", borderRadius: "8px" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Short Ratio</p>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                      {shortInterest.short_ratio?.toFixed(2) ?? "—"}
                    </p>
                  </div>
                  <div style={{ padding: "14px", backgroundColor: "var(--bg-primary)", borderRadius: "8px" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>% of Float</p>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: shortInterest.short_percent_of_float && shortInterest.short_percent_of_float > 0.1 ? "#F59E0B" : "var(--text-primary)" }}>
                      {shortInterest.short_percent_of_float ? `${(shortInterest.short_percent_of_float * 100).toFixed(2)}%` : "—"}
                    </p>
                  </div>
                  <div style={{ padding: "14px", backgroundColor: "var(--bg-primary)", borderRadius: "8px" }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Prior Month</p>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                      {shortInterest.shares_short_prior_month ? `${(shortInterest.shares_short_prior_month / 1e6).toFixed(2)}M` : "—"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* SEC Filings Card */}
            {secFilings.length > 0 && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  padding: "20px",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <FileText size={18} />
                  SEC Filings
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                  {secFilings.slice(0, 10).map((filing, idx) => {
                    const getFormDescription = (form: string | null): string => {
                      if (!form) return "";
                      if (form.includes("10-K")) return "Annual Report";
                      if (form.includes("10-Q")) return "Quarterly Report";
                      if (form.includes("8-K")) return "Current Report";
                      if (form === "4") return "Insider Transaction";
                      if (form === "3") return "Initial Ownership";
                      if (form === "5") return "Annual Ownership";
                      if (form.includes("DEF 14A")) return "Proxy Statement";
                      if (form.includes("13F")) return "Holdings Report";
                      return "";
                    };
                    
                    const formDesc = getFormDescription(filing.form);
                    const fileUrl = filing.report_url || filing.filing_url;
                    
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          if (fileUrl) {
                            navigate(`/sec-filing?url=${encodeURIComponent(fileUrl)}&symbol=${symbol}&form=${encodeURIComponent(filing.form || "")}&date=${encodeURIComponent(filing.filed_date || "")}`);
                          }
                        }}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "14px 16px",
                          backgroundColor: "var(--bg-primary)",
                          borderRadius: "8px",
                          textDecoration: "none",
                          transition: "all 0.15s ease",
                          border: "1px solid transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent)";
                          e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 10%, var(--bg-primary))";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "transparent";
                          e.currentTarget.style.backgroundColor = "var(--bg-primary)";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
                          <span
                            style={{
                              padding: "6px 10px",
                              borderRadius: "6px",
                              backgroundColor: filing.form?.includes("10-K") ? "rgba(139, 92, 246, 0.2)" :
                                             filing.form?.includes("10-Q") ? "rgba(16, 185, 129, 0.2)" :
                                             filing.form?.includes("8-K") ? "rgba(245, 158, 11, 0.2)" :
                                             filing.form === "4" || filing.form === "3" || filing.form === "5" ? "rgba(59, 130, 246, 0.2)" :
                                             "var(--bg-secondary)",
                              color: filing.form?.includes("10-K") ? "#8B5CF6" :
                                    filing.form?.includes("10-Q") ? "#10B981" :
                                    filing.form?.includes("8-K") ? "#F59E0B" :
                                    filing.form === "4" || filing.form === "3" || filing.form === "5" ? "#3B82F6" :
                                    "var(--text-secondary)",
                              fontSize: "13px",
                              fontWeight: "700",
                              minWidth: "fit-content",
                            }}
                          >
                            {filing.form || "Filing"}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: "14px", fontWeight: "500", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {formDesc || "SEC Filing"}
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                              Filed: {filing.filed_date || "—"}
                            </p>
                          </div>
                        </div>
                        <ExternalLink size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Insider Transactions Card */}
            {insiderTransactions.length > 0 && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  padding: "20px",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <UserCheck size={18} />
                  Insider Transactions
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                  {insiderTransactions.slice(0, 10).map((tx, idx) => {
                    const isBuy = tx.change && tx.change > 0;
                    const transactionTypes: Record<string, string> = {
                      P: "Purchase",
                      S: "Sale",
                      A: "Award",
                      D: "Disposition",
                      G: "Gift",
                      F: "Tax Payment",
                      M: "Option Exercise",
                      C: "Conversion",
                      X: "Exercise Expired",
                    };
                    const txType = tx.transaction_code ? transactionTypes[tx.transaction_code] || tx.transaction_code : "—";
                    
                    return (
                      <div
                        key={idx}
                        style={{
                          padding: "12px 14px",
                          backgroundColor: "var(--bg-primary)",
                          borderRadius: "8px",
                          borderLeft: `3px solid ${isBuy ? "#10B981" : "#EF4444"}`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                          <div>
                            <p style={{ margin: 0, fontSize: "14px", fontWeight: "500", color: "var(--text-primary)" }}>
                              {tx.name || "Unknown Insider"}
                            </p>
                            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                              {tx.transaction_date || tx.filing_date || "—"}
                            </p>
                          </div>
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: "4px",
                              backgroundColor: isBuy ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                              color: isBuy ? "#10B981" : "#EF4444",
                              fontSize: "11px",
                              fontWeight: "600",
                            }}
                          >
                            {txType}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
                          <div>
                            <span style={{ color: "var(--text-secondary)" }}>Shares: </span>
                            <span style={{ color: isBuy ? "#10B981" : "#EF4444", fontWeight: "600" }}>
                              {tx.change ? `${isBuy ? "+" : ""}${tx.change.toLocaleString()}` : "—"}
                            </span>
                          </div>
                          {tx.transaction_price && (
                            <div>
                              <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>
                                ${tx.transaction_price.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {tx.share && (
                            <div>
                              <span style={{ color: "var(--text-secondary)" }}>Total: </span>
                              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>
                                {tx.share.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
