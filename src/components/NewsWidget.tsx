import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { 
  RefreshCw, 
  ExternalLink, 
  Clock, 
  ChevronRight,
  Newspaper,
  AlertCircle
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
}

const NEWS_WATCHED_SYMBOLS_KEY = "tradebutler_news_watched_symbols";
const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";

export default function NewsWidget({ maxItems = 5, showRefresh = true, compact = false }: NewsWidgetProps) {
  const navigate = useNavigate();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [news, setNews] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToDataMode(setDataMode);
  }, []);

  const fetchNews = useCallback(async () => {
    // Get watched symbols from localStorage
    const savedSymbols = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
    const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
    
    const savedIncludePositions = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
    const includePositions = savedIncludePositions ? JSON.parse(savedIncludePositions) : true;

    let openPositionSymbols: string[] = [];
    
    // Get open position symbols if enabled
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
          .filter(g => g.final_quantity !== 0)
          .map(g => g.entry_trade.symbol.toUpperCase());
      } catch (e) {
        console.error("Failed to fetch open positions:", e);
      }
    }

    // Combine symbols
    const allSymbols = [...new Set([...watchedSymbols, ...openPositionSymbols])];
    
    if (allSymbols.length === 0) {
      setNews([]);
      setLastRefresh(new Date());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newsData = await invoke<NewsItem[]>("fetch_news_batch", { symbols: allSymbols });
      setNews(newsData.slice(0, maxItems));
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch news:", e);
      setError(typeof e === "string" ? e : "Failed to fetch news");
    } finally {
      setIsLoading(false);
    }
  }, [dataMode, maxItems]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

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
      <div style={{ height: "100%" }}>
        {/* Compact header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}>
          <span style={{ 
            fontSize: "14px", 
            fontWeight: "600", 
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            gap: "6px"
          }}>
            <Newspaper size={16} />
            News
          </span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {showRefresh && (
              <button
                onClick={(e) => { e.stopPropagation(); fetchNews(); }}
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

        {/* Compact news list */}
        <div style={{ 
          display: "flex", 
          flexDirection: "column", 
          gap: "8px",
          overflowY: "auto",
          maxHeight: "calc(100% - 40px)",
        }}>
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

          {news.length === 0 && !isLoading && !error && (
            <div style={{
              padding: "16px",
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}>
              No news available
            </div>
          )}

          {news.map((item) => (
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
          {showRefresh && (
            <button
              onClick={(e) => { e.stopPropagation(); fetchNews(); }}
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

        {news.length === 0 && !isLoading && !error && (
          <div style={{
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--text-secondary)",
          }}>
            <Newspaper size={32} style={{ marginBottom: "12px", opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: "14px" }}>
              No news available
            </p>
            <p style={{ margin: "8px 0 0 0", fontSize: "12px" }}>
              Add symbols in the News tab
            </p>
          </div>
        )}

        {news.map((item) => (
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
