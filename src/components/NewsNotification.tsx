import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { X, ExternalLink, Bell, BellOff, Newspaper } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  NEWS_NOTIFICATIONS_ENABLED_KEY,
  NEWS_NOTIFICATION_INTERVAL_KEY,
  NEWS_LAST_SEEN_IDS_KEY,
  NEWS_SETTINGS_CHANGED_EVENT,
  emitNewsSettingsChanged,
} from "../utils/newsManager";

interface NewsItem {
  id: string;
  symbol: string;
  title: string;
  link: string;
  pub_date: string;
  source: string;
}

interface OpenPositionGroup {
  entry_trade: { symbol: string };
  final_quantity: number;
}

const NEWS_WATCHED_SYMBOLS_KEY = "tradebutler_news_watched_symbols";
const NEWS_INCLUDE_POSITIONS_KEY = "tradebutler_news_include_positions";

interface NewsNotificationProps {
  maxNotifications?: number;
  autoDismissMs?: number;
}

export default function NewsNotification({ maxNotifications = 3, autoDismissMs = 10000 }: NewsNotificationProps) {
  const navigate = useNavigate();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [notifications, setNotifications] = useState<NewsItem[]>([]);
  const [isEnabled, setIsEnabled] = useState(() => {
    const saved = localStorage.getItem(NEWS_NOTIFICATIONS_ENABLED_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [checkInterval, setCheckInterval] = useState(() => {
    const saved = localStorage.getItem(NEWS_NOTIFICATION_INTERVAL_KEY);
    return saved ? parseInt(saved, 10) : 5; // Default 5 minutes
  });
  const [showSettings, setShowSettings] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const dismissTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Load seen IDs from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(NEWS_LAST_SEEN_IDS_KEY);
    if (saved) {
      try {
        const ids = JSON.parse(saved);
        seenIdsRef.current = new Set(ids);
      } catch {
        seenIdsRef.current = new Set();
      }
    }
  }, []);

  // Save settings
  useEffect(() => {
    localStorage.setItem(NEWS_NOTIFICATIONS_ENABLED_KEY, JSON.stringify(isEnabled));
    emitNewsSettingsChanged();
  }, [isEnabled]);

  useEffect(() => {
    localStorage.setItem(NEWS_NOTIFICATION_INTERVAL_KEY, checkInterval.toString());
    emitNewsSettingsChanged();
  }, [checkInterval]);

  useEffect(() => {
    const syncFromStorage = () => {
      const en = localStorage.getItem(NEWS_NOTIFICATIONS_ENABLED_KEY);
      setIsEnabled(en ? JSON.parse(en) : true);
      const iv = localStorage.getItem(NEWS_NOTIFICATION_INTERVAL_KEY);
      setCheckInterval(iv ? parseInt(iv, 10) : 5);
    };
    window.addEventListener(NEWS_SETTINGS_CHANGED_EVENT, syncFromStorage);
    return () => window.removeEventListener(NEWS_SETTINGS_CHANGED_EVENT, syncFromStorage);
  }, []);

  useEffect(() => {
    return subscribeToDataMode(setDataMode);
  }, []);

  // Check for new news
  const checkForNewNews = useCallback(async () => {
    if (!isEnabled || dataMode === "sandbox") return;

    try {
      // Get watched symbols
      const savedSymbols = localStorage.getItem(NEWS_WATCHED_SYMBOLS_KEY);
      const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
      
      const savedIncludePositions = localStorage.getItem(NEWS_INCLUDE_POSITIONS_KEY);
      const includePositions = savedIncludePositions ? JSON.parse(savedIncludePositions) : true;

      let openPositionSymbols: string[] = [];
      if (includePositions) {
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

      const allSymbols = [...new Set([...watchedSymbols, ...openPositionSymbols])];
      if (allSymbols.length === 0) return;

      const newsData = await invoke<NewsItem[]>("fetch_news_batch", { symbols: allSymbols });
      
      // Find new news items (not seen before)
      const newItems = newsData.filter(item => !seenIdsRef.current.has(item.id));
      
      if (newItems.length > 0) {
        // Add to notifications (limit to maxNotifications)
        const itemsToShow = newItems.slice(0, maxNotifications);
        setNotifications(prev => [...itemsToShow, ...prev].slice(0, maxNotifications));
        
        // Mark as seen
        newItems.forEach(item => seenIdsRef.current.add(item.id));
        
        // Save seen IDs (keep last 100)
        const idsToSave = Array.from(seenIdsRef.current).slice(-100);
        localStorage.setItem(NEWS_LAST_SEEN_IDS_KEY, JSON.stringify(idsToSave));
        
        // Set auto-dismiss timers
        itemsToShow.forEach(item => {
          if (autoDismissMs > 0) {
            const timer = setTimeout(() => dismissNotification(item.id), autoDismissMs);
            dismissTimersRef.current.set(item.id, timer);
          }
        });
      }
    } catch (e) {
      console.error("Failed to check for new news:", e);
    }
  }, [isEnabled, dataMode, maxNotifications, autoDismissMs]);

  // Check for news on mount and at intervals
  useEffect(() => {
    if (!isEnabled || checkInterval === 0) return;

    // Initial check after a short delay
    const initialTimer = setTimeout(checkForNewNews, 5000);
    
    // Regular interval checks
    const intervalMs = checkInterval * 60 * 1000;
    const intervalId = setInterval(checkForNewNews, intervalMs);
    
    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [isEnabled, checkInterval, checkForNewNews]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      dismissTimersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  };

  const dismissAll = () => {
    notifications.forEach(n => {
      const timer = dismissTimersRef.current.get(n.id);
      if (timer) clearTimeout(timer);
    });
    dismissTimersRef.current.clear();
    setNotifications([]);
  };

  const formatRelativeTime = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      {/* Notifications container */}
      {notifications.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            right: "16px",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxWidth: "400px",
            width: "100%",
          }}
        >
          {/* Header with dismiss all */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
          }}>
            <span style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}>
              <Newspaper size={16} />
              {notifications.length} New {notifications.length === 1 ? "Article" : "Articles"}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => navigate("/news")}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: "500",
                  backgroundColor: "var(--accent)",
                  color: "var(--bg-primary)",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                View All
              </button>
              <button
                onClick={dismissAll}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: "500",
                  backgroundColor: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Notification cards */}
          {notifications.map((item) => (
            <div
              key={item.id}
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
                overflow: "hidden",
                animation: "slideIn 0.3s ease-out",
              }}
            >
              <div style={{ padding: "14px 16px" }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                    }}>
                      {formatRelativeTime(item.pub_date)}
                    </span>
                  </div>
                  <button
                    onClick={() => dismissNotification(item.id)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-secondary)",
                      padding: "2px",
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                </div>
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: "500",
                    color: "var(--text-primary)",
                    textDecoration: "none",
                    lineHeight: "1.4",
                  }}
                  onClick={() => dismissNotification(item.id)}
                >
                  {item.title}
                </a>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "10px",
                }}>
                  <span style={{
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                  }}>
                    {item.source}
                  </span>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "12px",
                      color: "var(--accent)",
                      textDecoration: "none",
                    }}
                  >
                    Read <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toggle button (always visible in corner) */}
      <div
        style={{
          position: "fixed",
          bottom: "16px",
          right: "16px",
          zIndex: 9999,
        }}
      >
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            backgroundColor: isEnabled ? "var(--accent)" : "var(--bg-secondary)",
            color: isEnabled ? "var(--bg-primary)" : "var(--text-secondary)",
            border: "1px solid var(--border-color)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
          }}
          title={isEnabled ? "News notifications enabled" : "News notifications disabled"}
        >
          {isEnabled ? <Bell size={20} /> : <BellOff size={20} />}
        </button>

        {/* Settings popup */}
        {showSettings && (
          <div
            style={{
              position: "absolute",
              bottom: "56px",
              right: 0,
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "12px",
              border: "1px solid var(--border-color)",
              padding: "16px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
              minWidth: "220px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{
              margin: "0 0 12px 0",
              fontSize: "14px",
              fontWeight: "600",
              color: "var(--text-primary)",
            }}>
              News Notifications
            </h4>
            
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              cursor: "pointer",
              marginBottom: "12px",
            }}>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                Enable notifications
              </span>
            </label>

            {isEnabled && (
              <div>
                <label style={{
                  display: "block",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginBottom: "6px",
                }}>
                  Check interval
                </label>
                <select
                  value={checkInterval}
                  onChange={(e) => setCheckInterval(parseInt(e.target.value, 10))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <option value={1}>Every 1 minute</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                </select>
              </div>
            )}

            <button
              onClick={() => setShowSettings(false)}
              style={{
                marginTop: "12px",
                width: "100%",
                padding: "8px",
                fontSize: "13px",
                fontWeight: "500",
                backgroundColor: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
