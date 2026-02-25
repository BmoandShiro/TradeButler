import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, ColorType, UTCTimestamp, CandlestickSeries, SeriesMarker, createSeriesMarkers } from "lightweight-charts";
import { format } from "date-fns";
import { invoke } from "@tauri-apps/api/tauri";
import { Settings } from "lucide-react";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  order_type: string;
  status: string;
  fees: number | null;
  notes: string | null;
  strategy_id: number | null;
}

interface TradeChartProps {
  symbol: string;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  onClose?: () => void;
  positionTrades?: Trade[]; // Optional: all trades that make up this position
  /** When true, render as inline compact chart (e.g. in journal entry view) without modal overlay */
  inline?: boolean;
  /** Height of chart container when inline (default 200) */
  compactHeight?: number;
}


type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "1d";

interface ChartSettings {
  backgroundColor: string;
  textColor: string;
  gridColor: string;
  upColor: string;
  downColor: string;
  buyMarkerColor: string;
  sellMarkerColor: string;
}

const CHART_SETTINGS_KEY = "tradebutler_chart_settings";
const defaultSettings: ChartSettings = {
  backgroundColor: "#1e1e1e",
  textColor: "#ffffff",
  gridColor: "#2a2a2a",
  upColor: "#26a69a",
  downColor: "#ef5350",
  buyMarkerColor: "#26a69a",
  sellMarkerColor: "#ef5350",
};

export function TradeChart({ symbol, entryTimestamp, exitTimestamp, entryPrice, exitPrice, onClose, positionTrades, inline = false, compactHeight = 200 }: TradeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const containerReadyRef = useRef(false);
  
  // Chart settings from localStorage
  const [chartSettings, setChartSettings] = useState<ChartSettings>(() => {
    const saved = localStorage.getItem(CHART_SETTINGS_KEY);
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  // Extract base symbol for options
  const getBaseSymbol = (sym: string): string => {
    const firstDigitIndex = sym.search(/\d/);
    return firstDigitIndex > 0 ? sym.substring(0, firstDigitIndex) : sym;
  };

  const baseSymbol = getBaseSymbol(symbol);

  // Detect if a symbol is an options contract
  // Options typically have patterns like: SPY251218C00679000 (underlying + date + C/P + strike)
  const isOptionsSymbol = (sym: string): boolean => {
    if (sym.length < 10) {
      return false; // Too short to be an option
    }
    
    // Check for C or P followed by digits (strike price)
    const hasCallPut = sym.includes('C') || sym.includes('P');
    
    if (!hasCallPut) {
      return false; // No C or P means it's not an option
    }
    
    // Check for 6-digit date pattern (YYMMDD) - typically appears before C/P
    const hasDatePattern = /\d{6}/.test(sym);
    
    // Options symbols are typically much longer than stock symbols
    return hasCallPut && (hasDatePattern || sym.length > 15);
  };

  const isOptions = isOptionsSymbol(symbol);
  
  // Helper function for color validation (used in multiple places)
  const cleanColor = useCallback((color: string, defaultColor: string): string => {
    if (!color || color.trim() === '') return defaultColor;
    const cleaned = color.trim().replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
      return `#${cleaned}`;
    }
    return defaultColor;
  }, []);

  // Define fetchPriceData function using useCallback so it can be called from chart initialization
  const fetchPriceData = useCallback(async () => {
    console.log('fetchPriceData called', { 
      hasSeries: !!seriesRef.current, 
      hasChart: !!chartRef.current,
      symbol: baseSymbol 
    });
    
    if (!seriesRef.current || !chartRef.current) {
      console.log('Chart or series not ready, skipping fetch');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('Starting data fetch for symbol:', baseSymbol);
      // Calculate date range based on timeframe
      // For 1m intervals, Yahoo Finance only supports last 7 days, so limit the range
      const entryDate = new Date(entryTimestamp);
      const exitDate = new Date(exitTimestamp);
      const startDate = new Date(entryDate);
      const endDate = new Date(exitDate);
      
      if (timeframe === "1m") {
        // 1m intervals are limited to last 7 days by Yahoo Finance
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        // Use the more restrictive range
        startDate.setTime(Math.max(startDate.getTime(), sevenDaysAgo.getTime()));
        endDate.setTime(Math.min(endDate.getTime(), now.getTime()));
        
        // Add small buffer
        endDate.setDate(endDate.getDate() + 1);
      } else {
        // For other timeframes, use wider range
        startDate.setDate(startDate.getDate() - 30);
        endDate.setDate(endDate.getDate() + 5);
      }

      // Fetch data from Yahoo Finance API (free, no API key needed)
      const period1 = Math.floor(startDate.getTime() / 1000);
      const period2 = Math.floor(endDate.getTime() / 1000);
      
      // Map timeframe to Yahoo Finance interval
      // Note: Yahoo Finance supports: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
      // - 1m: Only available for recent data (last 7 days) and may not work for all symbols
      // - 3m: Not directly supported, will try 2m first, then fallback to 5m
      // - 5m, 15m, 30m, 1h: Available for recent data
      // - 1d: Available for longer periods
      let interval = "1d";
      if (timeframe === "1m") {
        // 1m has strict limitations - only last 7 days, may fail for some symbols
        interval = "1m";
      } else if (timeframe === "3m") {
        // Yahoo Finance supports 2m but not 3m - try 2m first (closer to 3m than 5m)
        interval = "2m";
      } else if (timeframe === "5m") interval = "5m";
      else if (timeframe === "15m") interval = "15m";
      else if (timeframe === "30m") interval = "30m";
      else if (timeframe === "1h") interval = "1h";
      else interval = "1d";
      
      // Use Tauri command to fetch chart data (avoids CORS issues)
      console.log('Calling Tauri fetch_chart_data', { baseSymbol, period1, period2, interval });
      let data: any;
      try {
        data = await invoke("fetch_chart_data", {
          symbol: baseSymbol,
          period1,
          period2,
          interval,
        });
        console.log('Data received from Tauri:', data);
      } catch (fetchError) {
        console.error('Tauri fetch error:', fetchError);
        const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        // Provide helpful error messages for common issues
        if (errorMsg.includes('422') || errorMsg.includes('Unprocessable Entity')) {
          if (timeframe === "1m") {
            throw new Error(`1-minute intervals are not available for this symbol or date range. Yahoo Finance only supports 1-minute data for the last 7 days and may not be available for all symbols. Please try 3-minute, 5-minute, or another timeframe.`);
          } else if (timeframe === "3m") {
            // If 2m fails, try 5m as fallback
            console.log('3m interval failed, trying 5m as fallback...');
            try {
              const fallbackData = await invoke("fetch_chart_data", {
                symbol: baseSymbol,
                period1,
                period2,
                interval: "5m",
              });
              console.log('Fallback to 5m succeeded');
              data = fallbackData;
            } catch (fallbackError) {
              throw new Error(`Unable to fetch 3-minute data. Yahoo Finance doesn't support 3-minute intervals directly. Please try 2-minute, 5-minute, or another timeframe.`);
            }
          } else {
            throw new Error(`Unable to fetch ${timeframe} data for this symbol. The selected timeframe may not be supported for this symbol or date range. Please try a different timeframe.`);
          }
        } else {
          throw new Error(`Unable to fetch price data: ${errorMsg}`);
        }
      }
      
      if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
        throw new Error("No price data available for this symbol");
      }

      const result = data.chart.result[0];
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};

      if (!quotes.open || timestamps.length === 0) {
        throw new Error("Invalid price data format");
      }

      // Convert to candlestick format
      const candlestickData: CandlestickData[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const time = timestamps[i] as number;
        const open = quotes.open[i];
        const high = quotes.high[i];
        const low = quotes.low[i];
        const close = quotes.close[i];

        if (open != null && high != null && low != null && close != null) {
          candlestickData.push({
            time: (time) as UTCTimestamp, // Yahoo Finance returns Unix timestamp in seconds
            open,
            high,
            low,
            close,
          });
        }
      }

      if (candlestickData.length === 0) {
        throw new Error("No valid price data points found");
      }

      console.log(`Setting ${candlestickData.length} data points to chart`);
      seriesRef.current.setData(candlestickData);
      console.log('Data set successfully');
      
      // Note: Markers will be set separately after data is loaded

      // Create markers for each trade execution if positionTrades is provided
      const markers: SeriesMarker<UTCTimestamp>[] = [];
      
      if (positionTrades && positionTrades.length > 0) {
        // Sort trades by timestamp
        const sortedTrades = [...positionTrades].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Find the closest bar time for each trade to ensure markers align with visible bars
        const findClosestBarTime = (tradeTimestamp: number): UTCTimestamp => {
          const tradeTime = Math.floor(tradeTimestamp / 1000);
          let closestTime = tradeTime;
          let minDiff = Infinity;
          
          // Find the closest candlestick time
          for (const candle of candlestickData) {
            const candleTime = typeof candle.time === 'number' ? candle.time : Math.floor(new Date(candle.time as string).getTime() / 1000);
            const diff = Math.abs(candleTime - tradeTime);
            if (diff < minDiff) {
              minDiff = diff;
              closestTime = candleTime;
            }
          }
          
          return closestTime as UTCTimestamp;
        };
        
        sortedTrades.forEach((trade) => {
          const tradeTimestamp = new Date(trade.timestamp).getTime();
          const tradeTime = findClosestBarTime(tradeTimestamp);
          const isBuy = trade.side.toUpperCase() === "BUY";
          
          const buyColor = cleanColor(chartSettings.buyMarkerColor, defaultSettings.buyMarkerColor);
          const sellColor = cleanColor(chartSettings.sellMarkerColor, defaultSettings.sellMarkerColor);
          
          const marker: SeriesMarker<UTCTimestamp> = {
            time: tradeTime,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: isBuy ? buyColor : sellColor,
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            size: 2, // Larger size for better visibility
            text: `${trade.side} ${trade.quantity.toFixed(2)} @ $${trade.price.toFixed(2)}`, // Show details for both stocks and options
          };
          
          markers.push(marker);
        });
      } else {
        // Fallback: show just entry and exit markers if no positionTrades
        // Find closest bar times to ensure markers align with visible bars
        const findClosestBarTime = (timestamp: number): UTCTimestamp => {
          const targetTime = Math.floor(timestamp / 1000);
          let closestTime = targetTime;
          let minDiff = Infinity;
          
          // Find the closest candlestick time
          for (const candle of candlestickData) {
            const candleTime = typeof candle.time === 'number' ? candle.time : Math.floor(new Date(candle.time as string).getTime() / 1000);
            const diff = Math.abs(candleTime - targetTime);
            if (diff < minDiff) {
              minDiff = diff;
              closestTime = candleTime;
            }
          }
          
          return closestTime as UTCTimestamp;
        };
        
        const entryTimestampMs = new Date(entryTimestamp).getTime();
        const exitTimestampMs = new Date(exitTimestamp).getTime();
        const entryTime = findClosestBarTime(entryTimestampMs);
        const exitTime = findClosestBarTime(exitTimestampMs);
        
        const buyColor = cleanColor(chartSettings.buyMarkerColor, defaultSettings.buyMarkerColor);
        const sellColor = cleanColor(chartSettings.sellMarkerColor, defaultSettings.sellMarkerColor);
        
        const entryMarker: SeriesMarker<UTCTimestamp> = {
          time: entryTime,
          position: 'belowBar',
          color: buyColor,
          shape: 'arrowUp',
          size: 2, // Larger size for better visibility
        };
        
        const exitMarker: SeriesMarker<UTCTimestamp> = {
          time: exitTime,
          position: 'aboveBar',
          color: sellColor,
          shape: 'arrowDown',
          size: 2, // Larger size for better visibility
          text: `Exit @ $${exitPrice.toFixed(2)}`, // Show details for both stocks and options
        };
        
        entryMarker.text = `Entry @ $${entryPrice.toFixed(2)}`; // Show details for both stocks and options
        
        markers.push(entryMarker);
        markers.push(exitMarker);
      }
      
      // Set markers on the series using the v5.0+ plugin API
      if (markers.length > 0 && seriesRef.current) {
        // Debug: Check if marker times match candlestick times
        const candlestickTimes = candlestickData.map(c => c.time);
        const allTimesSet = new Set(candlestickTimes);
        
        // Check each marker time and fix if needed
        markers.forEach((marker, idx) => {
          if (!allTimesSet.has(marker.time)) {
            // Find the closest candlestick time
            const closestTime = candlestickTimes.reduce((closest, ct) => {
              const diff = Math.abs(Number(ct) - Number(marker.time));
              const closestDiff = Math.abs(Number(closest) - Number(marker.time));
              return diff < closestDiff ? ct : closest;
            }, candlestickTimes[0]);
            
            console.warn(`Marker ${idx} time ${marker.time} doesn't match any candlestick. Updating to closest: ${closestTime}`);
            marker.time = closestTime as UTCTimestamp;
          }
        });
        
        const matchingTimes = markers.map(m => m.time).filter(mt => allTimesSet.has(mt));
        console.log('Preparing to set markers using createSeriesMarkers plugin:', {
          markersCount: markers.length,
          isOptions,
          markers: markers.map(m => ({ time: m.time, position: m.position, shape: m.shape, color: m.color, hasText: !!m.text })),
          firstFewCandlestickTimes: candlestickTimes.slice(0, 10),
          lastFewCandlestickTimes: candlestickTimes.slice(-10),
          markerTimes: markers.map(m => m.time),
          matchingTimes: matchingTimes,
          allTimesMatch: matchingTimes.length === markers.length,
          candlestickCount: candlestickTimes.length
        });
        
        // Use the v5.0+ plugin API: createSeriesMarkers
        try {
          // Create or update the markers instance
          if (!markersRef.current && seriesRef.current) {
            console.log('Creating new markers instance using createSeriesMarkers plugin');
            markersRef.current = createSeriesMarkers(seriesRef.current, markers) as any;
            console.log('✓ Created markers instance with', markers.length, 'markers');
          } else if (markersRef.current) {
            console.log('Updating existing markers instance');
            (markersRef.current as any).setMarkers(markers);
            console.log('✓ Updated markers instance with', markers.length, 'markers');
          }
        } catch (markerError) {
          console.error('Failed to create/update markers using plugin:', markerError);
          console.error('Error details:', markerError);
        }
        
        // Force chart to update/redraw after setting markers
        if (chartRef.current) {
          const timeScale = chartRef.current.timeScale();
          try {
            timeScale.fitContent();
            console.log('Called fitContent() to refresh chart with markers');
          } catch (e) {
            console.warn('fitContent() not available, trying alternative');
            const currentRange = timeScale.getVisibleRange();
            if (currentRange) {
              timeScale.setVisibleRange({
                from: currentRange.from,
                to: currentRange.to
              });
            }
            timeScale.scrollToPosition(0, false);
          }
        }
      } else {
        console.warn('Cannot set markers:', {
          markersLength: markers.length,
          hasSeries: !!seriesRef.current,
          isOptions
        });
      }

      // Add entry and exit price lines for both stocks and options
      const buyColor = cleanColor(chartSettings.buyMarkerColor, defaultSettings.buyMarkerColor);
      const sellColor = cleanColor(chartSettings.sellMarkerColor, defaultSettings.sellMarkerColor);
      
      seriesRef.current.createPriceLine({
        price: entryPrice,
        color: buyColor,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: "Entry",
      });

      seriesRef.current.createPriceLine({
        price: exitPrice,
        color: sellColor,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: "Exit",
      });

      // Set visible range to show entry and exit with some padding
      const entryTime = Math.floor(new Date(entryTimestamp).getTime() / 1000) as UTCTimestamp;
      const exitTime = Math.floor(new Date(exitTimestamp).getTime() / 1000) as UTCTimestamp;
      const visibleStart = (entryTime - (7 * 24 * 60 * 60)) as UTCTimestamp; // 7 days before entry
      const visibleEnd = (exitTime + (2 * 24 * 60 * 60)) as UTCTimestamp; // 2 days after exit

      chartRef.current.timeScale().setVisibleRange({
        from: visibleStart,
        to: visibleEnd,
      });

      // Update markers AFTER setting visible range to ensure they're in view
      if (markers.length > 0 && markersRef.current) {
        setTimeout(() => {
          try {
            console.log('Final attempt: Updating markers after visible range is set');
            (markersRef.current as any).setMarkers(markers);
            console.log('✓ Final markers updated successfully');
            
            // Force a final redraw
            if (chartRef.current) {
              const timeScale = chartRef.current.timeScale();
              try {
                timeScale.fitContent();
                console.log('Called fitContent() to refresh chart with markers');
              } catch (e) {
                console.warn('fitContent() not available');
                timeScale.scrollToPosition(0, false);
              }
            }
          } catch (e) {
            console.error('Final marker update failed:', e);
          }
        }, 500);
      }

      setLoading(false);
    } catch (err) {
      console.error("Error fetching price data:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to load chart data";
      setError(errorMessage);
      setLoading(false);
      // Don't throw - just show error message
    }
  }, [symbol, entryTimestamp, exitTimestamp, entryPrice, exitPrice, timeframe, baseSymbol, positionTrades, isOptions, chartSettings, cleanColor]);

  useEffect(() => {
    // Prevent multiple initializations
    if (containerReadyRef.current || chartRef.current) {
      return;
    }
    
    if (!chartContainerRef.current) {
      setError("Chart container not available");
      return;
    }
    
    // Mark as ready immediately to prevent duplicate calls
    containerReadyRef.current = true;

    let cleanup: (() => void) | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    // Wait for container to have a width and be in the DOM
    // Use requestAnimationFrame to ensure DOM is ready
    const initChart = () => {
      requestAnimationFrame(() => {
        if (!chartContainerRef.current) {
          setError("Chart container not available");
          setLoading(false);
          return;
        }

        const container = chartContainerRef.current;
        
        // Check if element is in the DOM
        if (!container.isConnected) {
          timeoutId = setTimeout(initChart, 100);
          return;
        }
        
        // Force a layout recalculation
        const rect = container.getBoundingClientRect();
        let width = rect.width || container.clientWidth || container.offsetWidth;
        let height = rect.height || container.clientHeight || container.offsetHeight;
        
        // If still no dimensions, set explicit ones
        if (width === 0 || height === 0) {
          width = 800;
          height = 500;
          container.style.width = `${width}px`;
          container.style.height = `${height}px`;
        }
        
        if (width === 0 || height === 0) {
          setError(`Chart container has invalid dimensions: ${width}x${height}. Please ensure the container is visible.`);
          setLoading(false);
          return;
        }

        // Use chart settings from state (loaded from localStorage)
        const finalBgColor = cleanColor(chartSettings.backgroundColor, defaultSettings.backgroundColor);
        const finalTextColor = cleanColor(chartSettings.textColor, defaultSettings.textColor);
        const finalProfitColor = cleanColor(chartSettings.upColor, defaultSettings.upColor);
        const finalLossColor = cleanColor(chartSettings.downColor, defaultSettings.downColor);

        // Create chart with minimum width (ensure it's a valid number)
        // Use actual container dimensions or fallback to reasonable defaults
        const chartWidth = Math.max(Math.floor(width), 800);
        const chartHeight = Math.max(Math.floor(height), 500);
        
        if (chartWidth <= 0 || chartHeight <= 0 || !isFinite(chartWidth) || !isFinite(chartHeight)) {
          setError(`Invalid chart dimensions: ${chartWidth}x${chartHeight}`);
          setLoading(false);
          return;
        }

        // Ensure container is visible and has dimensions before creating chart
        container.style.display = 'block';
        container.style.visibility = 'visible';
        container.style.width = `${chartWidth}px`;
        container.style.height = `${chartHeight}px`;
        
        // Wait a bit more to ensure styles are applied and container is rendered
        setTimeout(() => {
          try {
            // Double-check dimensions after style changes
            const rect = container.getBoundingClientRect();
            const finalWidth = Math.max(Math.floor(rect.width || chartWidth), 800);
            const finalHeight = Math.max(Math.floor(rect.height || chartHeight), 500);
            
            const debugData = {
              containerWidth: container.clientWidth,
              containerHeight: container.clientHeight,
              rectWidth: rect.width,
              rectHeight: rect.height,
              finalWidth,
              finalHeight,
              isConnected: container.isConnected,
              display: container.style.display,
              visibility: container.style.visibility,
            };
            
            console.log('Chart initialization debug:', debugData);
            setDebugInfo(JSON.stringify(debugData, null, 2));
            
            if (finalWidth <= 0 || finalHeight <= 0) {
              setError(`Container still has invalid dimensions: ${finalWidth}x${finalHeight}\n\nDebug info:\n${JSON.stringify(debugData, null, 2)}`);
              setLoading(false);
              return;
            }
            
            // Ensure container is actually visible and has size
            if (!container.offsetParent && container.style.display !== 'none') {
              // Element might be hidden, force it visible
              container.style.display = 'block';
            }
            
            console.log('Creating chart with dimensions:', finalWidth, finalHeight);
            
            let chart: IChartApi;
            try {
              const gridColor = cleanColor(chartSettings.gridColor, defaultSettings.gridColor);
              
              // Try creating chart with autoSize first, then disable it
              chart = createChart(container, {
                width: finalWidth,
                height: finalHeight,
                autoSize: false,
                layout: {
                  background: { type: ColorType.Solid, color: finalBgColor },
                  textColor: finalTextColor,
                },
                grid: {
                  vertLines: {
                    color: gridColor,
                    style: 1, // Solid line
                  },
                  horzLines: {
                    color: gridColor,
                    style: 1, // Solid line
                  },
                },
                rightPriceScale: {
                  borderColor: gridColor,
                },
                timeScale: {
                  borderColor: gridColor,
                },
              });
              console.log('Chart created successfully');
              
              // Force chart to initialize by accessing its properties
              const timeScale = chart.timeScale();
              const priceScale = chart.priceScale('right');
              console.log('Chart APIs accessed:', { timeScale: !!timeScale, priceScale: !!priceScale });
              
              // Configure time scale to show time (not just date) when hovering
              timeScale.applyOptions({
                timeVisible: true,
                secondsVisible: false, // Don't show seconds unless needed for very short timeframes
              });
            } catch (chartError) {
              const errorMsg = chartError instanceof Error ? chartError.message : String(chartError);
              setError(`Failed to create chart: ${errorMsg}\n\nDebug info:\n${JSON.stringify(debugData, null, 2)}`);
              setLoading(false);
              return;
            }

            // Store chart reference immediately
            chartRef.current = chart;
            
            // Try adding series immediately after chart creation (synchronously)
            let candlestickSeries: ISeriesApi<"Candlestick"> | null = null;
            try {
              console.log('Attempting to add series immediately after chart creation...');
              const chartAny = chart as any;
              if (typeof chartAny.addCandlestickSeries === 'function') {
                candlestickSeries = chartAny.addCandlestickSeries({
                  upColor: finalProfitColor,
                  downColor: finalLossColor,
                  borderVisible: false,
                  wickUpColor: finalProfitColor,
                  wickDownColor: finalLossColor,
                });
                console.log('Series added successfully with addCandlestickSeries');
              } else {
                // In v5.0+, addSeries takes the series class as first argument, then options
                candlestickSeries = chart.addSeries(CandlestickSeries, {
                  upColor: finalProfitColor,
                  downColor: finalLossColor,
                  borderVisible: false,
                  wickUpColor: finalProfitColor,
                  wickDownColor: finalLossColor,
                });
                console.log('Series added successfully with addSeries');
              }
              
              seriesRef.current = candlestickSeries;
              
              // Handle resize
              const handleResize = () => {
                if (chartContainerRef.current && chartRef.current) {
                  const newWidth = Math.max(chartContainerRef.current.clientWidth, 600);
                  chartRef.current.applyOptions({
                    width: newWidth,
                  });
                }
              };

              window.addEventListener("resize", handleResize);

              // Store cleanup function
              cleanup = () => {
                window.removeEventListener("resize", handleResize);
                if (chartRef.current) {
                  chartRef.current.remove();
                  chartRef.current = null;
                }
              };
              
              setLoading(false);
              
              // Trigger data fetch now that chart and series are ready
              console.log('Chart and series ready, triggering data fetch');
              setTimeout(() => {
                if (chartRef.current && seriesRef.current) {
                  // Import and call fetchPriceData
                  fetchPriceData();
                }
              }, 100);
            } catch (immediateError) {
              console.error('Immediate series addition failed, trying with retry:', immediateError);
              
              // If immediate addition fails, fall back to retry logic
              // Wait for chart to be fully initialized and visible
              // Use multiple requestAnimationFrame calls and a small delay to ensure chart is ready
              const addSeriesWithRetry = (attempt = 0) => {
              if (attempt > 5) {
                setError(`Failed to add candlestick series after multiple attempts. Chart may not be fully initialized.\n\nDebug info:\n${JSON.stringify(debugData, null, 2)}`);
                setLoading(false);
                if (chart) {
                  chart.remove();
                }
                return;
              }
              
              // Check if container is actually visible
              const rect = container.getBoundingClientRect();
              const computedStyle = getComputedStyle(container);
              const isVisible = rect.width > 0 && rect.height > 0 && 
                               container.offsetParent !== null &&
                               computedStyle.visibility !== 'hidden' &&
                               computedStyle.display !== 'none';
              
              if (!isVisible && attempt < 3) {
                // Container not visible yet, wait and retry
                setTimeout(() => addSeriesWithRetry(attempt + 1), 100);
                return;
              }
              
              try {
                // Ensure container is in viewport
                container.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                
                // Force a layout recalculation
                void container.offsetHeight;
                
                // Ensure chart is resized
                chart.resize(finalWidth, finalHeight);
                
                // Try to access chart's internal APIs to force initialization
                try {
                  chart.timeScale();
                  chart.priceScale('right');
                } catch (e) {
                  console.log('Error accessing chart APIs:', e);
                }
                
                // Force chart to update its layout
                requestAnimationFrame(() => {
                  chart.resize(finalWidth, finalHeight);
                });
                
                console.log(`Adding candlestick series (attempt ${attempt + 1})...`);
                console.log('Chart state:', {
                  width: finalWidth,
                  height: finalHeight,
                  containerVisible: isVisible,
                  containerRect: rect,
                });
                
                // Try different approaches based on what's available
                let candlestickSeries: ISeriesApi<"Candlestick">;
                
                // Check what methods are actually available
                const chartAny = chart as any;
                const hasAddCandlestickSeries = typeof chartAny.addCandlestickSeries === 'function';
                const hasAddSeries = typeof chart.addSeries === 'function';
                
                console.log('Available methods:', { hasAddCandlestickSeries, hasAddSeries });
                
                if (hasAddCandlestickSeries) {
                  // Try the specific candlestick method if it exists
                  console.log('Using addCandlestickSeries method');
                  candlestickSeries = chartAny.addCandlestickSeries({
                    upColor: finalProfitColor,
                    downColor: finalLossColor,
                    borderVisible: false,
                    wickUpColor: finalProfitColor,
                    wickDownColor: finalLossColor,
                  });
                } else if (hasAddSeries) {
                  // Use the generic addSeries method
                  // In v5.0+, addSeries takes the series class as first argument, then options
                  console.log('Using addSeries method with CandlestickSeries class');
                  candlestickSeries = chart.addSeries(CandlestickSeries, {
                    upColor: finalProfitColor,
                    downColor: finalLossColor,
                    borderVisible: false,
                    wickUpColor: finalProfitColor,
                    wickDownColor: finalLossColor,
                  });
                } else {
                  throw new Error('Neither addSeries nor addCandlestickSeries methods are available');
                }
                
                console.log('Candlestick series added successfully');
                
                seriesRef.current = candlestickSeries;

                // Handle resize
                const handleResize = () => {
                  if (chartContainerRef.current && chartRef.current) {
                    const newWidth = Math.max(chartContainerRef.current.clientWidth, 600);
                    chartRef.current.applyOptions({
                      width: newWidth,
                    });
                  }
                };

                window.addEventListener("resize", handleResize);

                // Store cleanup function
                cleanup = () => {
                  window.removeEventListener("resize", handleResize);
                  if (chartRef.current) {
                    chartRef.current.remove();
                    chartRef.current = null;
                  }
                };
                
                setLoading(false);
              } catch (seriesError) {
                console.error(`Attempt ${attempt + 1} failed:`, seriesError);
                if (attempt < 5) {
                  // Wait a bit longer and retry
                  setTimeout(() => addSeriesWithRetry(attempt + 1), 200 * (attempt + 1));
                } else {
                  const errorMsg = seriesError instanceof Error ? seriesError.message : String(seriesError);
                  const errorStack = seriesError instanceof Error ? seriesError.stack : '';
                  setError(`Failed to add candlestick series after ${attempt + 1} attempts: ${errorMsg}\n\nStack: ${errorStack}\n\nDebug info:\n${JSON.stringify(debugData, null, 2)}`);
                  setLoading(false);
                  if (chart) {
                    chart.remove();
                  }
                }
              }
              };
              
              // Start with requestAnimationFrame to ensure DOM is ready
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  // Add a small delay to ensure chart is fully initialized
                  setTimeout(() => {
                    addSeriesWithRetry(0);
                  }, 150);
                });
              });
            }

          } catch (err) {
            console.error("Error initializing chart:", err);
            setError(`Failed to initialize chart: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setLoading(false);
          }
        }, 100); // Delay to ensure styles are applied and container is rendered
      });
    };

    // Start initialization
    initChart();

    // Return cleanup function
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (cleanup) {
        cleanup();
      }
    };
    
    // containerReadyRef.current is already set at the start of useEffect
  }, [fetchPriceData]);

  // Also trigger fetch when dependencies change (timeframe, etc.)
  useEffect(() => {
    // Only fetch if chart is initialized
    if (chartRef.current && seriesRef.current) {
      console.log('Dependencies changed, fetching data');
      fetchPriceData();
    } else {
      console.log('Chart or series not ready yet', {
        chart: !!chartRef.current,
        series: !!seriesRef.current
      });
    }
  }, [fetchPriceData, symbol, entryTimestamp, exitTimestamp, entryPrice, exitPrice, timeframe, baseSymbol, chartSettings]);
  
  // Update chart colors when settings change
  useEffect(() => {
    if (chartRef.current && seriesRef.current) {
      const cleanColor = (color: string, defaultColor: string): string => {
        if (!color || color.trim() === '') return defaultColor;
        const cleaned = color.trim().replace(/^#/, '');
        if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
          return `#${cleaned}`;
        }
        return defaultColor;
      };
      
      const gridColor = cleanColor(chartSettings.gridColor, defaultSettings.gridColor);
      const bgColor = cleanColor(chartSettings.backgroundColor, defaultSettings.backgroundColor);
      const textColor = cleanColor(chartSettings.textColor, defaultSettings.textColor);
      const upColor = cleanColor(chartSettings.upColor, defaultSettings.upColor);
      const downColor = cleanColor(chartSettings.downColor, defaultSettings.downColor);
      
      // Update chart layout
      chartRef.current.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: bgColor },
          textColor: textColor,
        },
        grid: {
          vertLines: { color: gridColor, style: 1 },
          horzLines: { color: gridColor, style: 1 },
        },
        rightPriceScale: {
          borderColor: gridColor,
        },
        timeScale: {
          borderColor: gridColor,
        },
      });
      
      // Update series colors
      seriesRef.current.applyOptions({
        upColor: upColor,
        downColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
    }
  }, [chartSettings, cleanColor]);
  
  const handleSettingsChange = (newSettings: Partial<ChartSettings>) => {
    const updated = { ...chartSettings, ...newSettings };
    setChartSettings(updated);
    localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify(updated));
  };
  
  const resetSettings = () => {
    setChartSettings(defaultSettings);
    localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify(defaultSettings));
  };

  // Safety check - if chart failed to initialize, show error and allow close
  if (error && !chartRef.current) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
          padding: "20px",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose?.();
          }
        }}
      >
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "40px",
            maxWidth: "500px",
            textAlign: "center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
                  <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "16px", color: "#ef5350" }}>
                    Chart Error
                  </h2>
                  <p style={{ color: "var(--text-secondary)", marginBottom: "24px", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "12px" }}>{error}</p>
                  {debugInfo && (
                    <details style={{ marginTop: "16px", color: "var(--text-secondary)", fontSize: "12px" }}>
                      <summary style={{ cursor: "pointer", marginBottom: "8px" }}>Debug Information</summary>
                      <pre style={{ 
                        backgroundColor: "rgba(0, 0, 0, 0.3)", 
                        padding: "12px", 
                        borderRadius: "4px", 
                        overflow: "auto",
                        maxHeight: "200px",
                        fontSize: "11px"
                      }}>{debugInfo}</pre>
                    </details>
                  )}
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px",
              backgroundColor: "var(--accent)",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const innerContent = (
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: inline ? "12px" : "20px",
          width: inline ? "100%" : "90%",
          maxWidth: inline ? "100%" : "1200px",
          maxHeight: inline ? "none" : "90vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: inline ? "8px" : "16px",
        }}
        onClick={(e) => !inline && e.stopPropagation()}
      >
        {inline && (
          <div style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>{symbol}</div>
        )}
        {!inline && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "600", margin: 0 }}>
            {symbol} - Trade Chart
          </h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowSettings(!showSettings);
              }}
              style={{
                background: showSettings ? "var(--bg-tertiary)" : "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                padding: "8px",
                color: "var(--text-primary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
              }}
              title="Chart Settings"
            >
              <Settings size={16} />
            </button>
            <button
              onClick={() => onClose?.()}
              style={{
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                padding: "8px 16px",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Close
            </button>
          </div>
        </div>
        )}
        
        {!inline && showSettings && (
          <div
            style={{
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>Chart Settings</h3>
              <button
                onClick={resetSettings}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  padding: "4px 12px",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                Reset to Defaults
              </button>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
              {/* Background Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Background Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.backgroundColor}
                    onChange={(e) => handleSettingsChange({ backgroundColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.backgroundColor}
                    onChange={(e) => handleSettingsChange({ backgroundColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#1e1e1e"
                  />
                </div>
              </div>
              
              {/* Text Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Text Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.textColor}
                    onChange={(e) => handleSettingsChange({ textColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.textColor}
                    onChange={(e) => handleSettingsChange({ textColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#ffffff"
                  />
                </div>
              </div>
              
              {/* Grid Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Grid Lines Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.gridColor}
                    onChange={(e) => handleSettingsChange({ gridColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.gridColor}
                    onChange={(e) => handleSettingsChange({ gridColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#2a2a2a"
                  />
                </div>
              </div>
              
              {/* Up/Profit Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Up/Profit Candle Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.upColor}
                    onChange={(e) => handleSettingsChange({ upColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.upColor}
                    onChange={(e) => handleSettingsChange({ upColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#26a69a"
                  />
                </div>
              </div>
              
              {/* Down/Loss Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Down/Loss Candle Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.downColor}
                    onChange={(e) => handleSettingsChange({ downColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.downColor}
                    onChange={(e) => handleSettingsChange({ downColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#ef5350"
                  />
                </div>
              </div>
              
              {/* Buy Marker Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Buy Marker Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.buyMarkerColor}
                    onChange={(e) => handleSettingsChange({ buyMarkerColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.buyMarkerColor}
                    onChange={(e) => handleSettingsChange({ buyMarkerColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#26a69a"
                  />
                </div>
              </div>
              
              {/* Sell Marker Color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                  Sell Marker Color
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="color"
                    value={chartSettings.sellMarkerColor}
                    onChange={(e) => handleSettingsChange({ sellMarkerColor: e.target.value })}
                    style={{
                      width: "40px",
                      height: "32px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      backgroundColor: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={chartSettings.sellMarkerColor}
                    onChange={(e) => handleSettingsChange({ sellMarkerColor: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "4px",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                    }}
                    placeholder="#ef5350"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {!inline && (
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <label style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
            Timeframe:
          </label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            style={{
              padding: "6px 12px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            <option value="1m">1 Minute</option>
            <option value="3m">3 Minutes</option>
            <option value="5m">5 Minutes</option>
            <option value="15m">15 Minutes</option>
            <option value="30m">30 Minutes</option>
            <option value="1h">1 Hour</option>
            <option value="1d">1 Day</option>
          </select>

        </div>
        )}

        <div style={{ display: "flex", gap: "16px", fontSize: inline ? "12px" : "14px", color: "var(--text-secondary)", flexWrap: "wrap" }}>
          <div>
            <strong>Entry:</strong> {format(new Date(entryTimestamp), "MMM dd, yyyy HH:mm")} @ ${entryPrice.toFixed(2)}
          </div>
          <div>
            <strong>Exit:</strong> {format(new Date(exitTimestamp), "MMM dd, yyyy HH:mm")} @ ${exitPrice.toFixed(2)}
          </div>
          <div style={{ color: exitPrice > entryPrice ? "var(--profit)" : "var(--loss)" }}>
            <strong>P&L:</strong> ${(exitPrice - entryPrice).toFixed(2)}
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
            Loading chart data...
          </div>
        )}

        {error && (
          <div style={{ 
            textAlign: "center", 
            padding: "40px", 
            color: "#ef5350",
            backgroundColor: "rgba(239, 83, 80, 0.1)",
            borderRadius: "8px",
            border: "1px solid rgba(239, 83, 80, 0.3)",
          }}>
            <div style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>Error Loading Chart</div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{error}</div>
            <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Note: Chart data requires internet connection.
            </div>
          </div>
        )}

        <div
          ref={chartContainerRef}
          style={{
            width: "100%",
            height: inline ? compactHeight : 500,
            minHeight: inline ? compactHeight : 500,
            minWidth: inline ? 280 : 800,
            position: "relative",
            display: "block",
          }}
        />
      </div>
    );

  if (inline) {
    return innerContent;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      {innerContent}
    </div>
  );
}

