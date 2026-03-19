import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { loadSandboxState } from "../utils/sandboxStore";
import { GridLadder } from "../features/grid/GridLadder";
import { GridCyclesTable } from "../features/grid/GridCyclesTable";
import { GridSummaryCards } from "../features/grid/GridSummaryCards";
import { GridCycleTimeline } from "../features/grid/GridCycleTimeline";
import { TradeChart } from "../components/TradeChart";
import {
  deriveGridLevels,
  aggregateFillsByLevel,
  computeGridPositionCycles,
  computeExposure,
  computePnLSummary,
} from "../features/grid/gridCalculations";
import { GridCycle, GridFill } from "../features/grid/gridTypes";

type BasicTrade = {
  id: number | string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  status?: string;
  fees?: number | null;
};

const GRID_TOOL_STATE_KEY = "tradebutler_grid_ladder_tool_state_v1";

interface GridToolPersistedState {
  symbol?: string;
  instrumentFilter?: "shares" | "options" | "all";
  gridAreaMode?: "grid" | "timeline";
  selectedCycleId?: string;
}

function loadGridToolState(): GridToolPersistedState {
  try {
    const raw = localStorage.getItem(GRID_TOOL_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GridToolPersistedState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function isOptionsSymbol(sym: string): boolean {
  if (!sym) return false;
  if (sym.length < 10) return false;
  const hasCallPut = sym.includes("C") || sym.includes("P");
  if (!hasCallPut) return false;
  const hasDatePattern = /\d{6}/.test(sym);
  return hasCallPut && (hasDatePattern || sym.length > 15);
}

function mapTradesToFills(trades: BasicTrade[]): GridFill[] {
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side.toUpperCase() === "SELL" ? "SELL" : "BUY",
    price: t.price,
    quantity: t.quantity,
    timestamp: t.timestamp,
    status:
      t.status === "PARTIAL"
        ? "PARTIAL"
        : t.status === "CANCELLED"
        ? "CANCELLED"
        : "FILLED",
    kind: "FILL",
  }));
}

export default function GridLadderTool() {
  const initialState = loadGridToolState();
  const [symbol, setSymbol] = useState<string>(initialState.symbol || "AAPL");
  const [selectedLevelId, setSelectedLevelId] = useState<string | undefined>();
  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>(
    initialState.selectedCycleId || undefined,
  );
  const [gridAreaMode, setGridAreaMode] = useState<"grid" | "timeline">(
    initialState.gridAreaMode === "timeline" ? "timeline" : "grid",
  );
  const [instrumentFilter, setInstrumentFilter] = useState<"shares" | "options" | "all">(
    initialState.instrumentFilter === "options" || initialState.instrumentFilter === "all"
      ? initialState.instrumentFilter
      : "shares",
  );
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [trades, setTrades] = useState<BasicTrade[]>([]);
  const [_isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCycleForChartId, setSelectedCycleForChartId] = useState<string | null>(null);
  const [leftPaneWidthPct, setLeftPaneWidthPct] = useState<number>(62);
  const [isResizingPanes, setIsResizingPanes] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const handleSelectCycle = (cycleId: string) => {
    setSelectedCycleId((prev) => (prev === cycleId ? undefined : cycleId));
  };

  useEffect(() => {
    const unsubscribe = subscribeToDataMode((mode) => {
      setDataMode(mode);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTrades() {
      setIsLoading(true);
      setLoadError(null);
      try {
        if (dataMode === "sandbox") {
          const state = loadSandboxState();
          const sandboxTrades = Array.isArray(state.trades) ? state.trades : [];
          const filtered = sandboxTrades.filter((t) => t.symbol === symbol);
          if (!cancelled) {
            setTrades(filtered as unknown as BasicTrade[]);
          }
        } else {
          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
          const backendTrades = await invoke<BasicTrade[]>("get_trades", paperArgs);
          const filtered = backendTrades.filter((t) => t.symbol === symbol);
          if (!cancelled) {
            setTrades(filtered);
          }
        }
      } catch (e) {
        console.error("Failed to load trades for Grid Ladder:", e);
        if (!cancelled) {
          setTrades([]);
          setLoadError("Failed to load trades for this mode.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    loadTrades();
    return () => {
      cancelled = true;
    };
  }, [dataMode, symbol]);

  const filteredTradesForInstrument = useMemo(() => {
    if (instrumentFilter === "all") return trades;
    if (instrumentFilter === "options") {
      return trades.filter((t) => isOptionsSymbol(t.symbol));
    }
    return trades.filter((t) => !isOptionsSymbol(t.symbol));
  }, [trades, instrumentFilter]);

  const fills: GridFill[] = useMemo(
    () => mapTradesToFills(filteredTradesForInstrument),
    [filteredTradesForInstrument],
  );

  const cycles: GridCycle[] = useMemo(
    () => computeGridPositionCycles(symbol, fills),
    [symbol, fills],
  );

  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);
  const selectedCycleForChart = cycles.find((c) => c.id === selectedCycleForChartId);
  const fillsForLadder = selectedCycle?.fills ?? fills;

  const levelsForLadder = useMemo(
    () => deriveGridLevels(undefined, fillsForLadder),
    [fillsForLadder],
  );

  const aggregatesForLadder = useMemo(
    () => aggregateFillsByLevel(levelsForLadder, fillsForLadder),
    [levelsForLadder, fillsForLadder],
  );

  const currentPriceForLadder: number | null = useMemo(() => {
    if (!fillsForLadder.length) return null;
    return fillsForLadder[fillsForLadder.length - 1].price;
  }, [fillsForLadder]);

  const exposure = useMemo(
    () => computeExposure(symbol, aggregatesForLadder, currentPriceForLadder),
    [symbol, aggregatesForLadder, currentPriceForLadder],
  );

  const pnlCyclesForLadder = selectedCycle ? [selectedCycle] : cycles;

  const pnl = useMemo(
    () => computePnLSummary(symbol, pnlCyclesForLadder, exposure),
    [symbol, pnlCyclesForLadder, exposure],
  );

  const selectedCycleChartTrades = useMemo(() => {
    if (!selectedCycleForChart) return undefined;
    return selectedCycleForChart.fills.map((fill, idx) => ({
      id: idx + 1,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      timestamp: fill.timestamp,
      order_type: "MARKET",
      status: "FILLED",
      fees: null as number | null,
      notes: null as string | null,
      strategy_id: null as number | null,
    }));
  }, [selectedCycleForChart]);

  useEffect(() => {
    // If the selected cycle changes, the previous level selection may not exist anymore.
    setSelectedLevelId(undefined);
  }, [selectedCycleId]);

  useEffect(() => {
    if (!selectedCycleId) return;
    if (!cycles.some((c) => c.id === selectedCycleId)) {
      setSelectedCycleId(undefined);
    }
  }, [cycles, selectedCycleId]);

  useEffect(() => {
    if (!selectedCycleForChartId) return;
    if (!cycles.some((c) => c.id === selectedCycleForChartId)) {
      setSelectedCycleForChartId(null);
    }
  }, [cycles, selectedCycleForChartId]);

  useEffect(() => {
    const stateToPersist: GridToolPersistedState = {
      symbol,
      instrumentFilter,
      gridAreaMode,
      selectedCycleId,
    };
    localStorage.setItem(GRID_TOOL_STATE_KEY, JSON.stringify(stateToPersist));
  }, [symbol, instrumentFilter, gridAreaMode, selectedCycleId]);

  useEffect(() => {
    if (!isResizingPanes) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      const rawPct = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(35, Math.min(75, rawPct));
      setLeftPaneWidthPct(clamped);
    };

    const handleMouseUp = () => {
      setIsResizingPanes(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingPanes]);

  return (
    <div
      ref={layoutRef}
      style={{
        display: "grid",
        gridTemplateColumns: `${leftPaneWidthPct}% 8px minmax(0, 1fr)`,
        gap: "6px",
        padding: "12px 24px 16px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Symbol
          </div>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              width: "100px",
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              fontSize: "13px",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "4px",
              marginLeft: "8px",
              padding: "2px",
              borderRadius: "999px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-tertiary)",
            }}
          >
            {(
              [
                { key: "shares" as const, label: "Shares" },
                { key: "options" as const, label: "Contracts" },
                { key: "all" as const, label: "All" },
              ] satisfies { key: "shares" | "options" | "all"; label: string }[]
            ).map((opt) => {
              const active = instrumentFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setInstrumentFilter(opt.key)}
                  style={{
                    border: "none",
                    borderRadius: "999px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    backgroundColor: active ? "var(--accent)" : "transparent",
                    color: active ? "#ffffff" : "var(--text-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: "12px",
              color: "var(--text-secondary)",
            }}
          >
            {dataMode === "sandbox"
              ? "Demo mode — using sandbox trades."
              : dataMode === "paper"
              ? "Paper mode — using paper-only trades."
              : "Real mode — using your real trades."}
          </div>
        </div>
        {loadError && (
          <div
            style={{
              marginTop: "4px",
              fontSize: "11px",
              color: "var(--danger-color, #dc2626)",
            }}
          >
            {loadError}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            padding: "2px 0",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
            View
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              type="button"
              onClick={() => setGridAreaMode("timeline")}
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: gridAreaMode === "timeline" ? "var(--accent)" : "transparent",
                color: gridAreaMode === "timeline" ? "#fff" : "var(--text-secondary)",
                borderRadius: "999px",
                padding: "4px 10px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setGridAreaMode("grid")}
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: gridAreaMode === "grid" ? "var(--accent)" : "transparent",
                color: gridAreaMode === "grid" ? "#fff" : "var(--text-secondary)",
                borderRadius: "999px",
                padding: "4px 10px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              Grid
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {gridAreaMode === "timeline" ? (
            <GridCycleTimeline cycle={selectedCycle} />
          ) : (
            <GridLadder
              aggregates={aggregatesForLadder}
              currentPrice={currentPriceForLadder}
              exposure={exposure}
              selectedLevelId={selectedLevelId}
              onSelectLevel={setSelectedLevelId}
              showPositionMetrics={false}
            />
          )}
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizingPanes(true);
        }}
        style={{
          cursor: "col-resize",
          borderRadius: "6px",
          backgroundColor: isResizingPanes
            ? "color-mix(in srgb, var(--accent) 25%, var(--bg-secondary))"
            : "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          userSelect: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minHeight: 0,
        }}
      >
        <GridSummaryCards
          pnl={pnl}
          exposure={exposure}
            currentPrice={currentPriceForLadder}
        />
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginTop: "4px",
          }}
        >
          Position cycles
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <GridCyclesTable
            cycles={cycles}
            selectedCycleId={selectedCycleId}
            onSelectCycle={handleSelectCycle}
            onViewGraph={(cycleId) => setSelectedCycleForChartId(cycleId)}
          />
        </div>
        {selectedCycle && (
          <div
            style={{
              marginTop: "4px",
              fontSize: "11px",
              color: "var(--text-secondary)",
            }}
          >
            Selected cycle: {selectedCycle.cycleName}. Realized PnL{" "}
            {selectedCycle.grossPnl.toFixed(2)}.
          </div>
        )}
      </div>
      {selectedCycleForChart && selectedCycleChartTrades && (
        <TradeChart
          symbol={selectedCycleForChart.symbol}
          entryTimestamp={selectedCycleForChart.openTime}
          exitTimestamp={
            selectedCycleForChart.closeTime ??
            selectedCycleForChart.fills[selectedCycleForChart.fills.length - 1]?.timestamp ??
            selectedCycleForChart.openTime
          }
          entryPrice={selectedCycleForChart.entryPrice}
          exitPrice={
            selectedCycleForChart.exitPrice ??
            selectedCycleForChart.fills[selectedCycleForChart.fills.length - 1]?.price ??
            selectedCycleForChart.entryPrice
          }
          onClose={() => setSelectedCycleForChartId(null)}
          positionTrades={selectedCycleChartTrades}
        />
      )}
    </div>
  );
}

