import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Heart, BookOpen, DollarSign, TrendingUp, Calendar as CalendarIcon, RefreshCw, Settings } from "lucide-react";
import { getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import type { DataMode } from "../utils/dataMode";
import { loadSandboxState, getSandboxEmotionalStates } from "../utils/sandboxStore";
import { buildPositionGroupsAndPairs } from "../utils/sandboxPairing";

interface DailyPnL {
  date: string;
  profit_loss: number;
  trade_count: number;
}

interface CalendarJournalEntry {
  id: number;
  date: string;
  title: string;
}

interface CalendarEmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
}

interface CalendarEvent {
  date: string;
  symbol: string | null;
  event_type: string;
  title: string;
  details: string | null;
}

interface EconomicEvent {
  date: string;
  event_type: string;
  title: string;
  description: string | null;
  importance: string;
}

const CALENDAR_SHOW_EARNINGS_KEY = "tradebutler_calendar_show_earnings";
const CALENDAR_SHOW_DIVIDENDS_KEY = "tradebutler_calendar_show_dividends";
const CALENDAR_SHOW_ECONOMIC_KEY = "tradebutler_calendar_show_economic";

export default function Calendar() {
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyPnL, setDailyPnL] = useState<Record<string, DailyPnL>>({});
  const [loading, setLoading] = useState(true);
  const [journalEntriesByDate, setJournalEntriesByDate] = useState<Record<string, CalendarJournalEntry[]>>({});
  const [emotionalStatesByDate, setEmotionalStatesByDate] = useState<Record<string, CalendarEmotionalState[]>>({});
  const [openJournalDate, setOpenJournalDate] = useState<string | null>(null);
  const [openJournalPage, setOpenJournalPage] = useState<number>(0);
  const navigate = useNavigate();

  // New state for calendar events
  const [calendarEvents, setCalendarEvents] = useState<Record<string, CalendarEvent[]>>({});
  const [economicEvents, setEconomicEvents] = useState<Record<string, EconomicEvent[]>>({});
  const [loadingEvents, setLoadingEvents] = useState(false);
  
  // Toggle state for showing different event types
  const [showEarnings, setShowEarnings] = useState(() => {
    const saved = localStorage.getItem(CALENDAR_SHOW_EARNINGS_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [showDividends, setShowDividends] = useState(() => {
    const saved = localStorage.getItem(CALENDAR_SHOW_DIVIDENDS_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [showEconomicEvents, setShowEconomicEvents] = useState(() => {
    const saved = localStorage.getItem(CALENDAR_SHOW_ECONOMIC_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [showEventSettings, setShowEventSettings] = useState(false);

  // Save toggle settings
  useEffect(() => {
    localStorage.setItem(CALENDAR_SHOW_EARNINGS_KEY, JSON.stringify(showEarnings));
  }, [showEarnings]);
  useEffect(() => {
    localStorage.setItem(CALENDAR_SHOW_DIVIDENDS_KEY, JSON.stringify(showDividends));
  }, [showDividends]);
  useEffect(() => {
    localStorage.setItem(CALENDAR_SHOW_ECONOMIC_KEY, JSON.stringify(showEconomicEvents));
  }, [showEconomicEvents]);

  useEffect(() => {
    const unsub = subscribeToDataMode(setDataMode);
    return unsub;
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [currentDate, dataMode]);

  // Fetch calendar events (earnings, dividends)
  const fetchCalendarEvents = useCallback(async () => {
    if (dataMode === "sandbox") return;
    
    setLoadingEvents(true);
    try {
      // Get watched symbols from news settings (shared with News page)
      const savedSymbols = localStorage.getItem("tradebutler_news_watched_symbols");
      const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
      
      // Get open position symbols
      const paperOnly = dataMode === "paper";
      let openSymbols: string[] = [];
      try {
        const groups = await invoke<Array<{ entry_trade: { symbol: string }; final_quantity: number }>>(
          "get_position_groups",
          { pairingMethod: "fifo", startDate: null, endDate: null, paperOnly, includePaper: !paperOnly }
        );
        openSymbols = groups
          .filter(g => g.final_quantity !== 0)
          .map(g => g.entry_trade.symbol.toUpperCase());
      } catch (e) {
        console.error("Failed to fetch open positions:", e);
      }
      
      const allSymbols = [...new Set([...watchedSymbols, ...openSymbols])];
      
      if (allSymbols.length > 0) {
        const events = await invoke<CalendarEvent[]>("fetch_calendar_events_batch", { symbols: allSymbols });
        const eventsMap: Record<string, CalendarEvent[]> = {};
        events.forEach(event => {
          if (!eventsMap[event.date]) eventsMap[event.date] = [];
          eventsMap[event.date].push(event);
        });
        setCalendarEvents(eventsMap);
      }
      
      // Fetch economic events for current month
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const economicData = await invoke<EconomicEvent[]>("get_economic_calendar_range", {
        startDate: format(monthStart, "yyyy-MM-dd"),
        endDate: format(monthEnd, "yyyy-MM-dd"),
      });
      
      const econMap: Record<string, EconomicEvent[]> = {};
      economicData.forEach(event => {
        if (!econMap[event.date]) econMap[event.date] = [];
        econMap[event.date].push(event);
      });
      setEconomicEvents(econMap);
    } catch (e) {
      console.error("Failed to fetch calendar events:", e);
    } finally {
      setLoadingEvents(false);
    }
  }, [dataMode, currentDate]);

  // Fetch events when month changes
  useEffect(() => {
    fetchCalendarEvents();
  }, [fetchCalendarEvents]);

  const loadCalendarData = async () => {
    try {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const rangeStart = format(monthStart, "yyyy-MM-dd");
      const rangeEnd = format(monthEnd, "yyyy-MM-dd");

      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        const pairingMethod = (localStorage.getItem("tradebutler_pairing_method") || "FIFO") as "FIFO" | "LIFO";
        const { pairs } = buildPositionGroupsAndPairs(
          state.trades.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            price: t.price,
            timestamp: t.timestamp,
            fees: t.fees,
            notes: t.notes,
            strategy_id: t.strategy_id,
          })),
          pairingMethod
        );
        const pnlMap: Record<string, DailyPnL> = {};
        for (const p of pairs) {
          const dateStr = p.exit_timestamp.slice(0, 10);
          if (!pnlMap[dateStr]) {
            pnlMap[dateStr] = { date: dateStr, profit_loss: 0, trade_count: 0 };
          }
          pnlMap[dateStr].profit_loss += p.net_profit_loss;
          pnlMap[dateStr].trade_count += 1;
        }
        setDailyPnL(pnlMap);

        const journalMap: Record<string, CalendarJournalEntry[]> = {};
        state.journalEntries.forEach((entry) => {
          const dateStr = entry.date;
          if (!journalMap[dateStr]) journalMap[dateStr] = [];
          journalMap[dateStr].push({ id: entry.id, date: entry.date, title: entry.title || "Untitled" });
        });
        setJournalEntriesByDate(journalMap);

        const allEmotions = getSandboxEmotionalStates();
        const emotionMap: Record<string, CalendarEmotionalState[]> = {};
        allEmotions.forEach((es) => {
          const dateStr = (es.timestamp || "").slice(0, 10);
          if (dateStr >= rangeStart && dateStr <= rangeEnd) {
            if (!emotionMap[dateStr]) emotionMap[dateStr] = [];
            emotionMap[dateStr].push({ id: es.id, timestamp: es.timestamp, emotion: es.emotion, intensity: es.intensity });
          }
        });
        setEmotionalStatesByDate(emotionMap);
      } else {
        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const [pnlData, journalData, emotionalStates] = await Promise.all([
          invoke<DailyPnL[]>("get_daily_pnl", paperArgs),
          invoke<CalendarJournalEntry[]>("get_journal_entries", paperArgs),
          invoke<Array<{ id: number | null; timestamp: string; emotion: string; intensity: number }>>("get_emotional_states", paperArgs),
        ]);

        const pnlMap: Record<string, DailyPnL> = {};
        pnlData.forEach((day) => {
          pnlMap[day.date] = day;
        });
        setDailyPnL(pnlMap);

        const journalMap: Record<string, CalendarJournalEntry[]> = {};
        journalData.forEach((entry) => {
          if (!journalMap[entry.date]) {
            journalMap[entry.date] = [];
          }
          journalMap[entry.date].push(entry);
        });
        setJournalEntriesByDate(journalMap);

        const emotionMap: Record<string, CalendarEmotionalState[]> = {};
        emotionalStates.forEach((es) => {
          const dateStr = (es.timestamp || "").slice(0, 10);
          if (dateStr >= rangeStart && dateStr <= rangeEnd && es.id != null) {
            if (!emotionMap[dateStr]) emotionMap[dateStr] = [];
            emotionMap[dateStr].push({ id: es.id, timestamp: es.timestamp, emotion: es.emotion, intensity: es.intensity });
          }
        });
        setEmotionalStatesByDate(emotionMap);
      }
    } catch (error) {
      console.error("Error loading calendar data:", error);
    } finally {
      setLoading(false);
    }
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get first day of week for the month start
  const firstDayOfWeek = monthStart.getDay();
  const emptyDays = Array(firstDayOfWeek).fill(null);

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const getDayPnL = (date: Date): DailyPnL | null => {
    const dateStr = format(date, "yyyy-MM-dd");
    return dailyPnL[dateStr] || null;
  };

  const getDayJournalEntries = (date: Date): CalendarJournalEntry[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return journalEntriesByDate[dateStr] || [];
  };

  const getDayEmotionalStates = (date: Date): CalendarEmotionalState[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return emotionalStatesByDate[dateStr] || [];
  };

  const getDayCalendarEvents = (date: Date): CalendarEvent[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return calendarEvents[dateStr] || [];
  };

  const getDayEconomicEvents = (date: Date): EconomicEvent[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return economicEvents[dateStr] || [];
  };

  const getDateKey = (date: Date): string => format(date, "yyyy-MM-dd");

  // Event type colors
  const getEventBadgeColor = (eventType: string): string => {
    switch (eventType) {
      case "earnings": return "#8B5CF6";
      case "dividend_ex": return "#10B981";
      case "dividend_pay": return "#34D399";
      case "split": return "#F59E0B";
      case "fomc": return "#EF4444";
      case "cpi": return "#F97316";
      case "gdp": return "#3B82F6";
      case "jobs": return "#6366F1";
      case "ppi": return "#EC4899";
      case "retail_sales": return "#14B8A6";
      default: return "var(--accent)";
    }
  };

  const getEventBadgeLabel = (eventType: string): string => {
    switch (eventType) {
      case "earnings": return "E";
      case "dividend_ex": return "D";
      case "dividend_pay": return "D$";
      case "split": return "S";
      case "fomc": return "FOMC";
      case "cpi": return "CPI";
      case "gdp": return "GDP";
      case "jobs": return "NFP";
      case "ppi": return "PPI";
      case "retail_sales": return "RET";
      default: return eventType.charAt(0).toUpperCase();
    }
  };

  const getDayColor = (pnl: number | null): string => {
    if (pnl === null) return "transparent";
    if (pnl > 0) return "var(--profit)";
    if (pnl < 0) return "var(--loss)";
    return "var(--border-color)";
  };

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (loading) {
    return (
      <div style={{ padding: "28px", textAlign: "center", fontSize: "16px", color: "var(--text-secondary)" }}>
        Loading calendar...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "var(--bg-primary)",
        border: "1px solid color-mix(in srgb, var(--border-color) 50%, transparent)",
        borderRadius: "12px",
        padding: "20px 24px",
      }}
    >
      {dataMode === "sandbox" && (
        <p style={{ margin: "0 0 20px 0", padding: "14px 18px", fontSize: "15px", fontWeight: "600", color: "var(--accent)", background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 14%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)", borderRadius: "10px" }}>
          Demo mode — you are viewing demo data only.
        </p>
      )}
      {dataMode === "paper" && (
        <p style={{ margin: "0 0 20px 0", padding: "14px 18px", fontSize: "15px", fontWeight: "600", color: "var(--accent)", background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 14%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))", border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)", borderRadius: "10px" }}>
          Paper mode — you are viewing paper trades only.
        </p>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={previousMonth}
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            padding: "10px 14px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-tertiary)";
            e.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-secondary)";
            e.currentTarget.style.borderColor = "var(--border-color)";
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <select
            value={currentDate.getMonth()}
            onChange={(e) => {
              const newMonth = parseInt(e.target.value);
              setCurrentDate(new Date(currentDate.getFullYear(), newMonth, 1));
            }}
            style={{
              padding: "12px 16px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
              outline: "none",
              appearance: "none",
              WebkitAppearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 12px center",
              paddingRight: "36px",
            }}
          >
            {[
              "January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December",
            ].map((month, index) => (
              <option key={month} value={index} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", padding: "8px 12px" }}>{month}</option>
            ))}
          </select>
          <select
            value={currentDate.getFullYear()}
            onChange={(e) => {
              const newYear = parseInt(e.target.value);
              setCurrentDate(new Date(newYear, currentDate.getMonth(), 1));
            }}
            style={{
              padding: "12px 16px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
              outline: "none",
              minWidth: "100px",
              appearance: "none",
              WebkitAppearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 12px center",
              paddingRight: "36px",
            }}
          >
            {Array.from({ length: 30 }, (_, i) => {
              const year = new Date().getFullYear() - 10 + i;
              return <option key={year} value={year} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", padding: "8px 12px" }}>{year}</option>;
            })}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={nextMonth}
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              padding: "10px 14px",
              color: "var(--text-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-tertiary)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-secondary)";
              e.currentTarget.style.borderColor = "var(--border-color)";
            }}
          >
            <ChevronRight size={20} />
          </button>
          
          {/* Refresh events button */}
          <button
            onClick={fetchCalendarEvents}
            disabled={loadingEvents}
            title="Refresh events"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              padding: "10px 14px",
              color: loadingEvents ? "var(--text-secondary)" : "var(--text-primary)",
              cursor: loadingEvents ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!loadingEvents) {
                e.currentTarget.style.background = "var(--bg-tertiary)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-secondary)";
              e.currentTarget.style.borderColor = "var(--border-color)";
            }}
          >
            <RefreshCw size={18} className={loadingEvents ? "spin" : ""} />
          </button>
          
          {/* Event settings button */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowEventSettings(!showEventSettings)}
              title="Event settings"
              style={{
                background: showEventSettings ? "var(--accent)" : "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: showEventSettings ? "var(--bg-primary)" : "var(--text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s ease, border-color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!showEventSettings) {
                  e.currentTarget.style.background = "var(--bg-tertiary)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }
              }}
              onMouseLeave={(e) => {
                if (!showEventSettings) {
                  e.currentTarget.style.background = "var(--bg-secondary)";
                  e.currentTarget.style.borderColor = "var(--border-color)";
                }
              }}
            >
              <Settings size={18} />
            </button>
            
            {showEventSettings && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "8px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "12px",
                  padding: "16px",
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
                  zIndex: 100,
                  minWidth: "200px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>
                  Show Events
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showEarnings}
                      onChange={(e) => setShowEarnings(e.target.checked)}
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontSize: "13px" }}>
                      <span style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        width: "20px", 
                        height: "20px", 
                        borderRadius: "4px", 
                        backgroundColor: "#8B5CF6",
                        color: "white",
                        fontSize: "10px",
                        fontWeight: "700"
                      }}>E</span>
                      Earnings
                    </span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showDividends}
                      onChange={(e) => setShowDividends(e.target.checked)}
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontSize: "13px" }}>
                      <span style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        width: "20px", 
                        height: "20px", 
                        borderRadius: "4px", 
                        backgroundColor: "#10B981",
                        color: "white",
                        fontSize: "10px",
                        fontWeight: "700"
                      }}>D</span>
                      Dividends
                    </span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showEconomicEvents}
                      onChange={(e) => setShowEconomicEvents(e.target.checked)}
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-primary)", fontSize: "13px" }}>
                      <span style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        width: "20px", 
                        height: "20px", 
                        borderRadius: "4px", 
                        backgroundColor: "#EF4444",
                        color: "white",
                        fontSize: "8px",
                        fontWeight: "700"
                      }}>FOMC</span>
                      Economic Events
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "auto repeat(6, minmax(0, 1fr))",
          gap: "10px",
          flex: 1,
          minHeight: 0,
        }}
      >
        {weekDays.map((day) => (
          <div
            key={day}
            style={{
              textAlign: "center",
              padding: "10px",
              fontSize: "14px",
              fontWeight: "600",
              color: "var(--text-secondary)",
              letterSpacing: "0.02em",
            }}
          >
            {day}
          </div>
        ))}

        {emptyDays.map((_, index) => (
          <div key={`empty-${index}`} />
        ))}

        {daysInMonth.map((day) => {
          const dayPnL = getDayPnL(day);
          const journalEntries = getDayJournalEntries(day);
          const emotionalStates = getDayEmotionalStates(day);
          const dayCalEvents = getDayCalendarEvents(day);
          const dayEconEvents = getDayEconomicEvents(day);
          const isCurrentDay = isToday(day);
          const pnlColor = getDayColor(dayPnL?.profit_loss ?? null);
          const dateKey = getDateKey(day);
          const isDropdownOpen = openJournalDate === dateKey;
          
          // Filter events based on settings
          const earningsEvents = showEarnings ? dayCalEvents.filter(e => e.event_type === "earnings") : [];
          const dividendEvents = showDividends ? dayCalEvents.filter(e => e.event_type.startsWith("dividend")) : [];
          const filteredEconEvents = showEconomicEvents ? dayEconEvents : [];
          
          const hasContent = dayPnL || journalEntries.length > 0 || emotionalStates.length > 0 ||
            earningsEvents.length > 0 || dividendEvents.length > 0 || filteredEconEvents.length > 0;

          const openDetails = (e: React.MouseEvent) => {
            e.stopPropagation();
            setOpenJournalPage(0);
            setOpenJournalDate((prev) => (prev === dateKey ? null : dateKey));
          };

          return (
            <div
              key={day.toISOString()}
              onClick={hasContent ? (e) => { if (!(e.target as HTMLElement).closest("button")) openDetails(e); } : undefined}
              role={hasContent ? "button" : undefined}
              style={{
                minHeight: 0,
                border: isCurrentDay ? "2px solid var(--accent)" : "1px solid color-mix(in srgb, var(--border-color) 60%, transparent)",
                borderRadius: "10px",
                padding: "12px",
                background: pnlColor !== "transparent"
                  ? `linear-gradient(180deg, color-mix(in srgb, ${pnlColor} 14%, var(--bg-primary)), color-mix(in srgb, ${pnlColor} 6%, var(--bg-primary)))`
                  : "transparent",
                cursor: hasContent ? "pointer" : "default",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={
                dayPnL
                  ? `${format(day, "MMM d, yyyy")}\nP&L: $${dayPnL.profit_loss.toFixed(2)}\nTrades: ${dayPnL.trade_count}${emotionalStates.length > 0 ? `\nEmotions: ${emotionalStates.length}` : ""}${journalEntries.length > 0 ? `\nJournal: ${journalEntries.length}` : ""}`
                  : format(day, "MMM d, yyyy")
              }
            >
              <span
                style={{
                  fontSize: "20px",
                  fontWeight: isCurrentDay ? "700" : "600",
                  color: isCurrentDay ? "var(--accent)" : "var(--text-primary)",
                  marginBottom: "3px",
                }}
              >
                {format(day, "d")}
              </span>
              {dayPnL && (
                <>
                  <span
                    style={{
                      fontSize: "16px",
                      fontWeight: "700",
                      color: dayPnL.profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                      marginTop: "3px",
                    }}
                  >
                    {dayPnL.profit_loss >= 0 ? "+" : ""}
                    ${Math.abs(dayPnL.profit_loss).toFixed(0)}
                  </span>
                  <span style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "4px", fontWeight: "500" }}>
                    {dayPnL.trade_count} trade{dayPnL.trade_count !== 1 ? "s" : ""}
                  </span>
                </>
              )}
              {(journalEntries.length > 0 || emotionalStates.length > 0) && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginTop: "8px",
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {journalEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={openDetails}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "3px 6px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "var(--accent)",
                      }}
                      title={`${journalEntries.length} journal entr${journalEntries.length === 1 ? "y" : "ies"} — click for details`}
                    >
                      <BookOpen size={16} />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>{journalEntries.length}</span>
                    </button>
                  )}
                  {emotionalStates.length > 0 && (
                    <button
                      type="button"
                      onClick={openDetails}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "3px 6px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "var(--accent)",
                      }}
                      title={`${emotionalStates.length} emotional state${emotionalStates.length === 1 ? "" : "s"} — click for details`}
                    >
                      <Heart size={16} />
                      <span style={{ fontSize: "14px", fontWeight: "600" }}>{emotionalStates.length}</span>
                    </button>
                  )}
                  {/* Event badges */}
                  {earningsEvents.map((event, idx) => (
                    <span
                      key={`earnings-${idx}`}
                      onClick={openDetails}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2px 5px",
                        borderRadius: "4px",
                        backgroundColor: getEventBadgeColor("earnings"),
                        color: "white",
                        fontSize: "10px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                      title={`${event.title}${event.details ? ` - ${event.details}` : ""}`}
                    >
                      E
                    </span>
                  ))}
                  {dividendEvents.map((event, idx) => (
                    <span
                      key={`dividend-${idx}`}
                      onClick={openDetails}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2px 5px",
                        borderRadius: "4px",
                        backgroundColor: getEventBadgeColor(event.event_type),
                        color: "white",
                        fontSize: "10px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                      title={`${event.title}${event.details ? ` - ${event.details}` : ""}`}
                    >
                      D
                    </span>
                  ))}
                  {filteredEconEvents.map((event, idx) => (
                    <span
                      key={`econ-${idx}`}
                      onClick={openDetails}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2px 5px",
                        borderRadius: "4px",
                        backgroundColor: getEventBadgeColor(event.event_type),
                        color: "white",
                        fontSize: "9px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                      title={`${event.title}${event.description ? ` - ${event.description}` : ""}`}
                    >
                      {getEventBadgeLabel(event.event_type)}
                    </span>
                  ))}
                </div>
              )}
              {isDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: "6px",
                        zIndex: 10,
                        minWidth: "240px",
                        maxWidth: "300px",
                        maxHeight: "360px",
                        overflowY: "auto",
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "12px",
                        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
                        padding: "16px",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "14px",
                          paddingBottom: "12px",
                          borderBottom: "1px solid var(--border-color)",
                        }}
                      >
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{format(day, "MMM d, yyyy")}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenJournalPage(0);
                            setOpenJournalDate(null);
                          }}
                          style={{
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            fontSize: "12px",
                            cursor: "pointer",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontWeight: "500",
                          }}
                        >
                          Close
                        </button>
                      </div>
                      {dayPnL && (
                        <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid var(--border-color)" }}>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>Trading</div>
                          <div style={{ fontSize: "15px", color: "var(--text-primary)" }}>
                            <span style={{ color: dayPnL.profit_loss >= 0 ? "var(--profit)" : "var(--loss)", fontWeight: "700" }}>
                              {dayPnL.profit_loss >= 0 ? "+" : ""}${dayPnL.profit_loss.toFixed(2)}
                            </span>
                            <span style={{ color: "var(--text-secondary)", marginLeft: "10px", fontWeight: "500" }}>
                              · {dayPnL.trade_count} trade{dayPnL.trade_count !== 1 ? "s" : ""} closed
                            </span>
                          </div>
                        </div>
                      )}
                      {emotionalStates.length > 0 && (
                        <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: journalEntries.length > 0 ? "1px solid var(--border-color)" : "none" }}>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <Heart size={14} style={{ color: "var(--accent)" }} />
                            Emotional states
                          </div>
                          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                            {emotionalStates.slice(0, 5).map((es) => (
                              <li key={es.id}>
                                <button
                                  onClick={() => navigate("/emotions")}
                                  style={{
                                    border: "none",
                                    background: "var(--bg-tertiary)",
                                    padding: "8px 12px",
                                    textAlign: "left",
                                    fontSize: "14px",
                                    color: "var(--text-primary)",
                                    cursor: "pointer",
                                    width: "100%",
                                    display: "block",
                                    borderRadius: "8px",
                                  }}
                                  title={`${es.emotion} (intensity ${es.intensity})`}
                                >
                                  {es.emotion} <span style={{ color: "var(--text-secondary)", fontWeight: "500" }}>· {es.intensity}/10</span>
                                </button>
                              </li>
                            ))}
                            {emotionalStates.length > 5 && (
                              <li style={{ fontSize: "13px", color: "var(--text-secondary)", paddingLeft: "12px" }}>
                                +{emotionalStates.length - 5} more
                              </li>
                            )}
                          </ul>
                          <button
                            onClick={() => navigate("/emotions")}
                            style={{
                              marginTop: "10px",
                              padding: "8px 14px",
                              fontSize: "13px",
                              borderRadius: "8px",
                              border: "1px solid var(--accent)",
                              background: "transparent",
                              color: "var(--accent)",
                              cursor: "pointer",
                              fontWeight: "600",
                            }}
                          >
                            Open Emotions
                          </button>
                        </div>
                      )}
                      {/* Events section */}
                      {(earningsEvents.length > 0 || dividendEvents.length > 0 || filteredEconEvents.length > 0) && (
                        <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: journalEntries.length > 0 ? "1px solid var(--border-color)" : "none" }}>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <CalendarIcon size={14} style={{ color: "var(--accent)" }} />
                            Events
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {earningsEvents.map((event, idx) => (
                              <div
                                key={`earnings-detail-${idx}`}
                                style={{
                                  padding: "10px 12px",
                                  background: "var(--bg-tertiary)",
                                  borderRadius: "8px",
                                  borderLeft: `3px solid ${getEventBadgeColor("earnings")}`,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                  <TrendingUp size={14} color={getEventBadgeColor("earnings")} />
                                  <span style={{ fontSize: "12px", fontWeight: "600", color: getEventBadgeColor("earnings"), textTransform: "uppercase" }}>
                                    Earnings
                                  </span>
                                  {event.symbol && (
                                    <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", fontWeight: "600" }}>
                                      {event.symbol}
                                    </span>
                                  )}
                                </div>
                                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", fontWeight: "500" }}>{event.title}</p>
                                {event.details && (
                                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>{event.details}</p>
                                )}
                              </div>
                            ))}
                            {dividendEvents.map((event, idx) => (
                              <div
                                key={`dividend-detail-${idx}`}
                                style={{
                                  padding: "10px 12px",
                                  background: "var(--bg-tertiary)",
                                  borderRadius: "8px",
                                  borderLeft: `3px solid ${getEventBadgeColor(event.event_type)}`,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                  <DollarSign size={14} color={getEventBadgeColor(event.event_type)} />
                                  <span style={{ fontSize: "12px", fontWeight: "600", color: getEventBadgeColor(event.event_type), textTransform: "uppercase" }}>
                                    {event.event_type === "dividend_ex" ? "Ex-Dividend" : "Dividend Pay"}
                                  </span>
                                  {event.symbol && (
                                    <span style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", fontWeight: "600" }}>
                                      {event.symbol}
                                    </span>
                                  )}
                                </div>
                                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", fontWeight: "500" }}>{event.title}</p>
                                {event.details && (
                                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>{event.details}</p>
                                )}
                              </div>
                            ))}
                            {filteredEconEvents.map((event, idx) => (
                              <div
                                key={`econ-detail-${idx}`}
                                style={{
                                  padding: "10px 12px",
                                  background: "var(--bg-tertiary)",
                                  borderRadius: "8px",
                                  borderLeft: `3px solid ${getEventBadgeColor(event.event_type)}`,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                  <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "2px 5px",
                                    borderRadius: "4px",
                                    backgroundColor: getEventBadgeColor(event.event_type),
                                    color: "white",
                                    fontSize: "9px",
                                    fontWeight: "700",
                                  }}>
                                    {getEventBadgeLabel(event.event_type)}
                                  </span>
                                  <span style={{
                                    fontSize: "10px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    backgroundColor: event.importance === "high" ? "rgba(239, 68, 68, 0.2)" : "var(--bg-secondary)",
                                    color: event.importance === "high" ? "#EF4444" : "var(--text-secondary)",
                                    fontWeight: "600",
                                    textTransform: "uppercase",
                                  }}>
                                    {event.importance}
                                  </span>
                                </div>
                                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", fontWeight: "500" }}>{event.title}</p>
                                {event.description && (
                                  <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>{event.description}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {journalEntries.length > 0 && (
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <BookOpen size={14} style={{ color: "var(--accent)" }} />
                            Journal entries
                          </div>
                          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                            {(() => {
                              const entriesPerPage = 10;
                              const totalPages = Math.ceil(journalEntries.length / entriesPerPage) || 1;
                              const currentPage = Math.min(openJournalPage, totalPages - 1);
                              const startIndex = currentPage * entriesPerPage;
                              const pageEntries = journalEntries.slice(startIndex, startIndex + entriesPerPage);

                              return (
                                <>
                                  {pageEntries.map((entry) => (
                                    <li key={entry.id}>
                                      <button
                                        onClick={() => navigate("/journal", { state: { openEntryId: entry.id } })}
                                        style={{
                                          border: "none",
                                          background: "var(--bg-tertiary)",
                                          padding: "8px 12px",
                                          textAlign: "left",
                                          fontSize: "14px",
                                          color: "var(--accent)",
                                          cursor: "pointer",
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          width: "100%",
                                          borderRadius: "8px",
                                        }}
                                        title={entry.title}
                                      >
                                        {entry.title || "Untitled entry"}
                                      </button>
                                    </li>
                                  ))}
                                  {totalPages > 1 && (
                                    <li style={{ marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "var(--text-secondary)" }}>
                                      <button
                                        onClick={() => setOpenJournalPage((prev) => (prev > 0 ? prev - 1 : prev))}
                                        disabled={currentPage === 0}
                                        style={{
                                          border: "1px solid var(--border-color)",
                                          background: currentPage === 0 ? "transparent" : "var(--bg-tertiary)",
                                          color: currentPage === 0 ? "var(--text-muted)" : "var(--accent)",
                                          cursor: currentPage === 0 ? "default" : "pointer",
                                          padding: "6px 10px",
                                          fontSize: "12px",
                                          borderRadius: "6px",
                                          fontWeight: "500",
                                        }}
                                      >
                                        ‹ Prev
                                      </button>
                                      <span style={{ fontWeight: "500" }}>Page {currentPage + 1} of {totalPages}</span>
                                      <button
                                        onClick={() => setOpenJournalPage((prev) => (prev < totalPages - 1 ? prev + 1 : prev))}
                                        disabled={currentPage >= totalPages - 1}
                                        style={{
                                          border: "1px solid var(--border-color)",
                                          background: currentPage >= totalPages - 1 ? "transparent" : "var(--bg-tertiary)",
                                          color: currentPage >= totalPages - 1 ? "var(--text-muted)" : "var(--accent)",
                                          cursor: currentPage >= totalPages - 1 ? "default" : "pointer",
                                          padding: "6px 10px",
                                          fontSize: "12px",
                                          borderRadius: "6px",
                                          fontWeight: "500",
                                        }}
                                      >
                                        Next ›
                                      </button>
                                    </li>
                                  )}
                                </>
                              );
                            })()}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "24px",
          marginTop: "20px",
          paddingTop: "20px",
          borderTop: "1px solid var(--border-color)",
          fontSize: "14px",
          color: "var(--text-secondary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "6px",
              background: "linear-gradient(180deg, color-mix(in srgb, var(--profit) 22%, transparent), color-mix(in srgb, var(--profit) 10%, transparent))",
              border: "1px solid color-mix(in srgb, var(--profit) 50%, transparent)",
            }}
          />
          <span style={{ fontWeight: "500" }}>Profit day</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "6px",
              background: "linear-gradient(180deg, color-mix(in srgb, var(--loss) 22%, transparent), color-mix(in srgb, var(--loss) 10%, transparent))",
              border: "1px solid color-mix(in srgb, var(--loss) 50%, transparent)",
            }}
          />
          <span style={{ fontWeight: "500" }}>Loss day</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <BookOpen size={16} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: "500" }}>Journal entries</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Heart size={16} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: "500" }}>Emotional states</span>
        </div>
        {showEarnings && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", borderRadius: "4px", backgroundColor: "#8B5CF6", color: "white", fontSize: "10px", fontWeight: "700" }}>E</span>
            <span style={{ fontWeight: "500" }}>Earnings</span>
          </div>
        )}
        {showDividends && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", borderRadius: "4px", backgroundColor: "#10B981", color: "white", fontSize: "10px", fontWeight: "700" }}>D</span>
            <span style={{ fontWeight: "500" }}>Dividends</span>
          </div>
        )}
        {showEconomicEvents && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", borderRadius: "4px", backgroundColor: "#EF4444", color: "white", fontSize: "8px", fontWeight: "700" }}>$</span>
            <span style={{ fontWeight: "500" }}>Economic events</span>
          </div>
        )}
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

