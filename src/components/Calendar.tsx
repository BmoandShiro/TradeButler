import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, addDays, addWeeks, addMonths, addYears } from "date-fns";
import { ChevronLeft, ChevronRight, Heart, BookOpen, DollarSign, TrendingUp, Calendar as CalendarIcon, RefreshCw, Settings, Plus } from "lucide-react";
import { getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import type { DataMode } from "../utils/dataMode";
import { loadSandboxState, getSandboxEmotionalStates } from "../utils/sandboxStore";
import { buildPositionGroupsAndPairs } from "../utils/sandboxPairing";
import { getFinnhubApiKey } from "../utils/finnhubManager";
import { LoadingSphere } from "./LoadingSphere";

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

interface FinnhubEarning {
  date: string;
  symbol: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate: number | null;
  revenue_actual: number | null;
  hour: string | null;
}

interface FinnhubEconomicEvent {
  date: string;
  country: string;
  event: string;
  impact: string;
  actual: number | null;
  estimate: number | null;
  prev: number | null;
  unit: string | null;
}

interface IpoEvent {
  symbol: string | null;
  name: string | null;
  date: string | null;
  exchange: string | null;
  price: string | null;
  shares: number | null;
  status: string | null;
}

interface CustomReminder {
  id: number;
  mode: DataMode;
  type?:
    | "general"
    | "event"
    | "review"
    | "meeting"
    | "deadline"
    | "task"
    | "payment"
    | "close_trade"
    | "open_trade"
    | "earnings_watch"
    | "risk_check"
    | "rebalance"
    | "journal";
  title: string;
  description?: string;
  startDate: string; // yyyy-MM-dd
  time?: string; // HH:mm
  color?: string;
  recurrence: {
    unit: "once" | "day" | "week" | "month" | "year";
    interval: number; // 1 = every unit, 2 = bi-weekly if unit=week, etc.
  };
}

const CALENDAR_SHOW_EARNINGS_KEY = "tradebutler_calendar_show_earnings";
const CALENDAR_SHOW_DIVIDENDS_KEY = "tradebutler_calendar_show_dividends";
const CALENDAR_SHOW_ECONOMIC_KEY = "tradebutler_calendar_show_economic";
const CALENDAR_SHOW_IPO_KEY = "tradebutler_calendar_show_ipo";
const CALENDAR_CUSTOM_REMINDERS_KEY = "tradebutler_calendar_custom_reminders_v1";

// Cache keys and duration
const CALENDAR_EVENTS_CACHE_KEY = "tradebutler_calendar_events_cache_v2";
const ECONOMIC_EVENTS_CACHE_KEY = "tradebutler_economic_events_cache_v2";
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHED_MONTHS = 6; // Keep up to 6 months cached

interface MonthCacheEntry<T> {
  timestamp: number;
  events: T;
}

interface MultiMonthCache<T> {
  months: Record<string, MonthCacheEntry<T>>;
}

const getCachedEvents = (month: string): MonthCacheEntry<Record<string, CalendarEvent[]>> | null => {
  try {
    const cached = localStorage.getItem(CALENDAR_EVENTS_CACHE_KEY);
    if (!cached) return null;
    const data: MultiMonthCache<Record<string, CalendarEvent[]>> = JSON.parse(cached);
    const monthData = data.months?.[month];
    if (monthData && Date.now() - monthData.timestamp < CACHE_DURATION_MS) {
      return monthData;
    }
    return null;
  } catch {
    return null;
  }
};

const setCachedEvents = (month: string, events: Record<string, CalendarEvent[]>) => {
  try {
    const cached = localStorage.getItem(CALENDAR_EVENTS_CACHE_KEY);
    const data: MultiMonthCache<Record<string, CalendarEvent[]>> = cached 
      ? JSON.parse(cached) 
      : { months: {} };
    
    // Add the new month's data
    data.months[month] = {
      timestamp: Date.now(),
      events,
    };
    
    // Clean up old entries (keep only MAX_CACHED_MONTHS most recent)
    const sortedMonths = Object.entries(data.months)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, MAX_CACHED_MONTHS);
    
    data.months = Object.fromEntries(sortedMonths);
    
    localStorage.setItem(CALENDAR_EVENTS_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to cache calendar events:", e);
  }
};

const getCachedEconomicEvents = (month: string): MonthCacheEntry<Record<string, EconomicEvent[]>> | null => {
  try {
    const cached = localStorage.getItem(ECONOMIC_EVENTS_CACHE_KEY);
    if (!cached) return null;
    const data: MultiMonthCache<Record<string, EconomicEvent[]>> = JSON.parse(cached);
    const monthData = data.months?.[month];
    if (monthData && Date.now() - monthData.timestamp < CACHE_DURATION_MS) {
      return monthData;
    }
    return null;
  } catch {
    return null;
  }
};

const setCachedEconomicEvents = (month: string, events: Record<string, EconomicEvent[]>) => {
  try {
    const cached = localStorage.getItem(ECONOMIC_EVENTS_CACHE_KEY);
    const data: MultiMonthCache<Record<string, EconomicEvent[]>> = cached 
      ? JSON.parse(cached) 
      : { months: {} };
    
    // Add the new month's data
    data.months[month] = {
      timestamp: Date.now(),
      events,
    };
    
    // Clean up old entries
    const sortedMonths = Object.entries(data.months)
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, MAX_CACHED_MONTHS);
    
    data.months = Object.fromEntries(sortedMonths);
    
    localStorage.setItem(ECONOMIC_EVENTS_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to cache economic events:", e);
  }
};

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
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);
  
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
  const [showIPOs, setShowIPOs] = useState(() => {
    const saved = localStorage.getItem(CALENDAR_SHOW_IPO_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [ipoEvents, setIpoEvents] = useState<Record<string, IpoEvent[]>>({});
  const [showEventSettings, setShowEventSettings] = useState(false);

  // Custom reminders state
  const [customReminders, setCustomReminders] = useState<CustomReminder[]>(() => {
    try {
      const saved = localStorage.getItem(CALENDAR_CUSTOM_REMINDERS_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved) as CustomReminder[];
      const currentMode = getCurrentDataMode();
      // Migration: ensure every reminder has a mode; default to current mode for legacy entries.
      return parsed.map((r: any) => ({
        ...r,
        mode: r.mode ?? currentMode,
      }));
    } catch {
      return [];
    }
  });
  const [customRemindersByDate, setCustomRemindersByDate] = useState<Record<string, CustomReminder[]>>({});
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [newReminderType, setNewReminderType] = useState<NonNullable<CustomReminder["type"]>>("general");
  const [newReminderDescription, setNewReminderDescription] = useState("");
  const [newReminderDate, setNewReminderDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [newReminderTime, setNewReminderTime] = useState("09:00");
  const [newReminderColor, setNewReminderColor] = useState("#0EA5E9");
  const [newReminderRepeatUnit, setNewReminderRepeatUnit] = useState<CustomReminder["recurrence"]["unit"]>("month");
  const [newReminderRepeatInterval, setNewReminderRepeatInterval] = useState(1);
  const [editingReminderId, setEditingReminderId] = useState<number | null>(null);
  const [editReminderTitle, setEditReminderTitle] = useState("");
  const [editReminderType, setEditReminderType] = useState<NonNullable<CustomReminder["type"]>>("general");
  const [editReminderDescription, setEditReminderDescription] = useState("");
  const [editReminderDate, setEditReminderDate] = useState("");
  const [editReminderTime, setEditReminderTime] = useState("");
  const [editReminderColor, setEditReminderColor] = useState("#0EA5E9");
  const [editReminderRepeatUnit, setEditReminderRepeatUnit] = useState<CustomReminder["recurrence"]["unit"]>("month");
  const [editReminderRepeatInterval, setEditReminderRepeatInterval] = useState(1);

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
    localStorage.setItem(CALENDAR_SHOW_IPO_KEY, JSON.stringify(showIPOs));
  }, [showIPOs]);

  // Persist custom reminders
  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_CUSTOM_REMINDERS_KEY, JSON.stringify(customReminders));
    } catch {
      // ignore
    }
  }, [customReminders]);

  // Recompute reminder occurrences for the visible month
  useEffect(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const map: Record<string, CustomReminder[]> = {};

    for (const reminder of customReminders) {
      if (reminder.mode !== dataMode) continue;
      const start = new Date(reminder.startDate);
      if (Number.isNaN(start.getTime())) continue;

      const unit = reminder.recurrence?.unit ?? "once";
      const intervalRaw = reminder.recurrence?.interval ?? 1;
      const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 1;

      if (unit === "once") {
        const key = reminder.startDate;
        if (key >= format(monthStart, "yyyy-MM-dd") && key <= format(monthEnd, "yyyy-MM-dd")) {
          if (!map[key]) map[key] = [];
          map[key].push(reminder);
        }
        continue;
      }

      // Generate occurrences from start until end of visible month.
      // This supports "every N days/weeks/months/years" and naturally covers bi-weekly via unit=week interval=2.
      let occurrence = start;

      // Fast-forward close to monthStart to avoid long loops for old reminders.
      // For days/weeks, we can jump by repeated adds; month/year cadence is already bounded by monthEnd.
      while (occurrence < monthStart) {
        if (unit === "day") occurrence = addDays(occurrence, interval);
        else if (unit === "week") occurrence = addWeeks(occurrence, interval);
        else if (unit === "month") occurrence = addMonths(occurrence, interval);
        else occurrence = addYears(occurrence, interval);
      }

      while (occurrence <= monthEnd) {
        const key = format(occurrence, "yyyy-MM-dd");
        if (!map[key]) map[key] = [];
        map[key].push(reminder);

        if (unit === "day") occurrence = addDays(occurrence, interval);
        else if (unit === "week") occurrence = addWeeks(occurrence, interval);
        else if (unit === "month") occurrence = addMonths(occurrence, interval);
        else occurrence = addYears(occurrence, interval);
      }
    }

    setCustomRemindersByDate(map);
  }, [customReminders, currentDate]);

  useEffect(() => {
    const unsub = subscribeToDataMode(setDataMode);
    return unsub;
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [currentDate, dataMode]);

  // Helper function to deduplicate calendar events
  // Prefers Finnhub data when both sources have the same event
  const deduplicateEvents = (finnhubEvents: CalendarEvent[], yahooEvents: CalendarEvent[]): CalendarEvent[] => {
    const seen = new Set<string>();
    const dedupedEvents: CalendarEvent[] = [];
    
    // Add all Finnhub events first (preferred source)
    finnhubEvents.forEach(event => {
      const key = `${event.symbol}_${event.event_type}_${event.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvents.push(event);
      }
    });
    
    // Add Yahoo events only if no matching Finnhub event exists
    yahooEvents.forEach(event => {
      const key = `${event.symbol}_${event.event_type}_${event.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvents.push(event);
      }
    });
    
    return dedupedEvents;
  };

  // Fetch calendar events (earnings, dividends) from both Yahoo and Finnhub
  const fetchCalendarEvents = useCallback(async (forceRefresh = false) => {
    const monthKey = format(currentDate, "yyyy-MM");
    
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedEvents = getCachedEvents(monthKey);
      const cachedEconomic = getCachedEconomicEvents(monthKey);
      
      // Use cached data if available (check each independently)
      let usedCalendarCache = false;
      let usedEconomicCache = false;
      
      if (cachedEvents) {
        setCalendarEvents(cachedEvents.events);
        setCacheTimestamp(cachedEvents.timestamp);
        usedCalendarCache = true;
        console.log("Using cached calendar events (cache age:", Math.round((Date.now() - cachedEvents.timestamp) / 60000), "minutes)");
      }
      
      if (cachedEconomic) {
        setEconomicEvents(cachedEconomic.events);
        usedEconomicCache = true;
        console.log("Using cached economic events (cache age:", Math.round((Date.now() - cachedEconomic.timestamp) / 60000), "minutes)");
      }
      
      // If both caches are valid, we're done
      if (usedCalendarCache && usedEconomicCache) {
        return;
      }
    }
    
    setLoadingEvents(true);
    try {
      // Get watched symbols from news settings (shared with News page)
      const savedSymbols = localStorage.getItem("tradebutler_news_watched_symbols");
      const watchedSymbols: string[] = savedSymbols ? JSON.parse(savedSymbols) : [];
      
      // Get open position symbols (skip in sandbox mode since sandbox doesn't have real positions)
      let openSymbols: string[] = [];
      if (dataMode !== "sandbox") {
        const paperOnly = dataMode === "paper";
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
      }
      
      const allSymbols = [...new Set([...watchedSymbols, ...openSymbols])];
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const fromDate = format(monthStart, "yyyy-MM-dd");
      const toDate = format(monthEnd, "yyyy-MM-dd");
      
      let yahooEvents: CalendarEvent[] = [];
      let finnhubCalendarEvents: CalendarEvent[] = [];
      
      if (allSymbols.length > 0) {
        // Fetch from Yahoo Finance
        try {
          yahooEvents = await invoke<CalendarEvent[]>("fetch_calendar_events_batch", { symbols: allSymbols });
        } catch (e) {
          console.warn("Failed to fetch Yahoo calendar events:", e);
        }
        
        // Fetch from Finnhub (if API key is available)
        const finnhubApiKey = getFinnhubApiKey();
        if (finnhubApiKey) {
          try {
            const finnhubEarnings = await invoke<FinnhubEarning[]>("fetch_finnhub_earnings_batch", {
              apiKey: finnhubApiKey,
              symbols: allSymbols,
              fromDate,
              toDate,
            });
            
            // Convert Finnhub earnings to CalendarEvent format
            finnhubCalendarEvents = finnhubEarnings.map(earning => ({
              date: earning.date,
              symbol: earning.symbol,
              event_type: "earnings",
              title: `${earning.symbol} Earnings`,
              details: [
                earning.hour === "bmo" ? "Before Market Open" : earning.hour === "amc" ? "After Market Close" : null,
                earning.eps_estimate != null ? `EPS Est: $${earning.eps_estimate.toFixed(2)}` : null,
                earning.eps_actual != null ? `EPS Actual: $${earning.eps_actual.toFixed(2)}` : null,
              ].filter(Boolean).join(" | ") || null,
            }));
          } catch (e) {
            console.warn("Failed to fetch Finnhub earnings:", e);
          }
        }
      }
      
      // Deduplicate events, preferring Finnhub data
      const allEvents = deduplicateEvents(finnhubCalendarEvents, yahooEvents);
      
      const eventsMap: Record<string, CalendarEvent[]> = {};
      allEvents.forEach(event => {
        if (!eventsMap[event.date]) eventsMap[event.date] = [];
        eventsMap[event.date].push(event);
      });
      setCalendarEvents(eventsMap);
      
      // Cache the calendar events
      setCachedEvents(monthKey, eventsMap);
      
      // Fetch economic events - try Finnhub first if API key available, fallback to static
      let economicData: EconomicEvent[] = [];
      const finnhubApiKey = getFinnhubApiKey();
      
      if (finnhubApiKey) {
        try {
          const finnhubEconEvents = await invoke<FinnhubEconomicEvent[]>("fetch_finnhub_economic_calendar", {
            apiKey: finnhubApiKey,
            fromDate,
            toDate,
          });
          
          // Convert Finnhub economic events to our format
          economicData = finnhubEconEvents.map(event => ({
            date: event.date,
            event_type: event.event.toLowerCase().replace(/\s+/g, "_"),
            title: event.event,
            description: [
              event.actual != null ? `Actual: ${event.actual}${event.unit || ""}` : null,
              event.estimate != null ? `Est: ${event.estimate}${event.unit || ""}` : null,
              event.prev != null ? `Prev: ${event.prev}${event.unit || ""}` : null,
            ].filter(Boolean).join(" | ") || null,
            importance: event.impact || "medium",
          }));
        } catch (e) {
          console.warn("Failed to fetch Finnhub economic calendar, using static data:", e);
        }
      }
      
      // Fallback to static economic events if Finnhub didn't return any
      if (economicData.length === 0) {
        economicData = await invoke<EconomicEvent[]>("get_economic_calendar_range", {
          startDate: fromDate,
          endDate: toDate,
        });
      }
      
      const econMap: Record<string, EconomicEvent[]> = {};
      economicData.forEach(event => {
        if (!econMap[event.date]) econMap[event.date] = [];
        econMap[event.date].push(event);
      });
      setEconomicEvents(econMap);
      
      // Fetch IPO calendar (if Finnhub API key is available)
      if (finnhubApiKey) {
        try {
          const ipoData = await invoke<IpoEvent[]>("fetch_finnhub_ipo_calendar", {
            apiKey: finnhubApiKey,
            fromDate,
            toDate,
          });
          
          const ipoMap: Record<string, IpoEvent[]> = {};
          ipoData.forEach(ipo => {
            if (ipo.date) {
              if (!ipoMap[ipo.date]) ipoMap[ipo.date] = [];
              ipoMap[ipo.date].push(ipo);
            }
          });
          setIpoEvents(ipoMap);
        } catch (e) {
          console.warn("Failed to fetch IPO calendar:", e);
        }
      }
      
      // Cache the economic events
      setCachedEconomicEvents(monthKey, econMap);
      setCacheTimestamp(Date.now());
      
      console.log("Fetched and cached calendar events for", monthKey);
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

  const startEditingReminder = (reminder: CustomReminder, fallbackDate: string) => {
    setEditingReminderId(reminder.id);
    setEditReminderTitle(reminder.title);
    setEditReminderType(reminder.type || "general");
    setEditReminderDescription(reminder.description || "");
    setEditReminderDate(reminder.startDate || fallbackDate);
    setEditReminderTime(reminder.time || "");
    setEditReminderColor(reminder.color || "#0EA5E9");
    setEditReminderRepeatUnit(reminder.recurrence?.unit || "month");
    setEditReminderRepeatInterval(reminder.recurrence?.interval || 1);
  };

  const cancelEditingReminder = () => {
    setEditingReminderId(null);
  };

  const saveEditedReminder = () => {
    if (!editingReminderId) return;
    if (!editReminderTitle.trim()) return;
    setCustomReminders((prev) =>
      prev.map((r) =>
        r.id === editingReminderId
          ? {
              ...r,
              mode: r.mode ?? dataMode,
              title: editReminderTitle.trim(),
              type: editReminderType,
              description: editReminderDescription.trim() || undefined,
              startDate: editReminderDate,
              time: editReminderTime || undefined,
              color: editReminderColor || undefined,
              recurrence: {
                unit: editReminderRepeatUnit,
                interval: editReminderRepeatUnit === "once" ? 1 : Math.max(1, Math.floor(editReminderRepeatInterval || 1)),
              },
            }
          : r
      )
    );
    setEditingReminderId(null);
  };

  const deleteReminder = (id: number) => {
    setCustomReminders((prev) => prev.filter((r) => r.id !== id));
    if (editingReminderId === id) setEditingReminderId(null);
  };

  const getReminderTypeLabel = (type?: CustomReminder["type"]) => {
    switch (type || "general") {
      case "event": return "Event";
      case "review": return "Review";
      case "meeting": return "Meeting";
      case "deadline": return "Deadline";
      case "task": return "Task";
      case "payment": return "Payment";
      case "close_trade": return "Close trade";
      case "open_trade": return "Open trade";
      case "earnings_watch": return "Earnings watch";
      case "risk_check": return "Risk check";
      case "rebalance": return "Rebalance";
      case "journal": return "Trading journal";
      default: return "General reminder";
    }
  };

  const getReminderTypeAbbreviation = (type?: CustomReminder["type"]) => {
    switch (type || "general") {
      case "event": return "EVT";
      case "review": return "REV";
      case "meeting": return "MTG";
      case "deadline": return "DUE";
      case "task": return "TSK";
      case "payment": return "PAY";
      case "close_trade": return "CLOSE";
      case "open_trade": return "OPEN";
      case "earnings_watch": return "ERN";
      case "risk_check": return "RISK";
      case "rebalance": return "REBAL";
      case "journal": return "JRN";
      default: return "REM";
    }
  };

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
      case "custom_review": return "#0EA5E9";
      case "custom": return "#6B7280";
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
      case "custom_review": return "REV";
      case "custom": return "R";
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
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "240px", padding: "28px" }}>
        <LoadingSphere size={100} message="Loading calendar..." />
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

          {/* Add custom reminder button */}
          <button
            onClick={() => {
              setNewReminderTitle("");
              setNewReminderType("general");
              setNewReminderDescription("");
              setNewReminderDate(format(currentDate, "yyyy-MM-dd"));
              setNewReminderTime("09:00");
              setNewReminderColor("#0EA5E9");
              setNewReminderRepeatUnit("month");
              setNewReminderRepeatInterval(1);
              setShowAddReminder(true);
            }}
            title="Add custom reminder (e.g. monthly review)"
            style={{
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "10px",
              padding: "8px 12px",
              color: "var(--bg-primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <Plus size={16} />
            Reminder
          </button>
          
          {/* Refresh events button */}
          <button
            onClick={() => fetchCalendarEvents(true)}
            disabled={loadingEvents}
            title={cacheTimestamp 
              ? `Refresh events (last updated ${Math.round((Date.now() - cacheTimestamp) / 60000)} min ago)` 
              : "Refresh events"}
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
              gap: "6px",
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
            {cacheTimestamp && (
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                {Math.round((Date.now() - cacheTimestamp) / 60000)}m
              </span>
            )}
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
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={showIPOs}
                      onChange={(e) => setShowIPOs(e.target.checked)}
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
                        backgroundColor: "#F59E0B",
                        color: "white",
                        fontSize: "9px",
                        fontWeight: "700"
                      }}>IPO</span>
                      IPO Events
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
          const dateKey = getDateKey(day);
          const dayCustomReminders = customRemindersByDate[dateKey] || [];
          const isCurrentDay = isToday(day);
          const pnlColor = getDayColor(dayPnL?.profit_loss ?? null);
          const isDropdownOpen = openJournalDate === dateKey;
          
          // Filter events based on settings
          const earningsEvents = showEarnings ? dayCalEvents.filter(e => e.event_type === "earnings") : [];
          const dividendEvents = showDividends ? dayCalEvents.filter(e => e.event_type.startsWith("dividend")) : [];
          const filteredEconEvents = showEconomicEvents ? dayEconEvents : [];
          const dayIpoEvents = showIPOs ? (ipoEvents[dateKey] || []) : [];
          
          const hasContent = dayPnL || journalEntries.length > 0 || emotionalStates.length > 0 ||
            earningsEvents.length > 0 || dividendEvents.length > 0 || filteredEconEvents.length > 0 || dayIpoEvents.length > 0 || dayCustomReminders.length > 0;

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
              {(journalEntries.length > 0 || emotionalStates.length > 0 || earningsEvents.length > 0 || dividendEvents.length > 0 || filteredEconEvents.length > 0 || dayIpoEvents.length > 0 || dayCustomReminders.length > 0) && (
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
                  {dayIpoEvents.map((ipo, idx) => (
                    <span
                      key={`ipo-${idx}`}
                      onClick={openDetails}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "2px 5px",
                        borderRadius: "4px",
                        backgroundColor: "#F59E0B",
                        color: "white",
                        fontSize: "9px",
                        fontWeight: "700",
                        cursor: "pointer",
                      }}
                      title={`IPO: ${ipo.name || ipo.symbol || "Unknown"}`}
                    >
                      IPO
                    </span>
                  ))}
                  {dayCustomReminders.map((reminder, idx) => {
                    const reminderColor = reminder.color || getEventBadgeColor(reminder.type === "review" ? "custom_review" : "custom");
                    return (
                      <span
                        key={`reminder-${idx}`}
                        onClick={openDetails}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: reminderColor,
                          color: "white",
                          fontSize: "9px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                        title={reminder.title}
                      >
                        {getReminderTypeAbbreviation(reminder.type)}
                      </span>
                    );
                  })}
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
                      {(earningsEvents.length > 0 || dividendEvents.length > 0 || filteredEconEvents.length > 0 || dayIpoEvents.length > 0 || dayCustomReminders.length > 0) && (
                        <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: journalEntries.length > 0 ? "1px solid var(--border-color)" : "none" }}>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <CalendarIcon size={14} style={{ color: "var(--accent)" }} />
                            Events & Reminders
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
                            {dayIpoEvents.map((ipo, idx) => (
                              <div
                                key={`ipo-detail-${idx}`}
                                style={{
                                  padding: "10px 12px",
                                  background: "var(--bg-tertiary)",
                                  borderRadius: "8px",
                                  borderLeft: "3px solid #F59E0B",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                  <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "2px 5px",
                                    borderRadius: "4px",
                                    backgroundColor: "#F59E0B",
                                    color: "white",
                                    fontSize: "9px",
                                    fontWeight: "700",
                                  }}>
                                    IPO
                                  </span>
                                  {ipo.symbol && (
                                    <span style={{
                                      fontSize: "10px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      backgroundColor: "var(--accent)",
                                      color: "var(--bg-primary)",
                                      fontWeight: "600",
                                    }}>
                                      {ipo.symbol}
                                    </span>
                                  )}
                                  {ipo.status && (
                                    <span style={{
                                      fontSize: "10px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      backgroundColor: ipo.status.toLowerCase() === "priced" ? "rgba(16, 185, 129, 0.2)" : "var(--bg-secondary)",
                                      color: ipo.status.toLowerCase() === "priced" ? "#10B981" : "var(--text-secondary)",
                                      fontWeight: "600",
                                    }}>
                                      {ipo.status}
                                    </span>
                                  )}
                                </div>
                                <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", fontWeight: "500" }}>{ipo.name || "Unknown Company"}</p>
                                <div style={{ display: "flex", gap: "12px", marginTop: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                                  {ipo.exchange && <span>Exchange: {ipo.exchange}</span>}
                                  {ipo.price && <span>Price: ${ipo.price}</span>}
                                </div>
                              </div>
                            ))}
                            {dayCustomReminders.map((reminder, idx) => {
                              const reminderColor = reminder.color || getEventBadgeColor(reminder.type === "review" ? "custom_review" : "custom");
                              const isEditing = editingReminderId === reminder.id;
                              return (
                                <div
                                  key={`reminder-detail-${idx}`}
                                  style={{
                                    padding: "10px 12px",
                                    background: "var(--bg-tertiary)",
                                    borderRadius: "8px",
                                    borderLeft: `3px solid ${reminderColor}`,
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        backgroundColor: reminderColor,
                                        color: "white",
                                        fontSize: "9px",
                                        fontWeight: "700",
                                      }}
                                    >
                                      {getReminderTypeAbbreviation(reminder.type)}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        backgroundColor: "var(--bg-secondary)",
                                        color: "var(--text-secondary)",
                                        fontWeight: "600",
                                      }}
                                    >
                                      {getReminderTypeLabel(reminder.type)}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        backgroundColor: "var(--bg-secondary)",
                                        color: "var(--text-secondary)",
                                        fontWeight: "600",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                    {reminder.recurrence.unit === "once"
                                      ? "One-time"
                                      : `Every ${reminder.recurrence.interval} ${reminder.recurrence.unit}${reminder.recurrence.interval === 1 ? "" : "s"}`}
                                    </span>
                                  </div>
                                  <p style={{ margin: 0, fontSize: "14px", color: "var(--text-primary)", fontWeight: "500" }}>
                                    {reminder.title}{reminder.time ? ` · ${reminder.time}` : ""}
                                  </p>
                                  {reminder.description && (
                                    <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                                      {reminder.description}
                                    </p>
                                  )}
                                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      onClick={() => startEditingReminder(reminder, dateKey)}
                                      style={{
                                        border: "1px solid var(--border-color)",
                                        background: "var(--bg-secondary)",
                                        color: "var(--text-primary)",
                                        fontSize: "12px",
                                        borderRadius: "6px",
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCustomReminders((prev) =>
                                          prev.map((r) =>
                                            r.id === reminder.id
                                              ? {
                                                  ...r,
                                                  startDate: dateKey,
                                                }
                                              : r
                                          )
                                        );
                                      }}
                                      style={{
                                        border: "1px solid var(--border-color)",
                                        background: "var(--bg-secondary)",
                                        color: "var(--text-primary)",
                                        fontSize: "12px",
                                        borderRadius: "6px",
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Move to this day
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteReminder(reminder.id)}
                                      style={{
                                        border: "1px solid color-mix(in srgb, #EF4444 60%, var(--border-color))",
                                        background: "transparent",
                                        color: "#EF4444",
                                        fontSize: "12px",
                                        borderRadius: "6px",
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                  {isEditing && (
                                    <div
                                      style={{
                                        marginTop: "10px",
                                        paddingTop: "10px",
                                        borderTop: "1px solid var(--border-color)",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "8px",
                                      }}
                                    >
                                      <input
                                        type="text"
                                        value={editReminderTitle}
                                        onChange={(e) => setEditReminderTitle(e.target.value)}
                                        style={{
                                          padding: "8px 10px",
                                          borderRadius: "8px",
                                          border: "1px solid var(--border-color)",
                                          background: "var(--bg-secondary)",
                                          color: "var(--text-primary)",
                                          fontSize: "13px",
                                        }}
                                      />
                                      <select
                                        className="themed-control"
                                        value={editReminderType}
                                        onChange={(e) => setEditReminderType(e.target.value as NonNullable<CustomReminder["type"]>)}
                                        style={{
                                          padding: "8px 10px",
                                          borderRadius: "8px",
                                          border: "1px solid var(--border-color)",
                                          background: "var(--bg-secondary)",
                                          color: "var(--text-primary)",
                                          fontSize: "13px",
                                        }}
                                      >
                                        <option value="general">General reminder (REM)</option>
                                        <option value="event">Event (EVT)</option>
                                        <option value="review">Review (REV)</option>
                                        <option value="meeting">Meeting (MTG)</option>
                                        <option value="deadline">Deadline (DUE)</option>
                                        <option value="task">Task (TSK)</option>
                                        <option value="payment">Payment (PAY)</option>
                                        <option value="close_trade">Close trade (CLOSE)</option>
                                        <option value="open_trade">Open trade (OPEN)</option>
                                        <option value="earnings_watch">Earnings watch (ERN)</option>
                                        <option value="risk_check">Risk check (RISK)</option>
                                        <option value="rebalance">Rebalance (REBAL)</option>
                                        <option value="journal">Trading journal (JRN)</option>
                                      </select>
                                      <textarea
                                        value={editReminderDescription}
                                        onChange={(e) => setEditReminderDescription(e.target.value)}
                                        rows={2}
                                        style={{
                                          padding: "8px 10px",
                                          borderRadius: "8px",
                                          border: "1px solid var(--border-color)",
                                          background: "var(--bg-secondary)",
                                          color: "var(--text-primary)",
                                          fontSize: "12px",
                                          resize: "vertical",
                                        }}
                                      />
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 82px", gap: "8px" }}>
                                        <input
                                        className="themed-control date-input"
                                          type="date"
                                          value={editReminderDate}
                                          onChange={(e) => setEditReminderDate(e.target.value)}
                                          style={{
                                            padding: "8px 10px",
                                            borderRadius: "8px",
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                            color: "var(--text-primary)",
                                            fontSize: "12px",
                                          }}
                                        />
                                        <input
                                        className="themed-control time-input"
                                          type="time"
                                          value={editReminderTime}
                                          onChange={(e) => setEditReminderTime(e.target.value)}
                                          style={{
                                            padding: "8px 10px",
                                            borderRadius: "8px",
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                            color: "var(--text-primary)",
                                            fontSize: "12px",
                                          }}
                                        />
                                        <input
                                          type="color"
                                          value={editReminderColor}
                                          onChange={(e) => setEditReminderColor(e.target.value)}
                                          style={{
                                            height: "34px",
                                            borderRadius: "8px",
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                          }}
                                        />
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                        <select
                                          className="themed-control"
                                          value={editReminderRepeatUnit}
                                          onChange={(e) => setEditReminderRepeatUnit(e.target.value as CustomReminder["recurrence"]["unit"])}
                                          style={{
                                            padding: "8px 10px",
                                            borderRadius: "8px",
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                            color: "var(--text-primary)",
                                            fontSize: "12px",
                                          }}
                                        >
                                          <option value="once">Once</option>
                                          <option value="day">Daily</option>
                                          <option value="week">Weekly</option>
                                          <option value="month">Monthly</option>
                                          <option value="year">Yearly</option>
                                        </select>
                                        <input
                                          className="themed-control"
                                          type="number"
                                          min={1}
                                          step={1}
                                          value={editReminderRepeatInterval}
                                          disabled={editReminderRepeatUnit === "once"}
                                          onChange={(e) => setEditReminderRepeatInterval(parseInt(e.target.value || "1", 10))}
                                          style={{
                                            padding: "8px 10px",
                                            borderRadius: "8px",
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                            color: "var(--text-primary)",
                                            fontSize: "12px",
                                            opacity: editReminderRepeatUnit === "once" ? 0.6 : 1,
                                          }}
                                        />
                                      </div>
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button
                                          type="button"
                                          onClick={saveEditedReminder}
                                          style={{
                                            border: "none",
                                            background: "var(--accent)",
                                            color: "var(--bg-primary)",
                                            fontSize: "12px",
                                            borderRadius: "6px",
                                            padding: "6px 10px",
                                            cursor: "pointer",
                                            fontWeight: "600",
                                          }}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditingReminder}
                                          style={{
                                            border: "1px solid var(--border-color)",
                                            background: "var(--bg-secondary)",
                                            color: "var(--text-primary)",
                                            fontSize: "12px",
                                            borderRadius: "6px",
                                            padding: "6px 10px",
                                            cursor: "pointer",
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
        {customReminders.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "16px",
                height: "16px",
                borderRadius: "4px",
                backgroundColor: "#0EA5E9",
                color: "white",
                fontSize: "9px",
                fontWeight: "700",
              }}
            >
              REV
            </span>
            <span style={{ fontWeight: "500" }}>Custom reminders</span>
          </div>
        )}
      </div>

      {/* Add reminder modal */}
      {showAddReminder && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setShowAddReminder(false)}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              borderRadius: "14px",
              border: "1px solid var(--border-color)",
              padding: "20px 22px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 650, color: "var(--text-primary)" }}>
                Add reminder
              </h2>
              <button
                onClick={() => setShowAddReminder(false)}
                style={{
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-secondary)",
                  borderRadius: "999px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Close
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newReminderTitle.trim()) return;
                const reminder: CustomReminder = {
                  id: Date.now(),
              mode: dataMode,
                  type: newReminderType,
                  title: newReminderTitle.trim(),
                  description: newReminderDescription.trim() || undefined,
                  startDate: newReminderDate,
                    time: newReminderTime || undefined,
                  color: newReminderColor || undefined,
                    recurrence: {
                      unit: newReminderRepeatUnit,
                      interval: Math.max(1, Math.floor(newReminderRepeatInterval || 1)),
                    },
                };
                setCustomReminders((prev) => [...prev, reminder]);
                setShowAddReminder(false);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Title
                </label>
                <input
                  className="themed-control"
                  type="text"
                  value={newReminderTitle}
                  onChange={(e) => setNewReminderTitle(e.target.value)}
                  placeholder="e.g. Monthly review"
                  required
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Type
                </label>
                <select
                  className="themed-control"
                  value={newReminderType}
                  onChange={(e) => setNewReminderType(e.target.value as NonNullable<CustomReminder["type"]>)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    outline: "none",
                  }}
                >
                  <option value="general">General reminder (REM)</option>
                  <option value="event">Event (EVT)</option>
                  <option value="review">Review (REV)</option>
                  <option value="meeting">Meeting (MTG)</option>
                  <option value="deadline">Deadline (DUE)</option>
                  <option value="task">Task (TSK)</option>
                  <option value="payment">Payment (PAY)</option>
                  <option value="close_trade">Close trade (CLOSE)</option>
                  <option value="open_trade">Open trade (OPEN)</option>
                  <option value="earnings_watch">Earnings watch (ERN)</option>
                  <option value="risk_check">Risk check (RISK)</option>
                  <option value="rebalance">Rebalance (REBAL)</option>
                  <option value="journal">Trading journal (JRN)</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Description <span style={{ fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  className="themed-control"
                  value={newReminderDescription}
                  onChange={(e) => setNewReminderDescription(e.target.value)}
                  rows={3}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: "14px",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Start date
                  </label>
                  <input
                    className="themed-control date-input"
                    type="date"
                    value={newReminderDate}
                    onChange={(e) => setNewReminderDate(e.target.value)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Time
                  </label>
                  <input
                    className="themed-control time-input"
                    type="time"
                    value={newReminderTime}
                    onChange={(e) => setNewReminderTime(e.target.value)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ width: "92px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Color
                  </label>
                  <input
                    type="color"
                    value={newReminderColor}
                    onChange={(e) => setNewReminderColor(e.target.value)}
                    style={{
                      height: "42px",
                      width: "100%",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      cursor: "pointer",
                    }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Repeat
                  </label>
                  <select
                    className="themed-control"
                    value={newReminderRepeatUnit}
                    onChange={(e) => setNewReminderRepeatUnit(e.target.value as CustomReminder["recurrence"]["unit"])}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      outline: "none",
                    }}
                  >
                    <option value="once">Once</option>
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Every
                  </label>
                  <input
                    className="themed-control"
                    type="number"
                    min={1}
                    step={1}
                    value={newReminderRepeatInterval}
                    disabled={newReminderRepeatUnit === "once"}
                    onChange={(e) => setNewReminderRepeatInterval(parseInt(e.target.value || "1", 10))}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      outline: "none",
                      opacity: newReminderRepeatUnit === "once" ? 0.6 : 1,
                    }}
                  />
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    {newReminderRepeatUnit === "once"
                      ? "One-time"
                      : newReminderRepeatUnit === "day"
                        ? "days (2 = every 2 days)"
                        : newReminderRepeatUnit === "week"
                          ? "weeks (2 = bi-weekly)"
                          : newReminderRepeatUnit === "month"
                            ? "months"
                            : "years"}
                  </div>
                </div>
              </div>
              <button
                type="submit"
                style={{
                  marginTop: "6px",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--bg-primary)",
                  fontSize: "14px",
                  fontWeight: 650,
                  cursor: "pointer",
                }}
              >
                Save reminder
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        .themed-control {
          color-scheme: dark;
        }
        .date-input,
        .time-input {
          position: relative;
          padding-right: 34px !important;
          background-repeat: no-repeat !important;
          background-position: right 10px center !important;
          background-size: 14px 14px !important;
        }
        .date-input {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2v4'/%3E%3Cpath d='M16 2v4'/%3E%3Crect width='18' height='18' x='3' y='4' rx='2'/%3E%3Cpath d='M3 10h18'/%3E%3C/svg%3E");
        }
        .time-input {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpolyline points='12 6 12 12 16 14'/%3E%3C/svg%3E");
        }
        .themed-control::-webkit-calendar-picker-indicator {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
        }
        .themed-control:focus {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
        }
      `}</style>
    </div>
  );
}

