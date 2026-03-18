import { useEffect, useMemo, useRef, useState } from "react";
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
type GalleryView = "signals" | "technical" | "candles";

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

function makeGalleryHeroImage(view: GalleryView): string {
  // Simple SVG-only hero thumbnails so each gallery page has its own distinct image.
  const w = 720;
  const h = 220;
  const accent =
    view === "technical" ? "#2563EB" : view === "candles" ? "#7C3AED" : "#F59E0B";
  const accent2 =
    view === "technical" ? "#10B981" : view === "candles" ? "#EF4444" : "#22C55E";

  const background = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${accent2}" stop-opacity="0.35"/>
      </linearGradient>
      <radialGradient id="glow" cx="30%" cy="30%" r="70%">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="url(#bg)"/>
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="url(#glow)"/>
    <g opacity="0.35">
      <path d="M 30 150 L 160 100 L 260 120 L 360 70 L 470 105 L 610 60" stroke="rgba(255,255,255,0.55)" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M 30 180 L 150 140 L 260 160 L 360 120 L 480 155 L 610 110" stroke="rgba(255,255,255,0.25)" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
  `;

  const technicalGlyph = `
    <g>
      <path d="M 70 150 L 160 105 L 260 135 L 360 85 L 470 120 L 640 70"
        stroke="${accent2}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.9"/>
      <g opacity="0.9">
        ${[0.18, 0.36, 0.54, 0.72, 0.88]
          .map((t, idx) => {
            const x = 70 + t * (640 - 70);
            const y = 150 - (idx + 1) * 14;
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${accent}" opacity="0.55"/>`;
          })
          .join("")}
      </g>
      <rect x="530" y="48" width="150" height="34" rx="12" fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.22)"/>
      <text x="545" y="71" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="15" fill="rgba(255,255,255,0.92)" font-weight="700">
        Technical Analysis
      </text>
    </g>
  `;

  const candlesGlyph = `
    <g>
      <rect x="60" y="60" width="600" height="120" rx="16" fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.22)"/>
      <g transform="translate(100, 80)">
        ${[
          { x: 0, w: 40, o: 92, c: 48, up: false },
          { x: 55, w: 34, o: 70, c: 98, up: true },
          { x: 100, w: 44, o: 100, c: 62, up: false },
          { x: 152, w: 36, o: 58, c: 92, up: true },
          { x: 198, w: 42, o: 88, c: 54, up: false },
          { x: 252, w: 34, o: 62, c: 98, up: true },
          { x: 300, w: 46, o: 96, c: 58, up: false },
        ]
          .map((bar) => {
            const bodyColor = bar.up ? accent2 : accent;
            return `
              <path d="M ${bar.x + bar.w / 2} ${bar.o} L ${bar.x + bar.w / 2} ${bar.c}" stroke="rgba(255,255,255,0.30)" stroke-width="3" stroke-linecap="round"/>
              <rect x="${bar.x}" y="${Math.min(bar.o, bar.c)}" width="${bar.w}" height="${Math.abs(bar.c - bar.o)}" rx="8" fill="${bodyColor}" opacity="0.75" stroke="rgba(255,255,255,0.25)"/>
            `;
          })
          .join("")}
      </g>
      <rect x="60" y="24" width="220" height="34" rx="12" fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.22)"/>
      <text x="78" y="47" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="15" fill="rgba(255,255,255,0.92)" font-weight="700">
        Candles
      </text>
    </g>
  `;

  const signalsGlyph = `
    <g>
      <g opacity="0.95">
        ${[
          { x: 70, y: 70, w: 170, label: "Signals" },
          { x: 260, y: 100, w: 140, label: "Ideas" },
          { x: 420, y: 70, w: 150, label: "Code" },
        ]
          .map((b, idx) => {
            const stroke = idx === 0 ? accent2 : accent;
            return `
              <rect x="${b.x}" y="${b.y}" width="${b.w}" height="62" rx="14"
                fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.20)" />
              <rect x="${b.x + 10}" y="${b.y + 10}" width="14" height="14" rx="4"
                fill="${stroke}" opacity="0.9"/>
              <text x="${b.x + 32}" y="${b.y + 41}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial"
                font-size="16" fill="rgba(255,255,255,0.92)" font-weight="800">
                ${b.label}
              </text>
            `;
          })
          .join("")}
      </g>
    </g>
  `;

  const glyph = view === "technical" ? technicalGlyph : view === "candles" ? candlesGlyph : signalsGlyph;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${background}${glyph}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function IndicatorsPage({ view = "signals" }: { view?: SignalsView }) {
  const FAVORITES_KEY = "tradebutler_favorite_indicators_v1";

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // "all" | "custom" | "Momentum" | ...
  const [favoriteOnly, setFavoriteOnly] = useState(false);
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

  const indicators = useMemo(() => loadIndicators(), [showAdd, selected]);

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

  const prebuiltThumbnails = useMemo(() => {
    if (!showEdit) return [];
    return getPrebuiltIndicatorThumbnails(editAbbr.trim() || selected?.abbreviation || "IND", editAccentColor);
  }, [showEdit, editAbbr, selected?.abbreviation, editAccentColor]);

  const heroSignalsImage = useMemo(() => makeGalleryHeroImage("signals"), []);
  const heroTechnicalImage = useMemo(() => makeGalleryHeroImage("technical"), []);
  const heroCandlesImage = useMemo(() => makeGalleryHeroImage("candles"), []);

  const signalsSectionRef = useRef<HTMLDivElement | null>(null);
  const technicalSectionRef = useRef<HTMLDivElement | null>(null);
  const candlesSectionRef = useRef<HTMLDivElement | null>(null);

  const filteredSignals = useMemo(() => {
    if (view !== "all") return filtered;
    // Keep candlestick patterns out of the main indicators library.
    return filtered.filter((i) => i.signalGroup !== "Candlestick");
  }, [filtered, view]);

  function scrollToRef(ref: { current: HTMLDivElement | null }) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
              : "Build a personal library of trading signals. Click a card to view full description and code."}
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
            onClick={() => scrollToRef(signalsSectionRef)}
            style={{
              flex: "1 1 340px",
              border: "1px solid var(--border-color)",
              borderRadius: "14px",
              background: "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <img
              src={heroSignalsImage}
              alt="Signals gallery thumbnail"
              style={{ width: 160, height: 68, objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-color)" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>Signals library</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Filter by strategy, search, and favorites.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => scrollToRef(technicalSectionRef)}
            style={{
              flex: "1 1 340px",
              border: "1px solid var(--border-color)",
              borderRadius: "14px",
              background: "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <img
              src={heroTechnicalImage}
              alt="Technical analysis gallery thumbnail"
              style={{ width: 160, height: 68, objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-color)" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>Technical Analysis patterns</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>Only indicators tagged as Technical Pattern.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => scrollToRef(candlesSectionRef)}
            style={{
              flex: "1 1 340px",
              border: "1px solid var(--border-color)",
              borderRadius: "14px",
              background: "var(--bg-secondary)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <img
              src={heroCandlesImage}
              alt="Candlestick gallery thumbnail"
              style={{ width: 160, height: 68, objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-color)" }}
            />
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
          <img
            src={view === "technical" ? heroTechnicalImage : view === "candles" ? heroCandlesImage : heroSignalsImage}
            alt={view === "technical" ? "Technical analysis gallery thumbnail" : view === "candles" ? "Candles gallery thumbnail" : "Signals gallery thumbnail"}
            style={{ width: 160, height: 68, objectFit: "cover", borderRadius: "10px", border: "1px solid var(--border-color)" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: "14px", fontWeight: 850, color: "var(--text-primary)" }}>
              {view === "technical" ? "Technical Analysis patterns" : view === "candles" ? "Candlestick patterns" : "Signals library"}
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
            ? `Signals ${filteredSignals.length}, Technical ${technicalPatterns.length}, Candles ${candlestickPatterns.length}`
            : view === "technical"
            ? `${technicalPatterns.length} shown`
            : view === "candles"
            ? `${candlestickPatterns.length} shown`
            : `${filtered.length} shown`}
        </div>
      </div>

      {view === "all" ? (
        <>
          <div ref={signalsSectionRef}>{renderIndicatorGrid(filteredSignals, "No indicators yet. Click “Add indicator”.")}</div>

          <div ref={technicalSectionRef} style={{ marginTop: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Technical Analysis Patterns
              </div>
            </div>
            {renderIndicatorGrid(technicalPatterns, "No technical analysis pattern indicators found.")}
          </div>

          <div ref={candlesSectionRef} style={{ marginTop: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Candlestick Patterns
              </div>
            </div>
            {renderIndicatorGrid(candlestickPatterns, "No candlestick pattern indicators found.")}
          </div>
        </>
      ) : view === "signals" ? (
        renderIndicatorGrid(filtered, "No indicators yet. Click “Add indicator”.")
      ) : view === "technical" ? (
        renderIndicatorGrid(technicalPatterns, "No technical analysis pattern indicators found.")
      ) : (
        renderIndicatorGrid(candlestickPatterns, "No candlestick pattern indicators found.")
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
                <div style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "14px", whiteSpace: "pre-wrap" }}>
                  {selected.description || "—"}
                </div>
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

