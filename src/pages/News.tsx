import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
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
  Newspaper,
  Search,
  TrendingUp,
  TrendingDown,
  VolumeX,
  Volume2,
  BookOpen,
  FolderPlus,
  Folder,
  Trash2,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { getFinnhubApiKey } from "../utils/finnhubManager";

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
  priceChange?: number;
  priceChangePercent?: number;
}

interface CalendarEvent {
  date: string;
  symbol: string | null;
  event_type: string;
  title: string;
  details: string | null;
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
const NEWS_MUTED_SYMBOLS_KEY = "tradebutler_news_muted_symbols";
const NEWS_WATCHLISTS_KEY = "tradebutler_news_watchlists";
const NEWS_SHOW_SENTIMENT_KEY = "tradebutler_news_show_sentiment";
const NEWS_SHOW_PRICE_CHANGE_KEY = "tradebutler_news_show_price_change";
const NEWS_CALENDAR_CACHE_KEY = "tradebutler_news_calendar_cache";
const NEWS_READ_IDS_KEY = "tradebutler_news_read_ids";
const NEWS_ITEMS_PER_PAGE_KEY = "tradebutler_news_items_per_page";
const NEWS_EVENTS_PER_PAGE_KEY = "tradebutler_news_events_per_page";
const NEWS_READ_IDS_MAX_KEY = "tradebutler_news_read_ids_max";
const NEWS_CALENDAR_CACHE_MAX_EVENTS_KEY = "tradebutler_news_calendar_cache_max_events";

const DEFAULT_NEWS_ITEMS_PER_PAGE = 15;
const DEFAULT_EVENTS_PER_PAGE = 10;
const DEFAULT_READ_IDS_MAX = 5000;
const DEFAULT_CALENDAR_CACHE_MAX_EVENTS = 250;

const NEWS_ITEMS_PER_PAGE_OPTIONS = [5, 10, 15, 20, 25, 50] as const;
const EVENTS_PER_PAGE_OPTIONS = [3, 5, 10, 15, 20, 25, 30] as const;
const READ_IDS_MAX_OPTIONS = [500, 1000, 2500, 5000, 10000, 25000] as const;
const CALENDAR_CACHE_MAX_OPTIONS = [50, 100, 250, 500, 1000, 2000] as const;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === "") return fallback;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseAllowedInt(
  raw: string | null,
  allowed: readonly number[],
  fallback: number
): number {
  const n = raw == null || raw === "" ? fallback : parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return allowed.includes(n) ? n : fallback;
}

function loadReadIdsFromStorage(maxAllowed: number): string[] {
  try {
    const raw = localStorage.getItem(NEWS_READ_IDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    return list.length > maxAllowed ? list.slice(-maxAllowed) : list;
  } catch {
    return [];
  }
}

const NEWS_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

interface CachedNewsCalendarData {
  timestamp: number;
  symbolsHash: string;
  events: CalendarEvent[];
}

const getNewsCalendarCache = (symbolsHash: string): CachedNewsCalendarData | null => {
  try {
    const cached = localStorage.getItem(NEWS_CALENDAR_CACHE_KEY);
    if (!cached) return null;
    const data: CachedNewsCalendarData = JSON.parse(cached);
    if (data.symbolsHash === symbolsHash && Date.now() - data.timestamp < NEWS_CACHE_DURATION_MS) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
};

const setNewsCalendarCache = (symbolsHash: string, events: CalendarEvent[], maxEvents: number) => {
  const trimmed =
    events.length > maxEvents ? events.slice(0, Math.max(0, maxEvents)) : events;
  const data: CachedNewsCalendarData = {
    timestamp: Date.now(),
    symbolsHash,
    events: trimmed,
  };
  localStorage.setItem(NEWS_CALENDAR_CACHE_KEY, JSON.stringify(data));
};

// Sentiment keywords for basic analysis
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

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export default function News() {
  const navigate = useNavigate();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [news, setNews] = useState<NewsItemWithMeta[]>([]);
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

  // New feature states
  const [searchQuery, setSearchQuery] = useState("");
  const [mutedSymbols, setMutedSymbols] = useState<string[]>(() => {
    const saved = localStorage.getItem(NEWS_MUTED_SYMBOLS_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => {
    const saved = localStorage.getItem(NEWS_WATCHLISTS_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [showSentiment, setShowSentiment] = useState(() => {
    const saved = localStorage.getItem(NEWS_SHOW_SENTIMENT_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [showPriceChange, setShowPriceChange] = useState(() => {
    const saved = localStorage.getItem(NEWS_SHOW_PRICE_CHANGE_KEY);
    return saved ? JSON.parse(saved) : true;
  });
  const [priceData, setPriceData] = useState<Record<string, { price: number; change: number; changePercent: number }>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [selectedWatchlist, setSelectedWatchlist] = useState<string | null>(null);
  const [filterSentiment, setFilterSentiment] = useState<"all" | "positive" | "negative" | "neutral">("all");
  const [readIdsMax, setReadIdsMax] = useState(() =>
    parseAllowedInt(localStorage.getItem(NEWS_READ_IDS_MAX_KEY), [...READ_IDS_MAX_OPTIONS], DEFAULT_READ_IDS_MAX)
  );
  const [readNewsIds, setReadNewsIds] = useState<string[]>(() =>
    loadReadIdsFromStorage(
      parseAllowedInt(localStorage.getItem(NEWS_READ_IDS_MAX_KEY), [...READ_IDS_MAX_OPTIONS], DEFAULT_READ_IDS_MAX)
    )
  );
  const [newsItemsPerPage, setNewsItemsPerPage] = useState(() =>
    parseAllowedInt(localStorage.getItem(NEWS_ITEMS_PER_PAGE_KEY), [...NEWS_ITEMS_PER_PAGE_OPTIONS], DEFAULT_NEWS_ITEMS_PER_PAGE)
  );
  const [eventsPerPage, setEventsPerPage] = useState(() =>
    parseAllowedInt(localStorage.getItem(NEWS_EVENTS_PER_PAGE_KEY), [...EVENTS_PER_PAGE_OPTIONS], DEFAULT_EVENTS_PER_PAGE)
  );
  const [calendarCacheMaxEvents, setCalendarCacheMaxEvents] = useState(() =>
    parseAllowedInt(
      localStorage.getItem(NEWS_CALENDAR_CACHE_MAX_EVENTS_KEY),
      [...CALENDAR_CACHE_MAX_OPTIONS],
      DEFAULT_CALENDAR_CACHE_MAX_EVENTS
    )
  );
  const [newsPage, setNewsPage] = useState(1);
  const [eventsPage, setEventsPage] = useState(1);
  const [selectedNewsIds, setSelectedNewsIds] = useState<string[]>([]);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  // Subscribe to data mode changes
  useEffect(() => {
    return subscribeToDataMode(setDataMode);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

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

  // Fetch price data for symbols
  const fetchPriceData = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    
    const prices: Record<string, { price: number; change: number; changePercent: number }> = {};
    
    for (const symbol of symbols) {
      try {
        const quote = await invoke<{ current_price?: number; dividend_rate?: number }>("fetch_stock_quote", { symbol });
        if (quote.current_price) {
          prices[symbol] = {
            price: quote.current_price,
            change: 0,
            changePercent: 0,
          };
        }
      } catch (e) {
        console.error(`Failed to fetch price for ${symbol}:`, e);
      }
    }
    
    setPriceData(prices);
  }, []);

  // Helper to deduplicate calendar events, preferring Finnhub data
  const deduplicateCalendarEvents = (finnhubEvents: CalendarEvent[], yahooEvents: CalendarEvent[]): CalendarEvent[] => {
    const seen = new Set<string>();
    const dedupedEvents: CalendarEvent[] = [];
    
    // Add Finnhub events first (preferred source)
    finnhubEvents.forEach(event => {
      const key = `${event.symbol}_${event.event_type}_${event.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvents.push(event);
      }
    });
    
    // Add Yahoo events only if no matching Finnhub event
    yahooEvents.forEach(event => {
      const key = `${event.symbol}_${event.event_type}_${event.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvents.push(event);
      }
    });
    
    return dedupedEvents;
  };

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
      // Fetch news from Yahoo
      const newsResult = await invoke<NewsItem[]>("fetch_news_batch", { symbols }).catch(e => {
        console.error("Failed to fetch news:", e);
        return [] as NewsItem[];
      });
      
      const newsWithMeta: NewsItemWithMeta[] = newsResult.map(item => ({
        ...item,
        sentiment: analyzeSentiment(item.title),
      }));
      setNews(newsWithMeta);
      
      // Fetch calendar events from both Yahoo and Finnhub (with caching)
      const symbolsHash = symbols.sort().join(",");
      const cachedCalendar = getNewsCalendarCache(symbolsHash);
      
      if (cachedCalendar) {
        // Use cached calendar events (trim to current cap)
        const ev = cachedCalendar.events;
        setCalendarEvents(
          ev.length > calendarCacheMaxEvents ? ev.slice(0, calendarCacheMaxEvents) : ev
        );
        console.log("Using cached calendar events (cache age:", Math.round((Date.now() - cachedCalendar.timestamp) / 60000), "minutes)");
      } else {
        // Fetch fresh calendar events
        let yahooEvents: CalendarEvent[] = [];
        let finnhubCalendarEvents: CalendarEvent[] = [];
        
        // Yahoo calendar events
        try {
          yahooEvents = await invoke<CalendarEvent[]>("fetch_calendar_events_batch", { symbols });
        } catch (e) {
          console.warn("Failed to fetch Yahoo calendar events:", e);
        }
        
        // Finnhub earnings (if API key available)
        const finnhubApiKey = getFinnhubApiKey();
        if (finnhubApiKey) {
          try {
            const today = new Date();
            const futureDate = new Date(today);
            futureDate.setDate(futureDate.getDate() + 60); // Look ahead 60 days
            
            const finnhubEarnings = await invoke<FinnhubEarning[]>("fetch_finnhub_earnings_batch", {
              apiKey: finnhubApiKey,
              symbols,
              fromDate: format(today, "yyyy-MM-dd"),
              toDate: format(futureDate, "yyyy-MM-dd"),
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
        
        // Deduplicate events, preferring Finnhub data
        const allEvents = deduplicateCalendarEvents(finnhubCalendarEvents, yahooEvents);
        const eventsForUi =
          allEvents.length > calendarCacheMaxEvents ? allEvents.slice(0, calendarCacheMaxEvents) : allEvents;
        setCalendarEvents(eventsForUi);

        // Cache the calendar events (trimmed for localStorage size)
        setNewsCalendarCache(symbolsHash, allEvents, calendarCacheMaxEvents);
        console.log("Fetched and cached calendar events for", symbols.length, "symbols");
      }
      
      setLastRefresh(new Date());
      
      // Fetch price data in background
      if (showPriceChange) {
        fetchPriceData(symbols);
      }
    } catch (e) {
      console.error("Failed to fetch news:", e);
      setError(typeof e === "string" ? e : "Failed to fetch news");
    } finally {
      setIsLoading(false);
    }
  }, [getAllSymbols, fetchPriceData, showPriceChange, calendarCacheMaxEvents]);

  // Initial fetch and when symbols change
  useEffect(() => {
    fetchNews();
  }, [watchedSymbols, includeOpenPositions, openPositionSymbols]);

  // Listen for keyboard shortcut refresh event
  useEffect(() => {
    const handleRefresh = () => {
      fetchNews();
    };
    window.addEventListener("tradeButlerRefreshNews", handleRefresh);
    return () => window.removeEventListener("tradeButlerRefreshNews", handleRefresh);
  }, [fetchNews]);

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

  // Save new settings
  useEffect(() => {
    localStorage.setItem(NEWS_MUTED_SYMBOLS_KEY, JSON.stringify(mutedSymbols));
  }, [mutedSymbols]);

  useEffect(() => {
    localStorage.setItem(NEWS_WATCHLISTS_KEY, JSON.stringify(watchlists));
  }, [watchlists]);

  useEffect(() => {
    localStorage.setItem(NEWS_SHOW_SENTIMENT_KEY, JSON.stringify(showSentiment));
  }, [showSentiment]);

  useEffect(() => {
    localStorage.setItem(NEWS_SHOW_PRICE_CHANGE_KEY, JSON.stringify(showPriceChange));
  }, [showPriceChange]);

  useEffect(() => {
    localStorage.setItem(NEWS_READ_IDS_KEY, JSON.stringify(readNewsIds));
  }, [readNewsIds]);

  useEffect(() => {
    setReadNewsIds((prev) => (prev.length > readIdsMax ? prev.slice(-readIdsMax) : prev));
  }, [readIdsMax]);

  useEffect(() => {
    localStorage.setItem(NEWS_READ_IDS_MAX_KEY, String(readIdsMax));
  }, [readIdsMax]);

  useEffect(() => {
    localStorage.setItem(NEWS_ITEMS_PER_PAGE_KEY, String(newsItemsPerPage));
  }, [newsItemsPerPage]);

  useEffect(() => {
    localStorage.setItem(NEWS_EVENTS_PER_PAGE_KEY, String(eventsPerPage));
  }, [eventsPerPage]);

  useEffect(() => {
    localStorage.setItem(NEWS_CALENDAR_CACHE_MAX_EVENTS_KEY, String(calendarCacheMaxEvents));
  }, [calendarCacheMaxEvents]);

  // Analyze sentiment of a news title
  const analyzeSentiment = (title: string): "positive" | "negative" | "neutral" => {
    const lowerTitle = title.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;
    
    POSITIVE_KEYWORDS.forEach(keyword => {
      if (lowerTitle.includes(keyword)) positiveScore++;
    });
    
    NEGATIVE_KEYWORDS.forEach(keyword => {
      if (lowerTitle.includes(keyword)) negativeScore++;
    });
    
    if (positiveScore > negativeScore) return "positive";
    if (negativeScore > positiveScore) return "negative";
    return "neutral";
  };

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

  // Mute/unmute a symbol
  const toggleMuteSymbol = (symbol: string) => {
    if (mutedSymbols.includes(symbol)) {
      setMutedSymbols(mutedSymbols.filter(s => s !== symbol));
    } else {
      setMutedSymbols([...mutedSymbols, symbol]);
    }
  };

  // Create a new watchlist
  const createWatchlist = () => {
    if (!newWatchlistName.trim()) return;
    const newList: Watchlist = {
      id: Date.now().toString(),
      name: newWatchlistName.trim(),
      symbols: [...watchedSymbols],
    };
    setWatchlists([...watchlists, newList]);
    setNewWatchlistName("");
    setShowWatchlistModal(false);
  };

  // Load a watchlist
  const loadWatchlist = (watchlist: Watchlist) => {
    setWatchedSymbols(watchlist.symbols);
    setSelectedWatchlist(watchlist.id);
  };

  // Delete a watchlist
  const deleteWatchlist = (id: string) => {
    setWatchlists(watchlists.filter(w => w.id !== id));
    if (selectedWatchlist === id) setSelectedWatchlist(null);
  };

  // Create journal entry from news
  const createJournalFromNews = (item: NewsItemWithMeta) => {
    // Navigate to journal with pre-filled data
    navigate("/journal", {
      state: {
        prefillTitle: `News: ${item.symbol} - ${item.title}`,
        prefillNotes: `Source: ${item.source}\nLink: ${item.link}\nDate: ${item.pub_date}`,
      },
    });
  };

  // Filter news by symbol, search, sentiment, and muted
  const filteredNews = news
    .filter(item => !mutedSymbols.includes(item.symbol))
    .filter(item => filterSymbol === null || item.symbol === filterSymbol)
    .filter(item => filterSentiment === "all" || item.sentiment === filterSentiment)
    .filter(item => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(query) ||
        item.symbol.toLowerCase().includes(query) ||
        item.source.toLowerCase().includes(query)
      );
    });

  const newsTotalPages = Math.max(1, Math.ceil(filteredNews.length / newsItemsPerPage));
  const safeNewsPage = Math.min(newsPage, newsTotalPages);
  const paginatedNews = filteredNews.slice(
    (safeNewsPage - 1) * newsItemsPerPage,
    safeNewsPage * newsItemsPerPage
  );

  const eventsTotalPages = Math.max(1, Math.ceil(calendarEvents.length / eventsPerPage));
  const safeEventsPage = Math.min(eventsPage, eventsTotalPages);
  const paginatedCalendarEvents = calendarEvents.slice(
    (safeEventsPage - 1) * eventsPerPage,
    safeEventsPage * eventsPerPage
  );

  useEffect(() => {
    setNewsPage(1);
  }, [searchQuery, filterSymbol, filterSentiment]);

  useEffect(() => {
    setSelectedNewsIds([]);
  }, [searchQuery, filterSymbol, filterSentiment]);

  useEffect(() => {
    if (newsPage > newsTotalPages) setNewsPage(newsTotalPages);
  }, [newsPage, newsTotalPages]);

  useEffect(() => {
    setNewsPage(1);
  }, [newsItemsPerPage]);

  useEffect(() => {
    setEventsPage(1);
  }, [eventsPerPage]);

  useEffect(() => {
    setEventsPage(1);
  }, [calendarEvents.length]);

  useEffect(() => {
    if (eventsPage > eventsTotalPages) setEventsPage(eventsTotalPages);
  }, [eventsPage, eventsTotalPages]);

  const isNewsRead = (id: string) => readNewsIds.includes(id);

  const filteredNewsIds = filteredNews.map((n) => n.id);
  const selectedInFilteredCount = selectedNewsIds.filter((id) => filteredNewsIds.includes(id)).length;
  const allFilteredSelected = filteredNews.length > 0 && selectedInFilteredCount === filteredNews.length;
  const someFilteredSelected = selectedInFilteredCount > 0 && !allFilteredSelected;

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (el) el.indeterminate = someFilteredSelected;
  }, [someFilteredSelected]);

  const toggleNewsSelected = (id: string) => {
    setSelectedNewsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedNewsIds((prev) => prev.filter((id) => !filteredNewsIds.includes(id)));
    } else {
      setSelectedNewsIds((prev) => {
        const s = new Set(prev);
        filteredNewsIds.forEach((id) => s.add(id));
        return [...s];
      });
    }
  };

  const markSelectedAsRead = () => {
    if (selectedNewsIds.length === 0) return;
    setReadNewsIds((prev) => {
      const s = new Set(prev);
      selectedNewsIds.forEach((id) => s.add(id));
      return [...s];
    });
  };

  const markSelectedAsUnread = () => {
    if (selectedNewsIds.length === 0) return;
    setReadNewsIds((prev) => prev.filter((id) => !selectedNewsIds.includes(id)));
  };

  const markAllFilteredAsRead = () => {
    if (filteredNews.length === 0) return;
    setReadNewsIds((prev) => {
      const s = new Set(prev);
      filteredNews.forEach((n) => s.add(n.id));
      return [...s];
    });
  };

  const markAllFilteredAsUnread = () => {
    if (filteredNews.length === 0) return;
    const drop = new Set(filteredNews.map((n) => n.id));
    setReadNewsIds((prev) => prev.filter((id) => !drop.has(id)));
  };

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

  // Get sentiment color
  const getSentimentColor = (sentiment: "positive" | "negative" | "neutral") => {
    switch (sentiment) {
      case "positive": return "#10B981";
      case "negative": return "#EF4444";
      default: return "var(--text-secondary)";
    }
  };

  // Get sentiment icon
  const getSentimentIcon = (sentiment: "positive" | "negative" | "neutral") => {
    switch (sentiment) {
      case "positive": return <TrendingUp size={14} color="#10B981" />;
      case "negative": return <TrendingDown size={14} color="#EF4444" />;
      default: return null;
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
          {/* Settings button */}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-primary)",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            <Settings size={16} />
            Settings
          </button>

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
                    backgroundColor: mutedSymbols.includes(symbol) ? "var(--bg-tertiary)" : "var(--accent)",
                    color: mutedSymbols.includes(symbol) ? "var(--text-secondary)" : "var(--bg-primary)",
                    fontSize: "13px",
                    fontWeight: "500",
                    opacity: mutedSymbols.includes(symbol) ? 0.6 : 1,
                  }}
                >
                  {mutedSymbols.includes(symbol) && <VolumeX size={12} />}
                  {symbol}
                  <button
                    onClick={() => toggleMuteSymbol(symbol)}
                    title={mutedSymbols.includes(symbol) ? "Unmute" : "Mute"}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "0",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      color: "inherit",
                      opacity: 0.7,
                    }}
                  >
                    {mutedSymbols.includes(symbol) ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  </button>
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

        {/* Watchlists Section */}
        <div style={{ 
          marginTop: "16px", 
          paddingTop: "16px", 
          borderTop: "1px solid var(--border-color)" 
        }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
            marginBottom: "12px"
          }}>
            <span style={{ 
              fontSize: "14px", 
              fontWeight: "500", 
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <Folder size={16} />
              Saved Watchlists
            </span>
            <button
              onClick={() => setShowWatchlistModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border-color)",
                backgroundColor: "transparent",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              <FolderPlus size={14} />
              Save Current
            </button>
          </div>
          
          {watchlists.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: 0 }}>
              No saved watchlists. Save your current symbols as a watchlist.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {watchlists.map(list => (
                <div
                  key={list.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    backgroundColor: selectedWatchlist === list.id ? "rgba(var(--accent-rgb), 0.1)" : "var(--bg-primary)",
                    border: `1px solid ${selectedWatchlist === list.id ? "var(--accent)" : "var(--border-color)"}`,
                  }}
                >
                  <button
                    onClick={() => loadWatchlist(list)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "0",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      fontWeight: selectedWatchlist === list.id ? "600" : "400",
                    }}
                  >
                    {list.name}
                  </button>
                  <span style={{ 
                    fontSize: "11px", 
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-tertiary)",
                    padding: "2px 6px",
                    borderRadius: "4px"
                  }}>
                    {list.symbols.length}
                  </span>
                  <button
                    onClick={() => deleteWatchlist(list.id)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "2px",
                      cursor: "pointer",
                      color: "var(--text-secondary)",
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="Delete watchlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Watchlist Modal */}
      {showWatchlistModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={() => setShowWatchlistModal(false)}
        >
          <div 
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "12px",
              padding: "24px",
              width: "400px",
              maxWidth: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px 0", color: "var(--text-primary)" }}>
              Save Watchlist
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 16px 0" }}>
              Save your current {watchedSymbols.length} symbols as a watchlist.
            </p>
            <input
              type="text"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createWatchlist()}
              placeholder="Watchlist name (e.g., Tech Stocks)"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "14px",
                marginBottom: "16px",
                boxSizing: "border-box",
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowWatchlistModal(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={createWatchlist}
                disabled={!newWatchlistName.trim() || watchedSymbols.length === 0}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: newWatchlistName.trim() && watchedSymbols.length > 0 ? "var(--accent)" : "var(--bg-tertiary)",
                  color: newWatchlistName.trim() && watchedSymbols.length > 0 ? "var(--bg-primary)" : "var(--text-secondary)",
                  cursor: newWatchlistName.trim() && watchedSymbols.length > 0 ? "pointer" : "not-allowed",
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

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
          {/* Search Bar */}
          <div style={{ 
            marginBottom: "16px",
            position: "relative"
          }}>
            <Search 
              size={18} 
              style={{ 
                position: "absolute", 
                left: "14px", 
                top: "50%", 
                transform: "translateY(-50%)",
                color: "var(--text-secondary)"
              }} 
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search news headlines, symbols, or sources..."
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
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "12px",
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
                <X size={16} />
              </button>
            )}
          </div>

          {/* News filter */}
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "12px", 
            marginBottom: "16px",
            flexWrap: "wrap"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Filter size={16} color="var(--text-secondary)" />
              <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Symbol:</span>
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
            
            {/* Sentiment filter */}
            {showSentiment && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "16px" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Sentiment:</span>
                {(["all", "positive", "neutral", "negative"] as const).map(sentiment => (
                  <button
                    key={sentiment}
                    onClick={() => setFilterSentiment(sentiment)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: filterSentiment === sentiment 
                        ? sentiment === "positive" ? "#10B981" 
                          : sentiment === "negative" ? "#EF4444" 
                          : sentiment === "neutral" ? "var(--bg-tertiary)"
                          : "var(--accent)" 
                        : "transparent",
                      color: filterSentiment === sentiment 
                        ? sentiment === "neutral" ? "var(--text-primary)" : "white"
                        : "var(--text-primary)",
                      cursor: "pointer",
                      fontSize: "13px",
                      textTransform: "capitalize",
                    }}
                  >
                    {sentiment === "all" ? "All" : sentiment}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filteredNews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "10px 16px",
                marginBottom: "12px",
                padding: "12px 14px",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "10px",
                border: "1px solid var(--border-color)",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  userSelect: "none",
                }}
              >
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "var(--accent)" }}
                />
                Select all
              </label>
              <span style={{ color: "var(--border-color)", fontSize: "12px" }} aria-hidden>
                |
              </span>
              <button
                type="button"
                onClick={markSelectedAsRead}
                disabled={selectedNewsIds.length === 0}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: selectedNewsIds.length === 0 ? "var(--bg-tertiary)" : "var(--bg-primary)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: selectedNewsIds.length === 0 ? "not-allowed" : "pointer",
                  opacity: selectedNewsIds.length === 0 ? 0.55 : 1,
                }}
              >
                Mark selected as read
              </button>
              <button
                type="button"
                onClick={markSelectedAsUnread}
                disabled={selectedNewsIds.length === 0}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: selectedNewsIds.length === 0 ? "var(--bg-tertiary)" : "var(--bg-primary)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: selectedNewsIds.length === 0 ? "not-allowed" : "pointer",
                  opacity: selectedNewsIds.length === 0 ? 0.55 : 1,
                }}
              >
                Mark selected as unread
              </button>
              <span style={{ color: "var(--border-color)", fontSize: "12px" }} aria-hidden>
                |
              </span>
              <button
                type="button"
                onClick={markAllFilteredAsRead}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Mark all as read
              </button>
              <button
                type="button"
                onClick={markAllFilteredAsUnread}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Mark all as unread
              </button>
              {selectedInFilteredCount > 0 && (
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "auto" }}>
                  {selectedInFilteredCount} selected
                </span>
              )}
            </div>
          )}

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

            {paginatedNews.map((item) => {
              const read = isNewsRead(item.id);
              return (
              <div
                key={item.id}
                style={{
                  display: "block",
                  padding: "16px 20px",
                  backgroundColor: read ? "var(--bg-secondary)" : "color-mix(in srgb, var(--bg-secondary) 92%, var(--accent))",
                  borderRadius: "12px",
                  border: "1px solid var(--border-color)",
                  transition: "all 0.2s ease",
                  borderLeft: showSentiment ? `4px solid ${getSentimentColor(item.sentiment)}` : undefined,
                  opacity: read ? 0.95 : 1,
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
                  <label
                    style={{
                      flexShrink: 0,
                      paddingTop: "2px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "flex-start",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedNewsIds.includes(item.id)}
                      onChange={() => toggleNewsSelected(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: "18px",
                        height: "18px",
                        cursor: "pointer",
                        accentColor: "var(--accent)",
                        marginTop: "2px",
                      }}
                      aria-label={`Select ${item.title.slice(0, 40)}`}
                    />
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "8px", 
                      marginBottom: "8px",
                      flexWrap: "wrap"
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
                      {showPriceChange && priceData[item.symbol] && (
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: "var(--bg-tertiary)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          fontWeight: "500",
                        }}>
                          ${priceData[item.symbol].price.toFixed(2)}
                        </span>
                      )}
                      {showSentiment && item.sentiment !== "neutral" && (
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: item.sentiment === "positive" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                          color: getSentimentColor(item.sentiment),
                          fontSize: "12px",
                          fontWeight: "500",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          textTransform: "capitalize",
                        }}>
                          {getSentimentIcon(item.sentiment)}
                          {item.sentiment}
                        </span>
                      )}
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
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      <h3 style={{ 
                        fontSize: "15px", 
                        fontWeight: read ? "500" : "600", 
                        color: "var(--text-primary)",
                        margin: 0,
                        lineHeight: "1.4",
                      }}>
                        {item.title}
                      </h3>
                    </a>
                    <div style={{ 
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      marginTop: "8px",
                      flexWrap: "wrap",
                    }}>
                      <p style={{ 
                        fontSize: "12px", 
                        color: "var(--text-secondary)", 
                        margin: 0 
                      }}>
                        {item.source}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "6px",
                        borderRadius: "6px",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Open article"
                    >
                      <ExternalLink size={14} />
                    </a>
                    <button
                      onClick={() => createJournalFromNews(item)}
                      style={{
                        padding: "6px",
                        borderRadius: "6px",
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Add to journal"
                    >
                      <BookOpen size={14} />
                    </button>
                    <button
                      onClick={() => toggleMuteSymbol(item.symbol)}
                      style={{
                        padding: "6px",
                        borderRadius: "6px",
                        backgroundColor: mutedSymbols.includes(item.symbol) ? "rgba(var(--accent-rgb), 0.1)" : "var(--bg-tertiary)",
                        color: mutedSymbols.includes(item.symbol) ? "var(--accent)" : "var(--text-secondary)",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title={mutedSymbols.includes(item.symbol) ? "Unmute symbol" : "Mute symbol"}
                    >
                      {mutedSymbols.includes(item.symbol) ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
            })}
          </div>

          {filteredNews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginTop: "16px",
                padding: "12px 16px",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "10px",
                border: "1px solid var(--border-color)",
              }}
            >
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {(safeNewsPage - 1) * newsItemsPerPage + 1}
                –
                {Math.min(safeNewsPage * newsItemsPerPage, filteredNews.length)} of {filteredNews.length}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setNewsPage((p) => Math.max(1, p - 1))}
                  disabled={safeNewsPage <= 1}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    cursor: safeNewsPage <= 1 ? "not-allowed" : "pointer",
                    opacity: safeNewsPage <= 1 ? 0.5 : 1,
                  }}
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)", minWidth: "100px", textAlign: "center" }}>
                  Page {safeNewsPage} of {newsTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setNewsPage((p) => Math.min(newsTotalPages, p + 1))}
                  disabled={safeNewsPage >= newsTotalPages}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    cursor: safeNewsPage >= newsTotalPages ? "not-allowed" : "pointer",
                    opacity: safeNewsPage >= newsTotalPages ? 0.5 : 1,
                  }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
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
                <>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {paginatedCalendarEvents.map((event, idx) => (
                    <div
                      key={`${event.date}-${event.symbol}-${event.event_type}-${idx}-${safeEventsPage}`}
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
                {eventsTotalPages > 1 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      marginTop: "16px",
                      paddingTop: "16px",
                      borderTop: "1px solid var(--border-color)",
                    }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {(safeEventsPage - 1) * eventsPerPage + 1}–
                      {Math.min(safeEventsPage * eventsPerPage, calendarEvents.length)} of {calendarEvents.length}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                        disabled={safeEventsPage <= 1}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-color)",
                          backgroundColor: "var(--bg-primary)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: safeEventsPage <= 1 ? "not-allowed" : "pointer",
                          opacity: safeEventsPage <= 1 ? 0.5 : 1,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <ChevronLeft size={14} />
                        Prev
                      </button>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        {safeEventsPage}/{eventsTotalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEventsPage((p) => Math.min(eventsTotalPages, p + 1))}
                        disabled={safeEventsPage >= eventsTotalPages}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-color)",
                          backgroundColor: "var(--bg-primary)",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: safeEventsPage >= eventsTotalPages ? "not-allowed" : "pointer",
                          opacity: safeEventsPage >= eventsTotalPages ? 0.5 : 1,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        Next
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
                </>
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

      {showSettings &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={() => setShowSettings(false)}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="news-settings-title"
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                padding: "24px",
                maxWidth: "520px",
                maxHeight: "80vh",
                overflow: "auto",
                width: "90%",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "20px",
                }}
              >
                <h2
                  id="news-settings-title"
                  style={{
                    fontSize: "20px",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    margin: 0,
                    color: "var(--text-primary)",
                  }}
                >
                  <Settings size={20} aria-hidden />
                  News settings
                </h2>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "24px",
                    padding: "0",
                    width: "32px",
                    height: "32px",
                    lineHeight: 1,
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <h3
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                }}
              >
                Display
              </h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    backgroundColor: showSentiment ? "rgba(var(--accent-rgb), 0.1)" : "var(--bg-primary)",
                    border: `1px solid ${showSentiment ? "var(--accent)" : "var(--border-color)"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showSentiment}
                    onChange={(e) => setShowSentiment(e.target.checked)}
                    style={{ display: "none" }}
                  />
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "4px",
                      border: `2px solid ${showSentiment ? "var(--accent)" : "var(--border-color)"}`,
                      backgroundColor: showSentiment ? "var(--accent)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showSentiment && <Check size={14} color="var(--bg-primary)" />}
                  </div>
                  <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                    Show sentiment indicators
                  </span>
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    cursor: "pointer",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    backgroundColor: showPriceChange ? "rgba(var(--accent-rgb), 0.1)" : "var(--bg-primary)",
                    border: `1px solid ${showPriceChange ? "var(--accent)" : "var(--border-color)"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showPriceChange}
                    onChange={(e) => setShowPriceChange(e.target.checked)}
                    style={{ display: "none" }}
                  />
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "4px",
                      border: `2px solid ${showPriceChange ? "var(--accent)" : "var(--border-color)"}`,
                      backgroundColor: showPriceChange ? "var(--accent)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showPriceChange && <Check size={14} color="var(--bg-primary)" />}
                  </div>
                  <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                    Show price data
                  </span>
                </label>
              </div>

              <h3
                style={{
                  margin: "24px 0 12px 0",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                }}
              >
                Pagination
              </h3>
              <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                How many items appear on each page in the main news list and in the upcoming events sidebar.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "100%" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>News articles per page</span>
                  <select
                    value={newsItemsPerPage}
                    onChange={(e) => setNewsItemsPerPage(parseInt(e.target.value, 10))}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      cursor: "pointer",
                      maxWidth: "280px",
                    }}
                  >
                    {NEWS_ITEMS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} per page
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Calendar events per page</span>
                  <select
                    value={eventsPerPage}
                    onChange={(e) => setEventsPerPage(parseInt(e.target.value, 10))}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      cursor: "pointer",
                      maxWidth: "280px",
                    }}
                  >
                    {EVENTS_PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} per page
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <h3
                style={{
                  margin: "24px 0 12px 0",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "var(--text-primary)",
                }}
              >
                Local storage
              </h3>
              <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                TradeButler saves a few News preferences in your browser. The largest piece is the list of article IDs
                you have marked as read (capped so it does not grow forever). The calendar cache stores upcoming events
                for faster loads; you can limit how many events are kept in that cache.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", maxWidth: "100%" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    Max read article IDs stored
                  </span>
                  <select
                    value={readIdsMax}
                    onChange={(e) => setReadIdsMax(parseInt(e.target.value, 10))}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      cursor: "pointer",
                      maxWidth: "320px",
                    }}
                  >
                    {READ_IDS_MAX_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} (oldest dropped when over limit)
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    Currently storing {readNewsIds.length.toLocaleString()} ID
                    {readNewsIds.length === 1 ? "" : "s"}.
                  </span>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    Max calendar events in cache (per symbol set)
                  </span>
                  <select
                    value={calendarCacheMaxEvents}
                    onChange={(e) => setCalendarCacheMaxEvents(parseInt(e.target.value, 10))}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-primary)",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      cursor: "pointer",
                      maxWidth: "320px",
                    }}
                  >
                    {CALENDAR_CACHE_MAX_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} events (earliest in list kept)
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    Applies on the next news refresh. Other saved keys: watched symbols, filters, watchlists, and display
                    toggles (small).
                  </span>
                </label>
              </div>

              {mutedSymbols.length > 0 && (
                <div style={{ marginTop: "20px" }}>
                  <p
                    style={{
                      fontSize: "14px",
                      color: "var(--text-secondary)",
                      marginBottom: "8px",
                    }}
                  >
                    Muted symbols
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {mutedSymbols.map((symbol) => (
                      <span
                        key={symbol}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "20px",
                          backgroundColor: "var(--bg-tertiary)",
                          color: "var(--text-secondary)",
                          fontSize: "13px",
                        }}
                      >
                        <VolumeX size={12} />
                        {symbol}
                        <X
                          size={14}
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleMuteSymbol(symbol)}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "var(--accent)",
                    color: "var(--bg-primary)",
                    fontSize: "14px",
                    fontWeight: "500",
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
