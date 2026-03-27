import { useState, useEffect, useCallback, useContext } from "react";
import { CurrentPriceSyncContext } from "../contexts/CurrentPriceSyncContext";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { 
  RefreshCw, 
  ExternalLink, 
  Clock, 
  ChevronRight,
  Newspaper,
  AlertCircle,
  Settings,
  Check,
  X,
  Search,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";

interface NewsItem {
  id: string;
  symbol: string;
  title: string;
  link: string;
  pub_date: string;
  source: string;
}

interface NewsItemWithMeta extends NewsItem {
  sentiment: "positive" | "negative" | "neutral";
}

interface OpenPositionGroup {
  entry_trade: { 
    id: number; 
    symbol: string;
  };
  final_quantity: number;
}

interface NewsWidgetProps {
  maxItems?: number;
  showRefresh?: boolean;
  compact?: boolean;
  externalSearchQuery?: string;
  externalIncludePositions?: boolean;
  externalShowSentiment?: boolean;
  onSearchQueryChange?: (query: string) => void;
  onIncludePositionsChange?: (value: boolean) => void;
  onShowSentimentChange?: (value: boolean) => void;
  hideInternalSettings?: boolean;
  showSearchInHeader?: boolean;
  /** When true, compact mode omits the built-in "News" label (e.g. section card already has a title). */
  hideCompactTitle?: boolean;
}

const NEWS_WATCHED_SYMBOLS_KEY = "tradebutler_news_watched_symbols";
const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";
const NEWS_SHOW_SENTIMENT_KEY = "tradebutler_news_show_sentiment";

const POSITIVE_KEYWORDS = [
  "surge", "soar", "jump", "gain", "rise", "rally", "climb", "beat", "exceed",
  "profit", "bullish", "upgrade", "record", "high", "growth", "positive",
  "strong", "boost", "breakthrough", "success", "win", "outperform", "buy"
];
const NEGATIVE_KEYWORDS = [
  "fall", "drop", "plunge", "crash", "decline", "loss", "miss", "cut", "layoff",
  "bearish", "downgrade", "low", "weak", "negative", "concern", "risk", "warning",
  "sell", "underperform", "fail", "struggle", "lawsuit", "investigation"
];

let newsSessionCache: {
  key: string;
  /** Watched symbols + settings only (instant first paint when unchanged). */
  syncKey: string;
  news: NewsItemWithMeta[];
  lastRefresh: Date | null;
} | null = null;

function buildNewsSyncKey(dataMode: DataMode, includePositions: boolean, maxItems: number): string {
  const savedSymbols = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
  const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
  return JSON.stringify({
    dataMode,
    includePositions,
    maxItems,
    watched: [...watchedSymbols].sort().join(","),
  });
}

function analyzeNewsSentiment(title: string): "positive" | "negative" | "neutral" {
  const lowerTitle = title.toLowerCase();
  let positiveScore = 0;
  let negativeScore = 0;
  POSITIVE_KEYWORDS.forEach((keyword) => {
    if (lowerTitle.includes(keyword)) positiveScore++;
  });
  NEGATIVE_KEYWORDS.forEach((keyword) => {
    if (lowerTitle.includes(keyword)) negativeScore++;
  });
  if (positiveScore > negativeScore) return "positive";
  if (negativeScore > positiveScore) return "negative";
  return "neutral";
}

export default function NewsWidget({ 
  maxItems = 5, 
  showRefresh = true, 
  compact = false,
  externalSearchQuery,
  externalIncludePositions,
  externalShowSentiment,
  onSearchQueryChange,
  onIncludePositionsChange,
  onShowSentimentChange,
  hideInternalSettings = false,
  showSearchInHeader = false,
  hideCompactTitle = false,
}: NewsWidgetProps) {
  const navigate = useNavigate();
  const priceSync = useContext(CurrentPriceSyncContext);
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  // Settings state - use external values if provided (must be before cached news init)
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalIncludePositions, setInternalIncludePositions] = useState(() => {
    const saved = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const includePositions = externalIncludePositions !== undefined ? externalIncludePositions : internalIncludePositions;

  const [news, setNews] = useState<NewsItemWithMeta[]>(() => {
    const dm = getCurrentDataMode();
    const sk = buildNewsSyncKey(dm, includePositions, maxItems);
    if (newsSessionCache && newsSessionCache.syncKey === sk) return newsSessionCache.news;
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(() => {
    const dm = getCurrentDataMode();
    const sk = buildNewsSyncKey(dm, includePositions, maxItems);
    if (newsSessionCache && newsSessionCache.syncKey === sk) return newsSessionCache.lastRefresh;
    return null;
  });
  const [error, setError] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [internalShowSentiment, setInternalShowSentiment] = useState(() => {
    const saved = localStorage.getItem(NEWS_SHOW_SENTIMENT_KEY);
    return saved ? JSON.parse(saved) : true;
  });

  // Use external or internal values
  const searchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
  const showSentiment = externalShowSentiment !== undefined ? externalShowSentiment : internalShowSentiment;

  // Setters that call external handlers if provided
  const setSearchQuery = (value: string) => {
    if (onSearchQueryChange) onSearchQueryChange(value);
    else setInternalSearchQuery(value);
  };
  const setIncludePositions = (value: boolean) => {
    if (onIncludePositionsChange) onIncludePositionsChange(value);
    else setInternalIncludePositions(value);
  };
  const setShowSentiment = (value: boolean) => {
    if (onShowSentimentChange) onShowSentimentChange(value);
    else setInternalShowSentiment(value);
  };

  useEffect(() => {
    return subscribeToDataMode(setDataMode);
  }, []);

  const getSentimentColor = (sentiment: "positive" | "negative" | "neutral") => {
    switch (sentiment) {
      case "positive": return "#10B981";
      case "negative": return "#EF4444";
      default: return "var(--text-secondary)";
    }
  };

  const buildNewsFetchContext = useCallback(async (): Promise<{ key: string; allSymbols: string[] }> => {
    const savedSymbols = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
    const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
    let openPositionSymbols: string[] = [];
    if (includePositions && dataMode !== "sandbox") {
      try {
        const paperOnly = dataMode === "paper";
        const groups = await invoke<OpenPositionGroup[]>("get_position_groups", {
          pairingMethod: "fifo",
          startDate: null,
          endDate: null,
          paperOnly,
          includePaper: !paperOnly,
        });
        openPositionSymbols = groups
          .filter((g) => g.final_quantity !== 0)
          .map((g) => g.entry_trade.symbol.toUpperCase());
      } catch (e) {
        console.error("Failed to fetch open positions:", e);
      }
    }
    const allSymbols = [...new Set([...watchedSymbols, ...openPositionSymbols])];
    const key = JSON.stringify({
      dataMode,
      includePositions,
      maxItems,
      symbols: [...allSymbols].sort().join(","),
    });
    return { key, allSymbols };
  }, [dataMode, includePositions, maxItems]);

  const fetchNews = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      const force = opts?.force ?? false;
      const silent = opts?.silent ?? false;
      const { key, allSymbols } = await buildNewsFetchContext();
      const cached = newsSessionCache;
      const cacheHit = !force && cached?.key === key;

      if (cacheHit && cached) {
        setNews(cached.news);
        setLastRefresh(cached.lastRefresh);
      }

      if (allSymbols.length === 0) {
        const syncKey = buildNewsSyncKey(dataMode, includePositions, maxItems);
        const now = new Date();
        setNews([]);
        setLastRefresh(now);
        setError(null);
        newsSessionCache = { key, syncKey, news: [], lastRefresh: now };
        setIsLoading(false);
        return;
      }

      const shouldShowLoading = !silent && (!cacheHit || force);
      if (shouldShowLoading) setIsLoading(true);
      setError(null);

      try {
        const newsData = await invoke<NewsItem[]>("fetch_news_batch", { symbols: allSymbols });
        const newsWithMeta: NewsItemWithMeta[] = newsData.map((item) => ({
          ...item,
          sentiment: analyzeNewsSentiment(item.title),
        }));
        const sliced = newsWithMeta.slice(0, maxItems * 2);
        const syncKey = buildNewsSyncKey(dataMode, includePositions, maxItems);
        setNews(sliced);
        const now = new Date();
        setLastRefresh(now);
        newsSessionCache = { key, syncKey, news: sliced, lastRefresh: now };
      } catch (e) {
        console.error("Failed to fetch news:", e);
        setError(typeof e === "string" ? e : "Failed to fetch news");
      } finally {
        setIsLoading(false);
      }
    },
    [buildNewsFetchContext, dataMode, includePositions, maxItems]
  );

  // Save settings to localStorage only when using internal state
  useEffect(() => {
    if (externalIncludePositions === undefined) {
      localStorage.setItem(NEWS_INCLUDE_POSITIONS_KEY, JSON.stringify(internalIncludePositions));
    }
  }, [internalIncludePositions, externalIncludePositions]);

  useEffect(() => {
    if (externalShowSentiment === undefined) {
      localStorage.setItem(NEWS_SHOW_SENTIMENT_KEY, JSON.stringify(internalShowSentiment));
    }
  }, [internalShowSentiment, externalShowSentiment]);

  // Filter news by search query
  const filteredNews = news
    .filter(item => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(query) ||
        item.symbol.toLowerCase().includes(query)
      );
    })
    .slice(0, maxItems);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // Listen for keyboard shortcut refresh event
  useEffect(() => {
    const handleRefresh = () => {
      void fetchNews({ force: true });
    };
    window.addEventListener("tradeButlerRefreshNews", handleRefresh);
    return () => window.removeEventListener("tradeButlerRefreshNews", handleRefresh);
  }, [fetchNews]);

  useEffect(() => {
    if (!priceSync?.enabled) return;
    if (priceSync.tick === 0) return;
    void fetchNews({ silent: true });
  }, [priceSync?.enabled, priceSync?.tick, fetchNews]);

  const formatRelativeTime = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  if (compact) {
    return (
      <div
        style={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* Compact header — fixed; list scrolls below */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
            flexShrink: 0,
          }}
        >
          {!hideCompactTitle && (
            <span
              style={{
                fontSize: "14px",
                fontWeight: "600",
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                flexShrink: 0,
              }}
            >
              <Newspaper size={16} />
              News
            </span>
          )}
          {showSearchInHeader && (
            <div style={{ flex: 1, maxWidth: "200px", margin: "0 12px" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search news..."
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
            {!hideInternalSettings && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: showSettings ? "var(--accent)" : "var(--text-secondary)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Settings"
              >
                <Settings size={14} />
              </button>
            )}
            {showRefresh && (
              <button
                onClick={(e) => { e.stopPropagation(); void fetchNews({ force: true }); }}
                disabled={isLoading}
                style={{
                  background: "none",
                  border: "none",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  color: "var(--text-secondary)",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Refresh news"
              >
                <RefreshCw size={14} className={isLoading ? "spin" : ""} />
              </button>
            )}
            <button
              onClick={() => navigate("/news")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--accent)",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
              }}
            >
              View all
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && !hideInternalSettings && (
          <div style={{
            padding: "12px",
            marginBottom: "12px",
            backgroundColor: "var(--bg-primary)",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
          }}>
            {/* Search */}
            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search 
                size={14} 
                style={{ 
                  position: "absolute", 
                  left: "10px", 
                  top: "50%", 
                  transform: "translateY(-50%)",
                  color: "var(--text-secondary)"
                }} 
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search news..."
                style={{
                  width: "100%",
                  padding: "8px 30px 8px 32px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-secondary)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Toggles */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontSize: "12px",
                color: "var(--text-primary)",
              }}>
                <div style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "3px",
                  border: `2px solid ${includePositions ? "var(--accent)" : "var(--border-color)"}`,
                  backgroundColor: includePositions ? "var(--accent)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {includePositions && <Check size={10} color="var(--bg-primary)" />}
                </div>
                <input
                  type="checkbox"
                  checked={includePositions}
                  onChange={(e) => setIncludePositions(e.target.checked)}
                  style={{ display: "none" }}
                />
                Include open positions
              </label>

              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                fontSize: "12px",
                color: "var(--text-primary)",
              }}>
                <div style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "3px",
                  border: `2px solid ${showSentiment ? "var(--accent)" : "var(--border-color)"}`,
                  backgroundColor: showSentiment ? "var(--accent)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {showSentiment && <Check size={10} color="var(--bg-primary)" />}
                </div>
                <input
                  type="checkbox"
                  checked={showSentiment}
                  onChange={(e) => setShowSentiment(e.target.checked)}
                  style={{ display: "none" }}
                />
                Show sentiment
              </label>
            </div>
          </div>
        )}

        {/* Compact news list — scroll inside fixed dashboard card height */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {error && (
            <div style={{
              padding: "8px",
              borderRadius: "6px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "#EF4444",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}>
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {filteredNews.length === 0 && !isLoading && !error && (
            <div style={{
              padding: "16px",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}>
              {searchQuery ? "No matching news" : "No news available"}
            </div>
          )}

          {filteredNews.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                padding: "10px 12px",
                backgroundColor: "var(--bg-primary)",
                borderRadius: "8px",
                textDecoration: "none",
                border: "1px solid var(--border-color)",
                borderLeft: showSentiment ? `3px solid ${getSentimentColor(item.sentiment)}` : undefined,
                transition: "border-color 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-color)";
              }}
            >
              <div style={{ 
                display: "flex", 
                alignItems: "center", 
                gap: "6px", 
                marginBottom: "4px" 
              }}>
                <span style={{
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "var(--accent)",
                  color: "var(--bg-primary)",
                  fontSize: "10px",
                  fontWeight: "600",
                }}>
                  {item.symbol}
                </span>
                {showSentiment && item.sentiment !== "neutral" && (
                  <span style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "3px 6px",
                    borderRadius: "4px",
                    backgroundColor: item.sentiment === "positive" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: getSentimentColor(item.sentiment),
                  }}>
                    {item.sentiment === "positive" ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  </span>
                )}
                <span style={{ 
                  color: "var(--text-secondary)", 
                  fontSize: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "3px"
                }}>
                  <Clock size={10} />
                  {formatRelativeTime(item.pub_date)}
                </span>
              </div>
              <p style={{ 
                fontSize: "13px", 
                color: "var(--text-primary)",
                margin: 0,
                lineHeight: "1.3",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}>
                {item.title}
              </p>
            </a>
          ))}
        </div>

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

  // Full widget view
  return (
    <div style={{
      backgroundColor: "var(--bg-secondary)",
      borderRadius: "12px",
      border: "1px solid var(--border-color)",
      overflow: "hidden",
      height: "100%",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--border-color)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <h3 style={{ 
          fontSize: "16px", 
          fontWeight: "600", 
          color: "var(--text-primary)",
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          <Newspaper size={18} />
          Latest News
        </h3>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!hideInternalSettings && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: showSettings ? "var(--accent)" : "var(--text-secondary)",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
              title="Settings"
            >
              <Settings size={16} />
            </button>
          )}
          {showRefresh && (
            <button
              onClick={(e) => { e.stopPropagation(); void fetchNews({ force: true }); }}
              disabled={isLoading}
              style={{
                background: "none",
                border: "none",
                cursor: isLoading ? "not-allowed" : "pointer",
                color: "var(--text-secondary)",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
              title="Refresh news"
            >
              <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            </button>
          )}
          <button
            onClick={() => navigate("/news")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--accent)",
              padding: "4px 8px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
            }}
          >
            View all
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && !hideInternalSettings && (
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-primary)",
        }}>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: "12px" }}>
            <Search 
              size={16} 
              style={{ 
                position: "absolute", 
                left: "12px", 
                top: "50%", 
                transform: "translateY(-50%)",
                color: "var(--text-secondary)"
              }} 
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search news headlines..."
              style={{
                width: "100%",
                padding: "10px 36px 10px 38px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: "13px",
                boxSizing: "border-box",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  padding: "4px",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Toggles */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              fontSize: "13px",
              color: "var(--text-primary)",
            }}>
              <div style={{
                width: "18px",
                height: "18px",
                borderRadius: "4px",
                border: `2px solid ${includePositions ? "var(--accent)" : "var(--border-color)"}`,
                backgroundColor: includePositions ? "var(--accent)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {includePositions && <Check size={12} color="var(--bg-primary)" />}
              </div>
              <input
                type="checkbox"
                checked={includePositions}
                onChange={(e) => setIncludePositions(e.target.checked)}
                style={{ display: "none" }}
              />
              Include open positions
            </label>

            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              fontSize: "13px",
              color: "var(--text-primary)",
            }}>
              <div style={{
                width: "18px",
                height: "18px",
                borderRadius: "4px",
                border: `2px solid ${showSentiment ? "var(--accent)" : "var(--border-color)"}`,
                backgroundColor: showSentiment ? "var(--accent)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {showSentiment && <Check size={12} color="var(--bg-primary)" />}
              </div>
              <input
                type="checkbox"
                checked={showSentiment}
                onChange={(e) => setShowSentiment(e.target.checked)}
                style={{ display: "none" }}
              />
              Show sentiment indicators
            </label>
          </div>
        </div>
      )}

      {/* News list */}
      <div style={{ 
        padding: "16px 20px",
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}>
        {error && (
          <div style={{
            padding: "12px",
            borderRadius: "8px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#EF4444",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {filteredNews.length === 0 && !isLoading && !error && (
          <div style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--text-secondary)",
          }}>
            <Newspaper size={32} style={{ marginBottom: "12px", opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: "14px" }}>
              {searchQuery ? "No matching news" : "No news available"}
            </p>
            <p style={{ margin: "8px 0 0 0", fontSize: "12px" }}>
              {searchQuery ? "Try a different search" : "Add symbols in the News tab"}
            </p>
          </div>
        )}

        {filteredNews.map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              padding: "14px 16px",
              backgroundColor: "var(--bg-primary)",
              borderRadius: "10px",
              textDecoration: "none",
              border: "1px solid var(--border-color)",
              borderLeft: showSentiment ? `4px solid ${getSentimentColor(item.sentiment)}` : undefined,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-color)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "12px"
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "8px", 
                  marginBottom: "6px" 
                }}>
                  <span style={{
                    padding: "3px 8px",
                    borderRadius: "4px",
                    backgroundColor: "var(--accent)",
                    color: "var(--bg-primary)",
                    fontSize: "11px",
                    fontWeight: "600",
                  }}>
                    {item.symbol}
                  </span>
                  {showSentiment && item.sentiment !== "neutral" && (
                    <span style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      backgroundColor: item.sentiment === "positive" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                      color: getSentimentColor(item.sentiment),
                      fontSize: "12px",
                      fontWeight: "600",
                      textTransform: "capitalize",
                    }}>
                      {item.sentiment === "positive" ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                      {item.sentiment}
                    </span>
                  )}
                  <span style={{ 
                    color: "var(--text-secondary)", 
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}>
                    <Clock size={11} />
                    {formatRelativeTime(item.pub_date)}
                  </span>
                </div>
                <p style={{ 
                  fontSize: "14px", 
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: "1.4",
                }}>
                  {item.title}
                </p>
                <p style={{ 
                  fontSize: "11px", 
                  color: "var(--text-secondary)", 
                  margin: "6px 0 0 0" 
                }}>
                  {item.source}
                </p>
              </div>
              <ExternalLink size={14} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: "2px" }} />
            </div>
          </a>
        ))}
      </div>

      {lastRefresh && (
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid var(--border-color)",
          fontSize: "11px",
          color: "var(--text-secondary)",
        }}>
          Last updated {formatRelativeTime(lastRefresh.toISOString())}
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
