import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Code2, Copy, Plus, Scale, Search, Star, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  addIndicator,
  deleteIndicator,
  getPrebuiltIndicatorThumbnails,
  loadIndicators,
  loadStrategyIndicatorIds,
  saveStrategyIndicatorIds,
  updateIndicator,
  type Indicator,
} from "../utils/indicatorsStore";
import { CustomOtherSignalsSettingsPanel } from "../components/CustomOtherSignalsSettingsPanel";
import { EmaMaJournalSettingsEditor } from "../components/EmaMaJournalSettingsEditor";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import { getSandboxStrategies } from "../utils/sandboxStore";

interface StrategyRef {
  id: number;
  name: string;
}

type SignalsView = "all" | "signals" | "technical" | "candles";

/** Groups technical analysis pattern cards for the Pattern category filter (Harmonics, etc.). */
const TECHNICAL_PATTERN_FAMILY_ALL = "all" as const;
const TECHNICAL_PATTERN_FAMILY_OPTIONS = ["Harmonics", "Chart patterns", "Price action"] as const;
type TechnicalPatternFamilyFilter = typeof TECHNICAL_PATTERN_FAMILY_ALL | (typeof TECHNICAL_PATTERN_FAMILY_OPTIONS)[number];

function getTechnicalPatternFamily(i: Indicator): (typeof TECHNICAL_PATTERN_FAMILY_OPTIONS)[number] {
  const explicit = i.patternFamily?.trim();
  if (explicit && (TECHNICAL_PATTERN_FAMILY_OPTIONS as readonly string[]).includes(explicit)) {
    return explicit as (typeof TECHNICAL_PATTERN_FAMILY_OPTIONS)[number];
  }
  if (i.id.startsWith("harmonic_")) return "Harmonics";
  if (i.id === "fvg" || i.id === "divergence" || i.id === "sfp_timeframe") return "Price action";
  return "Chart patterns";
}

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

/** Default abbreviation from a signal title; user can override in the form. */
function abbreviateFromTitle(title: string): string {
  const cleaned = title
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\w\s]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) {
    const w = words[0];
    return w.length <= 8 ? w.toUpperCase() : w.slice(0, 8).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 8);
}


export default function IndicatorsPage({ view = "signals" }: { view?: SignalsView }) {
  const FAVORITES_KEY = "tradebutler_favorite_indicators_v1";
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // "all" | "custom" | "Momentum" | ...
  const [technicalPatternFamilyFilter, setTechnicalPatternFamilyFilter] = useState<TechnicalPatternFamilyFilter>(TECHNICAL_PATTERN_FAMILY_ALL);
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
  /** Strategy to attach the open signal to (Strategies page indicator list). */
  const [linkStrategyId, setLinkStrategyId] = useState<number | "">("");
  const [linkStrategyMessage, setLinkStrategyMessage] = useState<string | null>(null);
  /** Bumps when the saved indicator list changes so `loadIndicators()` is re-run. */
  const [indicatorsTick, setIndicatorsTick] = useState(0);
  /** Themed delete confirmation (replaces OS `confirm`); z-index above detail modal. */
  const [indicatorPendingDelete, setIndicatorPendingDelete] = useState<Indicator | null>(null);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;
    const ind = loadIndicators().find((i) => i.id === focus);
    if (ind) setSelected(ind);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("focus");
        return n;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setLinkStrategyId("");
    setLinkStrategyMessage(null);
  }, [selected?.id]);

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const [newName, setNewName] = useState("");
  const [newAbbr, setNewAbbr] = useState("");
  /** When false, abbreviation stays in sync with the title; set true if the user edits Abbrev. */
  const [newAbbrUserEdited, setNewAbbrUserEdited] = useState(false);
  const [favoriteNewOnCreate, setFavoriteNewOnCreate] = useState(false);
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
  /** When false, abbreviation follows the title like create flow; true if stored abbr was custom or user edited Abbrev. */
  const [editAbbrUserEdited, setEditAbbrUserEdited] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editImage, setEditImage] = useState<string>("");
  const [editCategory, setEditCategory] = useState<Indicator["category"]>("Custom");
  const [editCapturesTimeframes, setEditCapturesTimeframes] = useState<boolean>(false);
  const [editOtherSignals, setEditOtherSignals] = useState<string[]>([]);
  const [editAccentColor, setEditAccentColor] = useState<string>("#F59E0B");
  const [editThemeMode, setEditThemeMode] = useState<"auto" | "manual">("manual");
  const [editThumbSource, setEditThumbSource] = useState<"upload" | "preset">("preset");
  const [editThumbPresetId, setEditThumbPresetId] = useState<string>("rsi");
  /** Preset thumbnail picker: which flow opened it (add vs edit detail). */
  const [thumbGalleryFor, setThumbGalleryFor] = useState<null | "add" | "edit">(null);

  const [codeCopyFeedback, setCodeCopyFeedback] = useState<null | "preview" | "edit">(null);
  const codeCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCodeCopyTimer = () => {
    if (codeCopyTimerRef.current != null) {
      clearTimeout(codeCopyTimerRef.current);
      codeCopyTimerRef.current = null;
    }
  };

  const copyIndicatorCode = async (text: string, which: "preview" | "edit") => {
    clearCodeCopyTimer();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCodeCopyFeedback(which);
    codeCopyTimerRef.current = setTimeout(() => {
      setCodeCopyFeedback(null);
      codeCopyTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    setCodeCopyFeedback(null);
    clearCodeCopyTimer();
  }, [selected?.id, showEdit]);

  useEffect(
    () => () => {
      clearCodeCopyTimer();
    },
    []
  );

  useEffect(() => {
    if (!showAdd) setThumbGalleryFor((prev) => (prev === "add" ? null : prev));
  }, [showAdd]);

  useEffect(() => {
    if (!showAdd) return;
    if (newAbbrUserEdited) return;
    setNewAbbr(abbreviateFromTitle(newName));
  }, [newName, showAdd, newAbbrUserEdited]);

  useEffect(() => {
    if (!showEdit || !selected) return;
    if (editAbbrUserEdited) return;
    setEditAbbr(abbreviateFromTitle(editName));
  }, [editName, showEdit, selected?.id, editAbbrUserEdited]);

  const indicators = useMemo(() => loadIndicators(), [showAdd, selected, indicatorsTick]);

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

    if (technicalPatternFamilyFilter !== TECHNICAL_PATTERN_FAMILY_ALL) {
      base = base.filter((i) => getTechnicalPatternFamily(i) === technicalPatternFamilyFilter);
    }

    return [...base].sort((a, b) => {
      const ak = a.kind === "custom" ? 0 : 1;
      const bk = b.kind === "custom" ? 0 : 1;
      if (ak !== bk) return ak - bk;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [indicators, query, strategyIndicatorIdSet, favoriteOnly, favoriteIds, technicalPatternFamilyFilter]);

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

  const addPrebuiltThumbnails = useMemo(() => {
    if (!showAdd) return [];
    return getPrebuiltIndicatorThumbnails(newAbbr.trim() || "IND", newAccentColor);
  }, [showAdd, newAbbr, newAccentColor]);

  const filteredSignals = useMemo(() => {
    if (view !== "all") return filtered;
    // Signals page: pattern cards live under Technical / Candlestick only — not under Indicators.
    return filtered
      .filter(
        (i) =>
          !(
            i.category === "Pattern" &&
            (i.signalGroup === "TechnicalPattern" || i.signalGroup === "Candlestick")
          )
      )
      .filter(passesBiasFilter);
  }, [filtered, view, showBullish, showBearish]);

  function resetAddModal() {
    setNewName("");
    setNewAbbr("");
    setNewAbbrUserEdited(false);
    setFavoriteNewOnCreate(false);
    setNewDesc("");
    setNewCode("");
    setNewImage("");
    setNewCategory("Custom");
    setNewCapturesTimeframes(false);
    setNewThemeMode("auto");
    setNewThumbSource("preset");
    setThumbGalleryFor(null);
    const randomAccent = THEME_COLOR_PRESETS[Math.floor(Math.random() * THEME_COLOR_PRESETS.length)];
    const presets = getPrebuiltIndicatorThumbnails("IND", randomAccent);
    const randomPreset = presets[Math.floor(Math.random() * presets.length)];
    setNewAccentColor(randomAccent);
    setNewThumbPresetId(randomPreset.id);
  }

  function resetEditModal(ind: Indicator | null) {
    setShowEdit(false);
    setThumbGalleryFor(null);
    if (!ind) return;
    setEditName(ind.name ?? "");
    const storedAbbr = (ind.abbreviation ?? "").trim().toUpperCase();
    const autoAbbr = abbreviateFromTitle(ind.name ?? "");
    setEditAbbrUserEdited(storedAbbr !== autoAbbr);
    setEditAbbr(ind.abbreviation ?? "");
    setEditDesc(ind.description ?? "");
    setEditCode(ind.code ?? "");
    setEditImage(ind.exampleImage ?? "");
    setEditCategory(ind.category ?? "Custom");
    setEditCapturesTimeframes(ind.capturesTimeframes === true || ind.id.includes("_timeframe"));
    setEditOtherSignals(Array.isArray(ind.otherSignals) ? ind.otherSignals : []);
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

  function addSelectedSignalToStrategy() {
    if (!selected || linkStrategyId === "") return;
    const sid = linkStrategyId;
    const current = loadStrategyIndicatorIds(dataMode, sid);
    if (current.includes(selected.id)) {
      setLinkStrategyMessage("This signal is already on that strategy.");
      return;
    }
    saveStrategyIndicatorIds(dataMode, sid, [...current, selected.id]);
    const label = strategies.find((s) => s.id === sid)?.name ?? "strategy";
    setLinkStrategyMessage(`Added to “${label}”. Open Strategies → Signals to reorder or remove.`);
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
          type="button"
          title={i.name}
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
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
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
          <button
            type="button"
            onClick={() => setCategoryFilter((prev) => (prev === "custom" ? "all" : "custom"))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 14px",
              borderRadius: "10px",
              fontWeight: 650,
              cursor: "pointer",
              border: `1px solid ${categoryFilter === "custom" ? "var(--accent)" : "var(--border-color)"}`,
              background: categoryFilter === "custom" ? "rgba(139, 92, 246, 0.18)" : "var(--bg-secondary)",
              color: categoryFilter === "custom" ? "var(--accent)" : "var(--text-primary)",
              whiteSpace: "nowrap",
            }}
            aria-pressed={categoryFilter === "custom"}
            aria-label={categoryFilter === "custom" ? "Showing custom signals only. Click to show all categories." : "Show custom signals only"}
          >
            Custom signals
            {categoryFilter === "custom" ? (
              <span style={{ fontSize: "11px", fontWeight: 800, opacity: 0.9 }}>ON</span>
            ) : null}
          </button>
        )}
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
            aria-label="Filter indicators by category"
          >
            <option value="all">All categories</option>
            <option value="custom">Custom signals</option>
            <option value="Momentum">Momentum</option>
            <option value="Trend">Trend</option>
            <option value="Volatility">Volatility</option>
            <option value="Volume">Volume</option>
            <option value="Structure">Structure</option>
            <option value="Pattern">Pattern</option>
          </select>
        )}
        {(view === "all" || view === "technical") && (
          <select
            value={technicalPatternFamilyFilter}
            onChange={(e) => setTechnicalPatternFamilyFilter(e.target.value as TechnicalPatternFamilyFilter)}
            style={{
              padding: "10px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              outline: "none",
              maxWidth: "220px",
            }}
            aria-label="Filter technical analysis patterns by category"
          >
            <option value={TECHNICAL_PATTERN_FAMILY_ALL}>All pattern categories</option>
            {TECHNICAL_PATTERN_FAMILY_OPTIONS.map((fam) => (
              <option key={fam} value={fam}>
                {fam}
              </option>
            ))}
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
            setIndicatorPendingDelete(null);
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
                <div
                  title={selected.name}
                  style={{
                    fontSize: "18px",
                    fontWeight: 750,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
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
                  <>
                    <button
                      type="button"
                      title="Delete custom indicator"
                      onClick={() => setIndicatorPendingDelete(selected)}
                      style={{
                        border: "1px solid rgba(239, 68, 68, 0.45)",
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#F87171",
                        borderRadius: "10px",
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 750,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Trash2 size={16} aria-hidden />
                      Delete
                    </button>
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
                  </>
                )}
                <button
                  onClick={() => {
                    setIndicatorPendingDelete(null);
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
                      onClick={() => setThumbGalleryFor("edit")}
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
                      onChange={(e) => {
                        setEditAbbr(e.target.value);
                        setEditAbbrUserEdited(true);
                      }}
                      placeholder="Auto from title"
                      style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", textTransform: "uppercase" }}
                    />
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.35 }}>
                      {editAbbrUserEdited ? "Custom abbreviation; change the title without updating this field." : "Updates when you change the name; edit here to set a custom abbreviation."}
                    </div>
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

                {selected.kind === "custom" && (
                  <CustomOtherSignalsSettingsPanel
                    indicatorId={selected.id}
                    otherSignals={editOtherSignals}
                    hideInlineAddField
                    onAddSignalToIndicator={(raw) => {
                      const clean = raw.trim();
                      if (!clean) return;
                      const lower = clean.toLowerCase();
                      setEditOtherSignals((prev) => {
                        if (prev.some((x) => x.toLowerCase() === lower)) return prev;
                        return [...prev, clean];
                      });
                    }}
                    onRemoveSignalFromIndicator={(label) => {
                      setEditOtherSignals((prev) => prev.filter((x) => x !== label));
                    }}
                  />
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Description</label>
                  <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={4} style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                    <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Code</label>
                    <button
                      type="button"
                      onClick={() => void copyIndicatorCode(editCode, "edit")}
                      title="Copy code"
                      style={{
                        border: "1px solid var(--border-color)",
                        background: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                        borderRadius: "8px",
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontWeight: 750,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      {codeCopyFeedback === "edit" ? (
                        "Copied"
                      ) : (
                        <>
                          <Copy size={14} aria-hidden />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
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

                  <div
                    style={{
                      border: "1px solid color-mix(in srgb, var(--warning) 38%, var(--border-color))",
                      borderRadius: 12,
                      padding: 12,
                      background: "color-mix(in srgb, var(--warning) 8%, var(--bg-secondary))",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <Scale size={16} style={{ color: "var(--warning)", flexShrink: 0 }} aria-hidden />
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--warning)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Link to strategy</div>
                    </div>
                    <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.45 }}>
                      Add this signal to a strategy&apos;s list (same as <strong>Select signals for this strategy</strong> on the{" "}
                      <Link to="/strategies" style={{ color: "var(--accent)", fontWeight: 700 }}>
                        Strategies
                      </Link>{" "}
                      page).
                    </p>
                    {strategies.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
                        No strategies yet. Create one on the{" "}
                        <Link to="/strategies" style={{ color: "var(--accent)", fontWeight: 700 }}>
                          Strategies
                        </Link>{" "}
                        page.
                      </p>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <select
                            value={linkStrategyId === "" ? "" : String(linkStrategyId)}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLinkStrategyId(v === "" ? "" : Number(v));
                              setLinkStrategyMessage(null);
                            }}
                            style={{
                              flex: "1 1 220px",
                              minWidth: 180,
                              padding: "10px 12px",
                              background: "var(--bg-primary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: 10,
                              color: "var(--text-primary)",
                              fontSize: 13,
                              outline: "none",
                            }}
                          >
                            <option value="">Choose a strategy…</option>
                            {strategies.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={linkStrategyId === ""}
                            onClick={addSelectedSignalToStrategy}
                            style={{
                              padding: "10px 14px",
                              borderRadius: 10,
                              border: "none",
                              background: linkStrategyId === "" ? "var(--bg-tertiary)" : "var(--accent)",
                              color: linkStrategyId === "" ? "var(--text-secondary)" : "white",
                              cursor: linkStrategyId === "" ? "not-allowed" : "pointer",
                              fontSize: 13,
                              fontWeight: 750,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Add to strategy
                          </button>
                        </div>
                        {linkStrategyMessage ? (
                          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>{linkStrategyMessage}</p>
                        ) : null}
                      </>
                    )}
                  </div>

                  {selected.kind === "custom" && (
                    <div style={{ border: "1px solid var(--border-color)", borderRadius: 12, overflow: "hidden", background: "var(--bg-secondary)" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Other signals
                      </div>
                      {(selected.otherSignals ?? []).length > 0 ? (
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
                      ) : null}
                      <div style={{ padding: "10px 12px 14px", color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>
                        Open Edit to add signals and set journal layout (values, checkboxes, colors).
                      </div>
                    </div>
                  )}
                </div>

                {(selected.id === "ema" || selected.id === "ma") && <EmaMaJournalSettingsEditor indicatorId={selected.id} />}
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "12px", overflow: "hidden", background: "var(--bg-secondary)" }}>
                  <div
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border-color)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div style={{ color: "var(--text-secondary)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Code</div>
                    <button
                      type="button"
                      onClick={() => void copyIndicatorCode(selected.code ?? "", "preview")}
                      title="Copy code"
                      style={{
                        border: "1px solid var(--border-color)",
                        background: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                        borderRadius: "8px",
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontSize: "11px",
                        fontWeight: 750,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        textTransform: "none",
                        letterSpacing: "normal",
                      }}
                    >
                      {codeCopyFeedback === "preview" ? (
                        "Copied"
                      ) : (
                        <>
                          <Copy size={14} aria-hidden />
                          Copy
                        </>
                      )}
                    </button>
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

      {/* Delete custom indicator — themed modal (matches Journal / Strategies) */}
      {indicatorPendingDelete && (
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
            zIndex: 300,
          }}
          onClick={() => setIndicatorPendingDelete(null)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "450px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="indicator-delete-title"
          >
            <h3
              id="indicator-delete-title"
              style={{
                fontSize: "18px",
                fontWeight: 600,
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              Delete custom signal
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to delete{" "}
              <strong>&quot;{(indicatorPendingDelete.name ?? "").trim() || "this indicator"}&quot;</strong>?
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: 1.5,
              }}
            >
              This removes it from your library, favorites, and saved journal data for this signal. This cannot be undone.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIndicatorPendingDelete(null);
                }}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const id = indicatorPendingDelete.id;
                  if (deleteIndicator(id)) {
                    setFavoriteIds((prev) => {
                      const next = new Set(prev);
                      next.delete(id);
                      return next;
                    });
                    setIndicatorPendingDelete(null);
                    setShowEdit(false);
                    setSelected(null);
                    setIndicatorsTick((t) => t + 1);
                  }
                }}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Delete
              </button>
            </div>
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
            style={{
              width: "100%",
              maxWidth: "860px",
              maxHeight: "86vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "14px",
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "14px 18px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                background: "var(--bg-primary)",
                zIndex: 2,
              }}
            >
              <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)", minWidth: 0 }}>Add indicator</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 650 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="add-indicator-form"
                  style={{ border: "none", background: "var(--accent)", color: "var(--bg-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 750 }}
                >
                  Save indicator
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <form
              id="add-indicator-form"
              onSubmit={(e) => {
                e.preventDefault();
                const abbr = newAbbr.trim() || abbreviateFromTitle(newName).trim();
                if (!newName.trim() || !abbr) return;
                const created = addIndicator({
                  name: newName,
                  abbreviation: abbr,
                  description: newDesc,
                  code: newCode,
                  exampleImage: newImage || undefined,
                  category: newCategory,
                  capturesTimeframes: newCapturesTimeframes,
                  accentColor: newAccentColor,
                });
                if (favoriteNewOnCreate) {
                  setFavoriteIds((prev) => {
                    const next = new Set(prev);
                    next.add(created.id);
                    return next;
                  });
                }
                setShowAdd(false);
                setIndicatorsTick((t) => t + 1);
              }}
              style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}
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
                    onChange={(e) => {
                      setNewAbbr(e.target.value);
                      setNewAbbrUserEdited(true);
                    }}
                    placeholder="Auto from title"
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", textTransform: "uppercase" }}
                  />
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.35 }}>
                    Filled from the title by default; edit to override.
                  </div>
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
              <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer", color: "var(--text-secondary)", fontSize: "13px", fontWeight: 650 }}>
                <input
                  type="checkbox"
                  checked={favoriteNewOnCreate}
                  onChange={(e) => setFavoriteNewOnCreate(e.target.checked)}
                  style={{ width: "16px", height: "16px" }}
                />
                Add to favorites
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
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
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
                  <button
                    type="button"
                    onClick={() => setThumbGalleryFor("add")}
                    style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                  >
                    Choose preset thumbnails
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!addPrebuiltThumbnails.length) return;
                      const random = addPrebuiltThumbnails[Math.floor(Math.random() * addPrebuiltThumbnails.length)];
                      setNewThumbSource("preset");
                      setNewThumbPresetId(random.id);
                      setNewImage(random.image);
                      setNewThemeMode("manual");
                    }}
                    style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                  >
                    Use auto thumbnail
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {thumbGalleryFor !== null &&
        (() => {
          const mode = thumbGalleryFor;
          const galleryThumbs = mode === "add" ? addPrebuiltThumbnails : prebuiltThumbnails;
          const galleryAccent = mode === "add" ? newAccentColor : editAccentColor;
          const galleryCurImage = mode === "add" ? newImage : editImage;
          const pickPreset = (t: { id: string; image: string }) => {
            if (mode === "add") {
              setNewThumbSource("preset");
              setNewThumbPresetId(t.id);
              setNewImage(t.image);
              setNewThemeMode("manual");
            } else {
              setEditThumbSource("preset");
              setEditThumbPresetId(t.id);
              setEditImage(t.image);
            }
            setThumbGalleryFor(null);
          };
          const pickRandom = () => {
            if (!galleryThumbs.length) return;
            const random = galleryThumbs[Math.floor(Math.random() * galleryThumbs.length)];
            pickPreset(random);
          };
          return (
            <div
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 280, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
              onClick={() => setThumbGalleryFor(null)}
            >
              <div
                style={{ width: "100%", maxWidth: "860px", maxHeight: "86vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)" }}>Pick a thumbnail</div>
                  <button
                    type="button"
                    onClick={() => setThumbGalleryFor(null)}
                    style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Select a preset preview image (your indicator abbreviation is applied).</div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
                    {galleryThumbs.map((t, idx) => {
                      const isSelected = galleryCurImage && t.image && galleryCurImage === t.image;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => pickPreset(t)}
                          style={{
                            background: isSelected ? hexToRgba(galleryAccent, 0.14) : "var(--bg-secondary)",
                            border: `1px solid ${isSelected ? hexToRgba(galleryAccent, 0.55) : "var(--border-color)"}`,
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
                      onClick={pickRandom}
                      style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontWeight: 650 }}
                    >
                      Auto thumbnail
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

