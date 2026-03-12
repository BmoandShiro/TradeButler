import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { 
  RefreshCw, 
  ExternalLink, 
  Clock, 
  Filter,
  X,
  Plus,
  Check,
  ChevronDown,
  Calendar,
  AlertCircle,
  Newspaper
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

interface CalendarEvent {
  date: string;
  symbol: string | null;
  event_type: string;
  title: string;
  details: string | null;
}

interface OpenPositionGroup {
  entry_trade: { 
    id: number; 
    symbol: string; 
    side: string; 
    quantity: number; 
    price: number; 
    timestamp: string;
  };
  final_quantity: number;
}

const NEWS_WATCHED_SYMBOLS_KEY = "tradebutler_news_watched_symbols";
const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";
const NEWS_AUTO_REFRESH_KEY = "tradebutler_news_auto_refresh";

export default function News() {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => {
    const saved = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [includeOpenPositions, setIncludeOpenPositions] = useState(() => {
    const saved = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [openPositionSymbols, setOpenPositionSymbols] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSymbolInput, setNewSymbolInput] = useState("");
  const [filterSymbol, setFilterSymbol] = useState<string | null>(null);
  const [showCalendarEvents, setShowCalendarEvents] = useState(true);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(() => {
    const saved = localStorage.getItem(NEWS_AUTO_REFRESH_KEY);
    return saved ? parseInt(saved, 10) : 0;
  });

  // Subscribe to data mode changes
  useEffect(() => {
    return subscribeToDataMode(setDataMode);
  }, []);

  // Get all symbols to use for news
  const getAllSymbols = useCallback(() => {
    const symbols = new Set<string>();
    watchedSymbols.forEach(s => symbols.add(s.toUpperCase()));
    if (includeOpenPositions) {
      openPositionSymbols.forEach(s => symbols.add(s.toUpperCase()));
    }
    return Array.from(symbols);
  }, [watchedSymbols, includeOpenPositions, openPositionSymbols]);

  // Fetch open positions to get symbols
  useEffect(() => {
    const fetchOpenPositions = async () => {
      if (dataMode === "sandbox") {
        setOpenPositionSymbols([]);
        return;
      }
      try {
        const paperOnly = dataMode === "paper";
        const groups = await invoke<OpenPositionGroup[]>("get_position_groups", {
          pairingMethod: "fifo",
          startDate: null,
          endDate: null,
          paperOnly,
          includePaper: !paperOnly,
        });
        const symbols = groups
          .filter(g => g.final_quantity !== 0)
          .map(g => g.entry_trade.symbol.toUpperCase());
        setOpenPositionSymbols([...new Set(symbols)]);
      } catch (e) {
        console.error("Failed to fetch open positions:", e);
      }
    };
    fetchOpenPositions();
  }, [dataMode]);

  // Fetch news for all symbols
  const fetchNews = useCallback(async () => {
    const symbols = getAllSymbols();
    if (symbols.length === 0) {
      setNews([]);
      setCalendarEvents([]);
      setLastRefresh(new Date());
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [newsData, eventsData] = await Promise.all([
        invoke<NewsItem[]>("fetch_news_batch", { symbols }),
        invoke<CalendarEvent[]>("fetch_calendar_events_batch", { symbols }),
      ]);
      setNews(newsData);
      setCalendarEvents(eventsData);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch news:", e);
      setError(typeof e === "string" ? e : "Failed to fetch news");
    } finally {
      setIsLoading(false);
    }
  }, [getAllSymbols]);

  // Initial fetch and when symbols change
  useEffect(() => {
    fetchNews();
  }, [watchedSymbols, includeOpenPositions, openPositionSymbols]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshMinutes === 0) return;
    const intervalMs = autoRefreshMinutes * 60 * 1000;
    const intervalId = setInterval(fetchNews, intervalMs);
    return () => clearInterval(intervalId);
  }, [autoRefreshMinutes, fetchNews]);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem(NEWS_WATCHED_SYMBOLS_KEY, JSON.stringify(watchedSymbols));
  }, [watchedSymbols]);

  useEffect(() => {
    localStorage.setItem(NEWS_INCLUDE_POSITIONS_KEY, JSON.stringify(includeOpenPositions));
  }, [includeOpenPositions]);

  useEffect(() => {
    localStorage.setItem(NEWS_AUTO_REFRESH_KEY, autoRefreshMinutes.toString());
  }, [autoRefreshMinutes]);

  // Add a new symbol to watchlist
  const addSymbol = () => {
    const symbol = newSymbolInput.trim().toUpperCase();
    if (symbol && !watchedSymbols.includes(symbol)) {
      setWatchedSymbols([...watchedSymbols, symbol]);
      setNewSymbolInput("");
    }
  };

  // Remove a symbol from watchlist
  const removeSymbol = (symbol: string) => {
    setWatchedSymbols(watchedSymbols.filter(s => s !== symbol));
  };

  // Filter news by symbol
  const filteredNews = filterSymbol
    ? news.filter(item => item.symbol === filterSymbol)
    : news;

  // Get unique symbols from current news
  const newsSymbols = [...new Set(news.map(item => item.symbol))];

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  // Get event type color
  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case "earnings":
        return "var(--accent)";
      case "dividend_ex":
        return "#10B981";
      case "dividend_pay":
        return "#34D399";
      case "split":
        return "#F59E0B";
      default:
        return "var(--text-secondary)";
    }
  };

  // Get event type label
  const getEventTypeLabel = (eventType: string) => {
    switch (eventType) {
      case "earnings":
        return "Earnings";
      case "dividend_ex":
        return "Ex-Dividend";
      case "dividend_pay":
        return "Div Pay Date";
      case "split":
        return "Stock Split";
      default:
        return eventType;
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        marginBottom: "24px",
        flexWrap: "wrap",
        gap: "16px"
      }}>
        <div>
          <h1 style={{ 
            fontSize: "24px", 
            fontWeight: "600", 
            color: "var(--text-primary)",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "12px"
          }}>
            <Newspaper size={28} />
            News & Events
          </h1>
          <p style={{ 
            color: "var(--text-secondary)", 
            margin: "4px 0 0 0",
            fontSize: "14px"
          }}>
            {lastRefresh && `Last updated ${formatRelativeTime(lastRefresh.toISOString())}`}
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {/* Auto-refresh dropdown */}
          <div style={{ position: "relative" }}>
            <select
              value={autoRefreshMinutes}
              onChange={(e) => setAutoRefreshMinutes(parseInt(e.target.value, 10))}
              style={{
                padding: "8px 12px",
                paddingRight: "32px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: "14px",
                cursor: "pointer",
                appearance: "none",
              }}
            >
              <option value={0}>Manual refresh</option>
              <option value={5}>Auto: 5 min</option>
              <option value={15}>Auto: 15 min</option>
              <option value={30}>Auto: 30 min</option>
              <option value={60}>Auto: 1 hour</option>
            </select>
            <ChevronDown 
              size={16} 
              style={{ 
                position: "absolute", 
                right: "10px", 
                top: "50%", 
                transform: "translateY(-50%)",
                pointerEvents: "none",
                color: "var(--text-secondary)"
              }} 
            />
          </div>

          {/* Refresh button */}
          <button
            onClick={fetchNews}
            disabled={isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "var(--accent)",
              color: "var(--bg-primary)",
              fontSize: "14px",
              fontWeight: "500",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Symbol Management */}
      <div style={{
        backgroundColor: "var(--bg-secondary)",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "24px",
        border: "1px solid var(--border-color)",
      }}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px"
        }}>
          {/* Add symbol input */}
          <div style={{ flex: "1", minWidth: "250px" }}>
            <label style={{ 
              display: "block", 
              marginBottom: "8px", 
              fontSize: "14px", 
              fontWeight: "500",
              color: "var(--text-primary)"
            }}>
              Watch Symbols
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={newSymbolInput}
                onChange={(e) => setNewSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && addSymbol()}
                placeholder="Enter symbol (e.g., AAPL)"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                }}
              />
              <button
                onClick={addSymbol}
                disabled={!newSymbolInput.trim()}
                style={{
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: newSymbolInput.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                  color: newSymbolInput.trim() ? "var(--bg-primary)" : "var(--text-secondary)",
                  cursor: newSymbolInput.trim() ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Plus size={16} />
                Add
              </button>
            </div>

            {/* Watched symbols tags */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
              {watchedSymbols.map(symbol => (
                <span
                  key={symbol}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    backgroundColor: "var(--accent)",
                    color: "var(--bg-primary)",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                >
                  {symbol}
                  <X
                    size={14}
                    style={{ cursor: "pointer" }}
                    onClick={() => removeSymbol(symbol)}
                  />
                </span>
              ))}
              {watchedSymbols.length === 0 && (
                <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                  No symbols added yet
                </span>
              )}
            </div>
          </div>

          {/* Include open positions toggle */}
          <div style={{ minWidth: "200px" }}>
            <label style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "10px",
              cursor: "pointer",
              padding: "10px 14px",
              borderRadius: "8px",
              backgroundColor: includeOpenPositions ? "rgba(var(--accent-rgb), 0.1)" : "transparent",
              border: `1px solid ${includeOpenPositions ? "var(--accent)" : "var(--border-color)"}`,
            }}>
              <input
                type="checkbox"
                checked={includeOpenPositions}
                onChange={(e) => setIncludeOpenPositions(e.target.checked)}
                style={{ display: "none" }}
              />
              <div style={{
                width: "20px",
                height: "20px",
                borderRadius: "4px",
                border: `2px solid ${includeOpenPositions ? "var(--accent)" : "var(--border-color)"}`,
                backgroundColor: includeOpenPositions ? "var(--accent)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {includeOpenPositions && <Check size={14} color="var(--bg-primary)" />}
              </div>
              <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                Include open positions
              </span>
            </label>
            {includeOpenPositions && openPositionSymbols.length > 0 && (
              <div style={{ 
                marginTop: "8px", 
                paddingLeft: "14px",
                display: "flex",
                flexWrap: "wrap",
                gap: "6px"
              }}>
                {openPositionSymbols.map(symbol => (
                  <span
                    key={symbol}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "12px",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      fontSize: "12px",
                    }}
                  >
                    {symbol}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          color: "#EF4444",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}>
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* Main content grid */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "1fr 350px", 
        gap: "24px",
        alignItems: "start",
      }}>
        {/* News Feed */}
        <div>
          {/* News filter */}
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "12px", 
            marginBottom: "16px" 
          }}>
            <Filter size={16} color="var(--text-secondary)" />
            <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Filter:</span>
            <button
              onClick={() => setFilterSymbol(null)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                backgroundColor: filterSymbol === null ? "var(--accent)" : "transparent",
                color: filterSymbol === null ? "var(--bg-primary)" : "var(--text-primary)",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              All
            </button>
            {newsSymbols.map(symbol => (
              <button
                key={symbol}
                onClick={() => setFilterSymbol(symbol)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: filterSymbol === symbol ? "var(--accent)" : "transparent",
                  color: filterSymbol === symbol ? "var(--bg-primary)" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                {symbol}
              </button>
            ))}
          </div>

          {/* News cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredNews.length === 0 && !isLoading && (
              <div style={{
                padding: "48px 24px",
                textAlign: "center",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
              }}>
                <Newspaper size={48} color="var(--text-secondary)" style={{ marginBottom: "16px" }} />
                <p style={{ color: "var(--text-secondary)", fontSize: "16px", margin: 0 }}>
                  {getAllSymbols().length === 0
                    ? "Add symbols to watch for news"
                    : "No news found for selected symbols"}
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
                  padding: "16px 20px",
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  textDecoration: "none",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.transform = "translateY(-2px)";
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
                      marginBottom: "8px" 
                    }}>
                      <span style={{
                        padding: "4px 8px",
                        borderRadius: "4px",
                        backgroundColor: "var(--accent)",
                        color: "var(--bg-primary)",
                        fontSize: "12px",
                        fontWeight: "600",
                      }}>
                        {item.symbol}
                      </span>
                      <span style={{ 
                        color: "var(--text-secondary)", 
                        fontSize: "12px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <Clock size={12} />
                        {formatRelativeTime(item.pub_date)}
                      </span>
                    </div>
                    <h3 style={{ 
                      fontSize: "15px", 
                      fontWeight: "500", 
                      color: "var(--text-primary)",
                      margin: 0,
                      lineHeight: "1.4",
                    }}>
                      {item.title}
                    </h3>
                    <p style={{ 
                      fontSize: "12px", 
                      color: "var(--text-secondary)", 
                      margin: "8px 0 0 0" 
                    }}>
                      {item.source}
                    </p>
                  </div>
                  <ExternalLink size={16} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Sidebar - Calendar Events */}
        <div style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <h2 style={{ 
              fontSize: "16px", 
              fontWeight: "600", 
              color: "var(--text-primary)",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <Calendar size={18} />
              Upcoming Events
            </h2>
            <button
              onClick={() => setShowCalendarEvents(!showCalendarEvents)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                padding: "4px",
              }}
            >
              <ChevronDown 
                size={18} 
                style={{ 
                  transform: showCalendarEvents ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease"
                }} 
              />
            </button>
          </div>

          {showCalendarEvents && (
            <div style={{ padding: "16px 20px" }}>
              {calendarEvents.length === 0 ? (
                <p style={{ 
                  color: "var(--text-secondary)", 
                  fontSize: "14px", 
                  textAlign: "center",
                  padding: "24px 0",
                  margin: 0
                }}>
                  No upcoming events
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {calendarEvents.slice(0, 10).map((event, idx) => (
                    <div
                      key={`${event.date}-${event.symbol}-${event.event_type}-${idx}`}
                      style={{
                        padding: "12px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "8px",
                        borderLeft: `3px solid ${getEventTypeColor(event.event_type)}`,
                      }}
                    >
                      <div style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between",
                        marginBottom: "4px"
                      }}>
                        <span style={{
                          fontSize: "12px",
                          fontWeight: "600",
                          color: getEventTypeColor(event.event_type),
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                        }}>
                          {getEventTypeLabel(event.event_type)}
                        </span>
                        {event.symbol && (
                          <span style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: "var(--bg-tertiary)",
                            color: "var(--text-primary)",
                            fontSize: "11px",
                            fontWeight: "600",
                          }}>
                            {event.symbol}
                          </span>
                        )}
                      </div>
                      <p style={{ 
                        fontSize: "14px", 
                        color: "var(--text-primary)", 
                        margin: "4px 0 0 0",
                        fontWeight: "500"
                      }}>
                        {event.title}
                      </p>
                      <div style={{ 
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        marginTop: "6px"
                      }}>
                        <Calendar size={12} color="var(--text-secondary)" />
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {event.date}
                        </span>
                      </div>
                      {event.details && (
                        <p style={{ 
                          fontSize: "12px", 
                          color: "var(--text-secondary)", 
                          margin: "6px 0 0 0" 
                        }}>
                          {event.details}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CSS for spin animation */}
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
