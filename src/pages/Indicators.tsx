import { useEffect, useMemo, useState } from "react";
import { Code2, Plus, Search, Star, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { addIndicator, getPrebuiltIndicatorThumbnails, loadIndicators, loadStrategyIndicatorIds, updateIndicator, type Indicator } from "../utils/indicatorsStore";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { getSandboxStrategies } from "../utils/sandboxStore";

interface StrategyRef {
  id: number;
  name: string;
}

type SignalsView = "all" | "signals" | "technical" | "candles";

const THEME_COLOR_PRESET_DEFS: Array<{ hex: string; label: string }> = [
  { hex: "#7C3AED", label: "Purple" },
  { hex: "#2563EB", label: "Blue" },
  { hex: "#0EA5E9", label: "Sky" },
  { hex: "#10B981", label: "Green" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#EC4899", label: "Pink" },
  { hex: "#22C55E", label: "Emerald" },
];
const THEME_COLOR_PRESETS = THEME_COLOR_PRESET_DEFS.map((p) => p.hex);

function hexToRgba(hex: string, alpha: number): string {
  // Supports #RRGGBB only; falls back to transparent for invalid input.
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(245,158,11,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}


export default function IndicatorsPage({ view = "signals" }: { view?: SignalsView }) {
  const FAVORITES_KEY = "tradebutler_favorite_indicators_v1";
  const EMA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ema_default_lengths_config_v1";
  const MA_DEFAULT_LENGTHS_CONFIG_KEY = "tradebutler_ma_default_lengths_config_v1";
  const LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY = "tradebutler_ma_default_lengths_v1";
  const MA_DEFAULT_LENGTHS_FALLBACK = ["50", "100", "200", "500"];

  type LengthChip = { len: string; enabled: boolean };
  type MovingAverageFlags = { bullishCross: boolean; bearishCross: boolean; coiling: boolean };

  const parseLengthsCsv = (csv: string): string[] => {
    const parts = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n) || n <= 0) continue;
      const asInt = String(Math.trunc(n));
      if (asInt === "0") continue;
      if (seen.has(asInt)) continue;
      seen.add(asInt);
      out.push(asInt);
    }
    return out.length ? out : MA_DEFAULT_LENGTHS_FALLBACK;
  };

  const normalizeLengthValue = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    const asInt = Math.trunc(n);
    if (asInt <= 0) return null;
    return String(asInt);
  };

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // "all" | "custom" | "Momentum" | ...
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [showBullish, setShowBullish] = useState(true);
  const [showBearish, setShowBearish] = useState(true);
  const [activeSections, setActiveSections] = useState<{
    indicators: boolean;
    technical: boolean;
    candles: boolean;
  }>({
    indicators: false,
    technical: false,
    candles: false,
  });
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      if (typeof window === "undefined") return new Set();
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.map((x) => String(x)).filter(Boolean));
    } catch {
      return new Set();
    }
  });

  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());
  const [strategies, setStrategies] = useState<StrategyRef[]>([]);
  const [strategyFilterId, setStrategyFilterId] = useState<number | "all">("all");

  const [selected, setSelected] = useState<Indicator | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const [newName, setNewName] = useState("");
  const [newAbbr, setNewAbbr] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newImage, setNewImage] = useState<string>("");
  const [newCategory, setNewCategory] = useState<Indicator["category"]>("Custom");
  const [newCapturesTimeframes, setNewCapturesTimeframes] = useState<boolean>(false);
  const [newAccentColor, setNewAccentColor] = useState<string>("#F59E0B");
  const [newThemeMode, setNewThemeMode] = useState<"auto" | "manual">("auto");
  const [newThumbSource, setNewThumbSource] = useState<"upload" | "preset">("preset");
  const [newThumbPresetId, setNewThumbPresetId] = useState<string>("rsi");

  const [editName, setEditName] = useState("");
  const [editAbbr, setEditAbbr] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editImage, setEditImage] = useState<string>("");
  const [editCategory, setEditCategory] = useState<Indicator["category"]>("Custom");
  const [editCapturesTimeframes, setEditCapturesTimeframes] = useState<boolean>(false);
  const [editOtherSignals, setEditOtherSignals] = useState<string[]>([]);
  const [editOtherSignalDraft, setEditOtherSignalDraft] = useState<string>("");
  const [editAccentColor, setEditAccentColor] = useState<string>("#F59E0B");
  const [editThemeMode, setEditThemeMode] = useState<"auto" | "manual">("manual");
  const [editThumbSource, setEditThumbSource] = useState<"upload" | "preset">("preset");
  const [editThumbPresetId, setEditThumbPresetId] = useState<string>("rsi");
  const [showThumbGallery, setShowThumbGallery] = useState(false);

  const [maDefaultLengths, setMaDefaultLengths] = useState<LengthChip[]>(
    MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true }))
  );
  const [maFlags, setMaFlags] = useState<MovingAverageFlags>({
    bullishCross: false,
    bearishCross: false,
    coiling: false,
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const [maAddDraft, setMaAddDraft] = useState<string>("");
  const [maIsAdding, setMaIsAdding] = useState<boolean>(false);

  useEffect(() => {
    if (!selected || (selected.id !== "ema" && selected.id !== "ma")) return;
    if (typeof window === "undefined") return;

    const indicatorId = selected.id as "ema" | "ma";
    const cfgKey = indicatorId === "ema" ? EMA_DEFAULT_LENGTHS_CONFIG_KEY : MA_DEFAULT_LENGTHS_CONFIG_KEY;
    const legacyRaw = window.localStorage.getItem(LEGACY_MOVING_AVERAGE_DEFAULT_LENGTHS_KEY);

    // Load configured chips (enabled/disabled).
    const rawCfg = window.localStorage.getItem(cfgKey);
    let nextChips: LengthChip[] | null = null;
    if (rawCfg && rawCfg.trim()) {
      try {
        const parsed = JSON.parse(rawCfg);
        if (Array.isArray(parsed)) {
          nextChips = parsed
            .map((x) => {
              if (typeof x === "number") return { len: String(x), enabled: true };
              if (typeof x === "string") return { len: x, enabled: true };
              if (x && typeof x === "object" && "len" in x) {
                const len = (x as any).len;
                const enabled = "enabled" in (x as any) ? Boolean((x as any).enabled) : true;
                return len != null ? { len: String(len), enabled } : null;
              }
              return null;
            })
            .filter(Boolean) as LengthChip[];
        }
      } catch {
        // ignore, will fall back below
      }
    }

    if (!nextChips || nextChips.length === 0) {
      const legacyNums = parseLengthsCsv(legacyRaw ?? "");
      nextChips = legacyNums.map((len) => ({ len, enabled: true }));
    }

    // De-dupe by len and preserve order.
    const seen = new Set<string>();
    nextChips = nextChips.filter((c) => {
      if (seen.has(c.len)) return false;
      seen.add(c.len);
      return true;
    });

    setMaDefaultLengths(nextChips ?? MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true })));

    // Load crossing/coiling flags.
    const flagsKey = `tradebutler_${indicatorId}_crossing_coiling_flags_v1`;
    const rawFlags = window.localStorage.getItem(flagsKey);
    if (rawFlags && rawFlags.trim()) {
      try {
        const f = JSON.parse(rawFlags);
        setMaFlags({
          bullishCross: Boolean(f?.bullishCross),
          bearishCross: Boolean(f?.bearishCross),
          coiling: Boolean(f?.coiling),
        });
      } catch {
        setMaFlags({ bullishCross: false, bearishCross: false, coiling: false });
      }
    } else {
      setMaFlags({ bullishCross: false, bearishCross: false, coiling: false });
    }

    setDragIndex(null);
    setMaIsAdding(false);
    setMaAddDraft("");
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || (selected.id !== "ema" && selected.id !== "ma")) return;
    if (typeof window === "undefined") return;
    const indicatorId = selected.id as "ema" | "ma";
    const cfgKey = indicatorId === "ema" ? EMA_DEFAULT_LENGTHS_CONFIG_KEY : MA_DEFAULT_LENGTHS_CONFIG_KEY;
    window.localStorage.setItem(cfgKey, JSON.stringify(maDefaultLengths));

    const flagsKey = `tradebutler_${indicatorId}_crossing_coiling_flags_v1`;
    window.localStorage.setItem(flagsKey, JSON.stringify(maFlags));

    // Same-window localStorage writes don't emit "storage" events.
    // Dispatch an app-level signal so Journal can refresh immediately.
    window.dispatchEvent(new CustomEvent("tradebutler:ma-config-changed"));
  }, [maDefaultLengths, maFlags, selected?.id]);

  const indicators = useMemo(() => loadIndicators(), [showAdd, selected]);

  const getBias = (i: Indicator): "bullish" | "bearish" | "neutral" => {
    const text = `${i.name ?? ""} ${i.abbreviation ?? ""} ${i.description ?? ""}`.toLowerCase();
    if (/(bull|buy|long|ascending|rising)/.test(text)) return "bullish";
    if (/(bear|sell|short|descending|falling)/.test(text)) return "bearish";
    return "neutral";
  };

  const passesBiasFilter = (i: Indicator): boolean => {
    const bias = getBias(i);
    if (bias === "neutral") return true;
    if (bias === "bullish") return showBullish;
    return showBearish;
  };

  const strategyIndicatorIdSet = useMemo<Set<string> | null>(() => {
    if (strategyFilterId === "all") return null;
    return new Set(loadStrategyIndicatorIds(dataMode, strategyFilterId));
  }, [strategyFilterId, dataMode, indicators]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let base = indicators;

    if (q) {
      base = base.filter((i) => {
        const hay = `${i.name} ${i.abbreviation} ${i.description}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (categoryFilter === "custom") {
      base = base.filter((i) => i.kind === "custom");
    } else if (categoryFilter !== "all") {
      base = base.filter((i) => i.category === categoryFilter);
    }

    if (strategyIndicatorIdSet) {
      base = base.filter((i) => strategyIndicatorIdSet.has(i.id));
    }

    if (favoriteOnly) {
      base = base.filter((i) => favoriteIds.has(i.id));
    }

    // Put custom indicators at the beginning of the gallery.
    return [...base].sort((a, b) => {
      const ak = a.kind === "custom" ? 0 : 1;
      const bk = b.kind === "custom" ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [indicators, query, categoryFilter, strategyIndicatorIdSet, favoriteOnly, favoriteIds]);

  const technicalPatterns = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = indicators.filter((i) => i.category === "Pattern" && i.signalGroup === "TechnicalPattern");

    if (q) {
      base = base.filter((i) => {
        const hay = `${i.name} ${i.abbreviation} ${i.description}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (strategyIndicatorIdSet) {
      base = base.filter((i) => strategyIndicatorIdSet.has(i.id));
    }

    if (favoriteOnly) {
      base = base.filter((i) => favoriteIds.has(i.id));
    }

    return [...base].sort((a, b) => {
      const ak = a.kind === "custom" ? 0 : 1;
      const bk = b.kind === "custom" ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [indicators, query, strategyIndicatorIdSet, favoriteOnly, favoriteIds]);

  const candlestickPatterns = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = indicators.filter((i) => i.category === "Pattern" && i.signalGroup === "Candlestick");

    if (q) {
      base = base.filter((i) => {
        const hay = `${i.name} ${i.abbreviation} ${i.description}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (strategyIndicatorIdSet) {
      base = base.filter((i) => strategyIndicatorIdSet.has(i.id));
    }

    if (favoriteOnly) {
      base = base.filter((i) => favoriteIds.has(i.id));
    }

    return [...base].sort((a, b) => {
      const ak = a.kind === "custom" ? 0 : 1;
      const bk = b.kind === "custom" ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [indicators, query, strategyIndicatorIdSet, favoriteOnly, favoriteIds]);

  const visibleFiltered = useMemo(() => filtered.filter(passesBiasFilter), [filtered, showBullish, showBearish]);
  const visibleTechnicalPatterns = useMemo(() => technicalPatterns.filter(passesBiasFilter), [technicalPatterns, showBullish, showBearish]);
  const visibleCandlestickPatterns = useMemo(() => candlestickPatterns.filter(passesBiasFilter), [candlestickPatterns, showBullish, showBearish]);
  const noSectionSelected = !activeSections.indicators && !activeSections.technical && !activeSections.candles;

  const prebuiltThumbnails = useMemo(() => {
    if (!showEdit) return [];
    return getPrebuiltIndicatorThumbnails(editAbbr.trim() || selected?.abbreviation || "IND", editAccentColor);
  }, [showEdit, editAbbr, selected?.abbreviation, editAccentColor]);

  const filteredSignals = useMemo(() => {
    if (view !== "all") return filtered;
    // Keep candlestick patterns out of the main indicators library.
    return filtered.filter((i) => i.signalGroup !== "Candlestick").filter(passesBiasFilter);
  }, [filtered, view, showBullish, showBearish]);

  function resetAddModal() {
    setNewName("");
    setNewAbbr("");
    setNewDesc("");
    setNewCode("");
    setNewImage("");
    setNewCategory("Custom");
    setNewCapturesTimeframes(false);
    setNewThemeMode("auto");
    setNewThumbSource("preset");
    const randomAccent = THEME_COLOR_PRESETS[Math.floor(Math.random() * THEME_COLOR_PRESETS.length)];
    const presets = getPrebuiltIndicatorThumbnails("IND", randomAccent);
    const randomPreset = presets[Math.floor(Math.random() * presets.length)];
    setNewAccentColor(randomAccent);
    setNewThumbPresetId(randomPreset.id);
  }

  function resetEditModal(ind: Indicator | null) {
    setShowEdit(false);
    setShowThumbGallery(false);
    if (!ind) return;
    setEditName(ind.name ?? "");
    setEditAbbr(ind.abbreviation ?? "");
    setEditDesc(ind.description ?? "");
    setEditCode(ind.code ?? "");
    setEditImage(ind.exampleImage ?? "");
    setEditCategory(ind.category ?? "Custom");
    setEditCapturesTimeframes(ind.capturesTimeframes === true || ind.id.includes("_timeframe"));
    setEditOtherSignals(Array.isArray(ind.otherSignals) ? ind.otherSignals : []);
    setEditOtherSignalDraft("");
    const accent = ind.accentColor ?? "#F59E0B";
    setEditAccentColor(accent);

    // Detect whether the current exampleImage matches one of our preset thumbnails.
    // If it matches, treat it as "preset" so changing theme color updates the thumbnail.
    const presets = getPrebuiltIndicatorThumbnails(ind.abbreviation ?? "IND", accent);
    const match = ind.exampleImage ? presets.find((p) => p.image === ind.exampleImage) : undefined;
    if (match) {
      setEditThumbSource("preset");
      setEditThumbPresetId(match.id);
      setEditThemeMode("manual");
    } else {
      setEditThumbSource("upload");
      setEditThumbPresetId("rsi");
      setEditThemeMode("manual");
    }
  }

  useEffect(() => {
    // Keep the auto/preset thumbnail preview in sync as the user edits abbreviation/theme.
    if (!showAdd) return;
    if (newThumbSource !== "preset") return;
    const abbr = newAbbr.trim() || "IND";
    const presets = getPrebuiltIndicatorThumbnails(abbr, newAccentColor);
    const match = presets.find((p) => p.id === newThumbPresetId) ?? presets[0];
    if (match?.image) setNewImage(match.image);
  }, [showAdd, newAbbr, newAccentColor, newThumbSource, newThumbPresetId]);

  useEffect(() => {
    // If the user is using a preset/auto thumbnail (not an uploaded image),
    // changing abbreviation/color should regenerate the SVG thumbnail.
    if (!showEdit) return;
    if (editThumbSource !== "preset") return;
    const abbr = editAbbr.trim() || selected?.abbreviation || "IND";
    const presets = getPrebuiltIndicatorThumbnails(abbr, editAccentColor);
    const match = presets.find((p) => p.id === editThumbPresetId) ?? presets[0];
    if (match?.image) setEditImage(match.image);
  }, [showEdit, editAbbr, editAccentColor, editThumbSource, editThumbPresetId]);

  useEffect(() => {
    // Persist favorites.
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favoriteIds)));
    } catch {
      /* optional */
    }
  }, [favoriteIds]);

  useEffect(() => {
    // Keep local dataMode in sync with the rest of the app.
    const unsub = subscribeToDataMode((mode) => setDataMode(mode));
    return () => unsub();
  }, []);

  useEffect(() => {
    // Load strategies for filtering.
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const data = getSandboxStrategies();
          setStrategies(data.map((s) => ({ id: s.id, name: s.name })));
          return;
        }
        const data = await invoke<StrategyRef[]>("get_strategies");
        setStrategies(data.map((s) => ({ id: s.id, name: s.name })));
      } catch {
        setStrategies([]);
      }
    })();
  }, [dataMode]);

  function toggleFavorite(indicatorId: string) {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(indicatorId)) next.delete(indicatorId);
      else next.add(indicatorId);
      return next;
    });
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  const renderIndicatorGrid = (list: Indicator[], emptyMessage: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "14px", overflow: "auto", paddingBottom: "16px" }}>
      {list.map((i) => (
        <button
          key={i.id}
          onClick={() => {
            setSelected(i);
            setShowEdit(false);
          }}
          style={{
            textAlign: "left",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "14px",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {i.exampleImage && (
            <img
              src={i.exampleImage}
              alt={i.name}
              style={{
                width: "100%",
                height: "110px",
                objectFit: "cover",
                borderRadius: "10px",
                border: "1px solid var(--border-color)",
              }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.name}>
              {i.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <span
                role="button"
                tabIndex={0}
                title={favoriteIds.has(i.id) ? "Unfavorite" : "Favorite"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavorite(i.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(i.id);
                  }
                }}
                style={{ display: "inline-flex", cursor: "pointer" }}
              >
                <Star size={16} fill={favoriteIds.has(i.id) ? "#FBBF24" : "transparent"} color={favoriteIds.has(i.id) ? "#FBBF24" : "var(--text-secondary)"} />
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  padding: "3px 7px",
                  borderRadius: "8px",
                  background: i.kind === "custom" ? hexToRgba(i.accentColor ?? "#F59E0B", 0.18) : "var(--bg-tertiary)",
                  border: `1px solid ${i.kind === "custom" ? hexToRgba(i.accentColor ?? "#F59E0B", 0.55) : "var(--border-color)"}`,
                  color: i.kind === "custom" ? i.accentColor ?? "#F59E0B" : "var(--text-secondary)",
                }}
              >
                {i.abbreviation}
              </span>
            </div>
          </div>
          {i.kind === "custom" && (
            <div style={{ fontSize: "11px", fontWeight: 800, color: i.accentColor ?? "#F59E0B", marginTop: "-6px" }}>
              Custom indicator
            </div>
          )}
          <div style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5, maxHeight: "3em", overflow: "hidden" }}>
            {i.description || "—"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", fontSize: "12px" }}>
            <Code2 size={14} />
            View code
          </div>
        </button>
      ))}
      {list.length === 0 && (
        <div style={{ color: "var(--text-secondary)", padding: "18px", border: "1px dashed var(--border-color)", borderRadius: "12px" }}>
          {emptyMessage}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "20px 24px", background: "var(--bg-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            {view === "technical" ? "Technical Analysis" : view === "candles" ? "Candles" : "Signals"}
          </h1>
          <div style={{ marginTop: "6px", color: "var(--text-secondary)", fontSize: "14px" }}>
            {view === "technical"
              ? "Browse technical analysis pattern signals. Click a card to view full description and code."
              : view === "candles"
              ? "Browse candlestick pattern signals. Click a card to view full description and code."
              : "Build and manage indicator and pattern libraries. Click a card to view full description and code."}
          </div>
        </div>
        {(view === "signals" || view === "all") && (
          <button
            onClick={() => {
              resetAddModal();
              setShowAdd(true);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--accent)",
              border: "none",
              borderRadius: "10px",
              padding: "10px 14px",
              color: "var(--bg-primary)",
              cursor: "pointer",
              fontWeight: 650,
            }}
          >
            <Plus size={18} />
            Add indicator
          </button>
        )}
      </div>

      {view === "all" ? (
        <div style={{ marginBottom: "16px", display: "flex", flexDirection: "row", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setActiveSections((prev) => ({ ...prev, indicators: !prev.indicators }))}
            style={{
              flex: "1 1 340px",
              border: `1px solid ${activeSections.indicators ? "var(--accent)" : "var(--border-color)"}`,
              borderRadius: "14px",
              background: activeSections.indicators ? "rgba(139, 92, 246, 0.14)" : "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>Indicators</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Filter by strategy, search, and favorites.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveSections((prev) => ({ ...prev, technical: !prev.technical }))}
            style={{
              flex: "1 1 340px",
              border: `1px solid ${activeSections.technical ? "var(--accent)" : "var(--border-color)"}`,
              borderRadius: "14px",
              background: activeSections.technical ? "rgba(139, 92, 246, 0.14)" : "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>Technical Analysis patterns</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Only indicators tagged as Technical Pattern.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveSections((prev) => ({ ...prev, candles: !prev.candles }))}
            style={{
              flex: "1 1 340px",
              border: `1px solid ${activeSections.candles ? "var(--accent)" : "var(--border-color)"}`,
              borderRadius: "14px",
              background: activeSections.candles ? "rgba(139, 92, 246, 0.14)" : "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>Candlestick patterns</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Only indicators tagged as Candlestick Pattern.</div>
            </div>
          </button>
        </div>
      ) : (
        <div
          style={{
            marginBottom: "16px",
            border: "1px solid var(--border-color)",
            borderRadius: "14px",
            background: "var(--bg-secondary)",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>
              {view === "technical" ? "Technical Analysis patterns" : view === "candles" ? "Candlestick patterns" : "Indicators"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Filter by strategy, search, and favorites.</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: "520px" }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              view === "technical"
                ? "Search technical patterns..."
                : view === "candles"
                ? "Search candlestick patterns..."
                : "Search indicators..."
            }
            style={{
              width: "100%",
              padding: "10px 12px 10px 40px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>
        {(view === "signals" || view === "all") && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              outline: "none",
            }}
            aria-label="Filter indicators"
          >
            <option value="all">All</option>
            <option value="custom">Custom</option>
            <option value="Momentum">Momentum</option>
            <option value="Trend">Trend</option>
            <option value="Volatility">Volatility</option>
            <option value="Volume">Volume</option>
            <option value="Structure">Structure</option>
            <option value="Pattern">Pattern</option>
          </select>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input type="checkbox" checked={favoriteOnly} onChange={(e) => setFavoriteOnly(e.target.checked)} />
          Favorites
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input type="checkbox" checked={showBullish} onChange={(e) => setShowBullish(e.target.checked)} />
          Bullish
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
          <input type="checkbox" checked={showBearish} onChange={(e) => setShowBearish(e.target.checked)} />
          Bearish
        </label>
        <select
          value={strategyFilterId === "all" ? "all" : String(strategyFilterId)}
          onChange={(e) => {
            const v = e.target.value;
            setStrategyFilterId(v === "all" ? "all" : Number(v));
          }}
          style={{
            padding: "10px 12px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            color: "var(--text-primary)",
            outline: "none",
          }}
          aria-label="Filter by strategy"
        >
          <option value="all">All strategies</option>
          {strategies.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
        <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
          {view === "all"
            ? `Indicators ${filteredSignals.length}, Technical ${visibleTechnicalPatterns.length}, Candles ${visibleCandlestickPatterns.length}`
            : view === "technical"
            ? `${visibleTechnicalPatterns.length} shown`
            : view === "candles"
            ? `${visibleCandlestickPatterns.length} shown`
            : `${visibleFiltered.length} shown`}
        </div>
      </div>

      {view === "all" ? (
        <>
          {(noSectionSelected || activeSections.indicators) && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Indicators
                </div>
              </div>
              {renderIndicatorGrid(filteredSignals, "No indicators yet. Click “Add indicator”.")}
            </div>
          )}

          {(noSectionSelected || activeSections.technical) && (
            <div style={{ marginTop: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Technical Analysis Patterns
                </div>
              </div>
              {renderIndicatorGrid(visibleTechnicalPatterns, "No technical analysis pattern indicators found.")}
            </div>
          )}

          {(noSectionSelected || activeSections.candles) && (
            <div style={{ marginTop: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Candlestick Patterns
                </div>
              </div>
              {renderIndicatorGrid(visibleCandlestickPatterns, "No candlestick pattern indicators found.")}
            </div>
          )}
        </>
      ) : view === "signals" ? (
        renderIndicatorGrid(visibleFiltered, "No indicators yet. Click “Add indicator”.")
      ) : view === "technical" ? (
        renderIndicatorGrid(visibleTechnicalPatterns, "No technical analysis pattern indicators found.")
      ) : (
        renderIndicatorGrid(visibleCandlestickPatterns, "No candlestick pattern indicators found.")
      )}

      {(view === "signals" || view === "all") && (
        <div style={{ marginTop: "18px", border: "1px dashed var(--border-color)", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Other Signal Groups
            </div>
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            Add more pattern/learning galleries here (example: Volatility regimes, trend setups, etc.).
          </div>
        </div>
      )}

      {/* View modal */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
          onClick={() => {
            setSelected(null);
            setShowEdit(false);
          }}
        >
          <div
            style={{ width: "100%", maxWidth: "980px", maxHeight: "82vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selected.name}
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  title={favoriteIds.has(selected.id) ? "Unfavorite" : "Favorite"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(selected.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFavorite(selected.id);
                    }
                  }}
                  style={{ display: "inline-flex", cursor: "pointer" }}
                >
                  <Star size={18} fill={favoriteIds.has(selected.id) ? "#FBBF24" : "transparent"} color={favoriteIds.has(selected.id) ? "#FBBF24" : "var(--text-secondary)"} />
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    padding: "3px 7px",
                    borderRadius: "8px",
                    background:
                      selected.kind === "custom" ? hexToRgba(selected.accentColor ?? "#F59E0B", 0.18) : "var(--bg-tertiary)",
                    border: `1px solid ${selected.kind === "custom" ? hexToRgba(selected.accentColor ?? "#F59E0B", 0.55) : "var(--border-color)"}`,
                    color: selected.kind === "custom" ? selected.accentColor ?? "#F59E0B" : "var(--text-secondary)",
                  }}
                >
                  {selected.abbreviation}
                </span>
                {selected.kind === "custom" && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 850,
                      padding: "3px 7px",
                      borderRadius: "8px",
                      background: hexToRgba(selected.accentColor ?? "#F59E0B", 0.18),
                      border: `1px solid ${hexToRgba(selected.accentColor ?? "#F59E0B", 0.55)}`,
                      color: selected.accentColor ?? "#F59E0B",
                    }}
                  >
                    Custom
                  </span>
                )}
                {selected.category && selected.category !== "Custom" && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 800,
                      padding: "3px 7px",
                      borderRadius: "8px",
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {selected.category}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {selected.kind === "custom" && (
                  <button
                    onClick={() => {
                      resetEditModal(selected);
                      setShowEdit(true);
                    }}
                    style={{
                      border: `1px solid ${hexToRgba(selected.accentColor ?? "#F59E0B", 0.45)}`,
                      background: hexToRgba(selected.accentColor ?? "#F59E0B", 0.14),
                      color: selected.accentColor ?? "#F59E0B",
                      borderRadius: "10px",
                      padding: "8px 10px",
                      cursor: "pointer",
                      fontWeight: 750,
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelected(null);
                    setShowEdit(false);
                  }}
                  style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            {showEdit ? (
              <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
                  {editImage && (
                    <img
                      src={editImage}
                      alt="Custom indicator"
                      style={{ width: "100%", height: "220px", objectFit: "cover", borderRadius: "12px", border: "1px solid var(--border-color)" }}
                    />
                  )}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontWeight: 650 }}>
                      <span>Upload image</span>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const dataUrl = await fileToDataUrl(file);
                          setEditImage(dataUrl);
                          setEditThumbSource("upload");
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowThumbGallery(true)}
                      style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                    >
                      Choose preset thumbnails
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!prebuiltThumbnails.length) return;
                        const random = prebuiltThumbnails[Math.floor(Math.random() * prebuiltThumbnails.length)];
                        setEditThumbSource("preset");
                        setEditThumbPresetId(random.id);
                        setEditImage(random.image);
                      }}
                      style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                    >
                      Use auto thumbnail
                    </button>
                  </div>
                </div>

                {showThumbGallery && (
                  <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 280, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
                    onClick={() => setShowThumbGallery(false)}
                  >
                    <div
                      style={{ width: "100%", maxWidth: "860px", maxHeight: "86vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)" }}>Pick a thumbnail</div>
                        <button
                          type="button"
                          onClick={() => setShowThumbGallery(false)}
                          style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                        <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Select a preset preview image (your indicator abbreviation is applied).</div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
                          {prebuiltThumbnails.map((t, idx) => {
                            const isSelected = editImage && t.image && editImage === t.image;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setEditThumbSource("preset");
                                  setEditThumbPresetId(t.id);
                                  setEditImage(t.image);
                                  setShowThumbGallery(false);
                                }}
                                style={{
                                  background: isSelected ? hexToRgba(editAccentColor, 0.14) : "var(--bg-secondary)",
                                  border: `1px solid ${isSelected ? hexToRgba(editAccentColor, 0.55) : "var(--border-color)"}`,
                                  borderRadius: "12px",
                                  padding: "10px",
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                <img
                                  src={t.image}
                                  alt={`Preset ${idx + 1}`}
                                  style={{ width: "100%", height: "92px", objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-color)" }}
                                />
                                <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 800, color: "var(--text-primary)" }}>Preset {idx + 1}</div>
                              </button>
                            );
                          })}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!prebuiltThumbnails.length) return;
                              const random = prebuiltThumbnails[Math.floor(Math.random() * prebuiltThumbnails.length)];
                              setEditThumbSource("preset");
                              setEditThumbPresetId(random.id);
                              setEditImage(random.image);
                              setShowThumbGallery(false);
                            }}
                            style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                          >
                            Auto thumbnail
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Theme color</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const randomAccent = THEME_COLOR_PRESETS[Math.floor(Math.random() * THEME_COLOR_PRESETS.length)];
                        const presets = getPrebuiltIndicatorThumbnails(editAbbr.trim() || selected?.abbreviation || "IND", randomAccent);
                        const randomPreset = presets[Math.floor(Math.random() * presets.length)];
                        setEditAccentColor(randomAccent);
                        setEditThemeMode("auto");
                        setEditThumbSource("preset");
                        setEditThumbPresetId(randomPreset.id);
                        setEditImage(randomPreset.image);
                      }}
                      style={{
                        border: editThemeMode === "auto" ? `1px solid ${hexToRgba(editAccentColor, 0.9)}` : "1px solid var(--border-color)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        borderRadius: "10px",
                        padding: "10px 12px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Auto theme
                    </button>
                    {THEME_COLOR_PRESET_DEFS.map((p) => {
                      const isActive = editThemeMode !== "auto" && editAccentColor === p.hex;
                      return (
                        <button
                          key={p.hex}
                          type="button"
                          onClick={() => {
                            setEditThemeMode("manual");
                            setEditAccentColor(p.hex);
                            if (editThumbSource === "preset") {
                              const t = getPrebuiltIndicatorThumbnails(editAbbr.trim() || selected?.abbreviation || "IND", p.hex).find(
                                (x) => x.id === editThumbPresetId
                              );
                              if (t) setEditImage(t.image);
                            }
                          }}
                          style={{
                            border: isActive ? `1px solid ${hexToRgba(p.hex, 0.95)}` : "1px solid var(--border-color)",
                            background: hexToRgba(p.hex, 0.18),
                            color: "var(--text-primary)",
                            borderRadius: "10px",
                            padding: "10px 12px",
                            cursor: "pointer",
                            fontWeight: 650,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                          aria-label={`Theme color ${p.label}`}
                        >
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 999,
                              background: p.hex,
                              boxShadow: `0 0 0 3px rgba(255,255,255,0.06)`,
                            }}
                          />
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "12px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Name</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Abbrev</label>
                    <input
                      value={editAbbr}
                      onChange={(e) => setEditAbbr(e.target.value)}
                      style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", textTransform: "uppercase" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Category</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as Indicator["category"])}
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none" }}
                  >
                    <option value="Custom">Custom</option>
                    <option value="Momentum">Momentum</option>
                    <option value="Trend">Trend</option>
                    <option value="Volatility">Volatility</option>
                    <option value="Volume">Volume</option>
                    <option value="Structure">Structure</option>
                    <option value="Pattern">Pattern</option>
                  </select>
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px", fontWeight: 650 }}>
                  <input
                    type="checkbox"
                    checked={editCapturesTimeframes}
                    onChange={(e) => setEditCapturesTimeframes(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Captures timeframes
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Other signals</div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      value={editOtherSignalDraft}
                      onChange={(e) => setEditOtherSignalDraft(e.target.value)}
                      placeholder="Add signal label"
                      disabled={selected?.kind !== "custom"}
                      style={{
                        padding: "10px 12px",
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "10px",
                        color: "var(--text-primary)",
                        outline: "none",
                        minWidth: "220px",
                      }}
                    />
                    <button
                      type="button"
                      disabled={selected?.kind !== "custom" || !editOtherSignalDraft.trim()}
                      onClick={() => {
                        const clean = editOtherSignalDraft.trim();
                        if (!clean) return;
                        const lower = clean.toLowerCase();
                        setEditOtherSignals((prev) => {
                          if (prev.some((x) => x.toLowerCase() === lower)) return prev;
                          return [...prev, clean];
                        });
                        setEditOtherSignalDraft("");
                      }}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--border-color)",
                        background: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        fontWeight: 750,
                        fontSize: "12px",
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {editOtherSignals.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>No other signals added yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      {editOtherSignals.map((sig) => (
                        <span
                          key={sig}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 10px",
                            borderRadius: "999px",
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-primary)",
                            fontSize: "12px",
                            fontWeight: 750,
                          }}
                        >
                          {sig}
                          <button
                            type="button"
                            disabled={selected?.kind !== "custom"}
                            onClick={() => setEditOtherSignals((prev) => prev.filter((x) => x !== sig))}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "var(--text-secondary)",
                              cursor: "pointer",
                              display: "inline-flex",
                              padding: 0,
                            }}
                            aria-label={`Remove signal ${sig}`}
                            title="Remove"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Description</label>
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={4} style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Code</label>
                  <textarea
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    rows={10}
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: "12px", lineHeight: 1.6 }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEdit(false);
                      resetEditModal(selected);
                    }}
                    style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 650 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selected || selected.kind !== "custom") return;
                      if (!editName.trim() || !editAbbr.trim()) return;
                      updateIndicator(selected.id, {
                        name: editName,
                        abbreviation: editAbbr,
                        description: editDesc,
                        code: editCode,
                        // empty string means "use auto thumbnail"
                        exampleImage: editImage,
                        accentColor: editAccentColor,
                        category: editCategory,
                        capturesTimeframes: editCapturesTimeframes,
                        otherSignals: editOtherSignals,
                      });
                      setShowEdit(false);
                      const updated = loadIndicators().find((i) => i.id === selected.id) ?? null;
                      setSelected(updated);
                    }}
                    style={{ border: "none", background: "var(--accent)", color: "var(--bg-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 750 }}
                  >
                    Save changes
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: "18px", display: "grid", gridTemplateColumns: "1fr", gap: "14px" }}>
                {selected.exampleImage && (
                  <img
                    src={selected.exampleImage}
                    alt={selected.name}
                    style={{
                      width: "100%",
                      height: "190px",
                      objectFit: "cover",
                      borderRadius: "12px",
                      border: "1px solid var(--border-color)",
                    }}
                  />
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "14px", whiteSpace: "pre-wrap" }}>
                    {selected.description || "—"}
                  </div>

                  {selected.kind === "custom" && (selected.otherSignals ?? []).length > 0 && (
                    <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "hidden", background: "var(--bg-secondary)" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Other signals
                      </div>
                      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {(selected.otherSignals ?? []).map((sig) => (
                          <span
                            key={sig}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: "1px solid var(--border-color)",
                              background: "var(--bg-tertiary)",
                              color: "var(--text-primary)",
                              fontSize: 12,
                              fontWeight: 750,
                            }}
                          >
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {(selected.id === "ema" || selected.id === "ma") && (
                  <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "hidden", background: "var(--bg-secondary)" }}>
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {selected.id === "ema" ? "EMA default lengths" : "MA default lengths"}
                    </div>
                    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {maDefaultLengths.map((chip, idx) => (
                          <div
                            key={`${chip.len}-${idx}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(idx));
                              setDragIndex(idx);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const raw = e.dataTransfer.getData("text/plain");
                              const from = raw ? Number(raw) : dragIndex;
                              if (from === null || !Number.isFinite(from) || from === idx) return;
                              setMaDefaultLengths((prev) => {
                                const next = [...prev];
                                const [moved] = next.splice(from, 1);
                                next.splice(idx, 0, moved);
                                return next;
                              });
                              setDragIndex(null);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: `1px solid var(--border-color)`,
                              background: chip.enabled ? "var(--bg-tertiary)" : "rgba(148,163,184,0.18)",
                              color: chip.enabled ? "var(--text-primary)" : "var(--text-secondary)",
                              fontSize: 12,
                              fontWeight: 800,
                              userSelect: "none",
                              cursor: "grab",
                              opacity: chip.enabled ? 1 : 0.85,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={chip.enabled}
                              onChange={(e) => {
                                const nextEnabled = e.target.checked;
                                setMaDefaultLengths((prev) => prev.map((x, i) => (i === idx ? { ...x, enabled: nextEnabled } : x)));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: 14, height: 14 }}
                              title="Show this value in the Journal"
                            />
                            <span>{chip.len}</span>
                            <button
                              type="button"
                              onClick={() => setMaDefaultLengths((prev) => prev.filter((_, i) => i !== idx))}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                                fontSize: 14,
                                fontWeight: 900,
                                lineHeight: 1,
                              }}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      {!maIsAdding ? (
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => setMaIsAdding(true)}
                            style={{ border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}
                          >
                            Add value
                          </button>
                          <button
                            type="button"
                            onClick={() => setMaDefaultLengths(MA_DEFAULT_LENGTHS_FALLBACK.map((len) => ({ len, enabled: true })))}
                            style={{ border: "none", background: "var(--accent)", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}
                          >
                            Reset
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={maAddDraft}
                            onChange={(e) => setMaAddDraft(e.target.value)}
                            placeholder="e.g. 250"
                            style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", outline: "none", fontSize: 12 }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const normalized = normalizeLengthValue(maAddDraft);
                              if (!normalized) return;
                              setMaDefaultLengths((prev) => (prev.some((x) => x.len === normalized) ? prev : [...prev, { len: normalized, enabled: true }]));
                              setMaAddDraft("");
                              setMaIsAdding(false);
                            }}
                            style={{ border: "none", background: "var(--accent)", color: "white", borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontWeight: 900, fontSize: 12 }}
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMaAddDraft("");
                              setMaIsAdding(false);
                            }}
                            style={{ border: "1px solid var(--border-color)", background: "var(--bg-tertiary)", color: "var(--text-primary)", borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontWeight: 900, fontSize: 12 }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.02em" }}>Signal conditions</div>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-primary)", fontSize: 12, fontWeight: 650 }}>
                          <input
                            type="checkbox"
                            checked={maFlags.bullishCross}
                            onChange={(e) => setMaFlags((f) => ({ ...f, bullishCross: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                          />
                          Bullish crossing
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-primary)", fontSize: 12, fontWeight: 650 }}>
                          <input
                            type="checkbox"
                            checked={maFlags.bearishCross}
                            onChange={(e) => setMaFlags((f) => ({ ...f, bearishCross: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                          />
                          Bearish crossing
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-primary)", fontSize: 12, fontWeight: 650 }}>
                          <input
                            type="checkbox"
                            checked={maFlags.coiling}
                            onChange={(e) => setMaFlags((f) => ({ ...f, coiling: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                          />
                          Coiling
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "12px", overflow: "hidden", background: "var(--bg-secondary)" }}>
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Code
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "14px 16px",
                      overflow: "auto",
                      color: "rgba(229,231,235,0.95)",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      background: "linear-gradient(180deg, rgba(2,6,23,0.95), rgba(2,6,23,0.75))",
                      borderTop: "1px solid rgba(255,255,255,0.10)",
                      borderBottom: "1px solid rgba(255,255,255,0.10)",
                      borderLeft: "1px solid rgba(255,255,255,0.08)",
                      borderRight: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "0px",
                    }}
                  >
                    {selected.code || "// (no code)"}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{ width: "100%", maxWidth: "860px", maxHeight: "86vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)" }}>Add indicator</div>
              <button
                onClick={() => setShowAdd(false)}
                style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
              >
                <X size={16} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim() || !newAbbr.trim()) return;
                addIndicator({
                  name: newName,
                  abbreviation: newAbbr,
                  description: newDesc,
                  code: newCode,
                  exampleImage: newImage || undefined,
                  category: newCategory,
                  capturesTimeframes: newCapturesTimeframes,
                  accentColor: newAccentColor,
                });
                setShowAdd(false);
              }}
              style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. RSI (Relative Strength Index)"
                    required
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Abbrev</label>
                  <input
                    value={newAbbr}
                    onChange={(e) => setNewAbbr(e.target.value)}
                    placeholder="RSI"
                    required
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", textTransform: "uppercase" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={4}
                  placeholder="What it measures, how you use it, key thresholds, etc."
                  style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Code</label>
                <textarea
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  rows={10}
                  placeholder={"// paste code here (pine/python/etc)\n"}
                  style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: "12px", lineHeight: 1.6 }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Theme color</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const randomAccent = THEME_COLOR_PRESETS[Math.floor(Math.random() * THEME_COLOR_PRESETS.length)];
                      const abbr = newAbbr.trim() || "IND";
                      const presets = getPrebuiltIndicatorThumbnails(abbr, randomAccent);
                      const randomPreset = presets[Math.floor(Math.random() * presets.length)];
                      setNewAccentColor(randomAccent);
                      setNewThumbPresetId(randomPreset.id);
                      setNewThumbSource("preset");
                      setNewThemeMode("auto");
                      setNewImage(randomPreset.image);
                    }}
                    style={{
                      border: newThemeMode === "auto" ? `1px solid ${hexToRgba(newAccentColor, 0.9)}` : "1px solid var(--border-color)",
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Auto theme
                  </button>
                  {THEME_COLOR_PRESET_DEFS.map((p) => {
                    const isActive = newThemeMode !== "auto" && newAccentColor === p.hex;
                    return (
                      <button
                        key={p.hex}
                        type="button"
                        onClick={() => {
                          setNewThemeMode("manual");
                          setNewAccentColor(p.hex);
                          // If user is using a preset thumbnail, the effect regen will update newImage.
                        }}
                        style={{
                          border: isActive ? `1px solid ${hexToRgba(p.hex, 0.95)}` : "1px solid var(--border-color)",
                          background: hexToRgba(p.hex, 0.18),
                          color: "var(--text-primary)",
                          borderRadius: "10px",
                          padding: "10px 12px",
                          cursor: "pointer",
                          fontWeight: 650,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                        aria-label={`Theme color ${p.label}`}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            background: p.hex,
                            boxShadow: `0 0 0 3px rgba(255,255,255,0.06)`,
                          }}
                        />
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as Indicator["category"])}
                  style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none" }}
                >
                  <option value="Custom">Custom</option>
                  <option value="Momentum">Momentum</option>
                  <option value="Trend">Trend</option>
                  <option value="Volatility">Volatility</option>
                  <option value="Volume">Volume</option>
                  <option value="Structure">Structure</option>
                  <option value="Pattern">Pattern</option>
                </select>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px", fontWeight: 650 }}>
                <input
                  type="checkbox"
                  checked={newCapturesTimeframes}
                  onChange={(e) => setNewCapturesTimeframes(e.target.checked)}
                  style={{ width: "16px", height: "16px" }}
                />
                Captures timeframes
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Custom image (optional)</label>
                {newImage ? (
                  <img src={newImage} alt="New indicator" style={{ width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", border: "1px solid var(--border-color)" }} />
                ) : (
                  <div style={{ color: "var(--text-secondary)", fontSize: "13px", border: "1px dashed var(--border-color)", borderRadius: "12px", padding: "12px" }}>
                    No image selected; auto thumbnail will be used.
                  </div>
                )}
                <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontWeight: 650, width: "fit-content" }}>
                  <span>Upload image</span>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await fileToDataUrl(file);
                      setNewImage(dataUrl);
                      setNewThumbSource("upload");
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" onClick={() => setShowAdd(false)} style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 650 }}>
                  Cancel
                </button>
                <button type="submit" style={{ border: "none", background: "var(--accent)", color: "var(--bg-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 750 }}>
                  Save indicator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

