import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { loadSandboxState } from "../utils/sandboxStore";
import { GridLadder } from "../features/grid/GridLadder";
import { GridCyclesTable } from "../features/grid/GridCyclesTable";
import { GridSummaryCards } from "../features/grid/GridSummaryCards";
import { GridCycleTimeline } from "../features/grid/GridCycleTimeline";
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
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [selectedLevelId, setSelectedLevelId] = useState<string | undefined>();
  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>();
  const [gridAreaMode, setGridAreaMode] = useState<"grid" | "timeline">("grid");
  const [instrumentFilter, setInstrumentFilter] = useState<"shares" | "options" | "all">("shares");
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [trades, setTrades] = useState<BasicTrade[]>([]);
  const [_isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  useEffect(() => {
    // If the selected cycle changes, the previous level selection may not exist anymore.
    setSelectedLevelId(undefined);
  }, [selectedCycleId]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 2.2fr) minmax(0, 1.4fr)",
        gap: "12px",
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
    </div>
  );
}

