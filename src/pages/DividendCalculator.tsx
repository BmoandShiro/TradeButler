import { useState, useEffect } from "react";
import { Calculator, X, BarChart3, TrendingUp, ChevronUp, ChevronDown, Loader } from "lucide-react";
import { LineChart, BarChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { invoke } from "@tauri-apps/api/tauri";

interface DividendYearResult {
  year: number;
  startBalance: number;
  startShares: number;
  sharePrice: number;
  dividendPerShare: number;
  dividendYield: number;
  yieldOnCost: number;
  annualDividend: number;
  totalDividends: number;
  endShares: number;
  endBalance: number;
}

interface DividendInputs {
  initialInvestment: string;
  sharePrice: string;
  dividendAmount: string;
  dividendFrequency: "Monthly" | "Quarterly" | "Semi-Annual" | "Annual";
  dividendGrowthRate: string;
  sharePriceGrowth: string;
  extraInvestment: string;
  extraInvestFrequency: "Monthly" | "Quarterly" | "Semi-Annual" | "Annual" | "None";
  lengthOfInvestment: string;
  enableDRIP: boolean;
}

const STORAGE_KEY = "tradebutler_dividend_calculator_data";

const DEFAULT_INPUTS: DividendInputs = {
  initialInvestment: "10000",
  sharePrice: "50",
  dividendAmount: "1.02",
  dividendFrequency: "Quarterly",
  dividendGrowthRate: "4",
  sharePriceGrowth: "5",
  extraInvestment: "100",
  extraInvestFrequency: "Monthly",
  lengthOfInvestment: "10",
  enableDRIP: true,
};

export default function DividendCalculator() {
  const [inputs, setInputs] = useState<DividendInputs>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_INPUTS, ...parsed };
      } catch {
        return DEFAULT_INPUTS;
      }
    }
    return DEFAULT_INPUTS;
  });

  const [results, setResults] = useState<DividendYearResult[]>([]);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [ticker, setTicker] = useState("");
  const [loadingTicker, setLoadingTicker] = useState(false);

  // Save to localStorage whenever inputs change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
  }, [inputs]);

  const updateInput = (field: keyof DividendInputs, value: string | boolean) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const incrementValue = (field: keyof DividendInputs, step: number = 1) => {
    const currentValue = parseFloat(String(inputs[field])) || 0;
    const newValue = (currentValue + step).toFixed(2);
    updateInput(field, newValue);
  };

  const decrementValue = (field: keyof DividendInputs, step: number = 1) => {
    const currentValue = parseFloat(String(inputs[field])) || 0;
    const newValue = Math.max(0, currentValue - step).toFixed(2);
    updateInput(field, newValue);
  };

  const getDividendsPerYear = (frequency: string): number => {
    switch (frequency) {
      case "Monthly": return 12;
      case "Quarterly": return 4;
      case "Semi-Annual": return 2;
      case "Annual": return 1;
      default: return 4;
    }
  };

  const getExtraInvestmentsPerYear = (frequency: string): number => {
    switch (frequency) {
      case "Monthly": return 12;
      case "Quarterly": return 4;
      case "Semi-Annual": return 2;
      case "Annual": return 1;
      case "None": return 0;
      default: return 0;
    }
  };

  const calculateDividends = () => {
    const initialInvestment = parseFloat(inputs.initialInvestment) || 0;
    const sharePrice = parseFloat(inputs.sharePrice) || 1;
    const dividendAmount = parseFloat(inputs.dividendAmount) || 0;
    const dividendGrowthRate = (parseFloat(inputs.dividendGrowthRate) || 0) / 100;
    const sharePriceGrowth = (parseFloat(inputs.sharePriceGrowth) || 0) / 100;
    const extraInvestment = parseFloat(inputs.extraInvestment) || 0;
    const lengthOfInvestment = parseInt(inputs.lengthOfInvestment) || 10;
    const enableDRIP = inputs.enableDRIP;

    const dividendsPerYear = getDividendsPerYear(inputs.dividendFrequency);
    const extraInvestmentsPerYear = getExtraInvestmentsPerYear(inputs.extraInvestFrequency);

    const results: DividendYearResult[] = [];
    let currentShares = initialInvestment / sharePrice;
    let currentSharePrice = sharePrice;
    let currentDividendPerShare = dividendAmount;
    let totalDividendsReceived = 0;
    let currentBalance = initialInvestment;

    for (let year = 1; year <= lengthOfInvestment; year++) {
      const startBalance = currentBalance;
      const startShares = currentShares;
      const startSharePrice = currentSharePrice;
      const yearDividendPerShare = currentDividendPerShare; // Store before updating

      // Calculate annual dividend
      const annualDividend = currentShares * currentDividendPerShare * dividendsPerYear;
      totalDividendsReceived += annualDividend;

      // DRIP: Reinvest dividends to buy more shares
      if (enableDRIP && annualDividend > 0) {
        const sharesFromDividends = annualDividend / currentSharePrice;
        currentShares += sharesFromDividends;
      }

      // Add extra investments
      if (extraInvestmentsPerYear > 0 && extraInvestment > 0) {
        const annualExtraInvestment = extraInvestment * extraInvestmentsPerYear;
        const sharesFromExtra = annualExtraInvestment / currentSharePrice;
        currentShares += sharesFromExtra;
        currentBalance += annualExtraInvestment;
      }

      // Update share price and dividend for next year
      currentSharePrice = currentSharePrice * (1 + sharePriceGrowth);
      currentDividendPerShare = currentDividendPerShare * (1 + dividendGrowthRate);

      // Update balance (shares * price + dividends if not DRIP)
      if (enableDRIP) {
        currentBalance = currentShares * currentSharePrice;
      } else {
        currentBalance = currentShares * currentSharePrice + totalDividendsReceived;
      }

      const endBalance = currentBalance;
      const endShares = currentShares;
      const dividendYield = (yearDividendPerShare * dividendsPerYear) / startSharePrice;
      const yieldOnCost = (yearDividendPerShare * dividendsPerYear * endShares) / initialInvestment;

      results.push({
        year,
        startBalance,
        startShares,
        sharePrice: startSharePrice,
        dividendPerShare: yearDividendPerShare, // Use the stored value
        dividendYield: dividendYield * 100,
        yieldOnCost: yieldOnCost * 100,
        annualDividend,
        totalDividends: totalDividendsReceived,
        endShares,
        endBalance,
      });
    }

    setResults(results);
  };

  const clearAll = () => {
    const confirmed = window.confirm(
      "Are you sure you want to clear all data? This action cannot be undone."
    );
    if (confirmed) {
      setInputs(DEFAULT_INPUTS);
      setResults([]);
      setTicker("");
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value: number, decimals: number = 0) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  };

  return (
    <>
      <style>{`
        /* Hide default number input spinners */
        input[type="number"] {
          -moz-appearance: textfield;
        }
        
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          padding: "32px",
          maxWidth: "1400px",
          margin: "0 auto",
        }}
      >
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <h1
              style={{
                fontSize: "28px",
                fontWeight: "bold",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: 0,
              }}
            >
              <Calculator size={28} />
              Dividend Calculator
            </h1>
            <button
              onClick={clearAll}
              style={{
                padding: "8px 16px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--loss)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
              }}
              title="Clear all data"
            >
              <X size={16} />
              Clear
            </button>
          </div>
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              lineHeight: "1.6",
              marginBottom: "8px",
            }}
          >
            <strong>Calculate the Compound Growth and Income of Dividend Growth Stocks - the Dividend Snowball Effect.</strong>{" "}
            By reinvesting your dividends (DRIP), you can increase the number of shares you own. This will result in more shares earning dividends, continuously growing your portfolio.
          </p>
        </div>

        {/* Optional Stock/ETF Selection */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "24px",
          }}
        >
          <h3
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "12px",
            }}
          >
            Select a Stock or ETF (optional)
          </h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              placeholder="ENTER TICKER"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              style={{
                flex: 1,
                padding: "10px 12px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "14px",
              }}
            />
            <button
              style={{
                padding: "10px 20px",
                backgroundColor: "var(--accent)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                cursor: loadingTicker ? "not-allowed" : "pointer",
                fontSize: "14px",
                fontWeight: "500",
                opacity: loadingTicker ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onClick={async () => {
                if (!ticker.trim() || loadingTicker) return;
                
                setLoadingTicker(true);
                try {
                  const quote = await invoke<{
                    symbol: string;
                    current_price: number | null;
                    dividend_yield: number | null;
                    dividend_rate: number | null;
                    dividend_frequency: string | null;
                    trailing_annual_dividend_rate: number | null;
                    trailing_annual_dividend_yield: number | null;
                  }>("fetch_stock_quote", { symbol: ticker.trim() });
                  
                  // Populate fields with fetched data
                  if (quote.current_price) {
                    updateInput("sharePrice", quote.current_price.toFixed(2));
                  }
                  
                  // Calculate dividend amount from annual dividend rate
                  if (quote.trailing_annual_dividend_rate) {
                    // Most stocks pay quarterly, so divide by 4
                    const quarterlyDividend = quote.trailing_annual_dividend_rate / 4;
                    updateInput("dividendAmount", quarterlyDividend.toFixed(2));
                    updateInput("dividendFrequency", "Quarterly");
                  } else if (quote.dividend_rate) {
                    const quarterlyDividend = quote.dividend_rate / 4;
                    updateInput("dividendAmount", quarterlyDividend.toFixed(2));
                    updateInput("dividendFrequency", "Quarterly");
                  }
                  
                  // Set dividend frequency if available
                  if (quote.dividend_frequency) {
                    const freq = quote.dividend_frequency.charAt(0).toUpperCase() + quote.dividend_frequency.slice(1).toLowerCase();
                    if (["Monthly", "Quarterly", "Semi-Annual", "Annual"].includes(freq)) {
                      updateInput("dividendFrequency", freq as any);
                    }
                  }
                  
                  // Estimate dividend growth rate (Yahoo Finance doesn't provide this, so we'll use a default)
                  // User can adjust this manually
                  if (!inputs.dividendGrowthRate || inputs.dividendGrowthRate === "0") {
                    updateInput("dividendGrowthRate", "4"); // Default 4% growth
                  }
                  
                  // Estimate share price growth (default 5% if not set)
                  if (!inputs.sharePriceGrowth || inputs.sharePriceGrowth === "0") {
                    updateInput("sharePriceGrowth", "5"); // Default 5% growth
                  }
                  
                } catch (error) {
                  alert(`Failed to load stock data: ${error}\n\nPlease check the ticker symbol and try again.`);
                } finally {
                  setLoadingTicker(false);
                }
              }}
              disabled={loadingTicker || !ticker.trim()}
            >
              {loadingTicker ? (
                <>
                  <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
                  Loading...
                </>
              ) : (
                "Load"
              )}
            </button>
          </div>
        </div>

        {/* Input Parameters */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h3
            style={{
              fontSize: "18px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "20px",
            }}
          >
            Investment Parameters
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "20px",
            }}
          >
            {/* Initial Investment */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Initial Investment
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "12px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                    zIndex: 1,
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.initialInvestment}
                  onChange={(e) => updateInput("initialInvestment", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 28px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("initialInvestment", 100)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("initialInvestment", 100)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Share Price */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Share Price
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "12px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                    zIndex: 1,
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.sharePrice}
                  onChange={(e) => updateInput("sharePrice", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 28px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("sharePrice", 1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("sharePrice", 1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Dividend Amount */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Dividend Amount
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "12px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                    zIndex: 1,
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.dividendAmount}
                  onChange={(e) => updateInput("dividendAmount", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 28px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("dividendAmount", 0.01)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("dividendAmount", 0.01)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Dividend Frequency */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Dividend Frequency
              </label>
              <select
                value={inputs.dividendFrequency}
                onChange={(e) => updateInput("dividendFrequency", e.target.value as any)}
                style={{
                  padding: "10px 12px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi-Annual">Semi-Annual</option>
                <option value="Annual">Annual</option>
              </select>
            </div>

            {/* Dividend Growth Rate */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Dividend Growth Rate
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={inputs.dividendGrowthRate}
                  onChange={(e) => updateInput("dividendGrowthRate", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 12px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    right: "36px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  %
                </span>
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("dividendGrowthRate", 0.1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("dividendGrowthRate", 0.1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Share Price Growth */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Share Price Growth
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={inputs.sharePriceGrowth}
                  onChange={(e) => updateInput("sharePriceGrowth", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 12px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    right: "36px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  %
                </span>
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("sharePriceGrowth", 0.1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("sharePriceGrowth", 0.1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Extra Investment */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Extra Investment
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    position: "absolute",
                    left: "12px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                    zIndex: 1,
                  }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inputs.extraInvestment}
                  onChange={(e) => updateInput("extraInvestment", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 28px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("extraInvestment", 10)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("extraInvestment", 10)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Extra Invest Frequency */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Extra Invest Frequency
              </label>
              <select
                value={inputs.extraInvestFrequency}
                onChange={(e) => updateInput("extraInvestFrequency", e.target.value as any)}
                style={{
                  padding: "10px 12px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                <option value="None">None</option>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi-Annual">Semi-Annual</option>
                <option value="Annual">Annual</option>
              </select>
            </div>

            {/* Length of Investment */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginBottom: "8px",
                }}
              >
                Length of Investment
              </label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="50"
                  value={inputs.lengthOfInvestment}
                  onChange={(e) => updateInput("lengthOfInvestment", e.target.value)}
                  style={{
                    padding: "10px 36px 10px 12px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    width: "100%",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    right: "36px",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  yrs.
                </span>
                <div
                  style={{
                    position: "absolute",
                    right: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => incrementValue("lengthOfInvestment", 1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => decrementValue("lengthOfInvestment", 1)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* DRIP Toggle */}
            <div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  marginTop: "32px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={inputs.enableDRIP}
                  onChange={(e) => updateInput("enableDRIP", e.target.checked)}
                  style={{
                    width: "18px",
                    height: "18px",
                    cursor: "pointer",
                    accentColor: "var(--accent)",
                  }}
                />
                <span>Enable DRIP (Dividend Reinvestment Plan)</span>
              </label>
            </div>
          </div>

          <button
            onClick={calculateDividends}
            style={{
              width: "100%",
              padding: "14px",
              backgroundColor: "var(--accent)",
              border: "none",
              borderRadius: "6px",
              color: "white",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "600",
              marginTop: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <Calculator size={18} />
            CALCULATE
          </button>
        </div>

        {/* Chart */}
        {results.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                }}
              >
                Total Dividends
              </h3>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setChartType("line")}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: chartType === "line" ? "var(--accent)" : "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: chartType === "line" ? "white" : "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <TrendingUp size={16} />
                  Line
                </button>
                <button
                  onClick={() => setChartType("bar")}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: chartType === "bar" ? "var(--accent)" : "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: chartType === "bar" ? "white" : "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <BarChart3 size={16} />
                  Bar
                </button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              {chartType === "line" ? (
                <LineChart data={results}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis
                    dataKey="year"
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    label={{ value: "Year", position: "insideBottom", offset: -5, fill: "var(--text-secondary)" }}
                  />
                  <YAxis
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                    label={{ value: "Total Dividends", angle: -90, position: "insideLeft", fill: "var(--text-secondary)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value: any) => [formatCurrency(value), "Total Dividends"]}
                    labelFormatter={(label) => `Year ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalDividends"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ fill: "var(--accent)", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              ) : (
                <BarChart data={results}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis
                    dataKey="year"
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    label={{ value: "Year", position: "insideBottom", offset: -5, fill: "var(--text-secondary)" }}
                  />
                  <YAxis
                    stroke="var(--text-secondary)"
                    tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                    label={{ value: "Total Dividends", angle: -90, position: "insideLeft", fill: "var(--text-secondary)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value: any) => [formatCurrency(value), "Total Dividends"]}
                    labelFormatter={(label) => `Year ${label}`}
                  />
                  <Bar dataKey="totalDividends" fill="var(--accent)" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              overflowX: "auto",
            }}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color: "var(--text-primary)",
                marginBottom: "20px",
              }}
            >
              Results by year: Dividends, Yield, Number of Shares, and Portfolio Value
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "14px",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border-color)" }}>
                    <th style={{ padding: "12px", textAlign: "left", color: "var(--text-primary)", fontWeight: "600" }}>
                      Year
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Start Balance
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Start Shares
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Share Price
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Dividend / Share
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Dividend Yield
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Yield on Cost
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Annual Dividend
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      Total Dividends
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      End Shares
                    </th>
                    <th style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)", fontWeight: "600" }}>
                      End Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr
                      key={result.year}
                      style={{
                        borderBottom: "1px solid var(--border-color)",
                        backgroundColor: index % 2 === 0 ? "transparent" : "var(--bg-tertiary)",
                      }}
                    >
                      <td style={{ padding: "12px", color: "var(--text-primary)", fontWeight: "500" }}>
                        {result.year}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatCurrency(result.startBalance)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatNumber(result.startShares, 2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatCurrency(result.sharePrice)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatCurrency(result.dividendPerShare)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatNumber(result.dividendYield, 2)}%
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatNumber(result.yieldOnCost, 2)}%
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatCurrency(result.annualDividend)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--accent)", fontWeight: "600" }}>
                        {formatCurrency(result.totalDividends)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--text-primary)" }}>
                        {formatNumber(result.endShares, 2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", color: "var(--profit)", fontWeight: "600" }}>
                        {formatCurrency(result.endBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

