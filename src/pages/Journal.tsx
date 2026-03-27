import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { Plus, Edit2, Trash2, FileText, X, RotateCcw, Maximize2, Minimize2, Link2, ChevronDown, ChevronUp, Search, LayoutDashboard, GripVertical, Eye, EyeOff, Settings } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush } from "recharts";
import { format, parse } from "date-fns";
import { TimeframeSelector, Timeframe, getTimeframeDates } from "../components/TimeframeSelector";
import { BRUSH_MIN_POINTS } from "../utils/chartDataSampling";
import { getSurveyScoreColor, getSurveyScoreBgRgba } from "../utils/intensityColor";
import RichTextEditor from "../components/RichTextEditor";
import { TradeChart } from "../components/TradeChart";
import {
  saveAllScrollPositions,
  restoreAllScrollPositions,
  restoreTabScrollPositions,
} from "../utils/scrollManager";
import { LoadingSphere } from "../components/LoadingSphere";
import { DataMode, getCurrentDataMode, subscribeToDataMode } from "../utils/dataMode";
import {
  getSandboxJournalEntries,
  getSandboxJournalEntry,
  getSandboxAllJournalTrades,
  getSandboxJournalTrades,
  getSandboxJournalEntryPairsAsPairedTrades,
  getSandboxStrategies,
  createSandboxJournalEntry,
  updateSandboxJournalEntry,
  deleteSandboxJournalEntry,
  createSandboxJournalTrade,
  updateSandboxJournalTrade,
  deleteSandboxJournalTrade,
  setSandboxJournalEntryPairs,
  getSandboxEmotionalStates,
  getSandboxEmotionalStatesForJournal,
  getSandboxEmotionSurveys,
  addSandboxJournalEntryToEmotionalStates,
  removeSandboxJournalEntryFromEmotionalStates,
  linkSandboxEmotionalStatesToJournal,
  deleteSandboxEmotionalState,
  loadSandboxState,
} from "../utils/sandboxStore";

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(245,158,11,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
import { buildPositionGroupsAndPairs } from "../utils/sandboxPairing";
import { sanitizeHtml, normalizeRichTextHtml } from "../utils/sanitizeHtml";
import {
  loadIndicators,
  loadStrategyIndicatorIds,
  loadStrategyRuleTexts,
  loadStrategyCustomRuleSets,
  loadJournalIndicatorValue,
  setJournalIndicatorValue,
  migrateJournalIndicatorDraftValues,
  loadJournalIndicatorDivergence,
  setJournalIndicatorDivergence,
  migrateJournalIndicatorDraftDivergence,
  loadJournalIndicatorOtherSignals,
  setJournalIndicatorOtherSignal,
  migrateJournalIndicatorDraftOtherSignals,
  loadJournalTradePatternIndicatorIds,
  setJournalTradePatternIndicatorIds,
  migrateJournalIndicatorDraftTradePatterns,
  type Indicator,
  type IndicatorPhase,
  type StrategyCustomRuleSet,
} from "../utils/indicatorsStore";

interface JournalEntry {
  id: number;
  date: string;
  title: string;
  strategy_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  linked_trade_ids?: string | null;
}

interface JournalTrade {
  id: number;
  journal_entry_id: number;
  symbol: string | null;
  position: string | null;
  timeframe: string | null;
  entry_type: string | null;
  exit_type: string | null;
  trade: string | null;
  what_went_well: string | null;
  what_could_be_improved: string | null;
  emotional_state: string | null;
  notes: string | null;
  outcome: string | null;
  r_multiple: number | null;
  trade_order: number;
  created_at: string | null;
  updated_at: string | null;
}

/** Actual trade from the Trades table (executed/real trades), not journal trades */
interface ActualTrade {
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

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string | null;
  color: string | null;
}

interface ChecklistItem {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
  parent_id: number | null;
}

interface JournalChecklistResponse {
  id: number | null;
  journal_entry_id: number;
  checklist_item_id: number;
  is_checked: boolean;
  journal_trade_ids?: string | null; // JSON array of trade IDs when associated with specific trades, null = whole entry
  response_value?: number | null; // For survey items: 1-10 scale
}

// All checklist and survey items are scoped per journal trade.
// Emotional states are the only thing that can be shared at the entry level.
const ENTRY_LEVEL_CHECKLIST_TYPES: string[] = [];

/** Hidden placeholder used in the DB for empty custom checklist types; never show to users. */
const EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER = "__empty_custom_checklist_placeholder__";

  /** Emotional state from Emotions (linked to journal entry/implementation) */
interface JournalEmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
  journal_entry_id?: number | null;
  journal_trade_id?: number | null;
  journal_entry_ids?: string | null;
  trade_ids?: string | null;
}

const JOURNAL_EMOTIONS = [
  "Confident", "Anxious", "Frustrated", "Excited", "Calm", "Greedy", "Fearful",
  "Optimistic", "Pessimistic", "Neutral",
];

const DEFAULT_EMOTION_INTENSITY = 0;

const INTENSITY_SCALE_LABEL = "0 = not present → 10 = extremely strong. Rate how strongly you feel each emotion; values are used for trends and insights over time.";

const INTENSITY_LABELS: Record<number, string> = {
  0: "None", 1: "Barely", 2: "Slight", 3: "Mild", 4: "Moderate", 5: "Noticeable",
  6: "Strong", 7: "Very strong", 8: "Intense", 9: "Severe", 10: "Extreme",
};

/** Same question groups as Emotions page — unified emotional state entry format (1–10 scale). */
const JOURNAL_SURVEY_QUESTIONS = {
  before: [
    { key: "before_calm_clear", question: "How calm and mentally clear did you feel before considering this trade?", scale: "1 = Very anxious/confused, 10 = Very calm/clear", highIsGood: true },
    { key: "before_urgency_pressure", question: "Did you feel any urgency or pressure to \"make something happen\" in the market?", scale: "1 = No urgency, 10 = Extreme pressure", highIsGood: false },
    { key: "before_confidence_vs_validation", question: "Were you feeling confident in yourself, or seeking validation from a win?", scale: "1 = Confident in self, 10 = Seeking validation", highIsGood: false },
    { key: "before_fomo", question: "Did fear of missing out (FOMO) influence your desire to enter?", scale: "1 = No FOMO, 10 = Strong FOMO", highIsGood: false },
    { key: "before_recovering_loss", question: "Were you trying to recover from a previous loss emotionally?", scale: "1 = Not at all, 10 = Strongly trying to recover", highIsGood: false },
    { key: "before_patient_detached", question: "Did you feel patient and detached, or restless and impulsive?", scale: "1 = Patient/detached, 10 = Restless/impulsive", highIsGood: false },
    { key: "before_trust_process", question: "How strong was your trust in your process at that moment?", scale: "1 = No trust, 10 = Complete trust", highIsGood: true },
    { key: "before_emotional_state", question: "Were you feeling bored, excited, anxious, or neutral before entry?", scale: "1 = Neutral/calm, 10 = Extremely emotional (any)", highIsGood: false },
  ],
  during: [
    { key: "during_stable", question: "How stable were your emotions once the trade was live?", scale: "1 = Very stable, 10 = Very unstable", highIsGood: false },
    { key: "during_tension_stress", question: "Did you feel tension, nervousness, or physical stress while price moved?", scale: "1 = No tension, 10 = Extreme tension/stress", highIsGood: false },
    { key: "during_tempted_interfere", question: "Were you tempted to interfere with the trade out of fear or hope?", scale: "1 = No temptation, 10 = Strong temptation", highIsGood: false },
    { key: "during_need_control", question: "Did you feel a need to \"control\" the outcome instead of letting it play out?", scale: "1 = Let it play, 10 = Strong need to control", highIsGood: false },
    { key: "during_fear_loss", question: "How strong was your fear of loss while in the position?", scale: "1 = No fear, 10 = Extreme fear", highIsGood: false },
    { key: "during_excitement_greed", question: "How strong was your excitement or greed as price moved in your favor?", scale: "1 = Calm, 10 = Extreme excitement/greed", highIsGood: false },
    { key: "during_mentally_present", question: "Did you feel mentally present, or distracted and reactive?", scale: "1 = Very present, 10 = Very distracted/reactive", highIsGood: false },
  ],
  after: [
    { key: "after_accept_outcome", question: "How well did you accept the outcome emotionally, regardless of win or loss?", scale: "1 = Full acceptance, 10 = Poor acceptance", highIsGood: false },
    { key: "after_emotional_reaction", question: "Did you feel relief, frustration, disappointment, or satisfaction?", scale: "1 = Neutral/balanced, 10 = Strong emotional reaction", highIsGood: false },
    { key: "after_confidence_affected", question: "Did the result affect your confidence in yourself?", scale: "1 = No effect, 10 = Strong effect (positive or negative)", highIsGood: false },
    { key: "after_tempted_another_trade", question: "Did you feel tempted to immediately take another trade to change your emotional state?", scale: "1 = No temptation, 10 = Strong temptation", highIsGood: false },
    { key: "after_proud_discipline", question: "Did you feel proud of your discipline, or focused only on the money outcome?", scale: "1 = Proud of discipline, 10 = Only focused on money", highIsGood: false },
  ],
};

/** Emotion survey linked to an emotional state (before/during/after 1–10 responses). */
interface JournalEmotionSurvey {
  id: number;
  emotional_state_id: number;
  timestamp: string;
  before_calm_clear: number;
  before_urgency_pressure: number;
  before_confidence_vs_validation: number;
  before_fomo: number;
  before_recovering_loss: number;
  before_patient_detached: number;
  before_trust_process: number;
  before_emotional_state: number;
  during_stable: number;
  during_tension_stress: number;
  during_tempted_interfere: number;
  during_need_control: number;
  during_fear_loss: number;
  during_excitement_greed: number;
  during_mentally_present: number;
  after_accept_outcome: number;
  after_emotional_reaction: number;
  after_confidence_affected: number;
  after_tempted_another_trade: number;
  after_proud_discipline: number;
}

/** Group emotional states by timestamp (same timestamp = one entry with shared notes). */
function groupEmotionalStatesByTimestamp(states: JournalEmotionalState[]): JournalEmotionalState[][] {
  const byTs = new Map<string, JournalEmotionalState[]>();
  for (const s of states) {
    const key = s.timestamp;
    if (!byTs.has(key)) byTs.set(key, []);
    byTs.get(key)!.push(s);
  }
  return Array.from(byTs.values()).sort(
    (a, b) => new Date(b[0].timestamp).getTime() - new Date(a[0].timestamp).getTime()
  );
}

/** Emotional state IDs that are linked to the given real trade (trade_id or trade_ids JSON). */
function getEmotionalStateIdsForRealTrade(tradeId: number, states: JournalEmotionalState[]): number[] {
  const ids: number[] = [];
  for (const s of states) {
    if (s.trade_id === tradeId) {
      ids.push(s.id);
      continue;
    }
    if (s.trade_ids) {
      try {
        const arr = JSON.parse(s.trade_ids) as number[];
        if (Array.isArray(arr) && arr.includes(tradeId)) ids.push(s.id);
      } catch {
        /* ignore */
      }
    }
  }
  return ids;
}

interface PairedTrade {
  symbol: string;
  entry_trade_id: number;
  exit_trade_id: number;
  quantity: number;
  entry_price: number;
  exit_price: number;
  entry_timestamp: string;
  exit_timestamp: string;
  gross_profit_loss: number;
  entry_fees: number;
  exit_fees: number;
  net_profit_loss: number;
  strategy_id: number | null;
  notes?: string | null;
}

type TabType =
  | "trade"
  | "what_went_well"
  | "what_could_be_improved"
  | "links"
  | "emotional_state"
  | "notes"
  | "checklists"
  | "survey"
  | "journal_page";

/** Section IDs for the scrolling journal entry flow (trader sequence). User can reorder. Core sections only; custom checklists/surveys use "custom:<type>" ids. */
export type JournalSectionId =
  | "analysis_checklist"
  | "emotional_state_before"
  | "mantra_checklist"
  | "implementation"
  | "entry_checklist"
  | "emotional_state_during"
  | "take_profit_checklist"
  | "emotional_state_after"
  | "emotional_state_notes"
  | "what_went_well"
  | "what_could_be_improved"
  | "notes"
  | "links";

/** Core section order (no custom blocks); custom checklist/survey sections are added per-strategy. */
const CORE_SECTION_ORDER: JournalSectionId[] = [
  "analysis_checklist",
  "emotional_state_before",
  "implementation",
  "entry_checklist",
  "emotional_state_during",
  "take_profit_checklist",
  "emotional_state_after",
  "emotional_state_notes",
  "what_went_well",
  "what_could_be_improved",
  "notes",
  "links",
];

const JOURNAL_SECTION_LABELS: Record<JournalSectionId, string> = {
  analysis_checklist: "Analysis",
  emotional_state_before: "Emo State: Before",
  mantra_checklist: "Mantra",
  implementation: "Implementation",
  entry_checklist: "Entry",
  emotional_state_during: "Emo State: During",
  take_profit_checklist: "Take Profit",
  emotional_state_after: "Emo State: After",
  emotional_state_notes: "Emo State: Notes",
  what_went_well: "Went Well",
  what_could_be_improved: "Improvement",
  notes: "Notes",
  links: "Links",
};

// Full labels for the scroll content only (nav bar keeps short labels to save space)
const JOURNAL_SECTION_LABELS_SCROLL: Record<JournalSectionId, string> = {
  ...JOURNAL_SECTION_LABELS,
  emotional_state_before: "Emotional State: Before Trade Survey",
  emotional_state_during: "Emotional State: During Trade",
  emotional_state_after: "Emotional State: After Trade",
  emotional_state_notes: "Emotional State Notes",
  what_went_well: "What went well",
  what_could_be_improved: "What could be improved",
};

const EMOTIONAL_STATE_SECTIONS_HIDDEN_UNTIL_STARTED: JournalSectionId[] = ["emotional_state_during", "emotional_state_after", "emotional_state_notes"];

const JOURNAL_SECTION_ORDER_KEY = "tradebutler_journal_section_order";
const JOURNAL_DEFAULT_STRATEGY_ID_KEY = "tradebutler_journal_default_strategy_id";
const JOURNAL_DEFAULT_SECTION_ORDER_KEY = "tradebutler_journal_default_section_order";
const JOURNAL_HIDDEN_SECTION_IDS_KEY = "tradebutler_journal_hidden_section_ids";

/** Sortable row for the Reorder sections modal (uses @dnd-kit). */
function SortableSectionRow({
  sectionId,
  label,
  index,
  totalLength,
  onMoveUp,
  onMoveDown,
  isHidden,
  onToggleHide,
}: {
  sectionId: string;
  label: string;
  index: number;
  totalLength: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isHidden?: boolean;
  onToggleHide?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : isHidden ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 10px",
        backgroundColor: isHidden ? "var(--bg-secondary)" : "var(--bg-tertiary)",
        borderRadius: "8px",
        border: "1px solid var(--border-color)",
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
        title="Drag to reorder"
      >
        <GripVertical size={16} />
      </div>
      <span style={{ flex: 1, fontSize: "13px", color: isHidden ? "var(--text-secondary)" : "var(--text-primary)" }}>{label}{isHidden ? " (hidden)" : ""}</span>
      {onToggleHide && (
        <button
          type="button"
          onClick={onToggleHide}
          title={isHidden ? "Show section" : "Hide section"}
          style={{ padding: "4px 6px", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-secondary)", cursor: "pointer", display: "flex" }}
        >
          {isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      )}
      <button type="button" disabled={index === 0} onClick={onMoveUp} style={{ padding: "4px 8px", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: index === 0 ? "var(--text-secondary)" : "var(--text-primary)", cursor: index === 0 ? "not-allowed" : "pointer", display: "flex" }} title="Move up"><ChevronUp size={16} /></button>
      <button type="button" disabled={index === totalLength - 1} onClick={onMoveDown} style={{ padding: "4px 8px", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: index === totalLength - 1 ? "var(--text-secondary)" : "var(--text-primary)", cursor: index === totalLength - 1 ? "not-allowed" : "pointer", display: "flex" }} title="Move down"><ChevronDown size={16} /></button>
    </div>
  );
}

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [journalEntriesPage, setJournalEntriesPage] = useState(1);
  const [journalEntriesSort, setJournalEntriesSort] = useState<"newest" | "oldest">("newest");
  const JOURNAL_ENTRIES_PAGE_SIZE = 25;
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(() => {
    const savedId = localStorage.getItem('journal_selected_entry_id');
    return savedId ? null : null; // Will be loaded by ID in useEffect
  });
  // Journal opens to Overview by default; only restore entry when navigating from another page with state (e.g. "Open in Journal").
  const [pendingRestoreEntryId, setPendingRestoreEntryId] = useState<number | null>(null);
  const [selectedTrades, setSelectedTrades] = useState<JournalTrade[]>([]);
  const [allJournalTrades, setAllJournalTrades] = useState<JournalTrade[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTradeIndex, setActiveTradeIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<TabType>("trade");
  // After a successful manual save, suppress background autosaves that could re-enter edit mode
  const [justSaved, setJustSaved] = useState(false);
  const justSavedRef = useRef(justSaved);
  useEffect(() => {
    justSavedRef.current = justSaved;
  }, [justSaved]);
  const [journalSectionOrder, setJournalSectionOrder] = useState<string[]>(() => {
    const parseOrder = (raw: string | null): string[] | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
                        const normalized = parsed.map((id) => (id === "mantra_checklist" ? "custom:daily_mantra" : id));
                        const valid = normalized.filter((id) => id !== "custom_checklists_surveys" && (CORE_SECTION_ORDER.includes(id as JournalSectionId) || id.startsWith("custom:") || id.startsWith("custom_rules:")));
          const missing = CORE_SECTION_ORDER.filter((id) => !valid.includes(id));
          return [...valid, ...missing];
        }
      } catch {
        /* ignore */
      }
      return null;
    };
    const saved = parseOrder(localStorage.getItem(JOURNAL_SECTION_ORDER_KEY));
    if (saved) return saved;
    const defaultOrder = parseOrder(localStorage.getItem(JOURNAL_DEFAULT_SECTION_ORDER_KEY));
    return defaultOrder ?? [...CORE_SECTION_ORDER];
  });
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(JOURNAL_HIDDEN_SECTION_IDS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  });
  const [defaultStrategyIdForJournal, setDefaultStrategyIdForJournal] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem(JOURNAL_DEFAULT_STRATEGY_ID_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n)) return n;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [strategyDropdownOpen, setStrategyDropdownOpen] = useState(false);
  const strategyDropdownRef = useRef<HTMLDivElement>(null);
  const [showSectionOrderModal, setShowSectionOrderModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTabContentMaximized, setIsTabContentMaximized] = useState(false);
  const [linkedPairs, setLinkedPairs] = useState<PairedTrade[]>([]);
  /** Pending trade pairs when creating a new entry (not yet saved); persisted when journal is saved. */
  const [pendingLinkedPairs, setPendingLinkedPairs] = useState<PairedTrade[]>([]);
  const [showLinkPairsModal, setShowLinkPairsModal] = useState(false);
  const [selectedPairForChart, setSelectedPairForChart] = useState<PairedTrade | null>(null);
  const [selectedPositionTrades, setSelectedPositionTrades] = useState<Array<{ id: number; symbol: string; side: string; quantity: number; price: number; timestamp: string; order_type: string; status: string; fees: number | null; notes: string | null; strategy_id: number | null }> | undefined>(undefined);
  const [allPairsForPicker, setAllPairsForPicker] = useState<PairedTrade[]>([]);
  const [linkPickerSelected, setLinkPickerSelected] = useState<Set<string>>(new Set());
  const [linkPairsSearchQuery, setLinkPairsSearchQuery] = useState("");
  const [linkPairsSortBy, setLinkPairsSortBy] = useState<"date" | "symbol" | "pnl">("date");
  const [linkPairsSortDirection, setLinkPairsSortDirection] = useState<"asc" | "desc">("desc");
  const [savingLinkPairs, setSavingLinkPairs] = useState(false);
  
  // Entry-level form state
  const [entryFormData, setEntryFormData] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    title: "",
    strategy_id: null as number | null,
    linked_trade_ids: [] as number[],
    /** One state id per emotional state group to link this journal to (used when creating or editing). */
    linked_emotional_state_ids: [] as number[],
    /** When linking existing states: scope per state id (for save / edit sync). */
    linked_emotional_state_link_scopes: {} as Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }>,
  });

  // Trade-level form state (array of trades)
  const [tradesFormData, setTradesFormData] = useState<Array<{
    id: number | null;
    symbol: string;
    position: string;
    timeframe: string;
    entry_type: string;
    exit_type: string;
    trade: string;
    what_went_well: string;
    what_could_be_improved: string;
    emotional_state: string;
    notes: string;
    outcome: string;
    trade_order: number;
  }>>([{
    id: null,
    symbol: "",
    position: "",
    timeframe: "",
    entry_type: "",
    exit_type: "",
    trade: "",
    what_went_well: "",
    what_could_be_improved: "",
    emotional_state: "",
    notes: "",
    outcome: "Positive",
    trade_order: 0,
  }]);

  // Checklist state (per trade, but checklists come from strategy)
  const [strategyChecklists, setStrategyChecklists] = useState<Map<number, Map<string, ChecklistItem[]>>>(new Map());
  const [checklistResponses, setChecklistResponses] = useState<Map<number, Map<number, boolean>>>(new Map()); // trade_index -> checklist_item_id -> is_checked
  const [surveyScores, setSurveyScores] = useState<Map<number, Map<number, number>>>(new Map()); // trade_index -> checklist_item_id -> 1-10 (for survey type items)
  // Entry-level (Analysis & Mantra): associated with whole journal by default, optionally with specific trades
  const [entryLevelChecklistResponses, setEntryLevelChecklistResponses] = useState<Map<number, boolean>>(new Map()); // item_id -> is_checked
  const [checklistTradeAssociations, setChecklistTradeAssociations] = useState<Map<number, number[] | null>>(new Map()); // item_id -> null (whole entry) or [trade_id, ...]
  const [tradeAssociationModalItemId, setTradeAssociationModalItemId] = useState<number | null>(null);

  // Journal trade -> actual trades (link journal trades in entry to real trades from Trades table)
  const [journalTradeActualTradeIds, setJournalTradeActualTradeIds] = useState<Map<number, number[]>>(new Map()); // journal_trade_id -> [actual trade id, ...]
  const [actualTrades, setActualTrades] = useState<ActualTrade[]>([]); // all actual trades for "Link to actual trades" modal
  const [linkActualTradesModalJournalTradeId, setLinkActualTradesModalJournalTradeId] = useState<number | null>(null);
  const [linkActualTradesSelection, setLinkActualTradesSelection] = useState<number[]>([]); // selection in "Link to actual trades" modal

  // Emotional states linked to this journal entry/implementation (same as Emotions page)
  const [journalEmotionalStates, setJournalEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [showAddEmotionalStateForm, setShowAddEmotionalStateForm] = useState(false);
  const DEFAULT_EMOTIONAL_STATE_FORM = useMemo(() => ({ selectedEmotions: {} as Record<string, number>, notes: "", surveyResponses: {} as Record<string, number> }), []);
  const [emotionalStateFormByTrade, setEmotionalStateFormByTrade] = useState<Map<number, { selectedEmotions: Record<string, number>; notes: string; surveyResponses: Record<string, number> }>>(new Map());
  const newEmotionalStateForm = useMemo(
    () => emotionalStateFormByTrade.get(activeTradeIndex) ?? DEFAULT_EMOTIONAL_STATE_FORM,
    [emotionalStateFormByTrade, activeTradeIndex, DEFAULT_EMOTIONAL_STATE_FORM]
  );
  const newEmotionalStateSurveyResponses = newEmotionalStateForm.surveyResponses;
  const setNewEmotionalStateForm = useCallback(
    (updater: React.SetStateAction<{ selectedEmotions: Record<string, number>; notes: string; surveyResponses: Record<string, number> }>) => {
      setEmotionalStateFormByTrade((prev) => {
        const next = new Map(prev);
        const cur = next.get(activeTradeIndex) ?? DEFAULT_EMOTIONAL_STATE_FORM;
        const nextForm = typeof updater === "function" ? updater({ ...cur, surveyResponses: cur.surveyResponses }) : updater;
        next.set(activeTradeIndex, { selectedEmotions: nextForm.selectedEmotions ?? cur.selectedEmotions, notes: nextForm.notes ?? cur.notes, surveyResponses: nextForm.surveyResponses ?? cur.surveyResponses });
        return next;
      });
    },
    [activeTradeIndex, DEFAULT_EMOTIONAL_STATE_FORM]
  );
  const setNewEmotionalStateSurveyResponses = useCallback(
    (updater: React.SetStateAction<Record<string, number>>) => {
      setEmotionalStateFormByTrade((prev) => {
        const next = new Map(prev);
        const cur = next.get(activeTradeIndex) ?? DEFAULT_EMOTIONAL_STATE_FORM;
        const nextSurvey = typeof updater === "function" ? updater(cur.surveyResponses) : updater;
        next.set(activeTradeIndex, { ...cur, surveyResponses: nextSurvey });
        return next;
      });
    },
    [activeTradeIndex, DEFAULT_EMOTIONAL_STATE_FORM]
  );
  const setEmotionalStateFormForTradeIndex = useCallback(
    (tradeIndex: number, form: { selectedEmotions: Record<string, number>; notes: string; surveyResponses: Record<string, number> }) => {
      setEmotionalStateFormByTrade((prev) => {
        const next = new Map(prev);
        next.set(tradeIndex, form);
        return next;
      });
    },
    []
  );
  const [newEmotionalStateLinkScope, setNewEmotionalStateLinkScope] = useState<"entry" | "trades">("entry");
  const [newEmotionalStateTradeIndices, setNewEmotionalStateTradeIndices] = useState<number[]>([]);
  // Pending emotional state entries (tradeIndex -1 = entire journal, >= 0 = that trade only; one state per scope)
  const [pendingEmotionalStates, setPendingEmotionalStates] = useState<Array<{ tradeIndex: number; selectedEmotions: Record<string, number>; notes: string; surveyResponses?: Record<string, number> }>>([]);
  
  // Available symbols for dropdown
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [journalFilters, setJournalFilters] = useState<{
    symbol: string;
    position: string;
    timeframe: string;
    entry_type: string;
    exit_type: string;
    outcome: string;
    text: string;
  }>({
    symbol: "",
    position: "",
    timeframe: "",
    entry_type: "",
    exit_type: "",
    outcome: "",
    text: "",
  });
  
  // Modal state
  const [showTitleRequiredModal, setShowTitleRequiredModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [emotionalStateDeleteTarget, setEmotionalStateDeleteTarget] = useState<null | { type: "saved"; states: JournalEmotionalState[] } | { type: "pending"; tradeIndex: number; idx: number }>(null);
  // View mode: emotional states for the selected entry (when not editing)
  const [viewEntryEmotionalStates, setViewEntryEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [viewEntrySurveys, setViewEntrySurveys] = useState<JournalEmotionSurvey[]>([]);
  // View mode: which trade card is currently expanded/focused.
  const [viewFocusedTradeIndex, setViewFocusedTradeIndex] = useState<number | null>(0);
  const stripHtml = (html: string) =>
    (html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // For "Link to emotional states" / "Link to real trades" from Journal (entry-level)
  const [allEmotionalStates, setAllEmotionalStates] = useState<JournalEmotionalState[]>([]);
  const [realTradesForLink, setRealTradesForLink] = useState<{ id: number; symbol: string; side: string; timestamp: string; quantity: number; pnl?: number }[]>([]);
  const [journalLinksStateDropdownOpen, setJournalLinksStateDropdownOpen] = useState(false);
  const [journalLinksTradeDropdownOpen, setJournalLinksTradeDropdownOpen] = useState(false);
  const [linkExistingEmotionalStateScope, setLinkExistingEmotionalStateScope] = useState<"entry" | "trades">("entry");
  const [linkExistingEmotionalStateTradeIndex, setLinkExistingEmotionalStateTradeIndex] = useState<number | null>(null);
  /** Which link type is expanded in the Links section (scroll): emotional_state | trade_pair | real_trade */
  const [linksSectionActiveOption, setLinksSectionActiveOption] = useState<"emotional_state" | "trade_pair" | "real_trade" | null>(null);
  const journalLinksStateDropdownRef = useRef<HTMLDivElement>(null);
  const journalLinksTradeDropdownRef = useRef<HTMLDivElement>(null);
  const journalLinksStateDropdownRefScroll = useRef<HTMLDivElement>(null);
  const journalLinksTradeDropdownRefScroll = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dataMode, setDataMode] = useState<DataMode>(() => getCurrentDataMode());

  useEffect(() => {
    const unsub = subscribeToDataMode(setDataMode);
    return () => unsub();
  }, []);

  // When switching data mode (sandbox/real/paper), reset the view so the list and detail reflect the new mode's data
  useEffect(() => {
    setSelectedEntry(null);
    setPendingRestoreEntryId(null);
    setIsCreating(false);
    setIsEditing(false);
  }, [dataMode]);

  // When entering view mode for a selected entry, default focus to the first trade.
  useEffect(() => {
    if (!selectedEntry?.id) return;
    if (isCreating || isEditing) return;
    setViewFocusedTradeIndex(0);
  }, [selectedEntry?.id, isCreating, isEditing]);

  // When navigating from Analytics (e.g. "Journal Overview" link) with ?overview=1, show the overview (no entry selected, no create form)
  useEffect(() => {
    if (searchParams.get("overview") === "1") {
      setSelectedEntry(null);
      setPendingRestoreEntryId(null);
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [searchParams]);

  // Edit history for undo functionality
  const [editHistory, setEditHistory] = useState<Array<{
    entry: { date: string; title: string; strategy_id: number | null };
    trades: Array<{
      id: number | null;
      symbol: string;
      position: string;
      timeframe: string;
      entry_type: string;
      exit_type: string;
      trade: string;
      what_went_well: string;
      what_could_be_improved: string;
      emotional_state: string;
      notes: string;
      outcome: string;
      trade_order: number;
    }>;
    checklistResponses: Map<number, Map<number, boolean>>;
  }>>([]);
  
  // Store original state when starting to edit
  const [, setOriginalEntryData] = useState<{
    entry: { date: string; title: string; strategy_id: number | null };
    trades: Array<{
      id: number | null;
      symbol: string;
      position: string;
      timeframe: string;
      entry_type: string;
      exit_type: string;
      trade: string;
      what_went_well: string;
      what_could_be_improved: string;
      emotional_state: string;
      notes: string;
      outcome: string;
      trade_order: number;
    }>;
    checklistResponses: Map<number, Map<number, boolean>>;
  } | null>(null);

  // Store scroll positions for each tab
  const tabScrollPositions = useRef<Map<TabType, number>>(new Map());
  const tabContentRefs = useRef<Map<TabType, HTMLDivElement | null>>(new Map());
  const journalScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const leftPanelScrollRef = useRef<HTMLDivElement>(null);
  const isManualSaveInProgressRef = useRef(false);

  // Save work-in-progress to localStorage
  const saveWorkInProgress = () => {
    if (isCreating || isEditing) {
      const workInProgress = {
        entryFormData,
        tradesFormData,
        checklistResponses: Array.from(checklistResponses.entries()).map(([tradeIndex, responses]) => [
          tradeIndex,
          Array.from(responses.entries())
        ]),
        surveyScores: Array.from(surveyScores.entries()).map(([tradeIndex, scores]) => [
          tradeIndex,
          Array.from(scores.entries())
        ]),
        entryLevelChecklistResponses: Array.from(entryLevelChecklistResponses.entries()),
        checklistTradeAssociations: Array.from(checklistTradeAssociations.entries()).map(([k, v]) => [k, v]),
        activeTradeIndex,
        activeTab,
        isCreating,
        isEditing,
        selectedEntryId: selectedEntry?.id || null,
        scrollPositions: Array.from(tabScrollPositions.current.entries()),
      };
      localStorage.setItem('journal_work_in_progress', JSON.stringify(workInProgress));
    }
  };

  // Restore work-in-progress from localStorage (used by "Restore draft" on Overview)
  const restoreWorkInProgress = () => {
    try {
      const saved = localStorage.getItem('journal_work_in_progress');
      if (saved) {
        const workInProgress = JSON.parse(saved);
        setEntryFormData(workInProgress.entryFormData);
        setTradesFormData(workInProgress.tradesFormData);
        
        // Restore checklist responses
        const restoredResponses = new Map<number, Map<number, boolean>>();
        workInProgress.checklistResponses.forEach(([tradeIndex, responses]: [number, [number, boolean][]]) => {
          restoredResponses.set(tradeIndex, new Map(responses));
        });
        setChecklistResponses(restoredResponses);
        if (workInProgress.entryLevelChecklistResponses) {
          setEntryLevelChecklistResponses(new Map(workInProgress.entryLevelChecklistResponses));
        }
        if (workInProgress.checklistTradeAssociations) {
          setChecklistTradeAssociations(new Map(workInProgress.checklistTradeAssociations.map(([k, v]: [number, number[] | null]) => [k, v])));
        }
        if (workInProgress.surveyScores) {
          const restoredScores = new Map<number, Map<number, number>>();
          workInProgress.surveyScores.forEach(([tradeIndex, entries]: [number, [number, number][]]) => {
            restoredScores.set(tradeIndex, new Map(entries));
          });
          setSurveyScores(restoredScores);
        }
        
        setActiveTradeIndex(workInProgress.activeTradeIndex);
        setActiveTab(workInProgress.activeTab);
        setIsCreating(workInProgress.isCreating);
        setIsEditing(workInProgress.isEditing);
        
        // Restore scroll positions
        workInProgress.scrollPositions.forEach(([tab, pos]: [TabType, number]) => {
          tabScrollPositions.current.set(tab, pos);
        });
        
        // If editing an existing entry, load it. Pass restored count so we sync from DB if saved state was bloated.
        if (workInProgress.selectedEntryId && !workInProgress.isCreating) {
          loadEntry(workInProgress.selectedEntryId, {
            skipTradesFormDataSync: true,
            restoredTradesCount: workInProgress.tradesFormData?.length,
          });
        }
        
        // Load strategy checklists if needed
        if (workInProgress.entryFormData.strategy_id) {
          loadStrategyChecklists(workInProgress.entryFormData.strategy_id);
        }
      }
    } catch (error) {
      console.error("Error restoring work in progress:", error);
    }
  };

  // Clear work-in-progress from localStorage
  const clearWorkInProgress = () => {
    localStorage.removeItem('journal_work_in_progress');
  };

  // Get storage key for current entry (entry-specific scroll positions)
  const getScrollStorageKey = () => {
    if (selectedEntry?.id) {
      return `journal_entry_${selectedEntry.id}`;
    }
    return "journal"; // Fallback to global if no entry selected
  };

  /** Merge persisted tab scroll map with in-memory ref so unmount / partial saves never wipe other keys (same pattern as Strategies). */
  const saveJournalScrollPositionsMerged = useCallback((storageKey: string) => {
    const merged = new Map<TabType, number>(restoreTabScrollPositions(storageKey));
    tabScrollPositions.current.forEach((v, k) => merged.set(k, v));
    tabScrollPositions.current.clear();
    merged.forEach((v, k) => tabScrollPositions.current.set(k, v));
    saveAllScrollPositions(merged, leftPanelScrollRef.current?.scrollTop ?? null, null, storageKey);
  }, []);

  /** Snapshot all journal scroll surfaces; ref is updated every render for latest state on route unmount. */
  const persistJournalScrollStateRef = useRef<() => void>(() => {});

  // Scroll journal entry section into view (for scrolling page mode)
  const scrollToSection = (sectionId: string) => {
    const el = sectionRefs.current.get(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Persist section order when it changes
  useEffect(() => {
    try {
      localStorage.setItem(JOURNAL_SECTION_ORDER_KEY, JSON.stringify(journalSectionOrder));
    } catch {
      /* ignore */
    }
  }, [journalSectionOrder]);

  useEffect(() => {
    try {
      localStorage.setItem(JOURNAL_HIDDEN_SECTION_IDS_KEY, JSON.stringify(hiddenSectionIds));
    } catch {
      /* ignore */
    }
  }, [hiddenSectionIds]);

  useEffect(() => {
    if (!strategyDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (strategyDropdownRef.current && !strategyDropdownRef.current.contains(e.target as Node)) setStrategyDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [strategyDropdownOpen]);

  // Drag-and-drop for Reorder sections modal (handler is defined after effectiveSectionOrder)
  const sectionOrderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  persistJournalScrollStateRef.current = () => {
    try {
      const storageKey = getScrollStorageKey();
      if (journalScrollContainerRef.current && !isTabContentMaximized) {
        tabScrollPositions.current.set("journal_page", journalScrollContainerRef.current.scrollTop);
      } else {
        const currentTabContent = tabContentRefs.current.get(activeTab);
        if (currentTabContent) {
          tabScrollPositions.current.set(activeTab, currentTabContent.scrollTop);
        }
      }
      saveJournalScrollPositionsMerged(storageKey);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    return () => {
      persistJournalScrollStateRef.current();
    };
  }, []);

  // Save scroll position when switching tabs
  const handleTabChange = (newTab: TabType) => {
    // Save current tab's scroll position (maximized tab mode vs scrolling page mode)
    if (journalScrollContainerRef.current && !isTabContentMaximized) {
      tabScrollPositions.current.set("journal_page", journalScrollContainerRef.current.scrollTop);
    } else {
      const currentTabContent = tabContentRefs.current.get(activeTab);
      if (currentTabContent) {
        tabScrollPositions.current.set(activeTab, currentTabContent.scrollTop);
      }
    }

    // Save all scroll positions to localStorage before switching (entry-specific)
    const storageKey = getScrollStorageKey();
    saveJournalScrollPositionsMerged(storageKey);
    
    // Restore new tab's scroll position
    setActiveTab(newTab);
    
    // Restore scroll after a brief delay to ensure DOM is updated
    setTimeout(() => {
      const newTabContent = tabContentRefs.current.get(newTab);
      if (newTabContent) {
        // Get saved position from in-memory map first, then from storage
        let savedPosition = tabScrollPositions.current.get(newTab) || 0;
        if (savedPosition === 0 && selectedEntry?.id) {
          // Try to get from storage if not in memory
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          savedPosition = scrollState.tabPositions.get(newTab) || 0;
          // Update in-memory map
          if (savedPosition > 0) {
            tabScrollPositions.current.set(newTab, savedPosition);
          }
        }
        if (savedPosition > 0) {
          newTabContent.scrollTop = savedPosition;
        }
      }
    }, 100);
  };

  // Save state before component unmounts
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveWorkInProgress();
      persistJournalScrollStateRef.current();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Also save periodically
    const interval = setInterval(() => {
      saveWorkInProgress();
    }, 5000); // Save every 5 seconds
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(interval);
      saveWorkInProgress(); // Save one last time
    };
  }, [entryFormData, tradesFormData, checklistResponses, entryLevelChecklistResponses, checklistTradeAssociations, activeTradeIndex, activeTab, isCreating, isEditing, selectedEntry]);

  useEffect(() => {
    loadEntries();
    loadStrategies();
    loadAvailableSymbols();
    loadAllJournalTrades();
  }, [dataMode, searchParams]);

  // When navigating to Journal without ?overview=1, restore the last-open entry from localStorage (per mode) so the tab doesn't reset to overview.
  useEffect(() => {
    if (searchParams.get("overview") === "1") return;
    let savedId = localStorage.getItem(`journal_selected_entry_id_${dataMode}`);
    if (!savedId) {
      const legacyId = localStorage.getItem("journal_selected_entry_id");
      if (legacyId) {
        localStorage.setItem(`journal_selected_entry_id_${dataMode}`, legacyId);
        savedId = legacyId;
      }
    }
    if (!savedId) return;
    const id = parseInt(savedId, 10);
    if (isNaN(id)) return;
    setPendingRestoreEntryId(id);
    loadEntry(id);
  }, [dataMode]);

  // Clear pending restore once an entry is selected (so we don't stay in "loading" state)
  useEffect(() => {
    if (selectedEntry != null) setPendingRestoreEntryId(null);
  }, [selectedEntry]);

  // Open specific entry/trade when navigated from Emotions (e.g. "Open in Journal")
  useEffect(() => {
    const state = location.state as { openEntryId?: number; openTradeId?: number } | null;
    if (state?.openEntryId != null) {
      loadEntry(state.openEntryId, { openTradeId: state.openTradeId });
      navigate(location.pathname, { replace: true }); // clear state so back button doesn't re-open
    }
  }, [location.state]);

  useEffect(() => {
    if (entryFormData.strategy_id) {
      loadStrategyChecklists(entryFormData.strategy_id);
    } else {
      setStrategyChecklists(new Map());
      setChecklistResponses(new Map());
    }
  }, [entryFormData.strategy_id]);

  useEffect(() => {
    if (!entryFormData.strategy_id) {
      setStrategyIndicators([]);
      setStrategyEntryRuleTexts([]);
      setStrategyTakeProfitRuleTexts([]);
      setStrategyCustomRuleSets([]);
      return;
    }
    const all = loadIndicators();
    const indicatorIds = loadStrategyIndicatorIds(dataMode, entryFormData.strategy_id);
    setStrategyIndicators(all.filter((i) => indicatorIds.includes(i.id)));
    setStrategyEntryRuleTexts(loadStrategyRuleTexts(dataMode, entryFormData.strategy_id, "entry"));
    setStrategyTakeProfitRuleTexts(loadStrategyRuleTexts(dataMode, entryFormData.strategy_id, "takeProfit"));
    setStrategyCustomRuleSets(loadStrategyCustomRuleSets(dataMode, entryFormData.strategy_id));
  }, [dataMode, entryFormData.strategy_id]);

  useEffect(() => {
    if (selectedEntry && !isCreating && !isEditing) {
      (async () => {
        const loadedTrades = await loadTrades(selectedEntry.id);
        await loadLinkedPairs(selectedEntry.id);
        if (selectedEntry.strategy_id) {
          await loadChecklistResponses(selectedEntry.id, selectedEntry.strategy_id, loadedTrades);
        }
      })();
      
      // Restore scroll positions after entry data is loaded (entry-specific)
      if (selectedEntry?.id) {
        setTimeout(() => {
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          // Restore tab scroll positions to the ref
          scrollState.tabPositions.forEach((pos, tab) => {
            tabScrollPositions.current.set(tab as TabType, pos);
          });
          // Restore left panel scroll
          if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
            requestAnimationFrame(() => {
              if (leftPanelScrollRef.current) {
                leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
              }
            });
          }
          // Restore scrolling-page main column (default journal layout)
          if (journalScrollContainerRef.current && !isTabContentMaximized) {
            const jp =
              tabScrollPositions.current.get("journal_page") ??
              scrollState.tabPositions.get("journal_page") ??
              0;
            if (jp > 0) {
              requestAnimationFrame(() => {
                if (journalScrollContainerRef.current) {
                  journalScrollContainerRef.current.scrollTop = jp;
                }
              });
            }
          }
          // Restore active tab scroll
          const tabContent = tabContentRefs.current.get(activeTab);
          if (tabContent) {
            const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
            if (savedPosition > 0) {
              requestAnimationFrame(() => {
                tabContent.scrollTop = savedPosition;
              });
            }
          }
        }, 300);
      }
    }
  }, [selectedEntry, isCreating, isEditing, activeTab, isTabContentMaximized]);

  // Load actual trades when "Link to actual trades" modal opens
  useEffect(() => {
    if (linkActualTradesModalJournalTradeId == null) return;
    let cancelled = false;
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const state = loadSandboxState();
          if (!cancelled) setActualTrades(state.trades as unknown as ActualTrade[]);
          return;
        }
        const trades = await invoke<ActualTrade[]>("get_trades", dataMode === "paper" ? { paperOnly: true } : {});
        if (!cancelled) setActualTrades(trades);
      } catch (e) {
        if (!cancelled) setActualTrades([]);
      }
    })();
    return () => { cancelled = true; };
  }, [linkActualTradesModalJournalTradeId, dataMode]);

  // Load emotional states linked to this journal entry/implementation when on Emotional State or Links tab
  useEffect(() => {
    if ((activeTab !== "emotional_state" && activeTab !== "links") || !selectedEntry?.id) {
      setJournalEmotionalStates([]);
      return;
    }
    const jtId = tradesFormData[activeTradeIndex]?.id ?? null;
    let cancelled = false;
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const states = getSandboxEmotionalStatesForJournal(selectedEntry.id) as unknown as JournalEmotionalState[];
          if (!cancelled) {
            setJournalEmotionalStates(states);
            const groups = groupEmotionalStatesByTimestamp(states);
            const ids = groups.map((g) => g[0].id);
            const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
            for (const g of groups) {
              const first = g[0];
              const jtIdVal = first.journal_trade_id ?? null;
              if (jtIdVal == null) {
                scopes[first.id] = { scope: "entry", tradeIndex: null };
              } else {
                const idx = tradesFormData.findIndex((t) => t.id === jtIdVal);
                scopes[first.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
              }
            }
            setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
          }
          return;
        }
        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
          journalEntryId: selectedEntry.id,
          journalTradeId: jtId ?? undefined,
          ...paperArgs,
        });
        if (!cancelled) {
          setJournalEmotionalStates(states);
          const groups = groupEmotionalStatesByTimestamp(states);
          const ids = groups.map((g) => g[0].id);
          const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
          for (const g of groups) {
            const first = g[0];
            const jtIdVal = first.journal_trade_id ?? null;
            if (jtIdVal == null) {
              scopes[first.id] = { scope: "entry", tradeIndex: null };
            } else {
              const idx = tradesFormData.findIndex((t) => t.id === jtIdVal);
              scopes[first.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
            }
          }
          setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
        }
      } catch {
        if (!cancelled) {
          setJournalEmotionalStates([]);
          setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [], linked_emotional_state_link_scopes: {} }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, selectedEntry?.id, activeTradeIndex, tradesFormData, dataMode]);

  // Reset scroll to top when switching trade tab or adding a new trade, so the page shows the current trade from the start
  useEffect(() => {
    const el = journalScrollContainerRef.current;
    if (el) el.scrollTop = 0;
  }, [activeTradeIndex]);

  // When switching trade tab or adding a new trade, sync emotional state "Link to" selection so it matches the active trade
  useEffect(() => {
    setNewEmotionalStateLinkScope("trades");
    setNewEmotionalStateTradeIndices([activeTradeIndex]);
    setLinkExistingEmotionalStateScope("trades");
    setLinkExistingEmotionalStateTradeIndex(activeTradeIndex);
  }, [activeTradeIndex]);

  // Load emotional states for view mode (when viewing an entry, not editing)
  useEffect(() => {
    if (!selectedEntry?.id || isCreating || isEditing) {
      setViewEntryEmotionalStates([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const states = getSandboxEmotionalStatesForJournal(selectedEntry.id) as unknown as JournalEmotionalState[];
          if (!cancelled) setViewEntryEmotionalStates(states);
          return;
        }
        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
          journalEntryId: selectedEntry.id,
          ...paperArgs,
        });
        if (!cancelled) setViewEntryEmotionalStates(states);
      } catch {
        if (!cancelled) setViewEntryEmotionalStates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEntry?.id, isCreating, isEditing, dataMode]);

  // Load emotion surveys for the emotional states linked to this journal entry (for view mode)
  useEffect(() => {
    if (viewEntryEmotionalStates.length === 0) {
      setViewEntrySurveys([]);
      return;
    }
    const stateIds = new Set(viewEntryEmotionalStates.map((s) => s.id));
    let cancelled = false;
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const all = getSandboxEmotionSurveys() as unknown as JournalEmotionSurvey[];
          const filtered = all.filter((s) => stateIds.has(s.emotional_state_id));
          if (!cancelled) setViewEntrySurveys(filtered);
          return;
        }
        const all = await invoke<JournalEmotionSurvey[]>("get_all_emotion_surveys");
        if (!cancelled) setViewEntrySurveys(all.filter((s) => stateIds.has(s.emotional_state_id)));
      } catch {
        if (!cancelled) setViewEntrySurveys([]);
      }
    })();
    return () => { cancelled = true; };
  }, [viewEntryEmotionalStates, dataMode]);

  // Load all emotional states and real trades for "Link to" dropdowns (Links section + Emotional State tab)
  useEffect(() => {
    if (!(isCreating || isEditing)) return;
    (async () => {
      try {
        if (dataMode === "sandbox") {
          const states = getSandboxEmotionalStates() as unknown as JournalEmotionalState[];
          const state = loadSandboxState();
          setAllEmotionalStates(states);
          setRealTradesForLink(state.trades.map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            timestamp: t.timestamp,
            quantity: t.quantity ?? 0,
            pnl: undefined,
          })));
          return;
        }
        const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
        const [states, trades] = await Promise.all([
          invoke<JournalEmotionalState[]>("get_emotional_states", paperArgs),
          invoke<{ id: number; symbol: string; side: string; timestamp: string; quantity: number; price: number }[]>("get_trades", paperArgs),
        ]);
        setAllEmotionalStates(states);
        let pnlMap: Record<number, number> = {};
        try {
          const withPairing = await invoke<{ trade: { id: number }; entry_pairs: { net_profit_loss: number }[]; exit_pairs: { net_profit_loss: number }[] }[]>("get_trades_with_pairing", { pairing_method: null, start_date: null, end_date: null, ...paperArgs });
          for (const row of withPairing) {
            const id = row.trade?.id;
            if (id == null) continue;
            const entrySum = (row.entry_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            const exitSum = (row.exit_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            pnlMap[id] = (pnlMap[id] ?? 0) + entrySum + exitSum;
          }
        } catch {
          /* optional */
        }
        setRealTradesForLink(trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          timestamp: t.timestamp,
          quantity: t.quantity ?? 0,
          pnl: pnlMap[t.id] !== undefined && pnlMap[t.id] !== 0 ? pnlMap[t.id] : undefined,
        })));
      } catch {
        setAllEmotionalStates([]);
        setRealTradesForLink([]);
      }
    })();
  }, [isCreating, isEditing, dataMode]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const stateContained = (journalLinksStateDropdownRef.current?.contains(target)) || (journalLinksStateDropdownRefScroll.current?.contains(target));
      const tradeContained = (journalLinksTradeDropdownRef.current?.contains(target)) || (journalLinksTradeDropdownRefScroll.current?.contains(target));
      if (!stateContained) setJournalLinksStateDropdownOpen(false);
      if (!tradeContained) setJournalLinksTradeDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadEntries = async () => {
    try {
      if (dataMode === "sandbox") {
        const data = getSandboxJournalEntries() as unknown as JournalEntry[];
        setEntries(data);
        setLoading(false);
        return;
      }
      const data = await invoke<JournalEntry[]>("get_journal_entries", dataMode === "paper" ? { paperOnly: true } : {});
      setEntries(data);
    } catch (error) {
      console.error("Error loading journal entries:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadAllJournalTrades = async () => {
    try {
      if (dataMode === "sandbox") {
        const trades = getSandboxAllJournalTrades() as unknown as JournalTrade[];
        setAllJournalTrades(trades);
        return;
      }
      const trades = await invoke<JournalTrade[]>("get_all_journal_trades");
      setAllJournalTrades(trades);
    } catch (error) {
      console.error("Error loading all journal trades:", error);
    }
  };

  const sortedJournalEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      const dA = parse(a.date, "yyyy-MM-dd", new Date()).getTime();
      const dB = parse(b.date, "yyyy-MM-dd", new Date()).getTime();
      return journalEntriesSort === "newest" ? dB - dA : dA - dB;
    });
    return copy;
  }, [entries, journalEntriesSort]);

  const journalEntriesTotalPages = Math.max(1, Math.ceil(sortedJournalEntries.length / JOURNAL_ENTRIES_PAGE_SIZE));
  const effectiveJournalPage = Math.min(journalEntriesPage, journalEntriesTotalPages);
  const paginatedJournalEntries = useMemo(
    () =>
      sortedJournalEntries.slice(
        (effectiveJournalPage - 1) * JOURNAL_ENTRIES_PAGE_SIZE,
        effectiveJournalPage * JOURNAL_ENTRIES_PAGE_SIZE
      ),
    [sortedJournalEntries, effectiveJournalPage]
  );

  const loadStrategies = async () => {
    try {
      if (dataMode === "sandbox") {
        const data = getSandboxStrategies() as unknown as Strategy[];
        setStrategies(data);
        return;
      }
      const data = await invoke<Strategy[]>("get_strategies");
      setStrategies(data);
    } catch (error) {
      console.error("Error loading strategies:", error);
    }
  };

  const loadAvailableSymbols = async () => {
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        const symSet = new Set<string>();
        state.trades.forEach((t) => symSet.add(t.symbol));
        setAvailableSymbols(Array.from(symSet).sort());
        return;
      }
      const symbols = await invoke<string[]>("get_all_symbols");
      setAvailableSymbols(symbols);
    } catch (error) {
      console.error("Error loading symbols:", error);
    }
  };

  const loadTrades = async (entryId: number): Promise<JournalTrade[]> => {
    try {
      if (dataMode === "sandbox") {
        const trades = getSandboxJournalTrades(entryId) as unknown as JournalTrade[];
        setSelectedTrades(trades);
        return trades;
      }
      const trades = await invoke<JournalTrade[]>("get_journal_trades", { journalEntryId: entryId });
      setSelectedTrades(trades);
      return trades;
    } catch (error) {
      console.error("Error loading trades:", error);
      return [];
    }
  };

  const loadLinkedPairs = async (entryId: number) => {
    try {
      if (dataMode === "sandbox") {
        const pairs = getSandboxJournalEntryPairsAsPairedTrades(entryId) as unknown as PairedTrade[];
        setLinkedPairs(pairs);
        return;
      }
      const pairs = await invoke<PairedTrade[]>("get_journal_entry_pairs", { journalEntryId: entryId });
      setLinkedPairs(pairs);
    } catch (error) {
      console.error("Error loading linked pairs:", error);
      setLinkedPairs([]);
    }
  };

  /** Fetch position trades for a pair so the chart can show buy/sell markers and average cost (same as Trades tab). */
  const fetchPositionTradesForPair = async (pair: PairedTrade): Promise<Array<{ id: number; symbol: string; side: string; quantity: number; price: number; timestamp: string; order_type: string; status: string; fees: number | null; notes: string | null; strategy_id: number | null }> | undefined> => {
    try {
      if (dataMode === "sandbox") {
        const state = loadSandboxState();
        const trades = state.trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          timestamp: t.timestamp,
          order_type: t.order_type ?? "",
          status: t.status ?? "Filled",
          fees: t.fees ?? null,
          notes: t.notes ?? null,
          strategy_id: t.strategy_id ?? null,
        }));
        const { positionGroups } = buildPositionGroupsAndPairs(trades, "FIFO");
        const group = positionGroups.find(
          (g) =>
            g.entry_trade.id === pair.entry_trade_id &&
            g.position_trades.length >= 1 &&
            g.position_trades[g.position_trades.length - 1].id === pair.exit_trade_id
        );
        if (!group) return undefined;
        return group.position_trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          timestamp: t.timestamp,
          order_type: t.order_type ?? "",
          status: t.status ?? "Filled",
          fees: t.fees ?? null,
          notes: t.notes ?? null,
          strategy_id: t.strategy_id ?? null,
        }));
      }
      const start = new Date(pair.entry_timestamp);
      const end = new Date(pair.exit_timestamp);
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() + 1);
      const startDate = start.toISOString();
      const endDate = end.toISOString();
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const groups = await invoke<Array<{ entry_trade: { id: number }; position_trades: Array<{ id?: number; symbol: string; side: string; quantity: number; price: number; timestamp: string; order_type?: string; status?: string; fees?: number | null; notes?: string | null; strategy_id?: number | null }> }>>("get_position_groups", { pairing_method: "FIFO", startDate, endDate, ...paperArgs });
      const group = groups.find(
        (g) =>
          g.entry_trade.id === pair.entry_trade_id &&
          g.position_trades.length >= 1 &&
          (g.position_trades[g.position_trades.length - 1].id ?? 0) === pair.exit_trade_id
      );
      if (!group) return undefined;
      return group.position_trades.map((t) => ({
        id: t.id ?? 0,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        timestamp: t.timestamp,
        order_type: t.order_type ?? "",
        status: t.status ?? "Filled",
        fees: t.fees ?? null,
        notes: t.notes ?? null,
        strategy_id: t.strategy_id ?? null,
      }));
    } catch {
      return undefined;
    }
  };

  const loadStrategyChecklists = async (strategyId: number) => {
    try {
      const allItems = await invoke<ChecklistItem[]>("get_strategy_checklist", {
        strategyId: strategyId,
        checklistType: null,
      });

      // Group by checklist_type
      const grouped = new Map<string, ChecklistItem[]>();
      for (const item of allItems) {
        const checklistType = item.checklist_type || "entry";
        if (!grouped.has(checklistType)) {
          grouped.set(checklistType, []);
        }
        grouped.get(checklistType)!.push(item);
      }

      // Sort each group by item_order
      for (const [, items] of grouped.entries()) {
        items.sort((a, b) => a.item_order - b.item_order);
      }

      setStrategyChecklists(new Map([[strategyId, grouped]]));
      // Reset checklist responses for all trades and entry-level
      const newResponses = new Map<number, Map<number, boolean>>();
      tradesFormData.forEach((_, index) => {
        newResponses.set(index, new Map());
      });
      setChecklistResponses(newResponses);
      setEntryLevelChecklistResponses(new Map());
      setChecklistTradeAssociations(new Map());
      setSurveyScores(new Map());
    } catch (error) {
      console.error("Error loading strategy checklists:", error);
    }
  };

  const loadChecklistResponses = async (entryId: number, strategyId: number, tradesForMapping?: JournalTrade[]) => {
    try {
      const [responses, allChecklistItems] = await Promise.all([
        invoke<JournalChecklistResponse[]>("get_journal_checklist_responses", { journalEntryId: entryId }),
        invoke<ChecklistItem[]>("get_strategy_checklist", { strategyId, checklistType: null }),
      ]);

      const itemIdToType = new Map<number, string>();
      for (const item of allChecklistItems) {
        itemIdToType.set(item.id, item.checklist_type || "entry");
      }

      const entryLevelChecked = new Map<number, boolean>();
      const entryLevelTradeAssociations = new Map<number, number[] | null>();
      const newResponses = new Map<number, Map<number, boolean>>();
      const loadedSurveyScoresPerTrade = new Map<number, Map<number, number>>();
      const tradesToUse = tradesForMapping ?? selectedTrades;
      tradesToUse.forEach((_, index) => {
        newResponses.set(index, new Map());
        loadedSurveyScoresPerTrade.set(index, new Map());
      });

      const tradeIdToIndex = new Map<number, number>();
      tradesToUse.forEach((t, idx) => {
        const id = (t as { id?: number }).id;
        if (id != null) tradeIdToIndex.set(id, idx);
      });

      for (const response of responses) {
        const itemType = itemIdToType.get(response.checklist_item_id);
        if (ENTRY_LEVEL_CHECKLIST_TYPES.includes(itemType || "")) {
          entryLevelChecked.set(response.checklist_item_id, response.is_checked);
          if (response.journal_trade_ids) {
            try {
              const ids = JSON.parse(response.journal_trade_ids) as number[];
              entryLevelTradeAssociations.set(response.checklist_item_id, ids.length > 0 ? ids : null);
            } catch {
              entryLevelTradeAssociations.set(response.checklist_item_id, null);
            }
          } else {
            entryLevelTradeAssociations.set(response.checklist_item_id, null);
          }
        } else {
          let tradeIndices: number[] = [];
          if (response.journal_trade_ids) {
            try {
              const ids = JSON.parse(response.journal_trade_ids) as number[];
              tradeIndices = ids.map((id) => tradeIdToIndex.get(id)).filter((i): i is number => i !== undefined);
            } catch {
              tradeIndices = [0];
            }
          }
          if (tradeIndices.length === 0) tradeIndices = [0];
          for (const tradeIndex of tradeIndices) {
            const resMap = newResponses.get(tradeIndex)!;
            resMap.set(response.checklist_item_id, response.is_checked);
            if (itemType === "survey" && response.response_value != null) {
              loadedSurveyScoresPerTrade.get(tradeIndex)!.set(response.checklist_item_id, response.response_value);
            }
          }
        }
      }

      setEntryLevelChecklistResponses(entryLevelChecked);
      setChecklistTradeAssociations(entryLevelTradeAssociations);
      setSurveyScores(loadedSurveyScoresPerTrade);
      setChecklistResponses(newResponses);
    } catch (error) {
      console.error("Error loading checklist responses:", error);
    }
  };

  const handleCreateNew = () => {
    clearWorkInProgress(); // Clear any old work in progress
    setIsCreating(true);
    setIsEditing(false);
    setSelectedEntry(null);
    setPendingLinkedPairs([]);
    localStorage.removeItem(`journal_selected_entry_id_${dataMode}`);
    setSelectedTrades([]);
    setJournalTradeActualTradeIds(new Map());
    setLinkActualTradesModalJournalTradeId(null);
    setPendingEmotionalStates([]);
    let defaultStrategyId: number | null = null;
    try {
      const saved = localStorage.getItem(JOURNAL_DEFAULT_STRATEGY_ID_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n)) defaultStrategyId = n;
      }
    } catch {
      /* ignore */
    }
    setEntryFormData({
      date: format(new Date(), "yyyy-MM-dd"),
      title: "",
      strategy_id: defaultStrategyId,
      linked_trade_ids: [],
      linked_emotional_state_ids: [],
      linked_emotional_state_link_scopes: {},
    });
    setTradesFormData([{
      id: null,
      symbol: "",
      position: "",
      timeframe: "",
      entry_type: "",
      exit_type: "",
      trade: "",
      what_went_well: "",
      what_could_be_improved: "",
      emotional_state: "",
      notes: "",
      outcome: "None",
      trade_order: 0,
    }]);
    setActiveTradeIndex(0);
    setActiveTab("trade");
    setChecklistResponses(new Map());
    setEntryLevelChecklistResponses(new Map());
    setChecklistTradeAssociations(new Map());
    setLinkedPairs([]);
    tabScrollPositions.current.clear();
  };

  const handleEdit = async () => {
    if (selectedEntry) {
      setIsEditing(true);
      setIsCreating(false);
      setJustSaved(false);
      setPendingEmotionalStates([]);
      let linkedTradeIds: number[] = [];
      if (selectedEntry.linked_trade_ids) {
        try {
          const parsed = JSON.parse(selectedEntry.linked_trade_ids) as number[];
          if (Array.isArray(parsed)) linkedTradeIds = parsed;
        } catch {
          /* ignore */
        }
      }
      setEntryFormData({
        date: selectedEntry.date,
        title: selectedEntry.title,
        strategy_id: selectedEntry.strategy_id,
        linked_trade_ids: linkedTradeIds,
        linked_emotional_state_ids: [], // synced when Links/Emotional State tab loads journalEmotionalStates
        linked_emotional_state_link_scopes: {},
      });
      const loadedTrades = await loadTrades(selectedEntry.id);
      await loadTrades(selectedEntry.id);
      await loadLinkedPairs(selectedEntry.id);
      if (selectedEntry.strategy_id) {
        await loadStrategyChecklists(selectedEntry.strategy_id);
        await loadChecklistResponses(selectedEntry.id, selectedEntry.strategy_id, loadedTrades);
      }
      try {
        if (dataMode === "sandbox") {
          const states = getSandboxEmotionalStatesForJournal(selectedEntry.id) as unknown as JournalEmotionalState[];
          const allSurveys = getSandboxEmotionSurveys() as unknown as JournalEmotionSurvey[];
          const surveysByStateId = new Map<number, JournalEmotionSurvey>();
          for (const sv of allSurveys) surveysByStateId.set(sv.emotional_state_id, sv);
          setJournalEmotionalStates(states);
          const entryLevelGroups = groupEmotionalStatesByTimestamp(states.filter((s) => s.journal_trade_id == null));
          const entryLevelGroup = entryLevelGroups[0];
          const nextForms = new Map<number, { selectedEmotions: Record<string, number>; notes: string; surveyResponses: Record<string, number> }>();
          loadedTrades.forEach((t, idx) => {
            const tradeGroups = groupEmotionalStatesByTimestamp(states.filter((s) => t.id != null && s.journal_trade_id === t.id));
            const picked = tradeGroups[0] ?? entryLevelGroup;
            if (!picked) return;
            const selectedEmotions: Record<string, number> = {};
            picked.forEach((s) => {
              selectedEmotions[s.emotion] = s.intensity;
            });
            const survey = picked.map((s) => surveysByStateId.get(s.id)).find((sv): sv is JournalEmotionSurvey => sv != null);
            const surveyResponses: Record<string, number> = {};
            if (survey) {
              for (const q of [...JOURNAL_SURVEY_QUESTIONS.before, ...JOURNAL_SURVEY_QUESTIONS.during, ...JOURNAL_SURVEY_QUESTIONS.after]) {
                const raw = (survey as unknown as Record<string, number>)[q.key];
                if (typeof raw === "number") surveyResponses[q.key] = raw;
              }
            }
            nextForms.set(idx, {
              selectedEmotions,
              notes: picked[0]?.notes || "",
              surveyResponses,
            });
          });
          setEmotionalStateFormByTrade(nextForms);
          setShowAddEmotionalStateForm(nextForms.size > 0);
        } else {
          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
          const [states, allSurveys] = await Promise.all([
            invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry.id, ...paperArgs }),
            invoke<JournalEmotionSurvey[]>("get_all_emotion_surveys"),
          ]);
          const surveysByStateId = new Map<number, JournalEmotionSurvey>();
          for (const sv of allSurveys) surveysByStateId.set(sv.emotional_state_id, sv);
          setJournalEmotionalStates(states);
          const entryLevelGroups = groupEmotionalStatesByTimestamp(states.filter((s) => s.journal_trade_id == null));
          const entryLevelGroup = entryLevelGroups[0];
          const nextForms = new Map<number, { selectedEmotions: Record<string, number>; notes: string; surveyResponses: Record<string, number> }>();
          loadedTrades.forEach((t, idx) => {
            const tradeGroups = groupEmotionalStatesByTimestamp(states.filter((s) => t.id != null && s.journal_trade_id === t.id));
            const picked = tradeGroups[0] ?? entryLevelGroup;
            if (!picked) return;
            const selectedEmotions: Record<string, number> = {};
            picked.forEach((s) => {
              selectedEmotions[s.emotion] = s.intensity;
            });
            const survey = picked.map((s) => surveysByStateId.get(s.id)).find((sv): sv is JournalEmotionSurvey => sv != null);
            const surveyResponses: Record<string, number> = {};
            if (survey) {
              for (const q of [...JOURNAL_SURVEY_QUESTIONS.before, ...JOURNAL_SURVEY_QUESTIONS.during, ...JOURNAL_SURVEY_QUESTIONS.after]) {
                const raw = (survey as unknown as Record<string, number>)[q.key];
                if (typeof raw === "number") surveyResponses[q.key] = raw;
              }
            }
            nextForms.set(idx, {
              selectedEmotions,
              notes: picked[0]?.notes || "",
              surveyResponses,
            });
          });
          setEmotionalStateFormByTrade(nextForms);
          setShowAddEmotionalStateForm(nextForms.size > 0);
        }
      } catch {
        setEmotionalStateFormByTrade(new Map());
      }
      
      // Convert trades to form data (use loadedTrades, not selectedTrades - state updates are async)
      const tradesData: Array<{
        id: number | null;
        symbol: string;
        position: string;
        timeframe: string;
        entry_type: string;
        exit_type: string;
        trade: string;
        what_went_well: string;
        what_could_be_improved: string;
        emotional_state: string;
        notes: string;
        outcome: string;
        trade_order: number;
      }> = loadedTrades.map(trade => ({
        id: trade.id,
        symbol: trade.symbol || "",
        position: trade.position || "",
        timeframe: trade.timeframe || "",
        entry_type: trade.entry_type || "",
        exit_type: trade.exit_type || "",
        trade: trade.trade || "",
        what_went_well: trade.what_went_well || "",
        what_could_be_improved: trade.what_could_be_improved || "",
        emotional_state: trade.emotional_state || "",
        notes: trade.notes || "",
        outcome: trade.outcome || "None",
        trade_order: trade.trade_order ?? 0,
      }));
      
      if (tradesData.length === 0) {
        tradesData.push({
          id: null,
          symbol: "",
          position: "",
          timeframe: "",
          entry_type: "",
          exit_type: "",
          trade: "",
          what_went_well: "",
          what_could_be_improved: "",
          emotional_state: "",
          notes: "",
          outcome: "None",
          trade_order: 0,
        });
      }
      
      setTradesFormData(tradesData);
      setActiveTradeIndex(0);
      setActiveTab("trade");

      // Load journal trade -> actual trade associations for each journal trade
      const assocMap = new Map<number, number[]>();
      for (const jt of loadedTrades) {
        if (jt.id != null) {
          try {
            const ids = await invoke<number[]>("get_journal_trade_actual_trade_ids", { journalTradeId: jt.id });
            assocMap.set(jt.id, ids);
          } catch {
            assocMap.set(jt.id, []);
          }
        }
      }
      setJournalTradeActualTradeIds(assocMap);
      
      // Store initial state for undo
      const initialState = {
        entry: {
          date: selectedEntry.date,
          title: selectedEntry.title,
          strategy_id: selectedEntry.strategy_id,
        },
        trades: tradesData.map(t => ({ ...t })),
        checklistResponses: new Map(checklistResponses),
      };
      setOriginalEntryData(initialState);
      setEditHistory([initialState]);
    }
  };

  const handleDeleteClick = () => {
    if (selectedEntry) {
      setShowDeleteConfirmModal(true);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedEntry) return;
    
    try {
      if (dataMode === "sandbox") {
        deleteSandboxJournalEntry(selectedEntry.id);
        await loadEntries();
        setSelectedEntry(null);
        localStorage.removeItem(`journal_selected_entry_id_${dataMode}`);
        setSelectedTrades([]);
        setShowDeleteConfirmModal(false);
        return;
      }
      await invoke("delete_journal_entry", { id: selectedEntry.id });
      await loadEntries();
      setSelectedEntry(null);
      localStorage.removeItem(`journal_selected_entry_id_${dataMode}`);
      setSelectedTrades([]);
      setShowDeleteConfirmModal(false);
    } catch (error) {
      console.error("Error deleting entry:", error);
      alert("Failed to delete entry: " + error);
      setShowDeleteConfirmModal(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirmModal(false);
  };

  const handleEmotionalStateDeleteCancel = () => {
    setEmotionalStateDeleteTarget(null);
  };

  const handleEmotionalStateDeleteConfirm = async () => {
    if (!emotionalStateDeleteTarget) return;
    if (emotionalStateDeleteTarget.type === "saved") {
      try {
        if (dataMode === "sandbox") {
          for (const state of emotionalStateDeleteTarget.states) {
            deleteSandboxEmotionalState(state.id);
          }
          if (selectedEntry?.id != null) {
            const states = getSandboxEmotionalStatesForJournal(selectedEntry.id) as unknown as JournalEmotionalState[];
            setJournalEmotionalStates(states);
          }
        } else {
          for (const state of emotionalStateDeleteTarget.states) {
            await invoke("delete_emotional_state", { id: state.id });
          }
          const jtId = tradesFormData[activeTradeIndex]?.id ?? null;
          if (selectedEntry?.id != null) {
            const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
            const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", {
              journalEntryId: selectedEntry.id,
              journalTradeId: jtId ?? undefined,
              ...paperArgs,
            });
            setJournalEmotionalStates(states);
          }
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      const { tradeIndex, idx } = emotionalStateDeleteTarget;
      const forThisTrade = pendingEmotionalStates.filter((p) => p.tradeIndex === tradeIndex);
      const kept = forThisTrade.filter((_, i) => i !== idx);
      setPendingEmotionalStates((prev) => [...prev.filter((p) => p.tradeIndex !== tradeIndex), ...kept]);
    }
    setEmotionalStateDeleteTarget(null);
  };

  const handleAddTrade = () => {
    const newTrade = {
      id: null,
      symbol: "",
      position: "",
      timeframe: "",
      entry_type: "",
      exit_type: "",
      trade: "",
      what_went_well: "",
      what_could_be_improved: "",
      emotional_state: "",
      notes: "",
      outcome: "None",
      trade_order: tradesFormData.length,
    };
    setTradesFormData([...tradesFormData, newTrade]);
    setActiveTradeIndex(tradesFormData.length);
    
    // Initialize checklist responses and survey scores for new trade
    const newResponses = new Map(checklistResponses);
    newResponses.set(tradesFormData.length, new Map());
    setChecklistResponses(newResponses);
    const newScores = new Map(surveyScores);
    newScores.set(tradesFormData.length, new Map());
    setSurveyScores(newScores);
    
    // Reset emotional state "add" form so the new trade starts with a clean slate (new trade has no form data yet)
    setShowAddEmotionalStateForm(false);
  };

  const handleRemoveTrade = (index: number) => {
    if (tradesFormData.length <= 1) {
      alert("You must have at least one trade");
      return;
    }
    
    const newTrades = tradesFormData.filter((_, i) => i !== index);
    // Reorder trades
    const reorderedTrades = newTrades.map((trade, i) => ({ ...trade, trade_order: i }));
    setTradesFormData(reorderedTrades);
    
    // Keep active trade deterministic after deletion:
    // - if deleting current tab, keep same numeric index (now next trade) when possible
    // - if deleting a tab before current, shift active index left
    // - clamp to valid bounds
    setActiveTradeIndex((prev) => {
      if (prev > index) return prev - 1;
      if (prev === index) return Math.min(index, reorderedTrades.length - 1);
      return Math.min(prev, reorderedTrades.length - 1);
    });
    
    // Remove checklist responses and survey scores for removed trade, then reindex
    const newResponses = new Map(checklistResponses);
    newResponses.delete(index);
    const reindexedResponses = new Map<number, Map<number, boolean>>();
    reorderedTrades.forEach((_, newIndex) => {
      const oldIndex = newIndex >= index ? newIndex + 1 : newIndex;
      reindexedResponses.set(newIndex, newResponses.get(oldIndex) || new Map());
    });
    setChecklistResponses(reindexedResponses);

    const newScores = new Map(surveyScores);
    newScores.delete(index);
    const reindexedScores = new Map<number, Map<number, number>>();
    reorderedTrades.forEach((_, newIndex) => {
      const oldIndex = newIndex >= index ? newIndex + 1 : newIndex;
      reindexedScores.set(newIndex, newScores.get(oldIndex) || new Map());
    });
    setSurveyScores(reindexedScores);
    
    // Track history for undo
    if (isEditing) {
      const currentState = {
        entry: { ...entryFormData },
        trades: reorderedTrades.map(t => ({ ...t })),
        checklistResponses: new Map(reindexedResponses),
      };
      setEditHistory(prev => [...prev, currentState].slice(-10));
    }
  };

  // Auto-save function (silent, doesn't require title)
  const autoSave = async (opts?: { isManualSave?: boolean }) => {
    if (isManualSaveInProgressRef.current && !opts?.isManualSave) {
      return;
    }
    // Only auto-save if we have a title, are creating/editing, and haven't just manually saved
    if (!entryFormData.title.trim() || (!isCreating && !isEditing) || (justSavedRef.current && !opts?.isManualSave)) {
      return;
    }

    try {
      let entryId: number;
      let toAdd: number[] = [];

      if (dataMode === "sandbox") {
        if (isCreating) {
          entryId = createSandboxJournalEntry({
            date: entryFormData.date,
            title: entryFormData.title,
            strategy_id: entryFormData.strategy_id,
            linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
          });
          updateSandboxJournalEntry(entryId, { linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null });
          // If the user manually clicked Save, don't re-enter edit mode due to a queued auto-save.
          if ((isManualSaveInProgressRef.current || justSavedRef.current) && !opts?.isManualSave) return;
          setIsCreating(false);
          setIsEditing(true);
          const savedEntry = getSandboxJournalEntry(entryId) as unknown as JournalEntry;
          setSelectedEntry(savedEntry);
        } else if (selectedEntry) {
          entryId = selectedEntry.id;
          updateSandboxJournalEntry(entryId, {
            date: entryFormData.date,
            title: entryFormData.title,
            strategy_id: entryFormData.strategy_id,
            linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
          });
          const formStateIds = entryFormData.linked_emotional_state_ids ?? [];
          const currentGroupIds = groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].id);
          const toRemove = currentGroupIds.filter((id) => !formStateIds.includes(id));
          toAdd = formStateIds.filter((id) => !currentGroupIds.includes(id));
          if (toRemove.length > 0) removeSandboxJournalEntryFromEmotionalStates(entryId, toRemove);
          if (toAdd.length > 0) addSandboxJournalEntryToEmotionalStates(entryId, toAdd);
        } else {
          return;
        }
        const tradeIdsInOrder: number[] = [];
        for (let i = 0; i < tradesFormData.length; i++) {
          const tradeData = tradesFormData[i];
          const payload = {
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entry_type: tradeData.entry_type || null,
            exit_type: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            what_went_well: normalizeRichTextHtml(tradeData.what_went_well || "") || null,
            what_could_be_improved: normalizeRichTextHtml(tradeData.what_could_be_improved || "") || null,
            emotional_state: normalizeRichTextHtml(tradeData.emotional_state || "") || null,
            notes: normalizeRichTextHtml(tradeData.notes || "") || null,
            outcome: tradeData.outcome || null,
            trade_order: i,
          };
          if (tradeData.id) {
            tradeIdsInOrder.push(tradeData.id);
            updateSandboxJournalTrade(tradeData.id, payload);
          } else {
            const newTradeId = createSandboxJournalTrade(entryId, payload);
            tradeIdsInOrder.push(newTradeId);
          }
        }
        const stateIdsToLinkAfterTrades = isCreating ? (entryFormData.linked_emotional_state_ids ?? []) : toAdd;
        if (stateIdsToLinkAfterTrades.length > 0) {
          if (isCreating) addSandboxJournalEntryToEmotionalStates(entryId, stateIdsToLinkAfterTrades);
          for (const stateId of stateIdsToLinkAfterTrades) {
            const scope = entryFormData.linked_emotional_state_link_scopes?.[stateId];
            const jtId = scope?.scope === "trades" && scope.tradeIndex != null ? tradeIdsInOrder[scope.tradeIndex] ?? null : null;
            linkSandboxEmotionalStatesToJournal([stateId], entryId, jtId ?? undefined);
          }
        }
        if (pendingLinkedPairs.length > 0) {
          setSandboxJournalEntryPairs(entryId, pendingLinkedPairs.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })));
          setPendingLinkedPairs([]);
        }
        await loadTrades(entryId);
        await loadLinkedPairs(entryId);
        return;
      }

      if (isCreating) {
      entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          isPaper: dataMode === "paper",
        });
        // Persist linked trades on the new entry
        await invoke("update_journal_entry", {
          id: entryId,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
      // Migrate any draft indicator data (from temporary entry id 0)
      migrateJournalIndicatorDraftValues(dataMode, 0, entryId);
      migrateJournalIndicatorDraftDivergence(dataMode, 0, entryId);
      migrateJournalIndicatorDraftOtherSignals(dataMode, 0, entryId);
      migrateJournalIndicatorDraftTradePatterns(dataMode, 0, entryId);
        // Link to emotional state entries (chosen while creating) — scope applied after trades below
        // After first auto-save, switch from creating to editing
        // If the user manually clicked Save, don't re-enter edit mode due to a queued auto-save.
        if ((isManualSaveInProgressRef.current || justSavedRef.current) && !opts?.isManualSave) return;
        setIsCreating(false);
        setIsEditing(true);
        const savedEntry = await invoke<JournalEntry>("get_journal_entry", { id: entryId });
        setSelectedEntry(savedEntry);
        if (pendingLinkedPairs.length > 0) {
          await invoke("set_journal_entry_pairs", { journalEntryId: entryId, pairs: pendingLinkedPairs.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })) });
          setPendingLinkedPairs([]);
        }
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
        // Sync emotional state links
        const formStateIds = entryFormData.linked_emotional_state_ids ?? [];
        const currentGroupIds = groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].id);
        const toRemove = currentGroupIds.filter((id) => !formStateIds.includes(id));
        toAdd = formStateIds.filter((id) => !currentGroupIds.includes(id));
        if (toRemove.length > 0) await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: entryId, emotionalStateIds: toRemove });
        if (toAdd.length > 0) await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: toAdd });
      } else {
        return;
      }

      // For real/paper mode, background auto-save should only persist entry metadata.
      // Trade/checklist/emotion persistence is reserved for explicit manual Save.
      if (!opts?.isManualSave) {
        return;
      }

      // Save all trades and collect trade IDs for checklist associations
      const tradeIdsInOrder: number[] = [];
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          tradeIdsInOrder.push(tradeData.id);
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: normalizeRichTextHtml(tradeData.what_went_well || "") || null,
            whatCouldBeImproved: normalizeRichTextHtml(tradeData.what_could_be_improved || "") || null,
            emotionalState: normalizeRichTextHtml(tradeData.emotional_state || "") || null,
            notes: normalizeRichTextHtml(tradeData.notes || "") || null,
            outcome: tradeData.outcome || null,
            rMultiple: (tradeData as { r_multiple?: string }).r_multiple?.trim() ? Number((tradeData as { r_multiple?: string }).r_multiple) : null,
            tradeOrder: i,
          });
        } else {
          const newTradeId = await invoke<number>("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: normalizeRichTextHtml(tradeData.what_went_well || "") || null,
            whatCouldBeImproved: normalizeRichTextHtml(tradeData.what_could_be_improved || "") || null,
            emotionalState: normalizeRichTextHtml(tradeData.emotional_state || "") || null,
            notes: normalizeRichTextHtml(tradeData.notes || "") || null,
            outcome: tradeData.outcome || null,
            rMultiple: (tradeData as { r_multiple?: string }).r_multiple?.trim() ? Number((tradeData as { r_multiple?: string }).r_multiple) : null,
            tradeOrder: i,
          });
          tradeIdsInOrder.push(newTradeId);
        }
      }

      // Save checklist responses
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean, string | null, number | null][] = [];
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(item.checklist_type || "");
              const isSurvey = (item.checklist_type || "") === "survey";
              if (isEntryLevel) {
                const isChecked = entryLevelChecklistResponses.get(item.id) || false;
                let journalTradeIds: string | null = null;
                const assoc = checklistTradeAssociations.get(item.id);
                if (assoc && assoc.length > 0) {
                  const ids = assoc.every(n => n >= 0 && n < tradeIdsInOrder.length)
                    ? assoc.map(idx => tradeIdsInOrder[idx]).filter(Boolean)
                    : assoc.filter(id => tradeIdsInOrder.includes(id));
                  if (ids.length > 0) journalTradeIds = JSON.stringify(ids);
                }
                responses.push([item.id, isChecked, journalTradeIds, null]);
              } else {
                for (let tradeIndex = 0; tradeIndex < tradeIdsInOrder.length; tradeIndex++) {
                  const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
                  const isChecked = tradeResponses.get(item.id) || false;
                  const jtId = tradeIdsInOrder[tradeIndex];
                  const journalTradeIds = jtId != null ? JSON.stringify([jtId]) : null;
                  const responseValue = isSurvey ? (surveyScores.get(tradeIndex)?.get(item.id) ?? null) : null;
                  responses.push([item.id, isChecked, journalTradeIds, responseValue]);
                }
              }
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      // Link emotional states with scope (after trades so we have trade IDs)
      const stateIdsToLinkAfterTrades = isCreating ? (entryFormData.linked_emotional_state_ids ?? []) : toAdd;
      if (stateIdsToLinkAfterTrades.length > 0) {
        if (isCreating) {
          await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: stateIdsToLinkAfterTrades });
        }
        for (const stateId of stateIdsToLinkAfterTrades) {
          const scope = entryFormData.linked_emotional_state_link_scopes?.[stateId];
          const jtId = scope?.scope === "trades" && scope.tradeIndex != null ? (tradeIdsInOrder[scope.tradeIndex] ?? null) : null;
          await invoke("link_emotional_states_to_journal", {
            emotionalStateIds: [stateId],
            journalEntryId: entryId,
            journalTradeId: jtId ?? undefined,
          });
        }
      }

      // Reload trades to get updated IDs
      await loadTrades(entryId);
      await loadLinkedPairs(entryId);
    } catch (error) {
      // Silently fail for auto-save
      console.error("Auto-save error:", error);
    }
  };

  // Restore scroll position when tab becomes active
  useEffect(() => {
    if (!selectedEntry?.id) return; // Only restore if we have an entry selected
    
    const tabContent = tabContentRefs.current.get(activeTab);
    if (tabContent) {
      // First try in-memory map, then check storage
      let savedPosition = tabScrollPositions.current.get(activeTab) || 0;
      if (savedPosition === 0) {
        // Try to get from storage
        const storageKey = `journal_entry_${selectedEntry.id}`;
        const scrollState = restoreAllScrollPositions(storageKey);
        savedPosition = scrollState.tabPositions.get(activeTab) || 0;
        // Update in-memory map
        if (savedPosition > 0) {
          tabScrollPositions.current.set(activeTab, savedPosition);
        }
      }
      // Use requestAnimationFrame to ensure DOM is ready
      if (savedPosition > 0) {
        requestAnimationFrame(() => {
          const tabContent = tabContentRefs.current.get(activeTab);
          if (tabContent) {
            tabContent.scrollTop = savedPosition;
          }
        });
      }
    } else {
      // Tab content not ready yet, retry after a delay
      setTimeout(() => {
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent && selectedEntry?.id) {
          const storageKey = `journal_entry_${selectedEntry.id}`;
          const scrollState = restoreAllScrollPositions(storageKey);
          const savedPosition = scrollState.tabPositions.get(activeTab) || tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              if (tabContent) {
                tabContent.scrollTop = savedPosition;
              }
            });
          }
        }
      }, 100);
    }
  }, [activeTab, selectedEntry?.id]);

  // Restore scroll positions on mount (only if we have a selected entry)
  useEffect(() => {
    if (selectedEntry?.id) {
      const storageKey = `journal_entry_${selectedEntry.id}`;
      const scrollState = restoreAllScrollPositions(storageKey);
      // Restore tab scroll positions
      scrollState.tabPositions.forEach((pos, tab) => {
        tabScrollPositions.current.set(tab as TabType, pos);
      });
      
      // Restore left panel scroll after a delay to ensure DOM is ready
      setTimeout(() => {
        if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
          requestAnimationFrame(() => {
            if (leftPanelScrollRef.current) {
              leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
            }
          });
        }

        if (journalScrollContainerRef.current && !isTabContentMaximized) {
          const jp =
            tabScrollPositions.current.get("journal_page") ??
            scrollState.tabPositions.get("journal_page") ??
            0;
          if (jp > 0) {
            requestAnimationFrame(() => {
              if (journalScrollContainerRef.current) {
                journalScrollContainerRef.current.scrollTop = jp;
              }
            });
          }
        }
        
        // Restore active tab scroll
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent) {
          const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              tabContent.scrollTop = savedPosition;
            });
          }
        }
      }, 100);
    }
  }, [selectedEntry?.id, activeTab, isTabContentMaximized]);

  // Save left panel scroll position on scroll (re-attach when ref mounts / entry changes)
  useEffect(() => {
    const leftPanel = leftPanelScrollRef.current;
    if (!leftPanel) return;
    let debounceId: number | undefined;
    const handleScroll = () => {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        if (leftPanelScrollRef.current) {
          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
          saveJournalScrollPositionsMerged(storageKey);
        }
      }, 100);
    };
    leftPanel.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearTimeout(debounceId);
      leftPanel.removeEventListener("scroll", handleScroll);
    };
  }, [selectedEntry?.id]);

  // Scrolling page mode: persist main column scroll (not covered by per-tab refs)
  useEffect(() => {
    if (isTabContentMaximized) return;
    const el = journalScrollContainerRef.current;
    if (!el) return;
    let debounceId: number | undefined;
    const onScroll = () => {
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        if (!journalScrollContainerRef.current) return;
        tabScrollPositions.current.set("journal_page", journalScrollContainerRef.current.scrollTop);
        const storageKey = getScrollStorageKey();
        saveJournalScrollPositionsMerged(storageKey);
      }, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(debounceId);
      el.removeEventListener("scroll", onScroll);
    };
  }, [selectedEntry?.id, isTabContentMaximized, activeTradeIndex, tradesFormData.length]);

  // Debounced auto-save when form data changes
  useEffect(() => {
    if (!isCreating && !isEditing) return;
    if (!entryFormData.title.trim()) return;

    const timeoutId = setTimeout(() => {
      autoSave();
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryFormData.title, entryFormData.date, entryFormData.strategy_id]);

  const handleSave = async () => {
    isManualSaveInProgressRef.current = true;
    // Prevent any background auto-save from re-entering edit mode while we're saving.
    setJustSaved(true);
    const wasCreatingAtStart = isCreating;

    try {
      if (!entryFormData.title.trim()) {
        setShowTitleRequiredModal(true);
        return;
      }
      // Prevent saving a bloated trade list (e.g. from stale work-in-progress)
      const MAX_TRADES_PER_ENTRY = 100;
      if (tradesFormData.length > MAX_TRADES_PER_ENTRY) {
        alert(`This entry has ${tradesFormData.length} trades (max ${MAX_TRADES_PER_ENTRY}). Reload the entry from the list to fix, or remove extra trades before saving.`);
        return;
      }

      // In real/paper mode, close the editor immediately for existing entries.
      // (Closing later can feel broken if the server work for checklist/emotional states is slow.)
      if (dataMode !== "sandbox" && selectedEntry && !wasCreatingAtStart) {
        setIsCreating(false);
        setIsEditing(false);
      }

      if (dataMode === "sandbox") {
        // Keep sandbox save path lightweight but align UX with real-mode save:
        // - autosave to sandbox store
        // - refresh trades/pairs and entry list
        // - exit edit/create mode into view mode with the entry selected.
        if (!isCreating && selectedEntry) {
          const keptTradeIds = new Set(tradesFormData.filter((t) => t.id !== null).map((t) => t.id!));
          for (const trade of selectedTrades) {
            if (trade.id && !keptTradeIds.has(trade.id)) deleteSandboxJournalTrade(trade.id);
          }
        }

        // Manual save delegates to autoSave() in sandbox mode.
        // We keep the "justSaved" suppression on so background autosaves can't re-open the editor.
        await autoSave({ isManualSave: true });

        if (selectedEntry) {
          await loadTrades(selectedEntry.id);
          await loadLinkedPairs(selectedEntry.id);
        }

        // Close the edit UI as soon as core sandbox persistence finishes.
        // (loadEntries() can take longer; we don't want that to keep the editor open)
        setIsCreating(false);
        setIsEditing(false);
        setShowAddEmotionalStateForm(false);
        setPendingEmotionalStates([]);
        setJustSaved(true);
        clearWorkInProgress();
        // Don't block UI closing on list refresh; reload in background.
        loadEntries().catch((e) => console.error("Failed to reload entries after save:", e));
        return;
      }

      let entryId: number;
      let toAdd: number[] = [];

      if (wasCreatingAtStart) {
        entryId = await invoke<number>("create_journal_entry", {
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          isPaper: dataMode === "paper",
        });
        // Persist linked trades (and metadata) on the new entry
        await invoke("update_journal_entry", {
          id: entryId,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
      } else if (selectedEntry) {
        entryId = selectedEntry.id;
        await invoke("update_journal_entry", {
          id: selectedEntry.id,
          date: entryFormData.date,
          title: entryFormData.title,
          strategyId: entryFormData.strategy_id,
          linked_trade_ids: (entryFormData.linked_trade_ids?.length ?? 0) > 0 ? JSON.stringify(entryFormData.linked_trade_ids) : null,
        });
        // Sync emotional state links (add new, remove unchecked)
        const formStateIds = entryFormData.linked_emotional_state_ids ?? [];
        const currentGroupIds = groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].id);
        const toRemove = currentGroupIds.filter((id) => !formStateIds.includes(id));
        toAdd = formStateIds.filter((id) => !currentGroupIds.includes(id));
        if (toRemove.length > 0) await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: entryId, emotionalStateIds: toRemove });
        if (toAdd.length > 0) await invoke("add_journal_entry_to_emotional_states", { journalEntryId: entryId, emotionalStateIds: toAdd });
        
        // Get IDs of trades that should be kept
        const keptTradeIds = new Set(tradesFormData.filter(t => t.id !== null).map(t => t.id!));
        
        // Delete trades that are no longer in the form
        for (const trade of selectedTrades) {
          if (trade.id && !keptTradeIds.has(trade.id)) {
            await invoke("delete_journal_trade", { id: trade.id });
          }
        }
      } else {
        return;
      }

      // Save all trades and collect trade IDs for checklist associations
      const tradeIdsInOrder: number[] = [];
      for (let i = 0; i < tradesFormData.length; i++) {
        const tradeData = tradesFormData[i];
        if (tradeData.id) {
          tradeIdsInOrder.push(tradeData.id);
          await invoke("update_journal_trade", {
            id: tradeData.id,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: normalizeRichTextHtml(tradeData.what_went_well || "") || null,
            whatCouldBeImproved: normalizeRichTextHtml(tradeData.what_could_be_improved || "") || null,
            emotionalState: normalizeRichTextHtml(tradeData.emotional_state || "") || null,
            notes: normalizeRichTextHtml(tradeData.notes || "") || null,
            outcome: tradeData.outcome || null,
            rMultiple: (tradeData as { r_multiple?: string }).r_multiple?.trim() ? Number((tradeData as { r_multiple?: string }).r_multiple) : null,
            tradeOrder: i,
          });
        } else {
          const newTradeId = await invoke<number>("create_journal_trade", {
            journalEntryId: entryId,
            symbol: tradeData.symbol || null,
            position: tradeData.position || null,
            timeframe: tradeData.timeframe || null,
            entryType: tradeData.entry_type || null,
            exitType: tradeData.exit_type || null,
            trade: tradeData.trade || null,
            whatWentWell: normalizeRichTextHtml(tradeData.what_went_well || "") || null,
            whatCouldBeImproved: normalizeRichTextHtml(tradeData.what_could_be_improved || "") || null,
            emotionalState: normalizeRichTextHtml(tradeData.emotional_state || "") || null,
            notes: normalizeRichTextHtml(tradeData.notes || "") || null,
            outcome: tradeData.outcome || null,
            rMultiple: (tradeData as { r_multiple?: string }).r_multiple?.trim() ? Number((tradeData as { r_multiple?: string }).r_multiple) : null,
            tradeOrder: i,
          });
          tradeIdsInOrder.push(newTradeId);
        }
      }

      // Save checklist responses
      if (entryFormData.strategy_id) {
        const checklists = strategyChecklists.get(entryFormData.strategy_id);
        if (checklists) {
          const responses: [number, boolean, string | null, number | null][] = [];
          for (const [, items] of checklists.entries()) {
            for (const item of items) {
              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(item.checklist_type || "");
              const isSurvey = (item.checklist_type || "") === "survey";
              if (isEntryLevel) {
                const isChecked = entryLevelChecklistResponses.get(item.id) || false;
                let journalTradeIds: string | null = null;
                const assoc = checklistTradeAssociations.get(item.id);
                if (assoc && assoc.length > 0) {
                  const ids = assoc.every(n => n >= 0 && n < tradeIdsInOrder.length)
                    ? assoc.map(idx => tradeIdsInOrder[idx]).filter(Boolean)
                    : assoc.filter(id => tradeIdsInOrder.includes(id));
                  if (ids.length > 0) journalTradeIds = JSON.stringify(ids);
                }
                responses.push([item.id, isChecked, journalTradeIds, null]);
              } else {
                for (let tradeIndex = 0; tradeIndex < tradeIdsInOrder.length; tradeIndex++) {
                  const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
                  const isChecked = tradeResponses.get(item.id) || false;
                  const jtId = tradeIdsInOrder[tradeIndex];
                  const journalTradeIds = jtId != null ? JSON.stringify([jtId]) : null;
                  const responseValue = isSurvey ? (surveyScores.get(tradeIndex)?.get(item.id) ?? null) : null;
                  responses.push([item.id, isChecked, journalTradeIds, responseValue]);
                }
              }
            }
          }
          await invoke("save_journal_checklist_responses", {
            journalEntryId: entryId,
            responses: responses,
          });
        }
      }

      // Exit edit UI immediately after core journal/trade + checklist persistence.
      // Emotional-state and other follow-up saves can take longer, and the user
      // expects the journal edit panel to close right away (like demo mode).
      setIsCreating(false);
      setIsEditing(false);
      setEditHistory([]);
      setOriginalEntryData(null);
      setJustSaved(true);
      clearWorkInProgress();

      // Persist emotional states: pending list + any form-in-progress (one state per trade or one for entire entry)
      const toPersist: Array<{ tradeIndex: number; selectedEmotions: Record<string, number>; notes: string; surveyResponses?: Record<string, number> }> = [...pendingEmotionalStates];
      const hasFormContent = Object.keys(newEmotionalStateForm.selectedEmotions).length > 0 || (newEmotionalStateForm.notes || "").trim() !== "";
      if (showAddEmotionalStateForm && hasFormContent) {
        if (newEmotionalStateLinkScope === "entry") {
          toPersist.push({ tradeIndex: -1, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: { ...newEmotionalStateSurveyResponses } });
        } else {
          for (const i of newEmotionalStateTradeIndices) {
            toPersist.push({ tradeIndex: i, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: { ...newEmotionalStateSurveyResponses } });
          }
        }
      }
      const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
      const allStatesForEntry = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId, ...paperArgs });
      const deleteGroup = async (group: JournalEmotionalState[]) => {
        for (const s of group) await invoke("delete_emotional_state", { id: s.id });
      };
      const now = new Date().toISOString();
      for (const pending of toPersist) {
        try {
          let firstStateId: number | null = null;
          if (pending.tradeIndex === -1) {
            const entryLevel = allStatesForEntry.filter((s) => s.journal_trade_id == null);
            const groups = groupEmotionalStatesByTimestamp(entryLevel);
            for (const g of groups) await deleteGroup(g);
            for (const emotion of Object.keys(pending.selectedEmotions)) {
              const stateId = await invoke<number>("add_emotional_state", {
                timestamp: now,
                emotion,
                intensity: pending.selectedEmotions[emotion],
                notes: pending.notes || null,
                tradeId: null,
                journalEntryId: entryId,
                journalTradeId: null,
                isPaper: dataMode === "paper",
              });
              if (firstStateId === null) firstStateId = stateId;
            }
          } else {
            const journalTradeId = tradeIdsInOrder[pending.tradeIndex];
            if (journalTradeId != null) {
              const forTrade = allStatesForEntry.filter((s) => s.journal_trade_id === journalTradeId);
              const groups = groupEmotionalStatesByTimestamp(forTrade);
              for (const g of groups) await deleteGroup(g);
              for (const emotion of Object.keys(pending.selectedEmotions)) {
                const stateId = await invoke<number>("add_emotional_state", {
                  timestamp: now,
                  emotion,
                  intensity: pending.selectedEmotions[emotion],
                  notes: pending.notes || null,
                  tradeId: null,
                  journalEntryId: entryId,
                  journalTradeId,
                  isPaper: dataMode === "paper",
                });
                if (firstStateId === null) firstStateId = stateId;
              }
            }
          }
          const sr = pending.surveyResponses ?? {};
          const shouldSaveSurvey = firstStateId != null && Object.values(JOURNAL_SURVEY_QUESTIONS).flat().some((q) => (sr[q.key] ?? 6) !== 6);
          if (shouldSaveSurvey && firstStateId != null) {
            try {
              await invoke("add_emotion_survey", {
                emotional_state_id: firstStateId,
                timestamp: now,
                before_calm_clear: sr.before_calm_clear ?? 6,
                before_urgency_pressure: sr.before_urgency_pressure ?? 6,
                before_confidence_vs_validation: sr.before_confidence_vs_validation ?? 6,
                before_fomo: sr.before_fomo ?? 6,
                before_recovering_loss: sr.before_recovering_loss ?? 6,
                before_patient_detached: sr.before_patient_detached ?? 6,
                before_trust_process: sr.before_trust_process ?? 6,
                before_emotional_state: sr.before_emotional_state ?? 6,
                during_stable: sr.during_stable ?? 6,
                during_tension_stress: sr.during_tension_stress ?? 6,
                during_tempted_interfere: sr.during_tempted_interfere ?? 6,
                during_need_control: sr.during_need_control ?? 6,
                during_fear_loss: sr.during_fear_loss ?? 6,
                during_excitement_greed: sr.during_excitement_greed ?? 6,
                during_mentally_present: sr.during_mentally_present ?? 6,
                after_accept_outcome: sr.after_accept_outcome ?? 6,
                after_emotional_reaction: sr.after_emotional_reaction ?? 6,
                after_confidence_affected: sr.after_confidence_affected ?? 6,
                after_tempted_another_trade: sr.after_tempted_another_trade ?? 6,
                after_proud_discipline: sr.after_proud_discipline ?? 6,
              });
            } catch (e) {
              console.error(e);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
      if (toPersist.length > 0) {
        setShowAddEmotionalStateForm(false);
        setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
        setNewEmotionalStateLinkScope("entry");
        setNewEmotionalStateTradeIndices([]);
        setPendingEmotionalStates([]);
      }

      await loadEntries();

      // Reload the saved entry from the server so we have a single source of truth, then switch to read-only
      await loadEntry(entryId);
      
      // Reload the saved entry
      const savedEntry = await invoke<JournalEntry>("get_journal_entry", { id: entryId });
      setSelectedEntry(savedEntry);
      try {
        await loadTrades(entryId);
        await loadLinkedPairs(entryId);
      } catch (refreshErr) {
        console.error("Post-save refresh failed:", refreshErr);
      }
    } catch (error) {
      console.error("Error saving entry:", error);
      alert("Failed to save entry: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      isManualSaveInProgressRef.current = false;
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setIsEditing(false);
    setJustSaved(false);
    setEditHistory([]);
    setOriginalEntryData(null);
    setJournalTradeActualTradeIds(new Map());
    setLinkActualTradesModalJournalTradeId(null);
    setPendingEmotionalStates([]);
    clearWorkInProgress();
    if (selectedEntry) {
      // Reload the entry to reset form
      loadEntry(selectedEntry.id);
    } else {
      // Reset form if creating
      setEntryFormData({
        date: format(new Date(), "yyyy-MM-dd"),
        title: "",
        strategy_id: null,
        linked_trade_ids: [],
        linked_emotional_state_ids: [],
        linked_emotional_state_link_scopes: {},
      });
      setTradesFormData([{
        id: null,
        symbol: "",
        position: "",
        timeframe: "",
        entry_type: "",
        exit_type: "",
        trade: "",
        what_went_well: "",
        what_could_be_improved: "",
        emotional_state: "",
        notes: "",
        outcome: "Positive",
        trade_order: 0,
      }]);
      setChecklistResponses(new Map());
    }
  };

  const handleUndo = () => {
    if (editHistory.length <= 1) return; // Can't undo if we're at the initial state
    
    // Remove the last state and restore the previous one
    const newHistory = [...editHistory];
    newHistory.pop(); // Remove current state
    const previousState = newHistory[newHistory.length - 1]; // Get previous state
    
    setEditHistory(newHistory);
    setEntryFormData({
      date: previousState.entry.date,
      title: previousState.entry.title,
      strategy_id: previousState.entry.strategy_id,
      linked_trade_ids: entryFormData.linked_trade_ids ?? [],
      linked_emotional_state_ids: entryFormData.linked_emotional_state_ids ?? [],
      linked_emotional_state_link_scopes: entryFormData.linked_emotional_state_link_scopes ?? {},
    });
    
    // Deep copy trades
    const restoredTrades = previousState.trades.map(t => ({ ...t }));
    setTradesFormData(restoredTrades);
    
    // Deep copy checklist responses
    const restoredResponses = new Map<number, Map<number, boolean>>();
    for (const [tradeIndex, responses] of previousState.checklistResponses.entries()) {
      restoredResponses.set(tradeIndex, new Map(responses));
    }
    setChecklistResponses(restoredResponses);
  };

  const loadEntry = async (id: number, options?: { skipTradesFormDataSync?: boolean; restoredTradesCount?: number; openTradeId?: number }) => {
    try {
      if (dataMode === "sandbox") {
        const entry = getSandboxJournalEntry(id) as unknown as JournalEntry | null;
        if (!entry) return;
        setSelectedEntry(entry);
        let linkedTradeIds: number[] = [];
        if (entry.linked_trade_ids) {
          try {
            const parsed = JSON.parse(entry.linked_trade_ids) as number[];
            if (Array.isArray(parsed)) linkedTradeIds = parsed;
          } catch { /* ignore */ }
        }
        setEntryFormData((prev) => ({ ...prev, date: entry.date, title: entry.title, strategy_id: entry.strategy_id, linked_trade_ids: linkedTradeIds }));
        localStorage.setItem(`journal_selected_entry_id_${dataMode}`, id.toString());
        const loadedTrades = await loadTrades(id);
        if (options?.openTradeId != null && loadedTrades.length > 0) {
          const idx = loadedTrades.findIndex((t) => t.id === options.openTradeId);
          if (idx >= 0) setActiveTradeIndex(idx);
        }
        await loadLinkedPairs(id);
        const shouldSyncTrades = !options?.skipTradesFormDataSync || (options?.restoredTradesCount != null && loadedTrades.length < options.restoredTradesCount);
        if (shouldSyncTrades) {
          setTradesFormData(loadedTrades.map((t, i) => ({
            id: t.id,
            symbol: t.symbol ?? "",
            position: t.position ?? "",
            timeframe: t.timeframe ?? "",
            entry_type: t.entry_type ?? "",
            exit_type: t.exit_type ?? "",
            trade: t.trade ?? "",
            what_went_well: t.what_went_well ?? "",
            what_could_be_improved: t.what_could_be_improved ?? "",
            emotional_state: t.emotional_state ?? "",
            notes: t.notes ?? "",
            outcome: t.outcome ?? "Positive",
            trade_order: i,
          })));
        }
        return;
      }
      const entry = await invoke<JournalEntry>("get_journal_entry", { id });
      setSelectedEntry(entry);
      let linkedTradeIds: number[] = [];
      if (entry.linked_trade_ids) {
        try {
          const parsed = JSON.parse(entry.linked_trade_ids) as number[];
          if (Array.isArray(parsed)) linkedTradeIds = parsed;
        } catch {
          /* ignore */
        }
      }
      setEntryFormData((prev) => ({
        ...prev,
        date: entry.date,
        title: entry.title,
        strategy_id: entry.strategy_id,
        linked_trade_ids: linkedTradeIds,
      }));
      // Save selected entry ID to localStorage (per mode)
      localStorage.setItem(`journal_selected_entry_id_${dataMode}`, id.toString());
      const loadedTrades = await loadTrades(id);
      if (options?.openTradeId != null && loadedTrades.length > 0) {
        const idx = loadedTrades.findIndex((t) => t.id === options.openTradeId);
        if (idx >= 0) setActiveTradeIndex(idx);
      }
      // Sync trades from DB when: (1) not skipping sync, or (2) we're restoring but saved state was bloated (DB has fewer trades)
      const shouldSyncTrades = !options?.skipTradesFormDataSync ||
        (options?.restoredTradesCount != null && loadedTrades.length < options.restoredTradesCount);
      if (shouldSyncTrades) {
        const MAX_TRADES_PER_ENTRY = 100;
        const tradesToUse = loadedTrades.length > MAX_TRADES_PER_ENTRY
          ? loadedTrades.slice(0, MAX_TRADES_PER_ENTRY)
          : loadedTrades;
        if (loadedTrades.length > MAX_TRADES_PER_ENTRY) {
          setTimeout(() => alert(`This entry had ${loadedTrades.length} trades (max ${MAX_TRADES_PER_ENTRY}). Showing first ${MAX_TRADES_PER_ENTRY}. Save to remove the extra ${loadedTrades.length - MAX_TRADES_PER_ENTRY} from the database.`), 100);
        }
        type TradeFormItem = { id: number | null; symbol: string; position: string; timeframe: string; entry_type: string; exit_type: string; trade: string; what_went_well: string; what_could_be_improved: string; emotional_state: string; notes: string; outcome: string; r_multiple: string; trade_order: number };
        const tradesData: TradeFormItem[] = tradesToUse.map((trade: JournalTrade) => ({
          id: trade.id,
          symbol: trade.symbol || "",
          position: trade.position || "",
          timeframe: trade.timeframe || "",
          entry_type: trade.entry_type || "",
          exit_type: trade.exit_type || "",
          trade: trade.trade || "",
          what_went_well: trade.what_went_well || "",
          what_could_be_improved: trade.what_could_be_improved || "",
          emotional_state: trade.emotional_state || "",
          notes: trade.notes || "",
          outcome: trade.outcome || "None",
          r_multiple: trade.r_multiple != null ? String(trade.r_multiple) : "",
          trade_order: trade.trade_order ?? 0,
        }));
        if (tradesData.length === 0) {
          tradesData.push({
            id: null as number | null,
            symbol: "",
            position: "",
            timeframe: "",
            entry_type: "",
            exit_type: "",
            trade: "",
            what_went_well: "",
            what_could_be_improved: "",
            emotional_state: "",
            notes: "",
            outcome: "None",
            r_multiple: "",
            trade_order: 0,
          });
        }
        setTradesFormData(tradesData);
        setActiveTradeIndex(0);
      }
      await loadTrades(id);
      await loadLinkedPairs(id);
      if (entry.strategy_id) {
        await loadStrategyChecklists(entry.strategy_id);
        await loadChecklistResponses(id, entry.strategy_id);
      }
      
      // Restore scroll positions after entry is loaded (entry-specific)
      // Use multiple attempts to ensure DOM is ready
      const restoreScroll = (attempt = 0) => {
        const storageKey = `journal_entry_${id}`;
        const scrollState = restoreAllScrollPositions(storageKey);
        // Restore tab scroll positions to the ref
        scrollState.tabPositions.forEach((pos, tab) => {
          tabScrollPositions.current.set(tab as TabType, pos);
        });
        // Restore left panel scroll
        if (leftPanelScrollRef.current && scrollState.leftPanelScroll !== null) {
          requestAnimationFrame(() => {
            if (leftPanelScrollRef.current) {
              leftPanelScrollRef.current.scrollTop = scrollState.leftPanelScroll!;
            }
          });
        }
        if (journalScrollContainerRef.current && !isTabContentMaximized) {
          const jp =
            tabScrollPositions.current.get("journal_page") ??
            scrollState.tabPositions.get("journal_page") ??
            0;
          if (jp > 0) {
            requestAnimationFrame(() => {
              if (journalScrollContainerRef.current) {
                journalScrollContainerRef.current.scrollTop = jp;
              }
            });
          }
        }
        // Restore active tab scroll - try multiple times if tab content not ready
        const tabContent = tabContentRefs.current.get(activeTab);
        if (tabContent) {
          const savedPosition = tabScrollPositions.current.get(activeTab) || 0;
          if (savedPosition > 0) {
            requestAnimationFrame(() => {
              if (tabContent) {
                tabContent.scrollTop = savedPosition;
              }
            });
          }
        } else if (attempt < 5) {
          // Retry if tab content not ready yet
          setTimeout(() => restoreScroll(attempt + 1), 100);
        }
      };
      
      setTimeout(() => restoreScroll(), 200);
    } catch (error) {
      console.error("Error loading entry:", error);
      setPendingRestoreEntryId(null);
      setSelectedEntry(null);
    }
  };

  const updateTradeFormData = (index: number, field: string, value: any) => {
    const newTrades = [...tradesFormData];
    newTrades[index] = { ...newTrades[index], [field]: value };
    setTradesFormData(newTrades);

    // Include trade-level edits in undo history (e.g., Implementation rich text),
    // so undo restores the latest typed state instead of stale snapshots.
    if (isEditing) {
      const currentState = {
        entry: { ...entryFormData },
        trades: newTrades.map(t => ({ ...t })),
        checklistResponses: new Map(checklistResponses),
      };
      setEditHistory(prev => [...prev, currentState].slice(-10));
    }
  };

  const toggleChecklistItem = (tradeIndex: number, itemId: number) => {
    setChecklistResponses(prev => {
      const newMap = new Map(prev);
      const tradeResponses = new Map(newMap.get(tradeIndex) || new Map());
      const current = tradeResponses.get(itemId) || false;
      tradeResponses.set(itemId, !current);
      newMap.set(tradeIndex, tradeResponses);
      return newMap;
    });
  };

  const toggleEntryLevelChecklistItem = (itemId: number) => {
    setEntryLevelChecklistResponses(prev => {
      const newMap = new Map(prev);
      newMap.set(itemId, !(prev.get(itemId) || false));
      return newMap;
    });
  };

  const setChecklistTradeAssociation = (itemId: number, tradeIds: number[] | null) => {
    setChecklistTradeAssociations(prev => new Map(prev).set(itemId, tradeIds));
    setTradeAssociationModalItemId(null);
  };

  const getChecklistTitle = (type: string): string => {
    const strategyId = entryFormData.strategy_id;
    if (strategyId) {
      try {
        const raw = localStorage.getItem("tradebutler_checklist_titles");
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
          const titles = parsed[String(strategyId)];
          if (titles?.[type]?.trim()) return titles[type].trim();
        }
      } catch {
        /* use default */
      }
    }
    const titleMap: Record<string, string> = {
      "daily_mantra": "Mantra",
      "daily_analysis": "Analysis",
      "entry": "Entry Checklist",
      "take_profit": "Take Profit Checklist",
      "survey": "Survey",
    };
    return titleMap[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + " Checklist";
  };

  const getSectionLabel = (sectionId: string): string => {
    if (JOURNAL_SECTION_LABELS[sectionId as JournalSectionId]) return JOURNAL_SECTION_LABELS[sectionId as JournalSectionId];
    if (sectionId.startsWith("custom:")) return getChecklistTitle(sectionId.slice(7));
    if (sectionId.startsWith("custom_rules:")) {
      const ruleSetId = sectionId.slice("custom_rules:".length);
      if (!entryFormData.strategy_id) return "Custom Rules";
      try {
        return loadStrategyCustomRuleSets(dataMode, entryFormData.strategy_id).find((s) => s.id === ruleSetId)?.title ?? "Custom Rules";
      } catch {
        return "Custom Rules";
      }
    }
    return sectionId;
  };

  const getSectionLabelScroll = (sectionId: string): string => {
    if (JOURNAL_SECTION_LABELS_SCROLL[sectionId as JournalSectionId]) return JOURNAL_SECTION_LABELS_SCROLL[sectionId as JournalSectionId];
    if (sectionId.startsWith("custom:")) return getChecklistTitle(sectionId.slice(7));
    if (sectionId.startsWith("custom_rules:")) {
      const ruleSetId = sectionId.slice("custom_rules:".length);
      if (!entryFormData.strategy_id) return "Custom Rules";
      try {
        return loadStrategyCustomRuleSets(dataMode, entryFormData.strategy_id).find((s) => s.id === ruleSetId)?.title ?? "Custom Rules";
      } catch {
        return "Custom Rules";
      }
    }
    return sectionId;
  };

  const calculateEntryProbability = (tradeIndex: number): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const entryItems = checklists.get("entry") || [];
    if (entryItems.length === 0) return 0;

    const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = entryItems.filter(item => !item.parent_id && !entryItems.some(child => child.parent_id === item.id));
    const groupedItems = entryItems.filter(item => item.parent_id !== null && entryItems.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    let checked = 0;
    // Count checked regular items
    for (const item of regularItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }
    // Count checked grouped items (children)
    for (const item of groupedItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const calculateTakeProfitImplementation = (tradeIndex: number): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const takeProfitItems = checklists.get("take_profit") || [];
    if (takeProfitItems.length === 0) return 0;

    const tradeResponses = checklistResponses.get(tradeIndex) || new Map();
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = takeProfitItems.filter(item => !item.parent_id && !takeProfitItems.some(child => child.parent_id === item.id));
    const groupedItems = takeProfitItems.filter(item => item.parent_id !== null && takeProfitItems.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    let checked = 0;
    // Count checked regular items
    for (const item of regularItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }
    // Count checked grouped items (children)
    for (const item of groupedItems) {
      if (tradeResponses.get(item.id)) {
        checked++;
      }
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const calculateChecklistProgress = (tradeIndex: number, checklistType: string): number => {
    if (!entryFormData.strategy_id) return 0;
    const checklists = strategyChecklists.get(entryFormData.strategy_id);
    if (!checklists) return 0;

    const items = checklists.get(checklistType) || [];
    if (items.length === 0) return 0;

    const isEntryLevelType = ENTRY_LEVEL_CHECKLIST_TYPES.includes(checklistType);
    const tradeResponses = isEntryLevelType
      ? entryLevelChecklistResponses
      : (checklistResponses.get(tradeIndex) || new Map());
    const entryTradesHere = selectedEntry ? selectedTrades : tradesFormData;
    const tradeKey = selectedEntry && entryTradesHere[tradeIndex] && (entryTradesHere[tradeIndex] as { id?: number }).id != null
      ? (entryTradesHere[tradeIndex] as { id: number }).id
      : (entryTradesHere.length > tradeIndex ? tradeIndex : undefined);
    const entryLevelAppliesHere = (itemId: number) => {
      const assoc = checklistTradeAssociations.get(itemId);
      if (!assoc || assoc.length === 0) return true;
      return tradeKey !== undefined && assoc.includes(tradeKey);
    };
    
    // Count checkable items the same way they're rendered:
    // - Regular items (no parent_id, not a group header)
    // - Child items (has parent_id)
    // Exclude group headers (items that have children)
    const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
    const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
    
    // Total checkable items = regular items + grouped items (children)
    const totalCheckable = regularItems.length + groupedItems.length;
    
    if (totalCheckable === 0) return 0;

    const isCheckedHere = (itemId: number) =>
      isEntryLevelType
        ? (tradeResponses.get(itemId) || false) && entryLevelAppliesHere(itemId)
        : (tradeResponses.get(itemId) || false);
    let checked = 0;
    for (const item of regularItems) {
      if (isCheckedHere(item.id)) checked++;
    }
    for (const item of groupedItems) {
      if (isCheckedHere(item.id)) checked++;
    }

    const percentage = (checked / totalCheckable) * 100;
    return Math.round(percentage);
  };

  const currentTrade = tradesFormData[activeTradeIndex];
  // Only show emotional states that are linked to the current journal trade (not other trades).
  const emotionalStatesForCurrentTrade = useMemo(
    () => (currentTrade?.id != null ? journalEmotionalStates.filter((s) => s.journal_trade_id === currentTrade.id) : []),
    [journalEmotionalStates, currentTrade?.id]
  );
  const currentChecklists = entryFormData.strategy_id ? strategyChecklists.get(entryFormData.strategy_id) : null;
  // Trades that belong to this journal entry only (for Associate modal). When editing, use tradesFormData (set from loaded trades in handleEdit) so we always show the correct 7; when viewing, use selectedTrades.
  const entryTradesForAssociation = selectedEntry && !isEditing ? selectedTrades : tradesFormData;
  const defaultTypes = ["daily_analysis", "entry", "take_profit"];
  const customTypes = currentChecklists 
    ? Array.from(currentChecklists.keys()).filter(t => !defaultTypes.includes(t) && t !== "survey")
    : [];
  // Use same order as Strategies page (from localStorage) so Journal checklists match strategy arrangement
  const CHECKLIST_TYPE_ORDER_KEY = "tradebutler_checklist_type_order";
  const allTypes = (() => {
    const strategyId = entryFormData.strategy_id;
    if (!strategyId) return [...defaultTypes, ...customTypes.filter(t => !defaultTypes.includes(t))];
    let savedOrder: string[] | null = null;
    try {
      const raw = localStorage.getItem(CHECKLIST_TYPE_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string[]>;
        savedOrder = parsed[String(strategyId)] ?? null;
      }
    } catch {
      savedOrder = null;
    }
    const allNeeded = new Set([...defaultTypes, ...customTypes]);
    if (!savedOrder || savedOrder.length === 0) {
      return [...defaultTypes, ...customTypes.filter(t => !defaultTypes.includes(t))];
    }
    const ordered = savedOrder.filter((t: string) => allNeeded.has(t));
    const appended = [...allNeeded].filter(t => !ordered.includes(t));
    return [...ordered, ...appended];
  })();

  const fullSectionOrder = useMemo(() => {
    const base = journalSectionOrder.filter((id) => id !== "custom_checklists_surveys");
    const surveyItems = (currentChecklists?.get("survey") || []).filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
    const customRuleSectionIds = entryFormData.strategy_id
      ? loadStrategyCustomRuleSets(dataMode, entryFormData.strategy_id).map((s) => `custom_rules:${s.id}`)
      : [];
    const customSectionIds = [
      ...customTypes.map((t) => `custom:${t}`),
      ...customRuleSectionIds,
      ...(surveyItems.length > 0 ? ["custom:survey"] : []),
    ];
    const newCustom = customSectionIds.filter((id) => !base.includes(id));
    return [...base, ...newCustom];
  }, [journalSectionOrder, customTypes, currentChecklists, dataMode, entryFormData.strategy_id]);

  const effectiveSectionOrder = useMemo(
    () => fullSectionOrder.filter((id) => !hiddenSectionIds.includes(id)),
    [fullSectionOrder, hiddenSectionIds]
  );

  const handleSectionOrderDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fullSectionOrder.indexOf(active.id as string);
    const newIndex = fullSectionOrder.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    setJournalSectionOrder(arrayMove(fullSectionOrder, oldIndex, newIndex));
  }, [fullSectionOrder]);

  /** Render checklist UI for a single type (used in scrolling sections). */
  const renderChecklistForType = (type: string) => {
    if (!entryFormData.strategy_id || !currentChecklists) return <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Select a strategy to load checklists.</p>;
    const rawItems = currentChecklists.get(type) || [];
    const items = rawItems.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
    if (items.length === 0) return <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No items for this checklist.</p>;
    const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(type);
    const responses = isEntryLevel ? entryLevelChecklistResponses : (checklistResponses.get(activeTradeIndex) || new Map());
    const getChecked = (id: number) => responses.get(id) || false;
    const onToggle = isEntryLevel ? (id: number) => toggleEntryLevelChecklistItem(id) : (id: number) => toggleChecklistItem(activeTradeIndex, id);
    const groups = items.filter(item => !item.parent_id && items.some(child => child.parent_id === item.id));
    const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
    const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
    const itemsByParent = new Map<number, ChecklistItem[]>();
    groupedItems.forEach(item => { if (item.parent_id) { const parentId = item.parent_id; if (!itemsByParent.has(parentId)) itemsByParent.set(parentId, []); itemsByParent.get(parentId)!.push(item); } });
    return (
      <div style={{ marginBottom: "4px" }}>
        {groups.map((group) => {
          const children = itemsByParent.get(group.id) || [];
          return (
            <div key={group.id} style={{ marginBottom: "12px" }}>
              <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", marginBottom: "6px", fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>{group.item_text}</div>
              {children.map((child) => (
                <div key={child.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", marginLeft: "16px", marginBottom: "2px" }}>
                  <input type="checkbox" checked={getChecked(child.id)} onChange={() => onToggle(child.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                  <label style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(child.id)}>{child.item_text}</label>
                  {isEntryLevel && entryTradesForAssociation.length > 1 && (
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{!(checklistTradeAssociations.get(child.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(child.id)!.length} trade(s)`}</span>
                      <button type="button" onClick={() => setTradeAssociationModalItemId(child.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "2px", display: "flex" }} title="Associate with specific trades"><Link2 size={12} /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {regularItems.map((item) => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", marginBottom: "2px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
            <input type="checkbox" checked={getChecked(item.id)} onChange={() => onToggle(item.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
            <label style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(item.id)}>{item.item_text}</label>
            {isEntryLevel && entryTradesForAssociation.length > 1 && (
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{!(checklistTradeAssociations.get(item.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(item.id)!.length} trade(s)`}</span>
                <button type="button" onClick={() => setTradeAssociationModalItemId(item.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "2px", display: "flex" }} title="Associate with specific trades"><Link2 size={12} /></button>
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  /** Read-only checklist rendering (for view-mode trade cards). */
  const renderChecklistReadOnlyForType = (type: string, tradeIndexForResponses: number) => {
    if (!currentChecklists) return null;
    const rawItems = currentChecklists.get(type) || [];
    const items = rawItems.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
    if (items.length === 0) return null;

    const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(type);
    const isSurveyType = type === "survey";
    const responses = isEntryLevel ? entryLevelChecklistResponses : checklistResponses.get(tradeIndexForResponses) || new Map();
    const scoreMap = surveyScores.get(tradeIndexForResponses) || new Map<number, number>();
    const getChecked = (id: number) => responses.get(id) || false;
    const getScore = (id: number) => scoreMap.get(id);

    const groups = items.filter((item) => !item.parent_id && items.some((child) => child.parent_id === item.id));
    const regularItems = items.filter((item) => !item.parent_id && !items.some((child) => child.parent_id === item.id));
    const groupedItems = items.filter((item) => item.parent_id !== null && items.some((p) => p.id === item.parent_id));
    const itemsByParent = new Map<number, ChecklistItem[]>();
    groupedItems.forEach((item) => {
      if (item.parent_id == null) return;
      const parentId = item.parent_id;
      if (!itemsByParent.has(parentId)) itemsByParent.set(parentId, []);
      itemsByParent.get(parentId)!.push(item);
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {groups.map((group) => {
          const children = itemsByParent.get(group.id) || [];
          return (
            <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 6, fontWeight: 600, color: "var(--text-primary)", fontSize: 13 }}>
                {group.item_text}
              </div>
              {children.map((child) => (
                <div key={child.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", marginLeft: 16 }}>
                  <input type="checkbox" checked={getChecked(child.id)} disabled style={{ cursor: "default", width: 16, height: 16 }} />
                  <label style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>{child.item_text}</label>
                  {isSurveyType && (
                    <span
                      style={{
                        flexShrink: 0,
                        minWidth: "28px",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        backgroundColor: getScore(child.id) != null ? getSurveyScoreBgRgba(getScore(child.id) as number) : "var(--bg-tertiary)",
                        color: getScore(child.id) != null ? getSurveyScoreColor(getScore(child.id) as number) : "var(--text-secondary)",
                        fontSize: "12px",
                        fontWeight: "500",
                        textAlign: "center",
                      }}
                    >
                      {getScore(child.id) != null ? getScore(child.id) : "—"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}

        {regularItems.map((item) => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
            <input type="checkbox" checked={getChecked(item.id)} disabled style={{ cursor: "default", width: 16, height: 16 }} />
            <label style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>{item.item_text}</label>
            {isSurveyType && (
              <span
                style={{
                  flexShrink: 0,
                  minWidth: "28px",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: getScore(item.id) != null ? getSurveyScoreBgRgba(getScore(item.id) as number) : "var(--bg-tertiary)",
                  color: getScore(item.id) != null ? getSurveyScoreColor(getScore(item.id) as number) : "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: "500",
                  textAlign: "center",
                }}
              >
                {getScore(item.id) != null ? getScore(item.id) : "—"}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  const TradePatternsPicker = ({
    phase,
    entryId,
    tradeIndex,
    canEdit,
    alignButtonRight,
  }: {
    phase: IndicatorPhase;
    entryId: number;
    tradeIndex: number;
    canEdit: boolean;
    alignButtonRight?: boolean;
  }) => {
    const [open, setOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>(() => loadJournalTradePatternIndicatorIds(dataMode, entryId, tradeIndex, phase));
    const [showBullish, setShowBullish] = useState(true);
    const [showBearish, setShowBearish] = useState(true);
    const pickerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      setSelectedIds(loadJournalTradePatternIndicatorIds(dataMode, entryId, tradeIndex, phase));
    }, [dataMode, entryId, tradeIndex, phase]);

    useEffect(() => {
      if (!open) return;

      const onPointerDown = (e: MouseEvent | TouchEvent) => {
        const el = pickerRef.current;
        if (!el) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (!el.contains(target)) setOpen(false);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };

      document.addEventListener("mousedown", onPointerDown, { passive: true });
      document.addEventListener("touchstart", onPointerDown, { passive: true });
      document.addEventListener("keydown", onKeyDown);

      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("touchstart", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [open]);

    const allPatternIndicators = useMemo(() => {
      const all = loadIndicators();
      return all.filter((i) => i.signalGroup === "TechnicalPattern" || i.signalGroup === "Candlestick");
    }, []);

    const idToInd = useMemo(() => new Map(allPatternIndicators.map((i) => [i.id, i] as const)), [allPatternIndicators]);

    const toggle = (id: string) => {
      if (!canEdit) return;
      setSelectedIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        setJournalTradePatternIndicatorIds(dataMode, entryId, tradeIndex, phase, next);
        return next;
      });
    };

    const technical = allPatternIndicators.filter((i) => i.signalGroup === "TechnicalPattern");
    const candlesticks = allPatternIndicators.filter((i) => i.signalGroup === "Candlestick");

    const getPatternBias = (ind: Indicator): "bullish" | "bearish" | "neutral" => {
      const text = `${ind.name} ${ind.abbreviation}`.toLowerCase();
      if (/(bull|buy|long|ascending|rising)/.test(text)) return "bullish";
      if (/(bear|sell|short|descending|falling)/.test(text)) return "bearish";
      return "neutral";
    };

    const passBiasFilter = (ind: Indicator): boolean => {
      const bias = getPatternBias(ind);
      if (bias === "neutral") return true;
      if (bias === "bullish") return showBullish;
      return showBearish;
    };

    const filteredTechnical = technical.filter(passBiasFilter);
    const filteredCandlesticks = candlesticks.filter(passBiasFilter);

    return (
      <div ref={pickerRef} style={{ marginTop: 6, position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: alignButtonRight ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: alignButtonRight ? "nowrap" : "wrap",
            marginBottom: 8,
          }}
        >
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Patterns
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Select which patterns are present in this trade.</div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: alignButtonRight ? "flex-end" : "flex-start",
              gap: 8,
              flexWrap: "wrap",
              minWidth: 0,
              flex: alignButtonRight ? "0 1 auto" : "1 1 200px",
            }}
          >
            {selectedIds.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {selectedIds.map((id) => {
                  const ind = idToInd.get(id);
                  if (!ind) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${hexToRgba(ind.accentColor ?? "#F59E0B", 0.55)}`,
                        background: hexToRgba(ind.accentColor ?? "#F59E0B", 0.18),
                        color: ind.accentColor ?? "#F59E0B",
                        fontSize: 12,
                        fontWeight: 800,
                        maxWidth: "100%",
                      }}
                      title={ind.name}
                    >
                      {ind.abbreviation}
                    </span>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                if (!canEdit) return;
                setOpen((v) => !v);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: `1px solid var(--border-color)`,
                background: "var(--accent)",
                color: "white",
                cursor: canEdit ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 700,
                width: 220,
                maxWidth: "100%",
                flexShrink: 0,
              }}
              title="Select patterns"
            >
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Choose patterns"}
            </button>
          </div>
        </div>

        {open && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "calc(100% + 8px)",
              width: "100%",
              maxWidth: "none",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: 12,
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
              zIndex: 60,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 2 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, cursor: canEdit ? "pointer" : "default" }}>
                  <input
                    type="checkbox"
                    checked={showBullish}
                    onChange={(e) => {
                      if (!canEdit) return;
                      setShowBullish(e.target.checked);
                    }}
                    disabled={!canEdit}
                    style={{ width: 16, height: 16 }}
                  />
                  Bullish
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, cursor: canEdit ? "pointer" : "default" }}>
                  <input
                    type="checkbox"
                    checked={showBearish}
                    onChange={(e) => {
                      if (!canEdit) return;
                      setShowBearish(e.target.checked);
                    }}
                    disabled={!canEdit}
                    style={{ width: 16, height: 16 }}
                  />
                  Bearish
                </label>
              </div>

              {[{ label: "Technical Patterns", items: filteredTechnical }, { label: "Candlesticks", items: filteredCandlesticks }].map(
                ({ label, items }) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {label}
                    </div>
                    {items.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>None available.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                        {items.map((ind) => {
                          const isOn = selectedIds.includes(ind.id);
                          return (
                            <button
                              key={ind.id}
                              type="button"
                              onClick={() => toggle(ind.id)}
                              disabled={!canEdit}
                              style={{
                                padding: 10,
                                borderRadius: 10,
                                border: `1px solid ${isOn ? hexToRgba(ind.accentColor ?? "#F59E0B", 0.85) : "var(--border-color)"}`,
                                background: isOn ? hexToRgba(ind.accentColor ?? "#F59E0B", 0.18) : "var(--bg-tertiary)",
                                color: "var(--text-primary)",
                                cursor: canEdit ? "pointer" : "default",
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 8,
                                alignItems: "flex-start",
                                textAlign: "left",
                                minHeight: 70,
                              }}
                              title={ind.name}
                            >
                              <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 900,
                                    padding: "2px 7px",
                                    borderRadius: 999,
                                    border: `1px solid ${hexToRgba(ind.accentColor ?? "#F59E0B", 0.55)}`,
                                    background: hexToRgba(ind.accentColor ?? "#F59E0B", 0.18),
                                    color: ind.accentColor ?? "#F59E0B",
                                    alignSelf: "flex-start",
                                  }}
                                >
                                  {ind.abbreviation}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                  {ind.name}
                                </span>
                              </span>
                              <span
                                style={{
                                  width: 42,
                                  height: 42,
                                  borderRadius: 6,
                                  border: "1px solid var(--border-color)",
                                  background: "var(--bg-secondary)",
                                  overflow: "hidden",
                                  flex: "0 0 auto",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {ind.exampleImage ? (
                                  <img
                                    src={ind.exampleImage}
                                    alt=""
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                  />
                                ) : (
                                  <span style={{ fontSize: 9, color: "var(--text-secondary)", fontWeight: 700 }}>N/A</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!canEdit) return;
                    setSelectedIds([]);
                    setJournalTradePatternIndicatorIds(dataMode, entryId, tradeIndex, phase, []);
                  }}
                  disabled={!canEdit}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
                    cursor: canEdit ? "pointer" : "not-allowed",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--accent)",
                    color: "white",
                    cursor: canEdit ? "pointer" : "default",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderIndicatorInputs = (phase: IndicatorPhase) => {
    const draftEntryId = 0;
    const entryId = selectedEntry?.id ?? draftEntryId;
    if (!isCreating && !selectedEntry?.id) return null;
    if (!entryFormData.strategy_id) return null;
    const phaseIndicators = strategyIndicators;

    const tradeIndex = activeTradeIndex;
    const timeframeOptions = ["1m", "5m", "15m", "1H", "4H", "1D", "1W"];
    const globalSelectedTfs = indicatorTimeframesByPhase[phase] || [];
    const signalFilter = indicatorSignalGroupFilterByPhase[phase];
    const visibleIndicators = phaseIndicators.filter((ind) => {
      if (ind.signalGroup === "TechnicalPattern") return signalFilter.technical;
      if (ind.signalGroup === "Candlestick") return signalFilter.candlestick;
      return true;
    });

    const getIndicatorSelectedTfs = (indicatorId: string, isTfIndicator: boolean) => {
      const overrides = indicatorTimeframesByPhaseAndIndicator[phase]?.[indicatorId];
      if (overrides && Array.isArray(overrides)) return overrides;
      // Important: do not auto-select indicator-specific timeframe buttons for timeframe-capturing indicators.
      // Non-timeframe indicators should still default to globalSelectedTfs so their Value inputs show by default.
      return isTfIndicator ? [] : globalSelectedTfs;
    };

    const toggleIndicatorTf = (indicatorId: string, tf: string) => {
      setIndicatorTimeframesByPhaseAndIndicator((prev) => {
        const phaseOverrides = prev[phase] ?? {};
        // Start from empty so clicking a timeframe button selects only that timeframe.
        const cur = phaseOverrides[indicatorId] ?? [];
        const next = cur.includes(tf) ? cur.filter((x) => x !== tf) : [...cur, tf];
        return { ...prev, [phase]: { ...phaseOverrides, [indicatorId]: next } };
      });
    };

    const hasAnyIndicatorTfs = visibleIndicators.some((ind) => {
      const isTfIndicator = ind.capturesTimeframes === true || ind.id.includes("_timeframe");
      if (isTfIndicator) return globalSelectedTfs.length > 0;
      return getIndicatorSelectedTfs(ind.id, false).length > 0;
    });

    const toggleTf = (tf: string) => {
      setIndicatorTimeframesByPhase((prev) => {
        const cur = prev[phase] || [];
        const next = cur.includes(tf) ? cur.filter((x) => x !== tf) : [...cur, tf];
        return { ...prev, [phase]: next };
      });
    };

    const canEditIndicators = isCreating || isEditing;
    const isReadOnlySignals = !canEditIndicators;

    const phaseLabel = phase === "entry" ? "Entry" : "Take Profit";

    return (
      <div
        style={{
          marginTop: "14px",
          padding: "12px",
          borderRadius: "10px",
          border: "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          pointerEvents: isReadOnlySignals ? "none" : "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Signals ({phaseLabel})
          </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    disabled={!canEditIndicators}
                    onClick={() => setIndicatorSettingsOpenByPhase((prev) => ({ ...prev, [phase]: !prev[phase] }))}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      cursor: canEditIndicators ? "pointer" : "not-allowed",
                      fontSize: 12,
                      fontWeight: 800,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    title="Signal settings"
                  >
                    <Settings size={16} />
                  </button>

                  {indicatorSettingsOpenByPhase[phase] && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 8px)",
                        zIndex: 50,
                        width: 280,
                        background: "var(--bg-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 12,
                        boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                        padding: 12,
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {phase === "entry" && (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-secondary)", fontSize: 12, fontWeight: 650 }}>
                            <input
                              type="checkbox"
                              checked={showIndicatorColors}
                              onChange={(e) => setShowIndicatorColors(e.target.checked)}
                              style={{ width: 16, height: 16 }}
                            />
                            Show indicator colors
                          </label>
                        )}

                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: canEditIndicators ? "pointer" : "default", color: "var(--text-secondary)", fontSize: 12, fontWeight: 650 }}>
                          <input
                            type="checkbox"
                            checked={indicatorSignalGroupFilterByPhase[phase]?.technical ?? true}
                            disabled={!canEditIndicators}
                            onChange={(e) => {
                              if (!canEditIndicators) return;
                              const next = e.target.checked;
                              setIndicatorSignalGroupFilterByPhase((prev) => ({
                                ...prev,
                                [phase]: { ...prev[phase], technical: next },
                              }));
                            }}
                            style={{ width: 16, height: 16 }}
                          />
                          Technical Patterns
                        </label>

                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: canEditIndicators ? "pointer" : "default", color: "var(--text-secondary)", fontSize: 12, fontWeight: 650 }}>
                          <input
                            type="checkbox"
                            checked={indicatorSignalGroupFilterByPhase[phase]?.candlestick ?? true}
                            disabled={!canEditIndicators}
                            onChange={(e) => {
                              if (!canEditIndicators) return;
                              const next = e.target.checked;
                              setIndicatorSignalGroupFilterByPhase((prev) => ({
                                ...prev,
                                [phase]: { ...prev[phase], candlestick: next },
                              }));
                            }}
                            style={{ width: 16, height: 16 }}
                          />
                          Candlesticks
                        </label>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                        <button
                          type="button"
                          onClick={() => setIndicatorSettingsOpenByPhase((prev) => ({ ...prev, [phase]: false }))}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: "var(--accent)",
                            color: "white",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
        </div>

        <TradePatternsPicker
          phase={phase}
          entryId={entryId}
          tradeIndex={tradeIndex}
          canEdit={canEditIndicators}
          alignButtonRight={true}
        />

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "nowrap" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Indicators
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
              Select one or more timeframes to enter indicator values (optional).
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", flex: "0 0 auto" }}>
            {timeframeOptions.map((tf) => {
              const active = globalSelectedTfs.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  disabled={!canEditIndicators}
                  onClick={() => {
                    if (!canEditIndicators) return;
                    toggleTf(tf);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: "1px solid var(--border-color)",
                    background: active ? "var(--accent)" : "var(--bg-tertiary)",
                    color: active ? "white" : "var(--text-primary)",
                    cursor: canEditIndicators ? "pointer" : "default",
                    fontSize: "12px",
                    fontWeight: 650,
                  }}
                >
                  {tf}
                </button>
              );
            })}
          </div>
        </div>

        {visibleIndicators.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
            No indicators match the selected pattern filters.
          </div>
        ) : !hasAnyIndicatorTfs ? (
          null
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {visibleIndicators.map((ind) => {
              const isTfIndicator = ind.capturesTimeframes === true || ind.id.includes("_timeframe");
              const indSelectedTfs = getIndicatorSelectedTfs(ind.id, isTfIndicator);
              const isMomentum = (ind.category ?? "").toLowerCase() === "momentum";
              const colTfs = isTfIndicator ? globalSelectedTfs : indSelectedTfs;
              const otherSignals = ind.kind === "custom" ? loadJournalIndicatorOtherSignals(dataMode, entryId, tradeIndex, phase, ind.id) : {};
              // Prefer labels defined on the Indicator; fall back to any previously-stored draft labels for older sessions.
              const otherSignalLabels =
                ind.kind === "custom"
                  ? (ind.otherSignals ?? []).length > 0
                    ? ind.otherSignals ?? []
                    : Object.keys(otherSignals)
                  : [];
              return (
                <div
                  key={ind.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `minmax(220px, 1fr) repeat(${colTfs.length}, minmax(110px, 140px))`,
                    gap: "10px",
                    alignItems: isTfIndicator ? "center" : "stretch",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 800,
                              padding: "3px 7px",
                              borderRadius: "8px",
                              background: showIndicatorColors ? hexToRgba(ind.accentColor ?? "#F59E0B", 0.18) : "var(--bg-secondary)",
                              border: `1px solid ${showIndicatorColors ? hexToRgba(ind.accentColor ?? "#F59E0B", 0.55) : "var(--border-color)"}`,
                              color: showIndicatorColors ? ind.accentColor ?? "#F59E0B" : "var(--text-secondary)",
                            }}
                          >
                            {ind.abbreviation}
                          </span>
                  <span
                    style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={ind.name}
                  >
                    {ind.name}
                  </span>
                  </div>
                  {colTfs.map((tf) =>
                    isTfIndicator ? (
                      <div
                        key={`${entryId}:${tradeIndex}:${phase}:${ind.id}:${tf}`}
                        style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "stretch", width: "100%" }}
                      >
                        <button
                          type="button"
                          disabled={!canEditIndicators}
                          onClick={() => {
                            if (!canEditIndicators) return;
                            toggleIndicatorTf(ind.id, tf);
                          }}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "999px",
                            border: "1px solid var(--border-color)",
                            background: indSelectedTfs.includes(tf) ? "var(--accent)" : "var(--bg-tertiary)",
                            color: indSelectedTfs.includes(tf) ? "white" : "var(--text-primary)",
                            cursor: canEditIndicators ? "pointer" : "default",
                            fontSize: "12px",
                            fontWeight: 650,
                            width: "100%",
                          }}
                        >
                          {tf}
                        </button>
                        {isMomentum && (
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              cursor: canEditIndicators ? "pointer" : "default",
                              color: "var(--text-secondary)",
                              fontSize: "11px",
                              fontWeight: 650,
                              userSelect: "none",
                              width: "100%",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={loadJournalIndicatorDivergence(dataMode, entryId, tradeIndex, phase, ind.id, tf)}
                              disabled={!canEditIndicators}
                              onChange={(e) => {
                                const next = e.target.checked;
                                if (next && !indSelectedTfs.includes(tf)) {
                                  setIndicatorTimeframesByPhaseAndIndicator((prev) => {
                                    const phaseOverrides = prev[phase] ?? {};
                                    // Start from empty: we only want to select the clicked timeframe,
                                    // not auto-select all global timeframes.
                                    const cur = phaseOverrides[ind.id] ?? [];
                                    const nextTfs = cur.includes(tf) ? cur : [...cur, tf];
                                    return { ...prev, [phase]: { ...phaseOverrides, [ind.id]: nextTfs } };
                                  });
                                }
                                setJournalIndicatorDivergence(dataMode, entryId, tradeIndex, phase, ind.id, tf, next);
                                setJournalSignalInputsTick((t) => t + 1);
                              }}
                              style={{ width: "16px", height: "16px" }}
                            />
                            Divergence
                          </label>
                        )}
                      </div>
                    ) : (
                      <div key={`${entryId}:${tradeIndex}:${phase}:${ind.id}:${tf}`} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", paddingLeft: "2px" }}>
                          {tf}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <input
                            type="text"
                            placeholder="Value"
                            defaultValue={loadJournalIndicatorValue(dataMode, entryId, tradeIndex, phase, ind.id, tf)}
                            onChange={(e) => {
                              if (!canEditIndicators) return;
                              setJournalIndicatorValue(dataMode, entryId, tradeIndex, phase, ind.id, tf, e.target.value);
                            }}
                            readOnly={!canEditIndicators}
                            disabled={!canEditIndicators}
                            spellCheck={false}
                            style={{
                              padding: "10px 12px",
                              background: "var(--bg-tertiary)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "10px",
                              color: "var(--text-primary)",
                              outline: "none",
                              flex: "1 1 120px",
                              minWidth: 0,
                            }}
                          />

                          {isMomentum && (
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                cursor: canEditIndicators ? "pointer" : "default",
                                color: "var(--text-secondary)",
                                fontSize: "11px",
                                fontWeight: 650,
                                userSelect: "none",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={loadJournalIndicatorDivergence(dataMode, entryId, tradeIndex, phase, ind.id, tf)}
                                disabled={!canEditIndicators}
                                onChange={(e) => {
                                  setJournalIndicatorDivergence(dataMode, entryId, tradeIndex, phase, ind.id, tf, e.target.checked);
                                  setJournalSignalInputsTick((t) => t + 1);
                                }}
                                style={{ width: "16px", height: "16px" }}
                              />
                              Divergence
                            </label>
                          )}

                          {ind.kind === "custom" && otherSignalLabels.length > 0 && tf === (colTfs[0] ?? tf) && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              {otherSignalLabels.map((label) => {
                                const checked = !!otherSignals[label];
                                return (
                                  <label
                                    key={label}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      color: "var(--text-primary)",
                                      fontSize: 12,
                                      fontWeight: 650,
                                      userSelect: "none",
                                      cursor: canEditIndicators ? "pointer" : "default",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!canEditIndicators}
                                      onChange={(e) => {
                                        setJournalIndicatorOtherSignal(dataMode, entryId, tradeIndex, phase, ind.id, label, e.target.checked);
                                        setJournalSignalInputsTick((t) => t + 1);
                                      }}
                                      style={{ width: 16, height: 16 }}
                                    />
                                    {label}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    );
  };

  const journalTradesByEntry = useMemo(() => {
    const map = new Map<number, JournalTrade[]>();
    allJournalTrades.forEach((t) => {
      if (!t.journal_entry_id) return;
      const list = map.get(t.journal_entry_id) || [];
      list.push(t);
      map.set(t.journal_entry_id, list);
    });
    return map;
  }, [allJournalTrades]);

  // Cascading filter options: each dropdown shows only values that exist when other filters are applied
  const journalFilterOptions = useMemo(() => {
    const {
      symbol,
      position,
      timeframe,
      entry_type,
      exit_type,
      outcome,
      text,
    } = journalFilters;
    const q = text.trim().toLowerCase();

    const entryIdsMatchingText: Set<number> =
      q === ""
        ? new Set(entries.map((e) => e.id))
        : new Set(
            entries
              .filter((entry) => {
                const trades = journalTradesByEntry.get(entry.id) || [];
                const titleMatch = (entry.title || "").toLowerCase().includes(q);
                const tradeTextMatch = trades.some((t) => {
                  const fields = [t.trade, t.what_went_well, t.what_could_be_improved, t.emotional_state, t.notes];
                  return fields.some((f) => (f || "").toLowerCase().includes(q));
                });
                return titleMatch || tradeTextMatch;
              })
              .map((e) => e.id)
          );

    type Skip = "symbol" | "position" | "timeframe" | "entry_type" | "exit_type" | "outcome";
    const matchTrade = (t: JournalTrade, skip: Skip): boolean => {
      if (!entryIdsMatchingText.has(t.journal_entry_id)) return false;
      if (skip !== "symbol" && symbol && (t.symbol || "").toLowerCase() !== symbol.toLowerCase()) return false;
      if (skip !== "position" && position && (t.position || "").toLowerCase() !== position.toLowerCase()) return false;
      if (skip !== "timeframe" && timeframe && (t.timeframe || "").toLowerCase() !== timeframe.toLowerCase()) return false;
      if (skip !== "entry_type" && entry_type && (t.entry_type || "").toLowerCase() !== entry_type.toLowerCase()) return false;
      if (skip !== "exit_type" && exit_type && (t.exit_type || "").toLowerCase() !== exit_type.toLowerCase()) return false;
      if (skip !== "outcome" && outcome && (t.outcome || "").toLowerCase() !== outcome.toLowerCase()) return false;
      return true;
    };

    const toSortedArray = (set: Set<string>) =>
      Array.from(set.values())
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .sort((a, b) => a.localeCompare(b));

    const forSymbol = allJournalTrades.filter((t) => matchTrade(t, "symbol"));
    const forPosition = allJournalTrades.filter((t) => matchTrade(t, "position"));
    const forTimeframe = allJournalTrades.filter((t) => matchTrade(t, "timeframe"));
    const forEntryType = allJournalTrades.filter((t) => matchTrade(t, "entry_type"));
    const forExitType = allJournalTrades.filter((t) => matchTrade(t, "exit_type"));
    const forOutcome = allJournalTrades.filter((t) => matchTrade(t, "outcome"));

    const symbols = new Set<string>(forSymbol.map((t) => t.symbol).filter(Boolean) as string[]);
    const positions = new Set<string>(forPosition.map((t) => t.position).filter(Boolean) as string[]);
    const timeframes = new Set<string>(forTimeframe.map((t) => t.timeframe).filter(Boolean) as string[]);
    const entryTypes = new Set<string>(forEntryType.map((t) => t.entry_type).filter(Boolean) as string[]);
    const exitTypes = new Set<string>(forExitType.map((t) => t.exit_type).filter(Boolean) as string[]);
    const outcomes = new Set<string>(forOutcome.map((t) => t.outcome).filter(Boolean) as string[]);

    return {
      symbols: toSortedArray(symbols),
      positions: toSortedArray(positions),
      timeframes: toSortedArray(timeframes),
      entryTypes: toSortedArray(entryTypes),
      exitTypes: toSortedArray(exitTypes),
      outcomes: toSortedArray(outcomes),
    };
  }, [allJournalTrades, entries, journalTradesByEntry, journalFilters]);

  // When options shrink from cascading, clear any selected value that is no longer in the list
  useEffect(() => {
    const { symbol, position, timeframe, entry_type, exit_type, outcome } = journalFilters;
    const symSet = new Set(journalFilterOptions.symbols.map((s) => s.toLowerCase()));
    const posSet = new Set(journalFilterOptions.positions.map((p) => p.toLowerCase()));
    const tfSet = new Set(journalFilterOptions.timeframes.map((t) => t.toLowerCase()));
    const etSet = new Set(journalFilterOptions.entryTypes.map((e) => e.toLowerCase()));
    const xtSet = new Set(journalFilterOptions.exitTypes.map((x) => x.toLowerCase()));
    const outSet = new Set(journalFilterOptions.outcomes.map((o) => o.toLowerCase()));
    const updates: Partial<typeof journalFilters> = {};
    if (symbol && !symSet.has(symbol.toLowerCase())) updates.symbol = "";
    if (position && !posSet.has(position.toLowerCase())) updates.position = "";
    if (timeframe && !tfSet.has(timeframe.toLowerCase())) updates.timeframe = "";
    if (entry_type && !etSet.has(entry_type.toLowerCase())) updates.entry_type = "";
    if (exit_type && !xtSet.has(exit_type.toLowerCase())) updates.exit_type = "";
    if (outcome && !outSet.has(outcome.toLowerCase())) updates.outcome = "";
    if (Object.keys(updates).length > 0) {
      setJournalFilters((prev) => ({ ...prev, ...updates }));
    }
  }, [journalFilterOptions, journalFilters.symbol, journalFilters.position, journalFilters.timeframe, journalFilters.entry_type, journalFilters.exit_type, journalFilters.outcome]);

  const filteredEntries = useMemo(() => {
    const {
      symbol,
      position,
      timeframe,
      entry_type,
      exit_type,
      outcome,
      text,
    } = journalFilters;

    const hasFilters =
      !!symbol ||
      !!position ||
      !!timeframe ||
      !!entry_type ||
      !!exit_type ||
      !!outcome ||
      !!text.trim();

    // Use same order as scrolling left panel (sorted by date) so list and overview match
    const sourceOrder = sortedJournalEntries;

    if (!hasFilters) {
      return sourceOrder;
    }

    const q = text.trim().toLowerCase();

    return sourceOrder.filter((entry) => {
      const trades = journalTradesByEntry.get(entry.id) || [];

      if (symbol) {
        const matches = trades.some((t) => (t.symbol || "").toLowerCase() === symbol.toLowerCase());
        if (!matches) return false;
      }

      if (position) {
        const matches = trades.some(
          (t) => (t.position || "").toLowerCase() === position.toLowerCase()
        );
        if (!matches) return false;
      }

      if (timeframe) {
        const matches = trades.some(
          (t) => (t.timeframe || "").toLowerCase() === timeframe.toLowerCase()
        );
        if (!matches) return false;
      }

      if (entry_type) {
        const matches = trades.some(
          (t) => (t.entry_type || "").toLowerCase() === entry_type.toLowerCase()
        );
        if (!matches) return false;
      }

      if (exit_type) {
        const matches = trades.some(
          (t) => (t.exit_type || "").toLowerCase() === exit_type.toLowerCase()
        );
        if (!matches) return false;
      }

      if (outcome) {
        const matches = trades.some(
          (t) => (t.outcome || "").toLowerCase() === outcome.toLowerCase()
        );
        if (!matches) return false;
      }

      if (q) {
        const titleMatch = (entry.title || "").toLowerCase().includes(q);
        const tradeTextMatch = trades.some((t) => {
          const fields = [
            t.trade,
            t.what_went_well,
            t.what_could_be_improved,
            t.emotional_state,
            t.notes,
          ];
          return fields.some((f) => (f || "").toLowerCase().includes(q));
        });
        if (!titleMatch && !tradeTextMatch) return false;
      }

      return true;
    });
  }, [sortedJournalEntries, journalTradesByEntry, journalFilters]);

  const [overviewChartTab, setOverviewChartTab] = useState<
    "entries_over_time" | "symbol" | "position" | "timeframe" | "entry_type" | "exit_type" | "outcome"
  >("entries_over_time");
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>("1y");
  const [chartCustomStart, setChartCustomStart] = useState("");
  const [chartCustomEnd, setChartCustomEnd] = useState("");
  const [overviewEntriesBrushStart, setOverviewEntriesBrushStart] = useState(0);
  const [overviewEntriesBrushEnd, setOverviewEntriesBrushEnd] = useState(0);
  const [overviewDimBrushStart, setOverviewDimBrushStart] = useState(0);
  const [overviewDimBrushEnd, setOverviewDimBrushEnd] = useState(0);

  // Indicators configured for this strategy (these drive Journal indicator inputs).
  const [strategyIndicators, setStrategyIndicators] = useState<Indicator[]>([]);
  // Free-text rules configured in the Strategy "Rules" tab (these drive the Journal rules panel).
  const [strategyEntryRuleTexts, setStrategyEntryRuleTexts] = useState<string[]>([]);
  const [strategyTakeProfitRuleTexts, setStrategyTakeProfitRuleTexts] = useState<string[]>([]);
  // Free-text "custom rule sets" configured in the Strategy "Rules" tab.
  // Each set gets its own Journal section that can be reordered.
  const [strategyCustomRuleSets, setStrategyCustomRuleSets] = useState<StrategyCustomRuleSet[]>([]);
  const SHOW_INDICATOR_COLORS_KEY = "tradebutler_show_indicator_colors_v1";
  const [showIndicatorColors, setShowIndicatorColors] = useState<boolean>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SHOW_INDICATOR_COLORS_KEY) : null;
      if (raw === null) return true;
      return raw === "1" || raw.toLowerCase() === "true";
    } catch {
      return true;
    }
  });
  const [indicatorSettingsOpenByPhase, setIndicatorSettingsOpenByPhase] = useState<Record<IndicatorPhase, boolean>>({
    entry: false,
    exit: false,
  });
  /** Bumped when divergence / other-signal prefs change in localStorage so controlled checkboxes re-render. */
  const [, setJournalSignalInputsTick] = useState(0);
  const [indicatorSignalGroupFilterByPhase, setIndicatorSignalGroupFilterByPhase] = useState<
    Record<IndicatorPhase, { technical: boolean; candlestick: boolean }>
  >({
    entry: { technical: true, candlestick: true },
    exit: { technical: true, candlestick: true },
  });
  const [indicatorTimeframesByPhase, setIndicatorTimeframesByPhase] = useState<Record<IndicatorPhase, string[]>>({
    // Default indicator timeframes (top-of-section buttons).
    entry: ["15m", "1H", "4H"],
    exit: ["15m", "1H", "4H"],
  });
  // Timeframe-capturing indicators (concept inputs) can optionally override the global phase selection.
  const [indicatorTimeframesByPhaseAndIndicator, setIndicatorTimeframesByPhaseAndIndicator] = useState<
    Record<IndicatorPhase, Record<string, string[]>>
  >({
    entry: {},
    exit: {},
  });

  // Custom-indicator "Other signals" labels are managed on the Indicators page.

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(SHOW_INDICATOR_COLORS_KEY, showIndicatorColors ? "1" : "0");
    } catch {
      /* optional */
    }
  }, [showIndicatorColors]);

  const overviewEntriesFiltered = useMemo(() => {
    const { start, end } = getTimeframeDates(chartTimeframe, chartCustomStart || undefined, chartCustomEnd || undefined);
    if (!start || !end) return filteredEntries;
    return filteredEntries.filter((entry) => {
      if (!entry.date) return false;
      const d = parse(entry.date, "yyyy-MM-dd", new Date());
      if (isNaN(d.getTime())) return false;
      const t = d.getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }, [filteredEntries, chartTimeframe, chartCustomStart, chartCustomEnd]);

  const overviewEntriesByMonth = useMemo(() => {
    const counts = new Map<string, number>();
    overviewEntriesFiltered.forEach((entry) => {
      if (!entry.date) return;
      const parsedDate = parse(entry.date, "yyyy-MM-dd", new Date());
      if (isNaN(parsedDate.getTime())) return;
      const key = format(parsedDate, "yyyy-MM");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [overviewEntriesFiltered]);

  const overviewFilteredTradesForCharts = useMemo(() => {
    const ids = new Set(overviewEntriesFiltered.map((e) => e.id));
    return allJournalTrades.filter((t) => ids.has(t.journal_entry_id));
  }, [overviewEntriesFiltered, allJournalTrades]);

  const overviewJournalChartData = useMemo(() => {
    const aggregate = (key: "symbol" | "position" | "timeframe" | "entry_type" | "exit_type" | "outcome") => {
      const counts = new Map<string, number>();
      overviewFilteredTradesForCharts.forEach((t) => {
        const raw = (t as any)[key] as string | null | undefined;
        const value = (raw || "Unspecified").trim();
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };
    return {
      symbol: aggregate("symbol"),
      position: aggregate("position"),
      timeframe: aggregate("timeframe"),
      entry_type: aggregate("entry_type"),
      exit_type: aggregate("exit_type"),
      outcome: aggregate("outcome"),
    };
  }, [overviewFilteredTradesForCharts]);

  const [showAllRecent, setShowAllRecent] = useState(false);
  const [expandedImprovementCardIds, setExpandedImprovementCardIds] = useState<Set<number>>(new Set());

  const recentEntries = useMemo(
    () => (showAllRecent ? filteredEntries : filteredEntries.slice(0, 10)),
    [filteredEntries, showAllRecent]
  );

  const recentWhatCouldBeImproved = useMemo(() => {
    const maxCards = 8;
    const out: { entry: JournalEntry; improvements: string[] }[] = [];
    const considered = showAllRecent ? filteredEntries : filteredEntries.slice(0, 15);
    for (const entry of considered) {
      const trades = journalTradesByEntry.get(entry.id) || [];
      const improvements = trades
        .map((t) => (t.what_could_be_improved || "").trim())
        .filter((s) => s.length > 0);
      if (improvements.length > 0) {
        out.push({ entry, improvements });
        if (out.length >= maxCards) break;
      }
    }
    return out;
  }, [filteredEntries, showAllRecent, journalTradesByEntry]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", flex: 1 }}>
      {dataMode === "sandbox" && (
        <p style={{ flexShrink: 0, margin: "0 0 12px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Demo mode — you are viewing demo data only.
        </p>
      )}
      {dataMode === "paper" && (
        <p style={{ flexShrink: 0, margin: "0 0 12px 0", padding: "12px 16px", fontSize: "14px", fontWeight: "600", color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "2px solid var(--accent)", borderRadius: "8px" }}>
          Paper mode — you are viewing paper trades only.
        </p>
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left Panel - Entry Details */}
      <div
        style={{
          flex: "2",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-primary)",
          overflow: "hidden",
        }}
      >
        {pendingRestoreEntryId != null && selectedEntry == null ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LoadingSphere size={100} message="Loading journal entry…" />
          </div>
        ) : selectedEntry && !isCreating && !isEditing ? (
          <>
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                backgroundColor: "var(--bg-secondary)",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <h2 style={{ fontSize: "20px", fontWeight: "800", margin: 0, lineHeight: 1.25, color: "var(--text-primary)" }}>
                  {format(parse(selectedEntry.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy")} - {selectedEntry.title}
                </h2>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setSelectedEntry(null)}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Journal overview"
                >
                  <LayoutDashboard size={16} />
                </button>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  onClick={handleEdit}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Edit"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={handleDeleteClick}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--danger)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, minWidth: 260, flex: "1 1 520px" }}>
                    <div style={{ flex: "1 1 220px", minWidth: 200, padding: "12px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 10 }}>
                      <label style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                        Date
                      </label>
                      <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                        {selectedEntry.date}
                      </div>
                    </div>

                    <div style={{ flex: "2 1 260px", minWidth: 240, padding: "12px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 10 }}>
                      <label style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                        Title
                      </label>
                      <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={selectedEntry.title}>
                        {selectedEntry.title}
                      </div>
                    </div>

                    {selectedEntry.strategy_id && (
                      <div style={{ flex: "1 1 220px", minWidth: 200, padding: "12px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 10 }}>
                        <label style={{ fontSize: "11px", fontWeight: "800", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                          Strategy
                        </label>
                        <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={strategies.find(s => s.id === selectedEntry.strategy_id)?.name || "Unknown"}>
                          {strategies.find(s => s.id === selectedEntry.strategy_id)?.name || "Unknown"}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: "1 1 280px", minWidth: 280 }}>
                    <div style={{ padding: "14px 14px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Overview</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{selectedEntry.strategy_id ? "Strategy-backed" : "Unassigned"}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 120px", minWidth: 120, padding: "10px 12px", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Trades</div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)" }}>{selectedTrades.length}</div>
                        </div>
                        <div style={{ flex: "1 1 120px", minWidth: 120, padding: "10px 12px", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Emotions</div>
                          <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text-primary)" }}>{viewEntryEmotionalStates.length > 0 ? groupEmotionalStatesByTimestamp(viewEntryEmotionalStates).length : 0}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                        Click a trade card to expand checklists and details. Use the Emotions cards to jump to the related trade.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Display all trades */}
                {selectedTrades.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <div
                      style={{
                        marginBottom: "16px",
                        padding: "10px 12px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderLeft: "3px solid var(--accent)",
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <h3
                        style={{
                          fontSize: "13px",
                          fontWeight: "900",
                          margin: 0,
                          color: "var(--text-primary)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Trades ({selectedTrades.length})
                      </h3>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          minWidth: 0,
                        }}
                      >
                        {selectedTrades.map((trade, index) => {
                          const tabLabel = trade.symbol
                            ? (trade.position ? `${trade.symbol} ${trade.position}` : trade.symbol)
                            : `Trade ${index + 1}`;
                          const isActiveTab = index === (viewFocusedTradeIndex ?? 0);
                          return (
                            <button
                              key={trade.id || `trade-tab-${index}`}
                              type="button"
                              onClick={() => setViewFocusedTradeIndex(index)}
                              style={{
                                border: `1px solid ${isActiveTab ? "var(--accent)" : "var(--border-color)"}`,
                                background: isActiveTab ? "var(--bg-secondary)" : "var(--bg-primary)",
                                color: isActiveTab ? "var(--text-primary)" : "var(--text-secondary)",
                                borderRadius: 8,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: isActiveTab ? 700 : 600,
                                cursor: "pointer",
                                maxWidth: 180,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={tabLabel}
                            >
                              {tabLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {selectedTrades.map((trade, index) => {
                      const tradeName = trade.symbol
                        ? (trade.position ? `${trade.symbol} (${trade.position})` : trade.symbol)
                        : `Trade ${index + 1}`;
                      const isFocused = index === (viewFocusedTradeIndex ?? 0);
                      if (!isFocused) return null;
                      return (
                      <div
                        key={trade.id || index}
                        id={`journal-trade-card-${index}`}
                        style={{
                          marginBottom: "24px",
                          padding: "12px",
                          backgroundColor: isFocused ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                          borderRadius: "8px",
                          border: `1px solid ${isFocused ? "var(--accent)" : "var(--border-color)"}`,
                          cursor: "default",
                        }}
                      >
                        <h4 style={{ fontSize: "16px", fontWeight: "700", margin: "0 0 12px", color: "var(--text-primary)" }}>
                          {tradeName}
                        </h4>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginBottom: "14px" }}>
                          {trade.symbol && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Symbol
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.symbol}
                              </div>
                            </div>
                          )}
                          {trade.position && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Position
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.position}
                              </div>
                            </div>
                          )}
                          {trade.timeframe && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Trade Timeframe
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.timeframe}
                              </div>
                            </div>
                          )}
                          {isFocused && trade.entry_type && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Entry Type
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.entry_type}
                              </div>
                            </div>
                          )}
                          {isFocused && trade.exit_type && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Exit Type
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.exit_type}
                              </div>
                            </div>
                          )}
                          {trade.outcome != null && (
                            <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                              <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", display: "block" }}>
                                Outcome
                              </label>
                              <div style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 700 }}>
                                {trade.outcome}
                              </div>
                            </div>
                          )}
                        </div>
                        {trade.trade != null && (
                          <div style={{ marginBottom: isFocused ? "24px" : "14px", padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                            <label style={{ fontSize: "10px", fontWeight: "700", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px", display: "block" }}>
                              Implementation
                            </label>
                            {isFocused ? (
                              <div style={{ overflow: "hidden" }}>
                                <RichTextEditor value={trade.trade || ""} onChange={() => {}} readOnly={true} />
                              </div>
                            ) : (
                              <div
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  color: "var(--text-primary)",
                                  fontSize: 13,
                                  lineHeight: 1.35,
                                }}
                                title={stripHtml(trade.trade || "")}
                              >
                                {stripHtml(trade.trade || "").slice(0, 140)}
                                {stripHtml(trade.trade || "").length > 140 ? "…" : ""}
                              </div>
                            )}
                          </div>
                        )}

                        {isFocused && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                            {effectiveSectionOrder.map((sectionId) => {
                              if (sectionId === "implementation") return null; // already rendered above
                              return (
                                <div key={`readonly-${sectionId}`}>
                                  <label style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: "8px", display: "block" }}>
                                    {getSectionLabelScroll(sectionId)}
                                  </label>

                                  {sectionId === "what_went_well" && (
                                    <div style={{ overflow: "hidden" }}>
                                      <RichTextEditor value={trade.what_went_well || ""} onChange={() => {}} readOnly={true} />
                                    </div>
                                  )}
                                  {sectionId === "what_could_be_improved" && (
                                    <div style={{ overflow: "hidden" }}>
                                      <RichTextEditor value={trade.what_could_be_improved || ""} onChange={() => {}} readOnly={true} />
                                    </div>
                                  )}
                                  {sectionId === "notes" && (
                                    <div style={{ overflow: "hidden" }}>
                                      <RichTextEditor value={trade.notes || ""} onChange={() => {}} readOnly={true} />
                                    </div>
                                  )}
                                  {sectionId === "analysis_checklist" && renderChecklistReadOnlyForType("daily_analysis", index)}
                                  {sectionId === "entry_checklist" && (
                                    <>
                                      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                                        <div style={{ flex: "1 1 0", minWidth: 280 }}>
                                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                            Entry Checklist
                                          </div>
                                          {renderChecklistReadOnlyForType("entry", index)}
                                        </div>
                                        <div style={{ flex: "1 1 0", minWidth: 280 }}>
                                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                            Entry Rules
                                          </div>
                                          {strategyEntryRuleTexts.length === 0 ? (
                                            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No entry rules configured.</p>
                                          ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                              {strategyEntryRuleTexts.map((rule, idx) => (
                                                <div key={`entry-rule-${idx}`} style={{ padding: "10px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderLeft: "3px solid var(--accent)", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                                                  {rule}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div style={{ marginTop: "12px" }}>{renderIndicatorInputs("entry")}</div>
                                    </>
                                  )}
                                  {sectionId === "take_profit_checklist" && (
                                    <>
                                      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                                        <div style={{ flex: "1 1 0", minWidth: 280 }}>
                                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                            Take Profit Checklist
                                          </div>
                                          {renderChecklistReadOnlyForType("take_profit", index)}
                                        </div>
                                        <div style={{ flex: "1 1 0", minWidth: 280 }}>
                                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                            Take Profit Rules
                                          </div>
                                          {strategyTakeProfitRuleTexts.length === 0 ? (
                                            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No take profit rules configured.</p>
                                          ) : (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                              {strategyTakeProfitRuleTexts.map((rule, idx) => (
                                                <div key={`tp-rule-${idx}`} style={{ padding: "10px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderLeft: "3px solid var(--accent)", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                                                  {rule}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div style={{ marginTop: "12px" }}>{renderIndicatorInputs("exit")}</div>
                                    </>
                                  )}
                                  {sectionId.startsWith("custom_rules:") && (() => {
                                    const ruleSetId = sectionId.slice("custom_rules:".length);
                                    const ruleSet = strategyCustomRuleSets?.find((s) => s.id === ruleSetId);
                                    const rules = ruleSet?.rules ?? [];
                                    return rules.length === 0 ? (
                                      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>No custom rules configured.</p>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        {rules.map((rule, idx) => (
                                          <div key={`${ruleSetId}-${idx}`} style={{ padding: "10px 12px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderLeft: "3px solid var(--accent)", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                                            {rule}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                  {sectionId.startsWith("custom:") && (() => {
                                    const type = sectionId.slice(7);
                                    return currentChecklists ? renderChecklistReadOnlyForType(type, index) : <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No checklist data available.</p>;
                                  })()}
                                  {(sectionId === "emotional_state_before" || sectionId === "emotional_state_during" || sectionId === "emotional_state_after") && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                      {(() => {
                                        const visibleSurveyPhases = sectionId === "emotional_state_before"
                                          ? (["before"] as const)
                                          : sectionId === "emotional_state_during"
                                            ? (["during"] as const)
                                            : (["after"] as const);
                                        const currentTradeId = trade.id ?? null;
                                        const relevantGroups = groupEmotionalStatesByTimestamp(viewEntryEmotionalStates).filter((group) => {
                                          const jtId = group[0]?.journal_trade_id ?? null;
                                          return jtId == null || (currentTradeId != null && jtId === currentTradeId);
                                        });
                                        if (relevantGroups.length === 0) {
                                          return <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>No emotional state survey results for this trade.</p>;
                                        }
                                        return relevantGroups.map((group) => {
                                          const first = group[0];
                                          const targetTradeId = first.journal_trade_id ?? null;
                                          const targetTradeIndex = targetTradeId != null ? selectedTrades.findIndex((t) => t.id === targetTradeId) : -1;
                                          const isCardFocused = targetTradeIndex === (viewFocusedTradeIndex ?? 0);
                                          const notes = first.notes;
                                          const groupStateIds = new Set(group.map((s) => s.id));
                                          const survey = viewEntrySurveys.find((s) => groupStateIds.has(s.emotional_state_id));
                                          return (
                                            <div
                                              key={first.timestamp}
                                              style={{
                                                padding: "12px",
                                                backgroundColor: "var(--bg-secondary)",
                                                border: `1px solid ${isCardFocused ? "var(--accent)" : "var(--border-color)"}`,
                                                borderRadius: "6px",
                                              }}
                                            >
                                              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                                                {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")}
                                              </div>
                                              {notes && (
                                                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px" }} dangerouslySetInnerHTML={{ __html: notes }} />
                                              )}
                                              <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-color)" }}>
                                                <div style={{ fontSize: "11px", color: "var(--accent)", marginBottom: "12px", letterSpacing: "0.03em", fontWeight: "500" }}>
                                                  Survey{!survey ? " (defaults shown)" : ""}
                                                </div>
                                                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--text-secondary)" }}>
                                                  0 = not present - 10 = extremely strong. Rate how strongly you feel each emotion; values are used for trends and insights over time.
                                                </p>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
                                                  {group.map((s) => (
                                                    <span
                                                      key={`emo-chip-${s.id}`}
                                                      style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: "6px",
                                                        padding: "4px 10px",
                                                        borderRadius: "999px",
                                                        border: "1px solid var(--border-color)",
                                                        background: "var(--bg-tertiary)",
                                                        fontSize: "12px",
                                                        fontWeight: 600,
                                                        color: "var(--text-primary)",
                                                      }}
                                                    >
                                                      {s.emotion}
                                                      <span style={{ color: "var(--accent)", fontWeight: 700 }}>{s.intensity}/10</span>
                                                    </span>
                                                  ))}
                                                </div>
                                                {visibleSurveyPhases.map((phase) => {
                                                    const phaseStyle = phase === "before"
                                                      ? { borderColor: "var(--accent)", labelColor: "var(--accent)" }
                                                      : phase === "during"
                                                        ? { borderColor: "var(--warning)", labelColor: "var(--warning)" }
                                                        : { borderColor: "var(--success)", labelColor: "var(--success)" };
                                                    return (
                                                        <div key={phase} style={{ marginBottom: "14px", paddingLeft: "12px", borderLeft: `2px solid ${phaseStyle.borderColor}` }}>
                                                          <div style={{ fontSize: "11px", color: phaseStyle.labelColor, marginBottom: "8px", fontWeight: "500" }}>
                                                            {phase === "before" ? "Before Trade" : phase === "during" ? "During Trade" : "After Trade"}
                                                          </div>
                                                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                                          {JOURNAL_SURVEY_QUESTIONS[phase].map((q, idx) => {
                                                            const score = survey ? (survey as unknown as Record<string, number>)[q.key] : undefined;
                                                            const scoreNum = typeof score === "number" && score >= 1 && score <= 10 ? score : 6;
                                                            return (
                                                              <div key={q.key} style={{ marginBottom: "2px" }}>
                                                                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: "var(--text-primary)" }}>
                                                                  {idx + 1}. {q.question}
                                                                </label>
                                                                <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: "0 0 6px" }}>{q.scale}</p>
                                                                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "16px" }}>1</span>
                                                                  <input
                                                                    type="range"
                                                                    min={1}
                                                                    max={10}
                                                                    value={scoreNum}
                                                                    readOnly
                                                                    disabled
                                                                    style={{ flex: 1, minWidth: "80px", accentColor: "var(--accent)" }}
                                                                  />
                                                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "16px" }}>10</span>
                                                                  <span style={{ minWidth: "28px", textAlign: "center", fontSize: "13px", fontWeight: "600", color: "var(--accent)" }}>
                                                                    {scoreNum}
                                                                  </span>
                                                                </div>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                              </div>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                    })}
                  </div>
                )}

                {/* Links */}
                {linkedPairs.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "6px", color: "var(--text-primary)" }}>
                      Links
                    </h3>
                    <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                      Linked positions: {linkedPairs.length}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {linkedPairs.map((pair) => (
                        <div
                          key={`${pair.entry_trade_id}_${pair.exit_trade_id}`}
                          style={{
                            padding: "16px",
                            backgroundColor: "var(--bg-secondary)",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                            <span style={{ fontWeight: "600", color: "var(--text-primary)" }}>{pair.symbol}</span>
                            <span style={{ color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)", fontSize: "14px" }}>
                              P&L: ${pair.net_profit_loss >= 0 ? "" : "-"}${Math.abs(pair.net_profit_loss).toFixed(2)}
                            </span>
                          </div>
                          <TradeChart
                            symbol={pair.symbol}
                            entryTimestamp={pair.entry_timestamp}
                            exitTimestamp={pair.exit_timestamp}
                            entryPrice={pair.entry_price}
                            exitPrice={pair.exit_price}
                            inline
                            compactHeight={200}
                          />
                          <div style={{ marginTop: "8px" }}>
                            <button
                              onClick={() => {
                                setSelectedPairForChart(pair);
                                setSelectedPositionTrades(undefined);
                                fetchPositionTradesForPair(pair).then(setSelectedPositionTrades);
                              }}
                              style={{
                                fontSize: "12px",
                                padding: "6px 12px",
                                background: "var(--bg-tertiary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "4px",
                                color: "var(--text-primary)",
                                cursor: "pointer",
                              }}
                            >
                              View full chart
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (isCreating || isEditing) ? (
          <>
            <div style={{ padding: "20px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "20px", fontWeight: "bold" }}>Journal Entry</h2>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {isEditing && editHistory.length > 1 && (
                  <button
                    onClick={handleUndo}
                    style={{
                      background: "var(--bg-tertiary)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      padding: "8px",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="Undo"
                  >
                    <RotateCcw size={16} />
                  </button>
                )}
                <button
                  onClick={handleSave}
                  style={{
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                  title="Save"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                  title="Cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {!isTabContentMaximized && (
                <>
                {/* Consolidated top bar: Date, Title, Strategy, Trade selector */}
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}>
                  <div style={{ flex: "0 0 110px", minWidth: "90px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "11px", fontWeight: "500", color: "var(--text-secondary)" }}>Date</label>
                    <input
                      type="date"
                      value={entryFormData.date}
                      onChange={(e) => setEntryFormData({ ...entryFormData, date: e.target.value })}
                      style={{ width: "100%", padding: "5px 6px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)", fontSize: "13px" }}
                    />
                  </div>
                  <div style={{ flex: "1 1 160px", minWidth: "120px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "11px", fontWeight: "500", color: "var(--text-secondary)" }}>Title</label>
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={entryFormData.title}
                      onChange={(e) => {
                        const newData = { ...entryFormData, title: e.target.value };
                        setEntryFormData(newData);
                        if (isEditing) {
                          const currentState = { entry: newData, trades: tradesFormData.map(t => ({ ...t })), checklistResponses: new Map(checklistResponses) };
                          setEditHistory(prev => [...prev, currentState].slice(-10));
                        }
                      }}
                      placeholder="Entry title..."
                      style={{ width: "100%", padding: "5px 6px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)", fontSize: "13px" }}
                    />
                  </div>
                  <div style={{ flex: "0 0 140px", minWidth: "100px" }} ref={strategyDropdownRef}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "11px", fontWeight: "500", color: "var(--text-secondary)" }}>Strategy</label>
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setStrategyDropdownOpen((o) => !o)}
                        style={{
                          width: "100%",
                          padding: "5px 8px",
                          textAlign: "left",
                          backgroundColor: "var(--bg-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "4px",
                          color: "var(--text-primary)",
                          fontSize: "13px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "6px",
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entryFormData.strategy_id != null ? (strategies.find((s) => s.id === entryFormData.strategy_id)?.name ?? "None") : "None"}
                        </span>
                        <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                      </button>
                      {strategyDropdownOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            marginTop: "2px",
                            backgroundColor: "var(--bg-secondary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            zIndex: 100,
                            maxHeight: "220px",
                            overflowY: "auto",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => { setEntryFormData({ ...entryFormData, strategy_id: null }); setStrategyDropdownOpen(false); }}
                            style={{
                              width: "100%",
                              padding: "8px 10px",
                              textAlign: "left",
                              background: "none",
                              border: "none",
                              borderBottom: "1px solid var(--border-color)",
                              color: "var(--accent)",
                              fontSize: "13px",
                              cursor: "pointer",
                              fontWeight: 500,
                            }}
                          >
                            None
                          </button>
                          {strategies.map((s) => {
                            const isDefault = defaultStrategyIdForJournal === s.id;
                            return (
                              <div
                                key={s.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "12px",
                                  padding: "4px 8px 4px 12px",
                                  background: entryFormData.strategy_id === s.id ? "var(--bg-hover)" : "transparent",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => { setEntryFormData({ ...entryFormData, strategy_id: s.id }); setStrategyDropdownOpen(false); }}
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    padding: "6px 0",
                                    textAlign: "left",
                                    background: "none",
                                    border: "none",
                                    color: "var(--text-primary)",
                                    fontSize: "13px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {s.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    try {
                                      if (isDefault) {
                                        localStorage.removeItem(JOURNAL_DEFAULT_STRATEGY_ID_KEY);
                                        setDefaultStrategyIdForJournal(null);
                                      } else {
                                        localStorage.setItem(JOURNAL_DEFAULT_STRATEGY_ID_KEY, String(s.id));
                                        setDefaultStrategyIdForJournal(s.id);
                                      }
                                    } catch {
                                      /* ignore */
                                    }
                                  }}
                                  title={isDefault ? "Clear default for new journal entries" : "Use this strategy as default for new journal entries"}
                                  style={{
                                    flexShrink: 0,
                                    padding: "4px 8px",
                                    fontSize: "11px",
                                    fontWeight: isDefault ? 600 : 400,
                                    color: isDefault ? "white" : "var(--text-secondary)",
                                    background: isDefault ? "var(--accent)" : "transparent",
                                    border: isDefault ? "1px solid var(--accent)" : "1px dashed var(--border-color)",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {isDefault ? "Default" : "Set default"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap" }}>
                    {tradesFormData.map((trade, index) => {
                      const isActive = activeTradeIndex === index;
                      const tabLabel = trade.symbol || `T${index + 1}`;
                      return (
                        <div key={index} style={{ display: "flex", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => setActiveTradeIndex(index)}
                            style={{
                              padding: "6px 12px",
                              background: isActive ? "var(--bg-primary)" : "transparent",
                              border: "1px solid var(--border-color)",
                              borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                              cursor: "pointer",
                              fontSize: "12px",
                              fontWeight: isActive ? "600" : "400",
                              borderRadius: "4px 4px 0 0",
                              marginBottom: "-1px",
                            }}
                          >
                            {tabLabel}
                          </button>
                          {tradesFormData.length > 1 && (
                            <button
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              onClick={(e) => { e.stopPropagation(); handleRemoveTrade(index); }}
                              style={{ padding: "4px", marginLeft: "2px", background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
                              title="Remove trade"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => handleAddTrade()}
                      style={{ padding: "6px 10px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--accent)", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
                      title="Add trade"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </div>
                </div>

              {/* Trade-specific fields - compact row */}
              {currentTrade && (
                <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
                  <div style={{ minWidth: "80px", flex: "1 1 80px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>Symbol</label>
                    <input type="text" list={`symbol-list-${activeTradeIndex}`} value={currentTrade.symbol} onChange={(e) => updateTradeFormData(activeTradeIndex, "symbol", e.target.value)} placeholder="Symbol" style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }} />
                    <datalist id={`symbol-list-${activeTradeIndex}`}>{availableSymbols.map((sym) => <option key={sym} value={sym} />)}</datalist>
                  </div>
                  <div style={{ minWidth: "70px", flex: "0 0 70px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>Position</label>
                    <select value={currentTrade.position} onChange={(e) => updateTradeFormData(activeTradeIndex, "position", e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}>
                      <option value="">Pos.</option>
                      <option value="Long">Long</option>
                      <option value="Short">Short</option>
                      <option value="Call">Call</option>
                      <option value="Put">Put</option>
                    </select>
                  </div>
                  <div style={{ minWidth: "75px", flex: "0 0 75px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>TF</label>
                    <select value={currentTrade.timeframe} onChange={(e) => updateTradeFormData(activeTradeIndex, "timeframe", e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}>
                      <option value="">TF</option>
                      <option value="1m">1m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="1h">1h</option>
                      <option value="1d">1d</option>
                    </select>
                  </div>
                  <div style={{ minWidth: "60px", flex: "0 0 60px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>Entry</label>
                    <select value={currentTrade.entry_type} onChange={(e) => updateTradeFormData(activeTradeIndex, "entry_type", e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}>
                      <option value="">—</option>
                      <option value="Market">Market</option>
                      <option value="Limit">Limit</option>
                    </select>
                  </div>
                  <div style={{ minWidth: "60px", flex: "0 0 60px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>Exit</label>
                    <select value={currentTrade.exit_type} onChange={(e) => updateTradeFormData(activeTradeIndex, "exit_type", e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}>
                      <option value="">—</option>
                      <option value="Market">Market</option>
                      <option value="Limit">Limit</option>
                    </select>
                  </div>
                  <div style={{ minWidth: "70px", flex: "0 0 70px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>Outcome</label>
                    <select value={currentTrade.outcome} onChange={(e) => updateTradeFormData(activeTradeIndex, "outcome", e.target.value)} style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }}>
                      <option value="None">None</option>
                      <option value="Positive">+</option>
                      <option value="Negative">−</option>
                      <option value="Breakeven">BE</option>
                    </select>
                  </div>
                  <div style={{ minWidth: "55px", flex: "0 0 55px" }}>
                    <label style={{ display: "block", marginBottom: "2px", fontSize: "10px", color: "var(--text-secondary)" }}>R</label>
                    <input type="text" inputMode="decimal" value={(currentTrade as { r_multiple?: string }).r_multiple ?? ""} onChange={(e) => updateTradeFormData(activeTradeIndex, "r_multiple", e.target.value)} placeholder="R" style={{ width: "100%", padding: "4px 6px", fontSize: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)" }} />
                  </div>
                  {((isEditing && currentTrade.id != null) || selectedEntry?.id) && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {isEditing && currentTrade.id != null && (
                        <button type="button" onClick={() => { setLinkActualTradesSelection(journalTradeActualTradeIds.get(currentTrade.id!) ?? []); setLinkActualTradesModalJournalTradeId(currentTrade.id!); }} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px", background: "var(--accent)", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "11px" }}>
                          <Link2 size={12} /> {journalTradeActualTradeIds.get(currentTrade.id!)?.length ? "Edit" : "Link"}
                        </button>
                      )}
                      {selectedEntry?.id && (
                        <button type="button" onClick={async () => { setShowLinkPairsModal(true); setLinkPairsSearchQuery(""); setLinkPairsSortBy("date"); setLinkPairsSortDirection("desc"); const method = localStorage.getItem("tradebutler_pairing_method") || "FIFO"; const all = await invoke<PairedTrade[]>("get_paired_trades", { pairingMethod: method || null }); setAllPairsForPicker(all); setLinkPickerSelected(new Set(linkedPairs.map(p => `${p.entry_trade_id}_${p.exit_trade_id}`))); }} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "4px", color: "var(--text-primary)", fontSize: "11px", cursor: "pointer" }}>
                          <Link2 size={12} /> Positions {linkedPairs.length > 0 && `(${linkedPairs.length})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Linked pairs list - compact when entry has pairs */}
              {selectedEntry?.id && !isTabContentMaximized && linkedPairs.length > 0 && (
                <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginRight: "8px" }}>{linkedPairs.length} position{linkedPairs.length !== 1 ? "s" : ""}</span>
                  {linkedPairs.map((pair) => (
                    <div key={`${pair.entry_trade_id}-${pair.exit_trade_id}`} style={{ display: "flex", alignItems: "center", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", overflow: "hidden" }}>
                      <button type="button" onClick={() => { setSelectedPairForChart(pair); setSelectedPositionTrades(undefined); fetchPositionTradesForPair(pair).then(setSelectedPositionTrades); }} style={{ padding: "4px 8px", background: "none", border: "none", color: "var(--text-primary)", fontSize: "12px", cursor: "pointer" }}>
                        {pair.symbol} {format(new Date(pair.entry_timestamp), "MMM d")}→{format(new Date(pair.exit_timestamp), "MMM d")} <span style={{ color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)", fontWeight: "600" }}>{pair.net_profit_loss >= 0 ? "+" : ""}{pair.net_profit_loss.toFixed(2)}</span>
                      </button>
                      <button type="button" onClick={async () => { if (!selectedEntry?.id) return; const remaining = linkedPairs.filter((p) => !(p.entry_trade_id === pair.entry_trade_id && p.exit_trade_id === pair.exit_trade_id)); try { if (dataMode === "sandbox") { setSandboxJournalEntryPairs(selectedEntry.id, remaining.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id }))); setLinkedPairs(remaining); } else { await invoke("set_journal_entry_pairs", { journalEntryId: selectedEntry.id, pairs: remaining.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })) }); setLinkedPairs(remaining); } } catch (err) { console.error(err); alert("Failed to unlink."); } }} style={{ padding: "4px 6px", borderLeft: "1px solid var(--border-color)", background: "none", color: "var(--text-secondary)", cursor: "pointer" }} title="Unlink"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Section nav: scroll-to links + reorder */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px", padding: "6px 12px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
                {effectiveSectionOrder
                  .filter((sectionId) => !EMOTIONAL_STATE_SECTIONS_HIDDEN_UNTIL_STARTED.includes(sectionId as JournalSectionId) || showAddEmotionalStateForm)
                  .map((sectionId) => (
                  <button
                    key={sectionId}
                    type="button"
                    onClick={() => scrollToSection(sectionId)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent)";
                      e.currentTarget.style.color = "white";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--bg-primary)";
                      e.currentTarget.style.color = "var(--accent)";
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: "500",
                      letterSpacing: "0.02em",
                      color: "var(--accent)",
                      background: "var(--bg-primary)",
                      border: "1px solid var(--accent)",
                      borderRadius: "999px",
                      cursor: "pointer",
                      transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
                    }}
                  >
                    {getSectionLabel(sectionId)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowSectionOrderModal(true)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "var(--text-secondary)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border-color)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    fontWeight: "500",
                    letterSpacing: "0.02em",
                    color: "var(--text-secondary)",
                    background: "transparent",
                    border: "1px dashed var(--border-color)",
                    borderRadius: "999px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
                  }}
                  title="Reorder sections"
                >
                  <GripVertical size={11} /> Order
                </button>
              </div>
                </>
              )}

              {/* Main scrolling content: sections in trader order */}
              {currentTrade && (
                <>
                  <div ref={journalScrollContainerRef} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", padding: "16px 20px" }}>
                    {effectiveSectionOrder.map((sectionId) => {
                      const hideUntilEmoStarted = EMOTIONAL_STATE_SECTIONS_HIDDEN_UNTIL_STARTED.includes(sectionId as JournalSectionId) && !showAddEmotionalStateForm;
                      if (hideUntilEmoStarted) return null;
                      return (
                      <div key={sectionId} id={`section-${sectionId}`} ref={(el) => { sectionRefs.current.set(sectionId, el); }} style={{ marginBottom: "28px", scrollMarginTop: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                          <h3 style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {getSectionLabelScroll(sectionId)}
                          </h3>
                          {sectionId === "emotional_state_before" && (isCreating || isEditing) && showAddEmotionalStateForm && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowAddEmotionalStateForm(false);
                                setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
                                setTimeout(() => {
                                  const idx = effectiveSectionOrder.indexOf("emotional_state_before");
                                  const nextId = idx >= 0 && idx < effectiveSectionOrder.length - 1 ? effectiveSectionOrder[idx + 1] : null;
                                  if (nextId) scrollToSection(nextId);
                                }, 0);
                              }}
                              style={{
                                padding: "6px 14px",
                                background: "transparent",
                                border: "1px solid var(--accent)",
                                borderRadius: "999px",
                                color: "var(--accent)",
                                fontSize: "11px",
                                cursor: "pointer",
                                fontWeight: 600,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                              }}
                            >
                              Skip
                            </button>
                          )}
                        </div>
                        {sectionId === "implementation" && (
                          <RichTextEditor value={currentTrade.trade} onChange={(content: string) => updateTradeFormData(activeTradeIndex, "trade", content)} placeholder="Describe the related trades..." readOnly={false} />
                        )}
                        {sectionId === "what_went_well" && (
                          <RichTextEditor value={currentTrade.what_went_well} onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_went_well", content)} placeholder="What went well..." readOnly={false} />
                        )}
                        {sectionId === "what_could_be_improved" && (
                          <RichTextEditor value={currentTrade.what_could_be_improved} onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_could_be_improved", content)} placeholder="What could be improved..." readOnly={false} />
                        )}
                        {sectionId === "notes" && (
                          <RichTextEditor value={currentTrade.notes} onChange={(content: string) => updateTradeFormData(activeTradeIndex, "notes", content)} placeholder="Notes..." readOnly={false} />
                        )}
                        {sectionId === "analysis_checklist" && renderChecklistForType("daily_analysis")}
                        {sectionId === "mantra_checklist" && renderChecklistForType("daily_mantra")}
                        {sectionId === "entry_checklist" && (
                          <>
                          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 0", minWidth: 280 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                Entry Checklist
                              </div>
                              {renderChecklistForType("entry")}
                            </div>
                            <div style={{ flex: "1 1 0", minWidth: 280 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                Entry Rules
                              </div>
                              {strategyEntryRuleTexts.length === 0 ? (
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                                  No entry rules configured.
                                </p>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {strategyEntryRuleTexts.map((rule, idx) => (
                                    <div
                                      key={`${idx}`}
                                      style={{
                                        padding: "10px 12px",
                                        background: "var(--bg-tertiary)",
                                        border: "1px solid var(--border-color)",
                                        borderLeft: "3px solid var(--accent)",
                                        borderRadius: 8,
                                        color: "var(--text-primary)",
                                        fontSize: 13,
                                        lineHeight: 1.35,
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {rule}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ marginTop: "12px" }}>{renderIndicatorInputs("entry")}</div>
                          </>
                        )}
                        {sectionId === "take_profit_checklist" && (
                          <>
                          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 0", minWidth: 280 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                Take Profit Checklist
                              </div>
                              {renderChecklistForType("take_profit")}
                            </div>
                            <div style={{ flex: "1 1 0", minWidth: 280 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                Take Profit Rules
                              </div>
                              {strategyTakeProfitRuleTexts.length === 0 ? (
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                                  No take profit rules configured.
                                </p>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {strategyTakeProfitRuleTexts.map((rule, idx) => (
                                    <div
                                      key={`${idx}`}
                                      style={{
                                        padding: "10px 12px",
                                        background: "var(--bg-tertiary)",
                                        border: "1px solid var(--border-color)",
                                        borderLeft: "3px solid var(--accent)",
                                        borderRadius: 8,
                                        color: "var(--text-primary)",
                                        fontSize: 13,
                                        lineHeight: 1.35,
                                        whiteSpace: "pre-wrap",
                                      }}
                                    >
                                      {rule}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ marginTop: "12px" }}>{renderIndicatorInputs("exit")}</div>
                          </>
                        )}
                        {sectionId.startsWith("custom_rules:") && (!entryFormData.strategy_id || !strategyCustomRuleSets) && (
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Select a strategy to load custom rules.</p>
                        )}
                        {sectionId.startsWith("custom_rules:") && entryFormData.strategy_id && (() => {
                          const ruleSetId = sectionId.slice("custom_rules:".length);
                          const ruleSet = strategyCustomRuleSets.find((s) => s.id === ruleSetId);
                          const rules = ruleSet?.rules ?? [];
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {rules.length === 0 ? (
                                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                                  No custom rules configured.
                                </p>
                              ) : (
                                rules.map((rule, idx) => (
                                  <div
                                    key={`${ruleSetId}-${idx}`}
                                    style={{
                                      padding: "10px 12px",
                                      background: "var(--bg-tertiary)",
                                      border: "1px solid var(--border-color)",
                                      borderLeft: "3px solid var(--accent)",
                                      borderRadius: 8,
                                      color: "var(--text-primary)",
                                      fontSize: 13,
                                      lineHeight: 1.35,
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {rule}
                                  </div>
                                ))
                              )}
                            </div>
                          );
                        })()}
                        {sectionId.startsWith("custom:") && (!entryFormData.strategy_id || !currentChecklists) && (
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Select a strategy to load custom checklists and surveys.</p>
                        )}
                        {sectionId.startsWith("custom:") && entryFormData.strategy_id && currentChecklists && (() => {
                          const type = sectionId.slice(7);
                          if (type === "survey") {
                            const rawSurveyItems = currentChecklists.get("survey") || [];
                            const surveyItems = rawSurveyItems.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                            if (surveyItems.length === 0) return <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No survey items.</p>;
                            const groups = surveyItems.filter(item => !item.parent_id && surveyItems.some(child => child.parent_id === item.id));
                            const regularItems = surveyItems.filter(item => !item.parent_id && !surveyItems.some(child => child.parent_id === item.id));
                            const groupedItems = surveyItems.filter(item => item.parent_id !== null && surveyItems.some(p => p.id === item.parent_id));
                            const itemsByParent = new Map<number, ChecklistItem[]>();
                            groupedItems.forEach(item => { if (item.parent_id) { const pid = item.parent_id; if (!itemsByParent.has(pid)) itemsByParent.set(pid, []); itemsByParent.get(pid)!.push(item); } });
                            return (
                              <div>
                                {groups.map((group) => {
                                  const children = itemsByParent.get(group.id) || [];
                                  return (
                                    <div key={group.id} style={{ marginBottom: "12px" }}>
                                      <div style={{ padding: "10px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", marginBottom: "6px", fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>{group.item_text}</div>
                                      {children.map((child) => {
                                        const score = surveyScores.get(activeTradeIndex)?.get(child.id);
                                        return (
                                          <div key={child.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 12px", marginLeft: "16px", marginBottom: "4px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                                            <label style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)" }}>{child.item_text}</label>
                                            <div style={{ display: "flex", gap: "4px" }}>
                                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                                <button key={n} type="button" onClick={() => { setSurveyScores(prev => { const next = new Map(prev); const tradeMap = new Map(next.get(activeTradeIndex)); tradeMap.set(child.id, n); next.set(activeTradeIndex, tradeMap); return next; }); setChecklistResponses(prev => { const m = new Map(prev); const tr = new Map(m.get(activeTradeIndex) || new Map()); tr.set(child.id, true); m.set(activeTradeIndex, tr); return m; }); }} style={{ width: "28px", height: "28px", padding: 0, borderRadius: "6px", border: `1px solid ${score === n ? "var(--accent)" : "var(--border-color)"}`, backgroundColor: score === n ? "var(--accent)" : "var(--bg-secondary)", color: score === n ? "white" : "var(--text-primary)", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>{n}</button>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                                {regularItems.map((item) => {
                                  const score = surveyScores.get(activeTradeIndex)?.get(item.id);
                                  return (
                                    <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 12px", marginBottom: "4px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                                      <label style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)" }}>{item.item_text}</label>
                                      <div style={{ display: "flex", gap: "4px" }}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                          <button key={n} type="button" onClick={() => { setSurveyScores(prev => { const next = new Map(prev); const tradeMap = new Map(next.get(activeTradeIndex)); tradeMap.set(item.id, n); next.set(activeTradeIndex, tradeMap); return next; }); setChecklistResponses(prev => { const m = new Map(prev); const tr = new Map(m.get(activeTradeIndex) || new Map()); tr.set(item.id, true); m.set(activeTradeIndex, tr); return m; }); }} style={{ width: "28px", height: "28px", padding: 0, borderRadius: "6px", border: `1px solid ${score === n ? "var(--accent)" : "var(--border-color)"}`, backgroundColor: score === n ? "var(--accent)" : "var(--bg-secondary)", color: score === n ? "white" : "var(--text-primary)", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>{n}</button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return renderChecklistForType(type);
                        })()}
                        {sectionId === "links" && (isCreating || isEditing) && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                            <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>Link this journal to emotional states, positions, or real trades. Saved when you save the entry.</p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                              {(["emotional_state", "trade_pair", "real_trade"] as const).map((option) => {
                                const isActive = linksSectionActiveOption === option;
                                const label = option === "emotional_state" ? "Link to existing emotional state" : option === "trade_pair" ? "Link to position" : "Link to real trade";
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => setLinksSectionActiveOption((prev) => (prev === option ? null : option))}
                                    onMouseEnter={(e) => {
                                      if (!isActive) {
                                        e.currentTarget.style.background = "var(--bg-hover)";
                                        e.currentTarget.style.color = "var(--text-primary)";
                                        e.currentTarget.style.borderColor = "var(--accent)";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isActive) {
                                        e.currentTarget.style.background = "var(--bg-primary)";
                                        e.currentTarget.style.color = "var(--accent)";
                                        e.currentTarget.style.borderColor = "var(--accent)";
                                      }
                                    }}
                                    style={{
                                      padding: "6px 12px",
                                      fontSize: "12px",
                                      fontWeight: "500",
                                      color: isActive ? "white" : "var(--accent)",
                                      background: isActive ? "var(--accent)" : "var(--bg-primary)",
                                      border: "1px solid var(--accent)",
                                      borderRadius: "999px",
                                      cursor: "pointer",
                                      transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
                                    }}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                            {linksSectionActiveOption === "emotional_state" && (
                              <div style={{ padding: "14px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", marginBottom: "12px" }}>
                                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>Link to</span>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px", borderRadius: "999px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}>
                                    <button type="button" onClick={() => { setLinkExistingEmotionalStateScope("entry"); setLinkExistingEmotionalStateTradeIndex(null); }} style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "999px", border: "none", cursor: "pointer", backgroundColor: linkExistingEmotionalStateScope === "entry" ? "var(--accent)" : "transparent", color: linkExistingEmotionalStateScope === "entry" ? "white" : "var(--text-secondary)", fontWeight: 500 }}>Entire journal entry</button>
                                    <button type="button" onClick={() => setLinkExistingEmotionalStateScope("trades")} style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "999px", border: "none", cursor: "pointer", backgroundColor: linkExistingEmotionalStateScope === "trades" ? "var(--accent)" : "transparent", color: linkExistingEmotionalStateScope === "trades" ? "white" : "var(--text-secondary)", fontWeight: 500 }}>Specific trade(s)</button>
                                  </div>
                                  {linkExistingEmotionalStateScope === "trades" && (
                                    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "6px" }}>
                                      {tradesFormData.map((t, i) => (
                                        <button key={i} type="button" onClick={() => setLinkExistingEmotionalStateTradeIndex(i)} style={{ padding: "4px 8px", fontSize: "11px", borderRadius: "6px", border: "1px solid var(--border-color)", cursor: "pointer", backgroundColor: linkExistingEmotionalStateTradeIndex === i ? "var(--accent)" : "var(--bg-primary)", color: linkExistingEmotionalStateTradeIndex === i ? "white" : "var(--text-secondary)" }}>{t.symbol || `Trade ${i + 1}`}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {groupEmotionalStatesByTimestamp(emotionalStatesForCurrentTrade).length > 0 && (
                                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                    {groupEmotionalStatesByTimestamp(emotionalStatesForCurrentTrade).map((group) => {
                                      const first = group[0];
                                      const stateIds = group.map((s) => s.id);
                                      return (
                                        <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                          <span style={{ fontSize: "12px", color: "var(--text-primary)" }}>{format(new Date(first.timestamp), "MMM d, HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => { const next = (prev.linked_emotional_state_ids ?? []).filter((id) => !stateIds.includes(id)); const scopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) }; stateIds.forEach((id) => delete scopes[id]); return { ...prev, linked_emotional_state_ids: next, linked_emotional_state_link_scopes: scopes }; })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer" }}>Remove</button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                                <div style={{ position: "relative" }} ref={journalLinksStateDropdownRefScroll}>
                                  <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                    <span>Add emotional state...</span>
                                    <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                  </button>
                                  {journalLinksStateDropdownOpen && (() => {
                                    const linkedIds = new Set(entryFormData.linked_emotional_state_ids ?? []);
                                    const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                    const addableGroups = allGroups.filter((g) => !linkedIds.has(g[0].id));
                                    const scope = { scope: linkExistingEmotionalStateScope, tradeIndex: linkExistingEmotionalStateScope === "trades" ? linkExistingEmotionalStateTradeIndex : null };
                                    return (
                                      <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "200px", overflowY: "auto", minWidth: "280px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                        {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-secondary)" }}>All selected or none exist.</div> : addableGroups.map((group) => {
                                          const first = group[0];
                                          return (
                                            <button key={first.timestamp} type="button" onClick={() => { setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [...(prev.linked_emotional_state_ids ?? []), first.id], linked_emotional_state_link_scopes: { ...(prev.linked_emotional_state_link_scopes ?? {}), [first.id]: scope } })); setJournalLinksStateDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "12px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                              {format(new Date(first.timestamp), "MMM d, HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                            {linksSectionActiveOption === "trade_pair" && (
                              <div style={{ padding: "14px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 10px" }}>Link entry/exit positions from your Trades tab. Positions appear above the content and are clickable for charts. Links are saved when you save the journal entry.</p>
                                {(() => {
                                  const pairsList = selectedEntry?.id ? linkedPairs : pendingLinkedPairs;
                                  return (
                                    <>
                                      {pairsList.length > 0 && (
                                        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                          {pairsList.map((pair) => (
                                            <li key={`${pair.entry_trade_id}_${pair.exit_trade_id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                              <span style={{ fontSize: "12px", color: "var(--text-primary)" }}>{pair.symbol ?? "—"} · Entry #{pair.entry_trade_id} / Exit #{pair.exit_trade_id}</span>
                                              <button
                                                type="button"
                                                onClick={async () => {
                                                  const remaining = pairsList.filter((p) => !(p.entry_trade_id === pair.entry_trade_id && p.exit_trade_id === pair.exit_trade_id));
                                                  if (selectedEntry?.id) {
                                                    try {
                                                      if (dataMode === "sandbox") {
                                                        setSandboxJournalEntryPairs(selectedEntry.id, remaining.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })));
                                                        setLinkedPairs(remaining);
                                                      } else {
                                                        await invoke("set_journal_entry_pairs", { journalEntryId: selectedEntry.id, pairs: remaining.map((p) => ({ entry_trade_id: p.entry_trade_id, exit_trade_id: p.exit_trade_id })) });
                                                        setLinkedPairs(remaining);
                                                      }
                                                    } catch (err) {
                                                      console.error(err);
                                                      alert("Failed to unlink.");
                                                    }
                                                  } else {
                                                    setPendingLinkedPairs(remaining);
                                                  }
                                                }}
                                                style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer" }}
                                              >
                                                Remove
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setShowLinkPairsModal(true);
                                          setLinkPairsSearchQuery("");
                                          setLinkPairsSortBy("date");
                                          setLinkPairsSortDirection("desc");
                                          const method = localStorage.getItem("tradebutler_pairing_method") || "FIFO";
                                          const all = await invoke<PairedTrade[]>("get_paired_trades", { pairingMethod: method || null });
                                          setAllPairsForPicker(all);
                                          const currentPairs = selectedEntry?.id ? linkedPairs : pendingLinkedPairs;
                                          setLinkPickerSelected(new Set(currentPairs.map((p) => `${p.entry_trade_id}_${p.exit_trade_id}`)));
                                        }}
                                        style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--accent)", border: "1px solid var(--accent)", borderRadius: "6px", color: "white", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}
                                      >
                                        <Link2 size={14} /> Add positions
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            {linksSectionActiveOption === "real_trade" && (
                              <div style={{ padding: "14px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 10px" }}>Link this journal to executed trades from your Trades tab.</p>
                                {(entryFormData.linked_trade_ids?.length ?? 0) > 0 && (
                                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                    {(entryFormData.linked_trade_ids ?? []).map((tradeId) => {
                                      const t = realTradesForLink.find((r) => r.id === tradeId);
                                      return (
                                        <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                          <span style={{ fontSize: "12px", color: "var(--text-primary)" }}>{t ? `${t.symbol} ${t.side}${t.quantity ? ` · ${t.quantity}` : ""}${t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · ${format(new Date(t.timestamp), "MMM dd")}` : `#${tradeId}`}</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => ({ ...prev, linked_trade_ids: (prev.linked_trade_ids ?? []).filter((id) => id !== tradeId) }))} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer" }}>Remove</button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                                <div style={{ position: "relative" }} ref={journalLinksTradeDropdownRefScroll}>
                                  <button type="button" onClick={() => setJournalLinksTradeDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                    <span>Add real trade...</span>
                                    <ChevronDown size={16} style={{ transform: journalLinksTradeDropdownOpen ? "rotate(180deg)" : "none" }} />
                                  </button>
                                  {journalLinksTradeDropdownOpen && (
                                    <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "200px", overflowY: "auto", minWidth: "280px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                      {realTradesForLink.map((t) => {
                                        const ids = entryFormData.linked_trade_ids ?? [];
                                        const isLinked = ids.includes(t.id);
                                        return (
                                          <button
                                            key={t.id}
                                            type="button"
                                            disabled={isLinked}
                                            onClick={() => {
                                              if (!isLinked) {
                                                const stateIdsForTrade = getEmotionalStateIdsForRealTrade(t.id, allEmotionalStates);
                                                const scope = { scope: "entry" as const, tradeIndex: null };
                                                setEntryFormData((prev) => {
                                                  const newLinkedIds = [...(prev.linked_trade_ids ?? []), t.id];
                                                  const existingStateIds = new Set(prev.linked_emotional_state_ids ?? []);
                                                  const newStateIds = [...existingStateIds];
                                                  const newScopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) };
                                                  for (const sid of stateIdsForTrade) {
                                                    if (!existingStateIds.has(sid)) {
                                                      newStateIds.push(sid);
                                                      newScopes[sid] = scope;
                                                    }
                                                  }
                                                  return { ...prev, linked_trade_ids: newLinkedIds, linked_emotional_state_ids: newStateIds, linked_emotional_state_link_scopes: newScopes };
                                                });
                                              }
                                              setJournalLinksTradeDropdownOpen(false);
                                            }}
                                            style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "12px", color: isLinked ? "var(--text-secondary)" : "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: isLinked ? "default" : "pointer", opacity: isLinked ? 0.8 : 1 }}
                                            onMouseEnter={(e) => { if (!isLinked) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                          >
                                            {t.symbol} {t.side}{t.quantity ? ` · ${t.quantity}` : ""}{t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · {format(new Date(t.timestamp), "MMM dd")}{isLinked && " ✓"}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {sectionId === "emotional_state_before" && (isCreating || isEditing) && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {!showAddEmotionalStateForm && (
                              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowAddEmotionalStateForm(true);
                                    setNewEmotionalStateLinkScope("trades");
                                    setNewEmotionalStateTradeIndices([activeTradeIndex]);
                                    setLinkExistingEmotionalStateScope("trades");
                                    setLinkExistingEmotionalStateTradeIndex(activeTradeIndex);
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "var(--accent-hover)";
                                    e.currentTarget.style.borderColor = "var(--accent-hover)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "var(--accent)";
                                    e.currentTarget.style.borderColor = "var(--accent)";
                                  }}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "6px",
                                    padding: "8px 14px",
                                    background: "var(--accent)",
                                    border: "1px solid var(--accent)",
                                    borderRadius: "6px",
                                    color: "white",
                                    fontSize: "13px",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    transition: "background 0.15s ease, border-color 0.15s ease",
                                  }}
                                >
                                  + Add emotional state
                                </button>
                              </div>
                            )}
                            {showAddEmotionalStateForm && (
                              <>
                                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", padding: "8px 12px", backgroundColor: "var(--bg-secondary)", borderRadius: "6px", border: "1px solid var(--border-color)" }}>
                                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>Link to</span>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px", borderRadius: "999px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)" }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewEmotionalStateLinkScope("entry");
                                        setNewEmotionalStateTradeIndices([]);
                                        setLinkExistingEmotionalStateScope("entry");
                                        setLinkExistingEmotionalStateTradeIndex(null);
                                      }}
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "11px",
                                        borderRadius: "999px",
                                        border: "none",
                                        cursor: "pointer",
                                        backgroundColor: newEmotionalStateLinkScope === "entry" ? "var(--accent)" : "transparent",
                                        color: newEmotionalStateLinkScope === "entry" ? "white" : "var(--text-secondary)",
                                        fontWeight: 500,
                                      }}
                                    >
                                      Entire entry
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewEmotionalStateLinkScope("trades");
                                        setLinkExistingEmotionalStateScope("trades");
                                      }}
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "11px",
                                        borderRadius: "999px",
                                        border: "none",
                                        cursor: "pointer",
                                        backgroundColor: newEmotionalStateLinkScope === "trades" ? "var(--accent)" : "transparent",
                                        color: newEmotionalStateLinkScope === "trades" ? "white" : "var(--text-secondary)",
                                        fontWeight: 500,
                                      }}
                                    >
                                      Trade(s)
                                    </button>
                                  </div>
                                  {newEmotionalStateLinkScope === "trades" && (
                                    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: "6px", marginLeft: "4px" }}>
                                      {tradesFormData.map((t, i) => {
                                        const checked = newEmotionalStateTradeIndices.includes(i);
                                        const isOnlySelected = checked && newEmotionalStateTradeIndices.length === 1;
                                        return (
                                          <label key={i} style={{ display: "inline-flex", alignItems: "center", gap: "4px", cursor: isOnlySelected ? "default" : "pointer", fontSize: "11px", color: "var(--text-secondary)", opacity: isOnlySelected ? 0.9 : 1 }}>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              disabled={isOnlySelected}
                                              onChange={() => {
                                                if (isOnlySelected) return;
                                                const next = checked ? newEmotionalStateTradeIndices.filter((j) => j !== i) : [...newEmotionalStateTradeIndices, i];
                                                setNewEmotionalStateTradeIndices(next);
                                                setLinkExistingEmotionalStateTradeIndex(next[0] ?? null);
                                              }}
                                            />
                                            {t.symbol || `Trade ${i + 1}`}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                <p style={{ margin: "0 0 8px", fontSize: "11px", color: "var(--text-secondary)" }}>{INTENSITY_SCALE_LABEL}</p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                                  {JOURNAL_EMOTIONS.map((emotion) => {
                                    const intensity = newEmotionalStateForm.selectedEmotions[emotion];
                                    const isSelected = intensity !== undefined;
                                    return (
                                      <button key={emotion} type="button" onClick={() => { if (isSelected) { const next = { ...newEmotionalStateForm.selectedEmotions }; delete next[emotion]; setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: next })); } else { setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: { ...f.selectedEmotions, [emotion]: DEFAULT_EMOTION_INTENSITY } })); } }} style={{ padding: "6px 12px", borderRadius: "999px", border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`, backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: "12px", fontWeight: isSelected ? "600" : "500", cursor: "pointer" }}>{emotion}{isSelected && ` ${intensity}/10`}</button>
                                    );
                                  })}
                                </div>
                                {Object.keys(newEmotionalStateForm.selectedEmotions).length > 0 && (
                                  <div style={{ marginBottom: "12px" }}>
                                    {Object.entries(newEmotionalStateForm.selectedEmotions).map(([emotion, intensity]) => (
                                      <div key={emotion} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                        <span style={{ minWidth: "80px", fontSize: "12px" }}>{emotion}</span>
                                        <input type="range" min={0} max={10} value={intensity} onChange={(e) => setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: { ...f.selectedEmotions, [emotion]: parseInt(e.target.value, 10) } }))} style={{ flex: 1, maxWidth: "160px", accentColor: "var(--accent)" }} />
                                        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--accent)", minWidth: "24px" }}>{intensity}/10</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <h4 style={{ margin: "12px 0 8px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>Before trade</h4>
                                {JOURNAL_SURVEY_QUESTIONS.before.map((q) => (
                                  <div key={q.key} style={{ marginBottom: "12px" }}>
                                    <label style={{ display: "block", marginBottom: "4px", fontSize: "12px" }}>{q.question}</label>
                                    <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>{q.scale}</p>
                                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>1</span>
                                      <input type="range" min={1} max={10} value={newEmotionalStateSurveyResponses[q.key] ?? 6} onChange={(e) => setNewEmotionalStateSurveyResponses((r) => ({ ...r, [q.key]: parseInt(e.target.value, 10) }))} style={{ flex: 1, minWidth: "60px", accentColor: "var(--accent)" }} />
                                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>10</span>
                                      <span style={{ minWidth: "24px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--accent)" }}>{newEmotionalStateSurveyResponses[q.key] ?? 6}</span>
                                    </div>
                                  </div>
                                ))}
                                <p style={{ margin: "12px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Fill during/after/notes below, then add in Emo. Notes section.</p>
                              </div>
                              </>
                            )}
                          </div>
                        )}
                        {sectionId === "emotional_state_during" && (isCreating || isEditing) && showAddEmotionalStateForm && (
                          <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                            <h4 style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>During trade</h4>
                            {JOURNAL_SURVEY_QUESTIONS.during.map((q) => (
                              <div key={q.key} style={{ marginBottom: "12px" }}>
                                <label style={{ display: "block", marginBottom: "4px", fontSize: "12px" }}>{q.question}</label>
                                <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>{q.scale}</p>
                                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>1</span>
                                  <input type="range" min={1} max={10} value={newEmotionalStateSurveyResponses[q.key] ?? 6} onChange={(e) => setNewEmotionalStateSurveyResponses((r) => ({ ...r, [q.key]: parseInt(e.target.value, 10) }))} style={{ flex: 1, minWidth: "60px", accentColor: "var(--accent)" }} />
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>10</span>
                                  <span style={{ minWidth: "24px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--accent)" }}>{newEmotionalStateSurveyResponses[q.key] ?? 6}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {sectionId === "emotional_state_after" && (isCreating || isEditing) && showAddEmotionalStateForm && (
                          <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                            <h4 style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase" }}>After trade</h4>
                            {JOURNAL_SURVEY_QUESTIONS.after.map((q) => (
                              <div key={q.key} style={{ marginBottom: "12px" }}>
                                <label style={{ display: "block", marginBottom: "4px", fontSize: "12px" }}>{q.question}</label>
                                <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>{q.scale}</p>
                                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>1</span>
                                  <input type="range" min={1} max={10} value={newEmotionalStateSurveyResponses[q.key] ?? 6} onChange={(e) => setNewEmotionalStateSurveyResponses((r) => ({ ...r, [q.key]: parseInt(e.target.value, 10) }))} style={{ flex: 1, minWidth: "60px", accentColor: "var(--accent)" }} />
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>10</span>
                                  <span style={{ minWidth: "24px", textAlign: "center", fontSize: "12px", fontWeight: "600", color: "var(--accent)" }}>{newEmotionalStateSurveyResponses[q.key] ?? 6}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {sectionId === "emotional_state_notes" && (isCreating || isEditing) && (
                          <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                            <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>Notes for this emotional state.</p>
                            <RichTextEditor value={newEmotionalStateForm.notes} onChange={(content: string) => setNewEmotionalStateForm((f) => ({ ...f, notes: content }))} placeholder="Notes..." readOnly={false} />
                            {showAddEmotionalStateForm && (
                              <button type="button" disabled={Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 || (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0)} onClick={async () => {
                                const hasAny = Object.keys(newEmotionalStateForm.selectedEmotions).length > 0;
                                if (!hasAny || (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0)) return;
                                const entryId = selectedEntry?.id;
                                const savedEntry = entryId != null;
                                if (savedEntry) {
                                  try {
                                    const now = new Date().toISOString();
                                    const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
                                    const allStates = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId!, ...paperArgs });
                                    const deleteGroup = async (group: JournalEmotionalState[]) => { for (const s of group) await invoke("delete_emotional_state", { id: s.id }); };
                                    let firstStateId: number | null = null;
                                    if (newEmotionalStateLinkScope === "entry") {
                                      const entryLevel = allStates.filter((s) => s.journal_trade_id == null);
                                      const groups = groupEmotionalStatesByTimestamp(entryLevel);
                                      for (const g of groups) await deleteGroup(g);
                                      for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                        const stateId = await invoke<number>("add_emotional_state", { timestamp: now, emotion, intensity: newEmotionalStateForm.selectedEmotions[emotion], notes: newEmotionalStateForm.notes || null, tradeId: null, journalEntryId: entryId, journalTradeId: null, isPaper: dataMode === "paper" });
                                        if (firstStateId === null) firstStateId = stateId;
                                      }
                                    } else {
                                      for (const tradeIdx of newEmotionalStateTradeIndices) {
                                        const trade = tradesFormData[tradeIdx];
                                        const jtId = trade?.id ?? null;
                                        if (jtId == null) continue;
                                        const forTrade = allStates.filter((s) => s.journal_trade_id === jtId);
                                        const groups = groupEmotionalStatesByTimestamp(forTrade);
                                        for (const g of groups) await deleteGroup(g);
                                        for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                          const stateId = await invoke<number>("add_emotional_state", { timestamp: now, emotion, intensity: newEmotionalStateForm.selectedEmotions[emotion], notes: newEmotionalStateForm.notes || null, tradeId: null, journalEntryId: entryId, journalTradeId: jtId, isPaper: dataMode === "paper" });
                                          if (firstStateId === null) firstStateId = stateId;
                                        }
                                      }
                                    }
                                    const sr = newEmotionalStateSurveyResponses;
                                    const shouldSaveSurvey = Object.values(JOURNAL_SURVEY_QUESTIONS).flat().some((q) => (sr[q.key] ?? 6) !== 6);
                                    if (shouldSaveSurvey && firstStateId != null) {
                                      try {
                                        await invoke("add_emotion_survey", { emotional_state_id: firstStateId, timestamp: now, before_calm_clear: sr.before_calm_clear ?? 6, before_urgency_pressure: sr.before_urgency_pressure ?? 6, before_confidence_vs_validation: sr.before_confidence_vs_validation ?? 6, before_fomo: sr.before_fomo ?? 6, before_recovering_loss: sr.before_recovering_loss ?? 6, before_patient_detached: sr.before_patient_detached ?? 6, before_trust_process: sr.before_trust_process ?? 6, before_emotional_state: sr.before_emotional_state ?? 6, during_stable: sr.during_stable ?? 6, during_tension_stress: sr.during_tension_stress ?? 6, during_tempted_interfere: sr.during_tempted_interfere ?? 6, during_need_control: sr.during_need_control ?? 6, during_fear_loss: sr.during_fear_loss ?? 6, during_excitement_greed: sr.during_excitement_greed ?? 6, during_mentally_present: sr.during_mentally_present ?? 6, after_accept_outcome: sr.after_accept_outcome ?? 6, after_emotional_reaction: sr.after_emotional_reaction ?? 6, after_confidence_affected: sr.after_confidence_affected ?? 6, after_tempted_another_trade: sr.after_tempted_another_trade ?? 6, after_proud_discipline: sr.after_proud_discipline ?? 6 });
                                      } catch (err) { console.error("Failed to save emotion survey:", err); }
                                    }
                                    const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId!, ...paperArgs });
                                    setJournalEmotionalStates(states);
                                    setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
                                    setNewEmotionalStateLinkScope("entry");
                                    setNewEmotionalStateTradeIndices([]);
                                    setShowAddEmotionalStateForm(false);
                                  } catch (e) { console.error(e); }
                                } else {
                                  const surveyPayload = { ...newEmotionalStateSurveyResponses };
                                  if (newEmotionalStateLinkScope === "entry") {
                                    setPendingEmotionalStates((prev) => prev.filter((p) => p.tradeIndex !== -1).concat([{ tradeIndex: -1, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: surveyPayload }]));
                                  } else {
                                    let next = pendingEmotionalStates.filter((p) => p.tradeIndex === -1 || !newEmotionalStateTradeIndices.includes(p.tradeIndex));
                                    for (const i of newEmotionalStateTradeIndices) {
                                      next = next.filter((p) => p.tradeIndex !== i);
                                      next.push({ tradeIndex: i, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: surveyPayload });
                                    }
                                    setPendingEmotionalStates(next);
                                  }
                                  setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
                                  setNewEmotionalStateLinkScope("entry");
                                  setNewEmotionalStateTradeIndices([]);
                                  setShowAddEmotionalStateForm(false);
                                }
                              }} style={{ marginTop: "12px", padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600", opacity: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? 0.6 : 1 }}>Add emotional state to entry</button>
                            )}
                          </div>
                        )}
                      </div>
                    ); })}
                  </div>
                  {/* Duplicate trade fields and section tabs removed - content in consolidated bar and scrolling sections above */}

                  {/* Tab Content - hidden; section content is in scrolling sections above. Shown only when maximized for legacy tab switcher. */}
                  <div style={{ flex: 1, overflow: "hidden", display: isTabContentMaximized ? "flex" : "none", flexDirection: "column", padding: isTabContentMaximized ? "40px" : "20px", position: "relative" }}>
                    {/* Maximize button for tab content */}
                    <button
                      onClick={() => setIsTabContentMaximized(!isTabContentMaximized)}
                      style={{
                        position: "absolute",
                        top: isTabContentMaximized ? "40px" : "20px",
                        right: isTabContentMaximized ? "40px" : "20px",
                        zIndex: 10,
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "8px",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                      }}
                      title={isTabContentMaximized ? "Restore" : "Maximize"}
                    >
                      {isTabContentMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                    {/* Show active tab label and switcher when maximized */}
                    {isTabContentMaximized && (
                      <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: "1px solid var(--border-color)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                          <h3 style={{ fontSize: "18px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {[
                              { id: "trade" as TabType, label: "Implementation" },
                              { id: "what_went_well" as TabType, label: "What Went Well" },
                              { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                              { id: "emotional_state" as TabType, label: "Emotional State" },
                              { id: "notes" as TabType, label: "Notes" },
                              { id: "checklists" as TabType, label: "Checklists" },
                              { id: "survey" as TabType, label: "Survey" },
                              { id: "links" as TabType, label: "Links" },
                            ].find(tab => tab.id === activeTab)?.label || "Tab"}
                          </h3>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {[
                            { id: "trade" as TabType, label: "Implementation" },
                            { id: "what_went_well" as TabType, label: "What Went Well" },
                            { id: "what_could_be_improved" as TabType, label: "What Could Be Improved" },
                            { id: "emotional_state" as TabType, label: "Emotional State" },
                            { id: "notes" as TabType, label: "Notes" },
                            { id: "checklists" as TabType, label: "Checklists" },
                            { id: "survey" as TabType, label: "Survey" },
                            { id: "links" as TabType, label: "Links" },
                          ].map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                style={{
                                  padding: "8px 16px",
                                  background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
                                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border-color)"}`,
                                  borderRadius: "6px",
                                  color: isActive ? "white" : "var(--text-primary)",
                                  cursor: "pointer",
                                  fontSize: "13px",
                                  fontWeight: isActive ? "600" : "400",
                                  transition: "all 0.2s",
                                }}
                              >
                                {tab.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {activeTab === "trade" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("trade", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("trade", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.trade}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "trade", content)}
                          placeholder="Describe the related trades..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_went_well" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("what_went_well", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("what_went_well", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.what_went_well}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_went_well", content)}
                          placeholder="What went well..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "what_could_be_improved" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("what_could_be_improved", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("what_could_be_improved", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.what_could_be_improved}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "what_could_be_improved", content)}
                          placeholder="What could be improved..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "links" && (
                      <div
                        ref={(el) => { tabContentRefs.current.set("links", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => {
                          tabScrollPositions.current.set("links", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        {!(isCreating || isEditing) ? (
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Click <strong>Edit</strong> to manage links for this journal entry. Link to emotional state entries and real trades from this tab.</p>
                        ) : !selectedEntry?.id ? (
                          <>
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Emotions</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal to emotional state entries. Links are saved when you save the journal entry.</p>
                              <div style={{ marginBottom: "16px" }}>
                                <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. This applies to the <strong>next</strong> state you link—change the selection before each link to associate different states with different trades.</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScope" checked={linkExistingEmotionalStateScope === "entry"} onChange={() => { setLinkExistingEmotionalStateScope("entry"); setLinkExistingEmotionalStateTradeIndex(null); }} />
                                    Entire journal entry
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScope" checked={linkExistingEmotionalStateScope === "trades"} onChange={() => setLinkExistingEmotionalStateScope("trades")} />
                                    Specific trade(s)
                                  </label>
                                  {linkExistingEmotionalStateScope === "trades" && (
                                    <div style={{ marginLeft: "24px", display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                                      {tradesFormData.map((t, i) => (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input type="radio" name="linkExistingTrade" checked={linkExistingEmotionalStateTradeIndex === i} onChange={() => setLinkExistingEmotionalStateTradeIndex(i)} />
                                          {t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                              {(entryFormData.linked_emotional_state_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_emotional_state_ids ?? []).map((stateId) => {
                                    const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                    const group = allGroups.find((g) => g.some((s) => s.id === stateId));
                                    const first = group?.[0];
                                    return first ? (
                                      <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group!.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Will link on save</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => { const next = (prev.linked_emotional_state_ids ?? []).filter((id) => id !== stateId); const scopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) }; delete scopes[stateId]; return { ...prev, linked_emotional_state_ids: next, linked_emotional_state_link_scopes: scopes }; })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Remove</button>
                                        </div>
                                      </li>
                                    ) : null;
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select emotional states to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksStateDropdownOpen && (() => {
                                  const linkedIds = new Set(entryFormData.linked_emotional_state_ids ?? []);
                                  const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                  const addableGroups = allGroups.filter((g) => !linkedIds.has(g[0].id));
                                  const scope = { scope: linkExistingEmotionalStateScope, tradeIndex: linkExistingEmotionalStateScope === "trades" ? linkExistingEmotionalStateTradeIndex : null };
                                  return (
                                    <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                      {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are selected, or none exist.</div> : addableGroups.map((group) => {
                                        const first = group[0];
                                        return (
                                          <button key={first.timestamp} type="button" onClick={() => { setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: [...(prev.linked_emotional_state_ids ?? []), first.id], linked_emotional_state_link_scopes: { ...(prev.linked_emotional_state_link_scopes ?? {}), [first.id]: scope } })); setJournalLinksStateDropdownOpen(false); }} style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                                            {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            <div style={{ padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal to real trades. Links are saved when you save the journal entry.</p>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to real trades</label>
                              {(entryFormData.linked_trade_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_trade_ids ?? []).map((tradeId) => {
                                    const t = realTradesForLink.find((r) => r.id === tradeId);
                                    return (
                                      <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{t ? `${t.symbol} ${t.side}${t.quantity ? ` · ${t.quantity}` : ""}${t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · ${format(new Date(t.timestamp), "MMM dd, yyyy")}` : `Trade #${tradeId}`}</span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Will link on save</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => ({ ...prev, linked_trade_ids: (prev.linked_trade_ids ?? []).filter((id) => id !== tradeId) }))} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Remove</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksTradeDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksTradeDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select trades to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksTradeDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksTradeDropdownOpen && (
                                  <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "300px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                    {realTradesForLink.map((t) => {
                                      const ids = entryFormData.linked_trade_ids ?? [];
                                      const isLinked = ids.includes(t.id);
                                      return (
                                        <button
                                          key={t.id}
                                          type="button"
                                          disabled={isLinked}
                                          onClick={() => {
                                            if (!isLinked) {
                                              const stateIdsForTrade = getEmotionalStateIdsForRealTrade(t.id, allEmotionalStates);
                                              const scope = { scope: "entry" as const, tradeIndex: null };
                                              setEntryFormData((prev) => {
                                                const newLinkedIds = [...(prev.linked_trade_ids ?? []), t.id];
                                                const existingStateIds = new Set(prev.linked_emotional_state_ids ?? []);
                                                const newStateIds = [...existingStateIds];
                                                const newScopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) };
                                                for (const sid of stateIdsForTrade) {
                                                  if (!existingStateIds.has(sid)) {
                                                    newStateIds.push(sid);
                                                    newScopes[sid] = scope;
                                                  }
                                                }
                                                return { ...prev, linked_trade_ids: newLinkedIds, linked_emotional_state_ids: newStateIds, linked_emotional_state_link_scopes: newScopes };
                                              });
                                            }
                                            setJournalLinksTradeDropdownOpen(false);
                                          }}
                                          style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: isLinked ? "var(--text-secondary)" : "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: isLinked ? "default" : "pointer", opacity: isLinked ? 0.8 : 1 }}
                                          onMouseEnter={(e) => { if (!isLinked) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                        >
                                          {t.symbol} {t.side}{t.quantity ? ` · ${t.quantity}` : ""}{t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · {format(new Date(t.timestamp), "MMM dd, yyyy")}{isLinked && <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--accent)" }}>Selected</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Links are saved when you save the journal entry.</p>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Emotions — clear separation of link categories */}
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Emotions</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal entry to emotional state entries.</p>
                              <div style={{ marginBottom: "16px" }}>
                                <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. This applies to the <strong>next</strong> state you link—change the selection before each link to associate different states with different trades.</p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScopeLinksTab" checked={linkExistingEmotionalStateScope === "entry"} onChange={() => { setLinkExistingEmotionalStateScope("entry"); setLinkExistingEmotionalStateTradeIndex(null); }} />
                                    Entire journal entry
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                    <input type="radio" name="linkExistingScopeLinksTab" checked={linkExistingEmotionalStateScope === "trades"} onChange={() => setLinkExistingEmotionalStateScope("trades")} />
                                    Specific trade(s)
                                  </label>
                                  {linkExistingEmotionalStateScope === "trades" && (
                                    <div style={{ marginLeft: "24px", display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                                      {tradesFormData.map((t, i) => (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input type="radio" name="linkExistingTradeLinksTab" checked={linkExistingEmotionalStateTradeIndex === i} onChange={() => setLinkExistingEmotionalStateTradeIndex(i)} />
                                          {t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`}
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to emotional states</label>
                              {groupEmotionalStatesByTimestamp(emotionalStatesForCurrentTrade).length > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {groupEmotionalStatesByTimestamp(emotionalStatesForCurrentTrade).map((group) => {
                                    const first = group[0];
                                    const scopeLabelLinks = first.journal_trade_id == null ? "Entire journal entry" : (() => { const idx = tradesFormData.findIndex((t) => t.id === first.journal_trade_id); return idx >= 0 ? `Trade ${idx + 1}` : "Trade"; })();
                                    return (
                                      <li key={first.timestamp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                        </span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }} title={scopeLabelLinks}>Linked · {scopeLabelLinks}</span>
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                await invoke("remove_journal_entry_from_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: group.map((s) => s.id) });
                                                const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
                                                const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id, ...paperArgs });
                                                setJournalEmotionalStates(states);
                                                const groups = groupEmotionalStatesByTimestamp(states);
                                                const ids = groups.map((g) => g[0].id);
                                                const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                for (const g of groups) {
                                                  const f = g[0];
                                                  if (f.journal_trade_id == null) scopes[f.id] = { scope: "entry", tradeIndex: null };
                                                  else { const idx = tradesFormData.findIndex((t) => t.id === f.journal_trade_id); scopes[f.id] = { scope: "trades", tradeIndex: idx >= 0 ? idx : null }; }
                                                }
                                                setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: ids, linked_emotional_state_link_scopes: scopes }));
                                              } catch (e) { console.error(e); }
                                            }}
                                            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}
                                          >Unlink</button>
                                          <button type="button" onClick={() => navigate("/emotions", { state: { openTimestamp: first.timestamp } })} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "4px", cursor: "pointer" }}>Open in Emotions</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksStateDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksStateDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Add this journal to emotional states...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksStateDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksStateDropdownOpen && (() => {
                                  const linkedTimestamps = new Set(groupEmotionalStatesByTimestamp(journalEmotionalStates).map((g) => g[0].timestamp));
                                  const allGroups = groupEmotionalStatesByTimestamp(allEmotionalStates);
                                  const addableGroups = allGroups.filter((g) => !linkedTimestamps.has(g[0].timestamp));
                                  return (
                                    <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                      {addableGroups.length === 0 ? <div style={{ padding: "12px", fontSize: "13px", color: "var(--text-secondary)" }}>All emotional state entries are already linked, or none exist.</div> : addableGroups.map((group) => {
                                        const first = group[0];
                                        return (
                                          <button
                                            key={first.timestamp}
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const ids = group.map((s) => s.id);
                                                await invoke("add_journal_entry_to_emotional_states", { journalEntryId: selectedEntry!.id, emotionalStateIds: ids });
                                                const jtId = linkExistingEmotionalStateScope === "entry" ? null : (linkExistingEmotionalStateTradeIndex != null ? tradesFormData[linkExistingEmotionalStateTradeIndex]?.id ?? null : null);
                                                await invoke("link_emotional_states_to_journal", { emotionalStateIds: ids, journalEntryId: selectedEntry!.id, journalTradeId: jtId ?? undefined });
                                                const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
                                                const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: selectedEntry!.id, ...paperArgs });
                                                setJournalEmotionalStates(states);
                                                const grps = groupEmotionalStatesByTimestamp(states);
                                                const linkIds = grps.map((g) => g[0].id);
                                                const scopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                                                for (const grp of grps) {
                                                  const f = grp[0];
                                                  const idx = tradesFormData.findIndex((t) => t.id === f.journal_trade_id);
                                                  scopes[f.id] = f.journal_trade_id == null ? { scope: "entry", tradeIndex: null } : { scope: "trades", tradeIndex: idx >= 0 ? idx : null };
                                                }
                                                setEntryFormData((prev) => ({ ...prev, linked_emotional_state_ids: linkIds, linked_emotional_state_link_scopes: scopes }));
                                                setJournalLinksStateDropdownOpen(false);
                                              } catch (e) { console.error(e); }
                                            }}
                                            style={{ display: "block", width: "100%", padding: "10px 12px", textAlign: "left", fontSize: "13px", color: "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: "pointer" }}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                          >
                                            {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")} · {group.map((s) => `${s.emotion} ${s.intensity}/10`).join(", ")}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                            {/* Trades — clear separation of link categories */}
                            <div style={{ padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Trades</h4>
                              <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Link this journal entry to real trades.</p>
                              <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: "600" }}>Link to real trades</label>
                              {(entryFormData.linked_trade_ids?.length ?? 0) > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
                                  {(entryFormData.linked_trade_ids ?? []).map((tradeId) => {
                                    const t = realTradesForLink.find((r) => r.id === tradeId);
                                    return (
                                      <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px", marginBottom: "6px" }}>
                                        <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{t ? `${t.symbol} ${t.side}${t.quantity ? ` · ${t.quantity}` : ""}${t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · ${format(new Date(t.timestamp), "MMM dd, yyyy")}` : `Trade #${tradeId}`}</span>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--accent)", padding: "2px 6px", backgroundColor: "var(--bg-hover)", borderRadius: "4px" }}>Linked</span>
                                          <button type="button" onClick={() => setEntryFormData((prev) => ({ ...prev, linked_trade_ids: (prev.linked_trade_ids ?? []).filter((id) => id !== tradeId) }))} style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "4px", cursor: "pointer" }}>Unlink</button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div style={{ position: "relative" }} ref={journalLinksTradeDropdownRef}>
                                <button type="button" onClick={() => setJournalLinksTradeDropdownOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "8px 12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", textAlign: "left" }}>
                                  <span>Select trades to link...</span>
                                  <ChevronDown size={16} style={{ transform: journalLinksTradeDropdownOpen ? "rotate(180deg)" : "none" }} />
                                </button>
                                {journalLinksTradeDropdownOpen && (
                                  <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "220px", overflowY: "auto", minWidth: "300px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", padding: "6px" }}>
                                    {realTradesForLink.map((t) => {
                                      const ids = entryFormData.linked_trade_ids ?? [];
                                      const isLinked = ids.includes(t.id);
                                      return (
                                        <button
                                          key={t.id}
                                          type="button"
                                          disabled={isLinked}
                                          onClick={() => {
                                            if (!isLinked) {
                                              const stateIdsForTrade = getEmotionalStateIdsForRealTrade(t.id, allEmotionalStates);
                                              const scope = { scope: "entry" as const, tradeIndex: null };
                                              setEntryFormData((prev) => {
                                                const newLinkedIds = [...(prev.linked_trade_ids ?? []), t.id];
                                                const existingStateIds = new Set(prev.linked_emotional_state_ids ?? []);
                                                const newStateIds = [...existingStateIds];
                                                const newScopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) };
                                                for (const sid of stateIdsForTrade) {
                                                  if (!existingStateIds.has(sid)) {
                                                    newStateIds.push(sid);
                                                    newScopes[sid] = scope;
                                                  }
                                                }
                                                return { ...prev, linked_trade_ids: newLinkedIds, linked_emotional_state_ids: newStateIds, linked_emotional_state_link_scopes: newScopes };
                                              });
                                            }
                                            setJournalLinksTradeDropdownOpen(false);
                                          }}
                                          style={{ display: "block", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: "13px", color: isLinked ? "var(--text-secondary)" : "var(--text-primary)", background: "transparent", border: "none", borderRadius: "6px", cursor: isLinked ? "default" : "pointer", opacity: isLinked ? 0.8 : 1 }}
                                          onMouseEnter={(e) => { if (!isLinked) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                                        >
                                          {t.symbol} {t.side}{t.quantity ? ` · ${t.quantity}` : ""}{t.pnl != null && t.pnl !== 0 ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : ""} · {format(new Date(t.timestamp), "MMM dd, yyyy")}{isLinked && <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--accent)" }}>Linked</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>Save the journal entry to persist linked trades.</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {activeTab === "emotional_state" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("emotional_state", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("emotional_state", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        {(isCreating || isEditing) ? (
                          <>
                            {/* Single "Link to" scope for both linking existing states and adding new ones */}
                            <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                              <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Link to</h3>
                              <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--text-secondary)" }}>One emotional state per journal trade or one for the entire entry. The choice below applies to the <strong>next</strong> state you link or add—change it before each action to link different states to different trades (e.g. one state for Trade 1, another for Trade 2).</p>
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name="emotionalStateTabLinkScope"
                                    checked={newEmotionalStateLinkScope === "entry"}
                                    onChange={() => {
                                      setNewEmotionalStateLinkScope("entry");
                                      setNewEmotionalStateTradeIndices([]);
                                      setLinkExistingEmotionalStateScope("entry");
                                      setLinkExistingEmotionalStateTradeIndex(null);
                                    }}
                                  />
                                  Entire journal entry
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name="emotionalStateTabLinkScope"
                                    checked={newEmotionalStateLinkScope === "trades"}
                                    onChange={() => { setNewEmotionalStateLinkScope("trades"); setLinkExistingEmotionalStateScope("trades"); }}
                                  />
                                  Specific trade(s)
                                </label>
                                {newEmotionalStateLinkScope === "trades" && (
                                  <div style={{ marginLeft: "24px", display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "6px" }}>
                                    {tradesFormData.map((t, i) => {
                                      const label = t.symbol ? `${t.symbol}${t.position ? ` (${t.position})` : ""}` : `Trade ${i + 1}`;
                                      const checked = newEmotionalStateTradeIndices.includes(i);
                                      return (
                                        <label key={i} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => {
                                              const next = checked ? newEmotionalStateTradeIndices.filter((j) => j !== i) : [...newEmotionalStateTradeIndices, i];
                                              setNewEmotionalStateTradeIndices(next);
                                              setLinkExistingEmotionalStateTradeIndex(next[0] ?? null);
                                            }}
                                          />
                                          {label || `Trade ${i + 1}`}
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>

                            <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>To link this entry to <strong>existing</strong> emotional state entries, use the <strong>Links</strong> tab.</p>

                            <div style={{ marginBottom: "16px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>Emotional states</span>
                                {!showAddEmotionalStateForm && (
                                  <button
                                    type="button"
                                    onClick={() => setShowAddEmotionalStateForm(true)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      padding: "8px 14px",
                                      background: "var(--accent)",
                                      border: "none",
                                      borderRadius: "6px",
                                      color: "white",
                                      fontSize: "13px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <Plus size={14} />
                                    Add State
                                  </button>
                                )}
                              </div>
                              {(emotionalStatesForCurrentTrade.length === 0 && pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).length === 0 && !showAddEmotionalStateForm) && (
                                <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No emotional states linked to this trade. Add one with the same form as on the Emotions page.</p>
                              )}
                              {/* When editing an existing entry, linked states are shown in "Link to emotional states" above; only show them here when creating (no selectedEntry.id) */}
                              {!selectedEntry?.id && groupEmotionalStatesByTimestamp(emotionalStatesForCurrentTrade).map((group) => {
                                const first = group[0];
                                const notes = first.notes;
                                return (
                                  <div
                                    key={first.timestamp}
                                    style={{
                                      padding: "12px",
                                      backgroundColor: "var(--bg-tertiary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "6px",
                                      marginBottom: "8px",
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                        {group.map((s) => (
                                          <span key={s.id} style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>
                                            {s.emotion} {s.intensity}/10
                                          </span>
                                        ))}
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                          {format(new Date(first.timestamp), "MMM d, yyyy HH:mm")}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setEmotionalStateDeleteTarget({ type: "saved", states: group })}
                                          style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}
                                          title="Delete"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                    {notes && (
                                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: notes }} />
                                    )}
                                  </div>
                                );
                              })}
                              {pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).map((pending, idx) => (
                                <div
                                  key={`pending-${activeTradeIndex}-${idx}`}
                                  style={{
                                    padding: "12px",
                                    backgroundColor: "var(--bg-tertiary)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: "6px",
                                    marginBottom: "8px",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                      {Object.entries(pending.selectedEmotions).map(([emotion, intensity]) => (
                                        <span key={emotion} style={{ fontWeight: "600", color: "var(--text-primary)", fontSize: "13px" }}>
                                          {emotion} {intensity}/10
                                        </span>
                                      ))}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                        {pending.tradeIndex === -1 ? "Entire journal entry (unsaved)" : `Trade ${pending.tradeIndex + 1} (unsaved)`}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPendingEmotionalStates((prev) => prev.filter((p) => p !== pending));
                                          setEmotionalStateFormForTradeIndex(pending.tradeIndex >= 0 ? pending.tradeIndex : activeTradeIndex, {
                                            selectedEmotions: { ...pending.selectedEmotions },
                                            notes: pending.notes,
                                            surveyResponses: pending.surveyResponses ? { ...pending.surveyResponses } : {},
                                          });
                                          setNewEmotionalStateLinkScope(pending.tradeIndex === -1 ? "entry" : "trades");
                                          setNewEmotionalStateTradeIndices(pending.tradeIndex === -1 ? [] : [pending.tradeIndex]);
                                          if (pending.tradeIndex >= 0) setActiveTradeIndex(pending.tradeIndex);
                                          setShowAddEmotionalStateForm(true);
                                        }}
                                        style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--accent)", cursor: "pointer", fontSize: "12px" }}
                                        title="Edit"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                        const sameScope = pendingEmotionalStates.filter((p) => p.tradeIndex === pending.tradeIndex);
                                        const scopeIdx = sameScope.indexOf(pending);
                                        setEmotionalStateDeleteTarget({ type: "pending", tradeIndex: pending.tradeIndex, idx: scopeIdx });
                                      }}
                                        style={{ padding: "2px 6px", background: "transparent", border: "none", borderRadius: "4px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px" }}
                                        title="Remove"
                                      >
                                        <X size={14} />
                                      </button>
                                    </div>
                                  </div>
                                  {pending.notes && (
                                    <div style={{ fontSize: "13px", color: "var(--text-secondary)" }} dangerouslySetInnerHTML={{ __html: pending.notes }} />
                                  )}
                                </div>
                              ))}
                            </div>
                            {((emotionalStatesForCurrentTrade.length === 0 && pendingEmotionalStates.filter((p) => p.tradeIndex === activeTradeIndex || p.tradeIndex === -1).length === 0) || showAddEmotionalStateForm) && (
                              <div style={{ display: "flex", flexDirection: "column", maxHeight: "85vh", minHeight: "300px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "12px", marginBottom: "16px", overflow: "hidden" }}>
                                {/* Header: title + buttons (same as Emotions page) */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)", flexShrink: 0 }}>
                                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600" }}>Add emotional state</h4>
                                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                    <button
                                      type="button"
                                      onClick={() => { setShowAddEmotionalStateForm(false); setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} }); setNewEmotionalStateLinkScope("entry"); setNewEmotionalStateTradeIndices([]); }}
                                      style={{ padding: "8px 14px", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px" }}
                                    >
                                      Close
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ||
                                        (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0)
                                      }
                                      onClick={async () => {
                                      const hasAny = Object.keys(newEmotionalStateForm.selectedEmotions).length > 0;
                                      if (!hasAny) return;
                                      if (newEmotionalStateLinkScope === "trades" && newEmotionalStateTradeIndices.length === 0) return;
                                      const entryId = selectedEntry?.id;
                                      const savedEntry = entryId != null;
                                      if (savedEntry) {
                                        try {
                                          const now = new Date().toISOString();
                                          const paperArgs = dataMode === "paper" ? { paperOnly: true } : {};
                                          const allStates = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId!, ...paperArgs });
                                          const deleteGroup = async (group: JournalEmotionalState[]) => {
                                            for (const s of group) {
                                              await invoke("delete_emotional_state", { id: s.id });
                                            }
                                          };
                                          let firstStateId: number | null = null;
                                          if (newEmotionalStateLinkScope === "entry") {
                                            const entryLevel = allStates.filter((s) => s.journal_trade_id == null);
                                            const groups = groupEmotionalStatesByTimestamp(entryLevel);
                                            for (const g of groups) await deleteGroup(g);
                                            for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                              const stateId = await invoke<number>("add_emotional_state", {
                                                timestamp: now,
                                                emotion,
                                                intensity: newEmotionalStateForm.selectedEmotions[emotion],
                                                notes: newEmotionalStateForm.notes || null,
                                                tradeId: null,
                                                journalEntryId: entryId,
                                                journalTradeId: null,
                                                isPaper: dataMode === "paper",
                                              });
                                              if (firstStateId === null) firstStateId = stateId;
                                            }
                                          } else {
                                            for (const tradeIdx of newEmotionalStateTradeIndices) {
                                              const trade = tradesFormData[tradeIdx];
                                              const jtId = trade?.id ?? null;
                                              if (jtId == null) continue;
                                              const forTrade = allStates.filter((s) => s.journal_trade_id === jtId);
                                              const groups = groupEmotionalStatesByTimestamp(forTrade);
                                              for (const g of groups) await deleteGroup(g);
                                              for (const emotion of Object.keys(newEmotionalStateForm.selectedEmotions)) {
                                                const stateId = await invoke<number>("add_emotional_state", {
                                                  timestamp: now,
                                                  emotion,
                                                  intensity: newEmotionalStateForm.selectedEmotions[emotion],
                                                  notes: newEmotionalStateForm.notes || null,
                                                  tradeId: null,
                                                  journalEntryId: entryId,
                                                  journalTradeId: jtId,
                                                  isPaper: dataMode === "paper",
                                                });
                                                if (firstStateId === null) firstStateId = stateId;
                                              }
                                            }
                                          }
                                          const sr = newEmotionalStateSurveyResponses;
                                          const shouldSaveSurvey = Object.values(JOURNAL_SURVEY_QUESTIONS).flat().some((q) => (sr[q.key] ?? 6) !== 6);
                                          if (shouldSaveSurvey && firstStateId != null) {
                                            try {
                                              await invoke("add_emotion_survey", {
                                                emotional_state_id: firstStateId,
                                                timestamp: now,
                                                before_calm_clear: sr.before_calm_clear ?? 6,
                                                before_urgency_pressure: sr.before_urgency_pressure ?? 6,
                                                before_confidence_vs_validation: sr.before_confidence_vs_validation ?? 6,
                                                before_fomo: sr.before_fomo ?? 6,
                                                before_recovering_loss: sr.before_recovering_loss ?? 6,
                                                before_patient_detached: sr.before_patient_detached ?? 6,
                                                before_trust_process: sr.before_trust_process ?? 6,
                                                before_emotional_state: sr.before_emotional_state ?? 6,
                                                during_stable: sr.during_stable ?? 6,
                                                during_tension_stress: sr.during_tension_stress ?? 6,
                                                during_tempted_interfere: sr.during_tempted_interfere ?? 6,
                                                during_need_control: sr.during_need_control ?? 6,
                                                during_fear_loss: sr.during_fear_loss ?? 6,
                                                during_excitement_greed: sr.during_excitement_greed ?? 6,
                                                during_mentally_present: sr.during_mentally_present ?? 6,
                                                after_accept_outcome: sr.after_accept_outcome ?? 6,
                                                after_emotional_reaction: sr.after_emotional_reaction ?? 6,
                                                after_confidence_affected: sr.after_confidence_affected ?? 6,
                                                after_tempted_another_trade: sr.after_tempted_another_trade ?? 6,
                                                after_proud_discipline: sr.after_proud_discipline ?? 6,
                                              });
                                            } catch (err) {
                                              console.error("Failed to save emotion survey:", err);
                                            }
                                          }
                                          const states = await invoke<JournalEmotionalState[]>("get_emotional_states_for_journal", { journalEntryId: entryId!, ...paperArgs });
                                          setJournalEmotionalStates(states);
                                          setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
                                          setNewEmotionalStateLinkScope("entry");
                                          setNewEmotionalStateTradeIndices([]);
                                          setShowAddEmotionalStateForm(false);
                                        } catch (e) {
                                          console.error(e);
                                        }
                                      } else {
                                        const surveyPayload = { ...newEmotionalStateSurveyResponses };
                                        if (newEmotionalStateLinkScope === "entry") {
                                          setPendingEmotionalStates((prev) => prev.filter((p) => p.tradeIndex !== -1).concat([{ tradeIndex: -1, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: surveyPayload }]));
                                        } else {
                                          let next = pendingEmotionalStates.filter((p) => p.tradeIndex === -1 || !newEmotionalStateTradeIndices.includes(p.tradeIndex));
                                          for (const i of newEmotionalStateTradeIndices) {
                                            next = next.filter((p) => p.tradeIndex !== i);
                                            next.push({ tradeIndex: i, selectedEmotions: newEmotionalStateForm.selectedEmotions, notes: newEmotionalStateForm.notes, surveyResponses: surveyPayload });
                                          }
                                          setPendingEmotionalStates(next);
                                        }
                                        setNewEmotionalStateForm({ selectedEmotions: {}, notes: "", surveyResponses: {} });
                                        setNewEmotionalStateLinkScope("entry");
                                        setNewEmotionalStateTradeIndices([]);
                                        setShowAddEmotionalStateForm(false);
                                      }
                                    }}
                                    style={{
                                      padding: "8px 16px",
                                      background: "var(--accent)",
                                      border: "none",
                                      borderRadius: "6px",
                                      color: "white",
                                      cursor: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? "not-allowed" : "pointer",
                                      fontSize: "13px",
                                      fontWeight: "600",
                                      opacity: Object.keys(newEmotionalStateForm.selectedEmotions).length === 0 ? 0.6 : 1,
                                    }}
                                    title="Add this emotional state to the journal entry"
                                    >
                                      Add emotional state to entry
                                    </button>
                                  </div>
                                </div>
                                {/* Scrollable body */}
                                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "20px" }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                  <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "10px", border: "1px solid var(--border-color)" }}>
                                    <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>{INTENSITY_SCALE_LABEL}</p>
                                  </div>
                                  <div>
                                    <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Emotions</h3>
                                    <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--text-secondary)" }}>Tap to add or remove; then set strength below.</p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                      {JOURNAL_EMOTIONS.map((emotion) => {
                                        const intensity = newEmotionalStateForm.selectedEmotions[emotion];
                                        const isSelected = intensity !== undefined;
                                        return (
                                          <button
                                            key={emotion}
                                            type="button"
                                            onClick={() => {
                                              if (isSelected) {
                                                const next = { ...newEmotionalStateForm.selectedEmotions };
                                                delete next[emotion];
                                                setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: next }));
                                              } else {
                                                setNewEmotionalStateForm((f) => ({
                                                  ...f,
                                                  selectedEmotions: { ...f.selectedEmotions, [emotion]: DEFAULT_EMOTION_INTENSITY },
                                                }));
                                              }
                                            }}
                                            style={{
                                              padding: "8px 14px",
                                              borderRadius: "999px",
                                              border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
                                              backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-tertiary)",
                                              color: "var(--text-primary)",
                                              fontSize: "12px",
                                              fontWeight: isSelected ? "600" : "500",
                                              cursor: "pointer",
                                              boxShadow: isSelected ? "0 0 0 1px var(--accent)" : "none",
                                            }}
                                          >
                                            {emotion}
                                            {isSelected && <span style={{ marginLeft: "4px", opacity: 0.9 }}>{intensity}/10</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  {Object.keys(newEmotionalStateForm.selectedEmotions).length > 0 && (
                                    <div style={{ padding: "16px", backgroundColor: "var(--bg-tertiary)", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                                      <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Set intensity</h3>
                                      <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                                        <span>0</span>
                                        <div style={{ flex: 1, height: "2px", background: "var(--border-color)", borderRadius: 1 }} />
                                        <span>10</span>
                                        <span style={{ marginLeft: "4px" }}>← strength</span>
                                      </div>
                                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                        {Object.entries(newEmotionalStateForm.selectedEmotions).map(([emotion, intensity]) => (
                                          <div key={emotion} style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--border-color)" }}>
                                            <span style={{ minWidth: "88px", fontSize: "13px", fontWeight: "500" }}>{emotion}</span>
                                            <input
                                              type="range"
                                              min={0}
                                              max={10}
                                              value={intensity}
                                              onChange={(e) =>
                                                setNewEmotionalStateForm((f) => ({
                                                  ...f,
                                                  selectedEmotions: { ...f.selectedEmotions, [emotion]: parseInt(e.target.value, 10) },
                                                }))
                                              }
                                              style={{ flex: "1", minWidth: "100px", maxWidth: "220px", height: "6px", accentColor: "var(--accent)" }}
                                            />
                                            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--accent)", minWidth: "28px" }}>{intensity}/10</span>
                                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "64px" }}>{INTENSITY_LABELS[intensity]}</span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const next = { ...newEmotionalStateForm.selectedEmotions };
                                                delete next[emotion];
                                                setNewEmotionalStateForm((f) => ({ ...f, selectedEmotions: next }));
                                              }}
                                              style={{ padding: "4px 10px", background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Same question groups as Emotions page — unified format */}
                                  {(["before", "during", "after"] as const).map((phase) => (
                                    <div key={phase} style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                                      <h3 style={{ margin: "0 0 12px", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                        {phase === "before" ? "Before Trade" : phase === "during" ? "During Trade" : "After Trade"}
                                      </h3>
                                      {JOURNAL_SURVEY_QUESTIONS[phase].map((q, idx) => (
                                        <div key={q.key} style={{ marginBottom: "16px" }}>
                                          <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500" }}>{idx + 1}. {q.question}</label>
                                          <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px" }}>{q.scale}</p>
                                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "16px" }}>1</span>
                                            <input
                                              type="range"
                                              min={1}
                                              max={10}
                                              value={newEmotionalStateSurveyResponses[q.key] ?? 6}
                                              onChange={(e) => setNewEmotionalStateSurveyResponses((r) => ({ ...r, [q.key]: parseInt(e.target.value, 10) }))}
                                              style={{ flex: 1, minWidth: "80px", accentColor: "var(--accent)" }}
                                            />
                                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "16px" }}>10</span>
                                            <span style={{ minWidth: "28px", textAlign: "center", fontSize: "13px", fontWeight: "600", color: "var(--accent)" }}>{newEmotionalStateSurveyResponses[q.key] ?? 6}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                  {/* Notes at the very bottom (under all questions) */}
                                  <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                                    <h3 style={{ margin: "0 0 6px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Notes (for this whole entry)</h3>
                                    <RichTextEditor
                                      value={newEmotionalStateForm.notes}
                                      onChange={(content: string) => setNewEmotionalStateForm((f) => ({ ...f, notes: content }))}
                                      placeholder="Notes..."
                                      readOnly={false}
                                    />
                                  </div>
                                </div>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div>
                            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                              Create or open a journal entry to add emotional states (same as the Emotions page).
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === "notes" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("notes", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("notes", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        <RichTextEditor
                          value={currentTrade.notes}
                          onChange={(content: string) => updateTradeFormData(activeTradeIndex, "notes", content)}
                          placeholder="Notes..."
                          readOnly={false}
                        />
                      </div>
                    )}
                    {activeTab === "checklists" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("checklists", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("checklists", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        {entryFormData.strategy_id && currentChecklists ? (
                          <div style={{ overflowY: "auto" }}>
                            {allTypes.map((type) => {
                              const rawItems = currentChecklists.get(type) || [];
                              const items = rawItems.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                              if (items.length === 0) return null;

                              const isEntryLevel = ENTRY_LEVEL_CHECKLIST_TYPES.includes(type);
                              const responses = isEntryLevel ? entryLevelChecklistResponses : (checklistResponses.get(activeTradeIndex) || new Map());
                              // Entry-level: show actual stored state so checkbox is always clickable; association is shown via "Whole entry" / "N trade(s)" label
                              const getChecked = (id: number) => responses.get(id) || false;
                              const onToggle = isEntryLevel ? (id: number) => toggleEntryLevelChecklistItem(id) : (id: number) => toggleChecklistItem(activeTradeIndex, id);

                              // Organize items: groups and regular items
                              const groups = items.filter(item => !item.parent_id && items.some(child => child.parent_id === item.id));
                              const regularItems = items.filter(item => !item.parent_id && !items.some(child => child.parent_id === item.id));
                              const groupedItems = items.filter(item => item.parent_id !== null && items.some(p => p.id === item.parent_id));
                              const itemsByParent = new Map<number, ChecklistItem[]>();
                              groupedItems.forEach(item => {
                                if (item.parent_id) {
                                  const parentId = item.parent_id;
                                  if (!itemsByParent.has(parentId)) itemsByParent.set(parentId, []);
                                  itemsByParent.get(parentId)!.push(item);
                                }
                              });

                              return (
                                <div key={type} style={{ marginBottom: "24px" }}>
                                  <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                                    {getChecklistTitle(type)}
                                    {isEntryLevel && (
                                      <span style={{ fontSize: "11px", fontWeight: "400", color: "var(--text-secondary)", marginLeft: "8px" }}>
                                        (applies to whole journal by default)
                                      </span>
                                    )}
                                  </h4>
                                  {groups.map((group) => {
                                    const children = itemsByParent.get(group.id) || [];
                                    return (
                                      <div key={group.id} style={{ marginBottom: "16px" }}>
                                        <div style={{ padding: "12px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", marginBottom: "8px", fontWeight: "600", color: "var(--text-primary)" }}>
                                          {group.item_text}
                                        </div>
                                        {children.map((child) => (
                                          <div key={child.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", marginLeft: "20px", marginBottom: "4px" }}>
                                            <input type="checkbox" checked={getChecked(child.id)} onChange={() => onToggle(child.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                                            <label style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(child.id)}>{child.item_text}</label>
                                            {isEntryLevel && entryTradesForAssociation.length > 1 && (
                                              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                                  {!(checklistTradeAssociations.get(child.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(child.id)!.length} trade(s)`}
                                                </span>
                                                <button type="button" onClick={() => setTradeAssociationModalItemId(child.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "4px", display: "flex" }} title="Associate with specific trades">
                                                  <Link2 size={14} />
                                                </button>
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                  {regularItems.map((item) => (
                                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", marginBottom: "4px", backgroundColor: "var(--bg-tertiary)", borderRadius: "6px" }}>
                                      <input type="checkbox" checked={getChecked(item.id)} onChange={() => onToggle(item.id)} style={{ cursor: "pointer", width: "16px", height: "16px" }} />
                                      <label style={{ flex: 1, fontSize: "14px", color: "var(--text-primary)", cursor: "pointer" }} onClick={() => onToggle(item.id)}>{item.item_text}</label>
                                      {isEntryLevel && entryTradesForAssociation.length > 1 && (
                                        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                            {!(checklistTradeAssociations.get(item.id)?.length) ? "Whole entry" : `${checklistTradeAssociations.get(item.id)!.length} trade(s)`}
                                          </span>
                                          <button type="button" onClick={() => setTradeAssociationModalItemId(item.id)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: "4px", display: "flex" }} title="Associate with specific trades">
                                            <Link2 size={14} />
                                          </button>
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                            {/* Trade association modal */}
                            {tradeAssociationModalItemId !== null && (
                              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setTradeAssociationModalItemId(null)}>
                                <div style={{ background: "var(--bg-primary)", borderRadius: "8px", padding: "20px", maxWidth: "400px", width: "90%", border: "1px solid var(--border-color)" }} onClick={e => e.stopPropagation()}>
                                  <h4 style={{ margin: "0 0 12px", fontSize: "14px" }}>Associate with trades</h4>
                                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Select which <strong>journal trades</strong> in this entry ({entryTradesForAssociation.length}) this checklist item should apply to.</p>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                                    <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingRight: "4px" }}>
                                      {entryTradesForAssociation.map((t, i) => {
                                        const key: number = selectedEntry && (t as { id?: number }).id != null ? (t as { id: number }).id : i;
                                        const label = (t as { symbol?: string }).symbol || `Trade ${i + 1}`;
                                        const currentAssoc = checklistTradeAssociations.get(tradeAssociationModalItemId);
                                        const isSelected = !!currentAssoc && currentAssoc.length > 0 && currentAssoc.includes(key);
                                        const toggleTrade = () => {
                                          const prev = checklistTradeAssociations.get(tradeAssociationModalItemId) || [];
                                          const ids = prev.length > 0 ? [...prev] : [];
                                          const idx = ids.indexOf(key);
                                          if (idx >= 0) ids.splice(idx, 1);
                                          else ids.push(key);
                                          setChecklistTradeAssociation(tradeAssociationModalItemId, ids.length > 0 ? ids : null);
                                        };
                                        return (
                                          <label key={i} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}>
                                            <input type="checkbox" checked={isSelected} onChange={toggleTrade} />
                                            <span>{label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <button onClick={() => setTradeAssociationModalItemId(null)} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}>Done</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            height: "100%",
                            color: "var(--text-secondary)",
                            fontSize: "14px"
                          }}>
                            {entryFormData.strategy_id ? "No checklists available for this strategy." : "Select a strategy to view checklists."}
                          </div>
                        )}
                      </div>
                    )}
                    {activeTab === "survey" && (
                      <div 
                        ref={(el) => { tabContentRefs.current.set("survey", el); }}
                        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", minHeight: 0 }}
                        onScroll={(e) => { 
                          tabScrollPositions.current.set("survey", e.currentTarget.scrollTop);
                          const storageKey = selectedEntry?.id ? `journal_entry_${selectedEntry.id}` : "journal";
                          saveJournalScrollPositionsMerged(storageKey);
                        }}
                      >
                        {entryFormData.strategy_id && currentChecklists ? (
                          <div style={{ overflowY: "auto" }}>
                            {(() => {
                              const rawSurveyItems = currentChecklists.get("survey") || [];
                              const surveyItems = rawSurveyItems.filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                              if (surveyItems.length === 0) {
                                return (
                                  <div style={{ 
                                    display: "flex", 
                                    alignItems: "center", 
                                    justifyContent: "center", 
                                    height: "100%",
                                    color: "var(--text-secondary)",
                                    fontSize: "14px"
                                  }}>
                                    {entryFormData.strategy_id ? "No survey items available for this strategy." : "Select a strategy to view survey."}
                                  </div>
                                );
                              }

                              // Organize items: groups and regular items
                              const groups = surveyItems.filter(item => !item.parent_id && surveyItems.some(child => child.parent_id === item.id));
                              const regularItems = surveyItems.filter(item => !item.parent_id && !surveyItems.some(child => child.parent_id === item.id));
                              const groupedItems = surveyItems.filter(item => item.parent_id !== null && surveyItems.some(p => p.id === item.parent_id));
                              const itemsByParent = new Map<number, ChecklistItem[]>();
                              groupedItems.forEach(item => {
                                if (item.parent_id) {
                                  const parentId = item.parent_id;
                                  if (!itemsByParent.has(parentId)) {
                                    itemsByParent.set(parentId, []);
                                  }
                                  itemsByParent.get(parentId)!.push(item);
                                }
                              });

                              return (
                                <div style={{ marginBottom: "24px" }}>
                                  <h4 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>
                                    Post-Trade Survey
                                  </h4>
                                  {/* Render groups */}
                                  {groups.map((group) => {
                                    const children = itemsByParent.get(group.id) || [];
                                    return (
                                      <div key={group.id} style={{ marginBottom: "16px" }}>
                                        <div
                                          style={{
                                            padding: "12px",
                                            backgroundColor: "var(--bg-tertiary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "6px",
                                            marginBottom: "8px",
                                            fontWeight: "600",
                                            color: "var(--text-primary)",
                                          }}
                                        >
                                          {group.item_text}
                                        </div>
                                        {children.map((child) => {
                                          const score = surveyScores.get(activeTradeIndex)?.get(child.id);
                                          return (
                                            <div
                                              key={child.id}
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                gap: "12px",
                                                padding: "12px",
                                                marginLeft: "20px",
                                                marginBottom: "8px",
                                                backgroundColor: "var(--bg-tertiary)",
                                                borderRadius: "6px",
                                              }}
                                            >
                                              <label
                                                style={{
                                                  flex: 1,
                                                  fontSize: "14px",
                                                  color: "var(--text-primary)",
                                                }}
                                              >
                                                {child.item_text}
                                              </label>
                                              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                                  <button
                                                    key={n}
                                                    type="button"
                                                    onClick={() => {
                                                      setSurveyScores(prev => { const next = new Map(prev); const tradeMap = new Map(next.get(activeTradeIndex)); tradeMap.set(child.id, n); next.set(activeTradeIndex, tradeMap); return next; });
                                                      setChecklistResponses(prev => {
                                                        const newMap = new Map(prev);
                                                        const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                        tradeResponses.set(child.id, true);
                                                        newMap.set(activeTradeIndex, tradeResponses);
                                                        return newMap;
                                                      });
                                                    }}
                                                    style={{
                                                      width: "32px",
                                                      height: "32px",
                                                      padding: 0,
                                                      borderRadius: "6px",
                                                      border: `1px solid ${score === n ? "var(--accent)" : "var(--border-color)"}`,
                                                      backgroundColor: score === n ? "var(--accent)" : "var(--bg-secondary)",
                                                      color: score === n ? "white" : "var(--text-primary)",
                                                      cursor: "pointer",
                                                      fontSize: "13px",
                                                      fontWeight: "600",
                                                    }}
                                                  >
                                                    {n}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                  {/* Render regular items */}
                                  {regularItems.map((item) => {
                                    const score = surveyScores.get(activeTradeIndex)?.get(item.id);
                                    return (
                                      <div
                                        key={item.id}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          gap: "12px",
                                          padding: "12px",
                                          marginBottom: "8px",
                                          backgroundColor: "var(--bg-tertiary)",
                                          borderRadius: "6px",
                                        }}
                                      >
                                        <label
                                          style={{
                                            flex: 1,
                                            fontSize: "14px",
                                            color: "var(--text-primary)",
                                          }}
                                        >
                                          {item.item_text}
                                        </label>
                                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                            <button
                                              key={n}
                                              type="button"
                                              onClick={() => {
                                                setSurveyScores(prev => { const next = new Map(prev); const tradeMap = new Map(next.get(activeTradeIndex)); tradeMap.set(item.id, n); next.set(activeTradeIndex, tradeMap); return next; });
                                                setChecklistResponses(prev => {
                                                  const newMap = new Map(prev);
                                                  const tradeResponses = new Map(newMap.get(activeTradeIndex) || new Map());
                                                  tradeResponses.set(item.id, true);
                                                  newMap.set(activeTradeIndex, tradeResponses);
                                                  return newMap;
                                                });
                                              }}
                                              style={{
                                                width: "32px",
                                                height: "32px",
                                                padding: 0,
                                                borderRadius: "6px",
                                                border: `1px solid ${score === n ? "var(--accent)" : "var(--border-color)"}`,
                                                backgroundColor: score === n ? "var(--accent)" : "var(--bg-secondary)",
                                                color: score === n ? "white" : "var(--text-primary)",
                                                cursor: "pointer",
                                                fontSize: "13px",
                                                fontWeight: "600",
                                              }}
                                            >
                                              {n}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            height: "100%",
                            color: "var(--text-secondary)",
                            fontSize: "14px"
                          }}>
                            {entryFormData.strategy_id ? "No survey items available for this strategy." : "Select a strategy to view survey."}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </>
              )}
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "24px",
            }}
          >
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
                marginBottom: "24px",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "12px" }}>
                Journal Overview
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Review your past journal entries at a glance. Select any entry on the right to dive into full details.
              </p>
              {typeof window !== "undefined" && localStorage.getItem("journal_work_in_progress") && (
                <div
                  style={{
                    marginBottom: "16px",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    You have an unsaved draft.
                  </span>
                  <button
                    type="button"
                    onClick={() => restoreWorkInProgress()}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "var(--accent)",
                      background: "none",
                      border: "1px solid var(--accent)",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Restore draft
                  </button>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  marginBottom: "16px",
                }}
              >
                <input
                  type="text"
                  placeholder="Search Title, Notes, and Implementation Text..."
                  value={journalFilters.text}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      text: e.target.value,
                    }))
                  }
                  style={{
                    flex: "1 1 220px",
                    minWidth: "180px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                />
                <select
                  value={journalFilters.symbol}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      symbol: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 160px",
                    minWidth: "140px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Symbols</option>
                  {journalFilterOptions.symbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <select
                  value={journalFilters.position}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      position: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 150px",
                    minWidth: "130px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Positions</option>
                  {journalFilterOptions.positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <select
                  value={journalFilters.timeframe}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      timeframe: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 170px",
                    minWidth: "140px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Timeframes</option>
                  {journalFilterOptions.timeframes.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
                <select
                  value={journalFilters.entry_type}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      entry_type: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 150px",
                    minWidth: "130px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Entry Types</option>
                  {journalFilterOptions.entryTypes.map((et) => (
                    <option key={et} value={et}>
                      {et}
                    </option>
                  ))}
                </select>
                <select
                  value={journalFilters.exit_type}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      exit_type: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 150px",
                    minWidth: "130px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Exit Types</option>
                  {journalFilterOptions.exitTypes.map((xt) => (
                    <option key={xt} value={xt}>
                      {xt}
                    </option>
                  ))}
                </select>
                <select
                  value={journalFilters.outcome}
                  onChange={(e) =>
                    setJournalFilters((prev) => ({
                      ...prev,
                      outcome: e.target.value,
                    }))
                  }
                  style={{
                    flex: "0 0 150px",
                    minWidth: "130px",
                    padding: "8px 10px",
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <option value="">All Outcomes</option>
                  {journalFilterOptions.outcomes.map((oc) => (
                    <option key={oc} value={oc}>
                      {oc}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setJournalFilters({
                      symbol: "",
                      position: "",
                      timeframe: "",
                      entry_type: "",
                      exit_type: "",
                      outcome: "",
                      text: "",
                    })
                  }
                  style={{
                    flex: "0 0 auto",
                    padding: "8px 12px",
                    backgroundColor: "transparent",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-secondary)",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  Clear filters
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "12px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    Total entries
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "600" }}>{filteredEntries.length}</div>
                </div>
                <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    This month
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "600" }}>
                    {filteredEntries.filter((entry) => {
                      const d = parse(entry.date, "yyyy-MM-dd", new Date());
                      if (isNaN(d.getTime())) return false;
                      const now = new Date();
                      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
                    }).length}
                  </div>
                </div>
                <div style={{ padding: "12px", borderRadius: "6px", backgroundColor: "var(--bg-tertiary)" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    Last entry
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: "500" }}>
                    {filteredEntries[0]
                      ? format(parse(filteredEntries[0].date, "yyyy-MM-dd", new Date()), "MMM d, yyyy")
                      : "—"}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginBottom: "12px",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-secondary)",
                  }}
                >
                  Journal Distributions
                </span>
                <TimeframeSelector
                  value={chartTimeframe}
                  onChange={(tf) => {
                    setChartTimeframe(tf);
                    setOverviewEntriesBrushEnd(0);
                    setOverviewDimBrushEnd(0);
                  }}
                  customStartDate={chartCustomStart || undefined}
                  customEndDate={chartCustomEnd || undefined}
                  onCustomDatesChange={(start, end) => {
                    setChartCustomStart(start);
                    setChartCustomEnd(end);
                    setOverviewEntriesBrushEnd(0);
                    setOverviewDimBrushEnd(0);
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px",
                    padding: "4px",
                    borderRadius: "999px",
                    background:
                      "linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {[
                  { id: "entries_over_time" as const, label: "Entries Over Time" },
                  { id: "symbol" as const, label: "Symbols" },
                  { id: "position" as const, label: "Positions" },
                  { id: "timeframe" as const, label: "Timeframes" },
                  { id: "entry_type" as const, label: "Entry Types" },
                  { id: "exit_type" as const, label: "Exit Types" },
                  { id: "outcome" as const, label: "Outcomes" },
                ].map((tab) => {
                  const isActive = overviewChartTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOverviewChartTab(tab.id)}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: isActive ? "var(--accent)" : "transparent",
                        color: isActive ? "#ffffff" : "var(--text-secondary)",
                        cursor: "pointer",
                        boxShadow: isActive ? "0 0 0 1px rgba(255,255,255,0.08)" : "none",
                        transition: "background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)");
                          e.currentTarget.style.color = "var(--text-primary)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "transparent";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
                </div>
              </div>
              <div style={{ height: 260, minHeight: 260, overflow: "hidden" }}>
                {(() => {
                  if (overviewChartTab === "entries_over_time") {
                    if (overviewEntriesByMonth.length === 0) {
                      return (
                        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                          No entries match the current filters.
                        </div>
                      );
                    }
                    const useBrush = overviewEntriesByMonth.length > BRUSH_MIN_POINTS;
                    const start = useBrush && overviewEntriesBrushEnd > 0 ? Math.min(overviewEntriesBrushStart, overviewEntriesByMonth.length - 1) : 0;
                    const end = useBrush && overviewEntriesBrushEnd > 0 ? Math.min(overviewEntriesByMonth.length - 1, Math.max(start, overviewEntriesBrushEnd)) : Math.max(0, overviewEntriesByMonth.length - 1);
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={overviewEntriesByMonth}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                          <XAxis dataKey="month" stroke="var(--text-secondary)" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} />
                          <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} allowDecimals={false} />
                          <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
                          <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                          {useBrush && (
                            <Brush dataKey="month" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setOverviewEntriesBrushStart(r.startIndex); setOverviewEntriesBrushEnd(r.endIndex); } }} />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  }
                  const key = overviewChartTab;
                  const data = overviewJournalChartData[key];
                  if (!data || data.length === 0) {
                    return (
                      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                        No journal trades match the current filters for this dimension.
                      </div>
                    );
                  }
                  const useBrush = data.length > BRUSH_MIN_POINTS;
                  const start = useBrush && overviewDimBrushEnd > 0 ? Math.min(overviewDimBrushStart, data.length - 1) : 0;
                  const end = useBrush && overviewDimBrushEnd > 0 ? Math.min(data.length - 1, Math.max(start, overviewDimBrushEnd)) : Math.max(0, data.length - 1);
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                        <XAxis dataKey="name" stroke="var(--text-secondary)" />
                        <YAxis stroke="var(--text-secondary)" allowDecimals={false} />
                        <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} contentStyle={{ backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} formatter={(value: any) => [value, "Entries"]} />
                        <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={1.6} activeBar={{ fill: "var(--accent)", fillOpacity: 0.8, stroke: "var(--accent)", strokeWidth: 2 }} />
                        {useBrush && (
                          <Brush dataKey="name" height={36} stroke="var(--border-color)" fill="var(--bg-tertiary)" startIndex={start} endIndex={end} onDragEnd={(r: { startIndex?: number; endIndex?: number }) => { if (r.startIndex != null && r.endIndex != null) { setOverviewDimBrushStart(r.startIndex); setOverviewDimBrushEnd(r.endIndex); } }} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>

            {recentWhatCouldBeImproved.length > 0 && (
              <div
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "20px",
                  marginBottom: "24px",
                }}
              >
                <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
                  Reflect: What could be improved
                </h3>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px" }}>
                  Notes from your most recent journals. Reflect on these before you start the day.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                  {recentWhatCouldBeImproved.map(({ entry, improvements }) => {
                    const isExpanded = expandedImprovementCardIds.has(entry.id);
                    return (
                      <div
                        key={entry.id}
                        onClick={() => {
                          clearWorkInProgress();
                          localStorage.setItem(`journal_selected_entry_id_${dataMode}`, entry.id.toString());
                          tabScrollPositions.current.clear();
                          loadEntry(entry.id);
                          setIsCreating(false);
                          setIsEditing(false);
                        }}
                        style={{
                          padding: "12px 14px",
                          borderRadius: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          border: "1px solid var(--border-color)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)" }}>
                          {entry.date
                            ? (() => {
                                try {
                                  const d = parse(entry.date, "yyyy-MM-dd", new Date());
                                  return isNaN(d.getTime()) ? entry.date : format(d, "MMM d, yyyy");
                                } catch {
                                  return entry.date;
                                }
                              })()
                            : ""}
                          {entry.title ? ` · ${entry.title}` : ""}
                        </div>
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div
                            style={{
                              maxHeight: isExpanded ? "none" : "88px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              className="reflect-improvement-content"
                              style={{
                                fontSize: "13px",
                                color: "var(--text-primary)",
                                lineHeight: 1.5,
                              }}
                            >
                              {improvements.map((text, i) => (
                                <div key={i} style={{ marginBottom: "6px" }}>
                                  <div
                                    dangerouslySetInnerHTML={{
                                      __html: sanitizeHtml(text || ""),
                                    }}
                                    style={{
                                      fontSize: "13px",
                                      color: "var(--text-primary)",
                                      lineHeight: 1.5,
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedImprovementCardIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(entry.id)) next.delete(entry.id);
                                else next.add(entry.id);
                                return next;
                              });
                            }}
                            style={{
                              alignSelf: "flex-start",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: "600",
                              color: "var(--accent)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              borderRadius: "4px",
                            }}
                          >
                            {isExpanded ? "Show less" : "Show more"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <style>{`
                  .reflect-improvement-content p { margin: 0 0 6px 0; }
                  .reflect-improvement-content p:last-child { margin-bottom: 0; }
                  .reflect-improvement-content br { display: block; content: ""; margin-bottom: 4px; }
                  .reflect-improvement-content ul, .reflect-improvement-content ol { margin: 0 0 6px 0; padding-left: 18px; }
                  .reflect-improvement-content strong { font-weight: 600; }
                  .reflect-improvement-content a { color: var(--accent); text-decoration: underline; }
                `}</style>
              </div>
            )}

            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "12px", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "600" }}>
                  Recent Journal Entries
                </h3>
                {filteredEntries.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecent((v) => !v)}
                    style={{
                      padding: "6px 10px",
                      fontSize: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {showAllRecent ? "Show latest 10" : `Show all (${filteredEntries.length})`}
                  </button>
                )}
              </div>
              {recentEntries.length === 0 ? (
                <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  No journal entries yet. Use the button above to create your first entry.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {recentEntries.map((entry) => (
                    <div
                      key={entry.id}
                      onClick={() => {
                        clearWorkInProgress();
                        localStorage.setItem(`journal_selected_entry_id_${dataMode}`, entry.id.toString());
                        tabScrollPositions.current.clear();
                        loadEntry(entry.id);
                        setIsCreating(false);
                        setIsEditing(false);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "6px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                        {format(parse(entry.date, "yyyy-MM-dd", new Date()), "MMM d, yyyy")} –{" "}
                        {entry.title}
                      </div>
                      {entry.strategy_id && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                          Strategy:{" "}
                          {strategies.find((s) => s.id === entry.strategy_id)?.name || "Unknown"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Entry List */}
      <div
        style={{
          width: isMaximized ? "0" : "300px",
          borderLeft: isMaximized ? "none" : "1px solid var(--border-color)",
          display: isMaximized ? "none" : "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-secondary)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: "bold" }}>Entries</h1>
          {!loading && entries.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <select
                  value={journalEntriesSort}
                  onChange={(e) => {
                    setJournalEntriesSort(e.target.value as "newest" | "oldest");
                    setJournalEntriesPage(1);
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    backgroundColor: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                {journalEntriesTotalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    <button
                      type="button"
                      onClick={() => setJournalEntriesPage((p) => Math.max(1, p - 1))}
                      disabled={effectiveJournalPage <= 1}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: journalEntriesPage <= 1 ? "var(--text-secondary)" : "var(--accent)",
                        background: "transparent",
                        border: `1px solid ${journalEntriesPage <= 1 ? "var(--border-color)" : "var(--accent)"}`,
                        borderRadius: "6px",
                        cursor: journalEntriesPage <= 1 ? "default" : "pointer",
                        opacity: journalEntriesPage <= 1 ? 0.6 : 1,
                      }}
                    >
                      Prev
                    </button>
                    <span style={{ minWidth: "52px", textAlign: "center" }}>
                      {effectiveJournalPage} / {journalEntriesTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setJournalEntriesPage((p) => Math.min(journalEntriesTotalPages, p + 1))}
                      disabled={effectiveJournalPage >= journalEntriesTotalPages}
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: effectiveJournalPage >= journalEntriesTotalPages ? "var(--text-secondary)" : "var(--accent)",
                        background: "transparent",
                        border: `1px solid ${effectiveJournalPage >= journalEntriesTotalPages ? "var(--border-color)" : "var(--accent)"}`,
                        borderRadius: "6px",
                        cursor: effectiveJournalPage >= journalEntriesTotalPages ? "default" : "pointer",
                        opacity: effectiveJournalPage >= journalEntriesTotalPages ? 0.6 : 1,
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={leftPanelScrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "24px 12px" }}>
              <LoadingSphere size={80} message="Loading journal..." padding={20} />
            </div>
          ) : entries.length === 0 ? (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "30px",
                textAlign: "center",
              }}
            >
              <FileText size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                No journal entries yet. Create your first entry.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {paginatedJournalEntries.map((entry) => {
                const isSelected = selectedEntry?.id === entry.id;
                return (
                  <div
                    key={entry.id}
                    onClick={() => {
                      // Toggle selection: clicking an already selected entry (when not editing) will unselect it
                      if (selectedEntry?.id === entry.id && !isCreating && !isEditing) {
                        const prevStorageKey = `journal_entry_${selectedEntry.id}`;
                        saveJournalScrollPositionsMerged(prevStorageKey);
                        clearWorkInProgress();
                        localStorage.removeItem(`journal_selected_entry_id_${dataMode}`);
                        setSelectedEntry(null);
                        setSelectedTrades([]);
                        tabScrollPositions.current.clear();
                        return;
                      }

                      // Save scroll position before switching (for previous entry if any)
                      if (selectedEntry?.id) {
                        const prevStorageKey = `journal_entry_${selectedEntry.id}`;
                        saveJournalScrollPositionsMerged(prevStorageKey);
                      }
                      clearWorkInProgress(); // Clear work in progress when selecting an existing entry
                      // Save selected entry ID immediately (per mode)
                      localStorage.setItem(`journal_selected_entry_id_${dataMode}`, entry.id.toString());
                      // Clear tab scroll positions to load fresh for new entry
                      tabScrollPositions.current.clear();
                      loadEntry(entry.id);
                      setIsCreating(false);
                      setIsEditing(false);
                    }}
                    style={{
                      padding: "12px",
                      backgroundColor: isSelected ? "var(--accent)" : "var(--bg-tertiary)",
                      border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: isSelected ? "white" : "var(--text-primary)",
                        marginBottom: "4px",
                      }}
                    >
                      {format(parse(entry.date, "yyyy-MM-dd", new Date()), "MM/dd/yyyy")} - {entry.title}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div style={{ padding: "16px", borderTop: "1px solid var(--border-color)" }}>
          {/* Progress Bars */}
          {(isCreating || isEditing) && entryFormData.strategy_id && currentTrade && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
              {/* Analysis & Mantra (first) */}
              {(["daily_analysis", "daily_mantra"] as const).map((type) => {
                const items = (currentChecklists?.get(type) || []).filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                if (items.length === 0) return null;
                const progress = calculateChecklistProgress(activeTradeIndex, type);
                const getProgressColor = () => {
                  if (progress >= 80) return "var(--profit)";
                  if (progress >= 60) return "var(--accent)";
                  if (progress >= 40) return "var(--warning)";
                  return "var(--danger)";
                };
                return (
                  <div key={type}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                        {getChecklistTitle(type)}
                      </span>
                      <span style={{ fontSize: "12px", color: getProgressColor(), fontWeight: "600" }}>{progress}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          backgroundColor: getProgressColor(),
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              
              {/* Entry Probability */}
              {(() => {
                const entryItems = currentChecklists?.get("entry") || [];
                if (entryItems.length > 0) {
                  const entryProb = calculateEntryProbability(activeTradeIndex);
                  const getEntryColor = () => {
                    if (entryProb >= 80) return "var(--profit)";
                    if (entryProb >= 60) return "var(--accent)";
                    if (entryProb >= 40) return "var(--warning)";
                    return "var(--danger)";
                  };
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>Entry Probability</span>
                        <span style={{ fontSize: "12px", color: getEntryColor(), fontWeight: "600" }}>{entryProb}%</span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${entryProb}%`,
                            height: "100%",
                            backgroundColor: getEntryColor(),
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Take Profit Implementation */}
              {(() => {
                const takeProfitItems = currentChecklists?.get("take_profit") || [];
                if (takeProfitItems.length > 0) {
                  const tpImpl = calculateTakeProfitImplementation(activeTradeIndex);
                  const getTPColor = () => {
                    if (tpImpl >= 80) return "var(--profit)";
                    if (tpImpl >= 60) return "var(--accent)";
                    if (tpImpl >= 40) return "var(--warning)";
                    return "var(--danger)";
                  };
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>Take Profit Implementation</span>
                        <span style={{ fontSize: "12px", color: getTPColor(), fontWeight: "600" }}>{tpImpl}%</span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "8px",
                          backgroundColor: "var(--bg-tertiary)",
                          borderRadius: "4px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${tpImpl}%`,
                            height: "100%",
                            backgroundColor: getTPColor(),
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Custom Checklist Progress Bars */}
              {customTypes.map((type) => {
                const items = (currentChecklists?.get(type) || []).filter((item) => item.item_text !== EMPTY_CUSTOM_CHECKLIST_PLACEHOLDER);
                if (items.length === 0) return null;
                
                const progress = calculateChecklistProgress(activeTradeIndex, type);
                const getProgressColor = () => {
                  if (progress >= 80) return "var(--profit)";
                  if (progress >= 60) return "var(--accent)";
                  if (progress >= 40) return "var(--warning)";
                  return "var(--danger)";
                };
                
                return (
                  <div key={type}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}>
                        {getChecklistTitle(type)}
                      </span>
                      <span style={{ fontSize: "12px", color: getProgressColor(), fontWeight: "600" }}>{progress}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "8px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progress}%`,
                          height: "100%",
                          backgroundColor: getProgressColor(),
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={handleCreateNew}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--accent)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              <Plus size={16} />
              Add Entry
            </button>
          </div>
        </div>
      </div>

      {/* Link to actual trades modal (journal trade -> real trades from Trades table) */}
      {linkActualTradesModalJournalTradeId !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1001,
          }}
          onClick={() => setLinkActualTradesModalJournalTradeId(null)}
        >
          <div
            style={{
              background: "var(--bg-primary)",
              borderRadius: "8px",
              padding: "20px",
              maxWidth: "480px",
              width: "90%",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--border-color)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 8px", fontSize: "16px" }}>Link to actual trades</h4>
            <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>
              Select real trades from your Trades list to associate with this journal trade.
            </p>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px", paddingRight: "4px" }}>
              {actualTrades.filter((t): t is ActualTrade & { id: number } => t.id != null).map((t) => {
                const tid = t.id as number;
                const isSelected = linkActualTradesSelection.includes(tid);
                return (
                  <label
                    key={tid}
                    style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setLinkActualTradesSelection((prev) =>
                          prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid]
                        );
                      }}
                    />
                    <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                      {t.symbol} {t.side} · {t.quantity} @ ${typeof t.price === "number" ? t.price.toFixed(2) : t.price} · {t.timestamp ? format(new Date(t.timestamp), "MMM d, yyyy HH:mm") : ""}
                    </span>
                  </label>
                );
              })}
              {actualTrades.length === 0 && (
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No actual trades in your Trades list. Add trades on the Trades page first.</span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setLinkActualTradesModalJournalTradeId(null)}
                style={{ padding: "8px 16px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const jtId = linkActualTradesModalJournalTradeId;
                  if (jtId == null) return;
                  try {
                    await invoke("save_journal_trade_actual_trades", { journalTradeId: jtId, tradeIds: linkActualTradesSelection });
                    setJournalTradeActualTradeIds((prev) => new Map(prev).set(jtId, linkActualTradesSelection));
                  } catch (e) {
                    console.error(e);
                  }
                  setLinkActualTradesModalJournalTradeId(null);
                }}
                style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section order modal: reorder journal entry sections */}
      {showSectionOrderModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowSectionOrderModal(false)}>
          <div style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "20px", width: "90%", maxWidth: "420px", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px", color: "var(--text-primary)" }}>Reorder sections</h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>Drag to reorder. Use the eye icon to hide or show sections on the journal page.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "60vh", overflowY: "auto" }}>
              <DndContext
                sensors={sectionOrderSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleSectionOrderDragEnd}
              >
                <SortableContext items={fullSectionOrder} strategy={verticalListSortingStrategy}>
                  {fullSectionOrder.map((sectionId, index) => (
                    <SortableSectionRow
                      key={sectionId}
                      sectionId={sectionId}
                      label={getSectionLabel(sectionId)}
                      index={index}
                      totalLength={fullSectionOrder.length}
                      onMoveUp={() => setJournalSectionOrder(arrayMove(fullSectionOrder, index, index - 1))}
                      onMoveDown={() => setJournalSectionOrder(arrayMove(fullSectionOrder, index, index + 1))}
                      isHidden={hiddenSectionIds.includes(sectionId)}
                      onToggleHide={() => setHiddenSectionIds((prev) => (prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]))}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
            <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.setItem(JOURNAL_DEFAULT_SECTION_ORDER_KEY, JSON.stringify(journalSectionOrder));
                    } catch {
                      /* ignore */
                    }
                  }}
                  style={{ padding: "6px 12px", fontSize: "12px", color: "var(--text-secondary)", background: "transparent", border: "1px dashed var(--border-color)", borderRadius: "6px", cursor: "pointer" }}
                >
                  Set as default arrangement
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const raw = localStorage.getItem(JOURNAL_DEFAULT_SECTION_ORDER_KEY);
                      if (raw) {
                        const parsed = JSON.parse(raw) as string[];
                        if (Array.isArray(parsed) && parsed.length > 0) {
                          const normalized = parsed.map((id) => (id === "mantra_checklist" ? "custom:daily_mantra" : id));
                          const valid = normalized.filter((id) => id !== "custom_checklists_surveys" && (CORE_SECTION_ORDER.includes(id as JournalSectionId) || id.startsWith("custom:")));
                          const missing = CORE_SECTION_ORDER.filter((id) => !valid.includes(id));
                          setJournalSectionOrder([...valid, ...missing]);
                        }
                      } else {
                        setJournalSectionOrder([...CORE_SECTION_ORDER]);
                      }
                    } catch {
                      setJournalSectionOrder([...CORE_SECTION_ORDER]);
                    }
                  }}
                  style={{ padding: "6px 12px", fontSize: "12px", color: "var(--text-secondary)", background: "transparent", border: "1px dashed var(--border-color)", borderRadius: "6px", cursor: "pointer" }}
                >
                  Reset to default arrangement
                </button>
              </div>
              <button type="button" onClick={() => setShowSectionOrderModal(false)} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer", fontSize: "13px" }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Trade association modal (for checklist items in scrolling sections) */}
      {tradeAssociationModalItemId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setTradeAssociationModalItemId(null)}>
          <div style={{ background: "var(--bg-primary)", borderRadius: "8px", padding: "20px", maxWidth: "400px", width: "90%", border: "1px solid var(--border-color)" }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px", fontSize: "14px" }}>Associate with trades</h4>
            <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--text-secondary)" }}>Select which <strong>journal trades</strong> in this entry ({entryTradesForAssociation.length}) this checklist item should apply to.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              <div style={{ maxHeight: "240px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingRight: "4px" }}>
                {entryTradesForAssociation.map((t, i) => {
                  const key: number = selectedEntry && (t as { id?: number }).id != null ? (t as { id: number }).id : i;
                  const label = (t as { symbol?: string }).symbol || `Trade ${i + 1}`;
                  const currentAssoc = checklistTradeAssociations.get(tradeAssociationModalItemId);
                  const isSelected = !!currentAssoc && currentAssoc.length > 0 && currentAssoc.includes(key);
                  const toggleTrade = () => {
                    const prev = checklistTradeAssociations.get(tradeAssociationModalItemId) || [];
                    const ids = prev.length > 0 ? [...prev] : [];
                    const idx = ids.indexOf(key);
                    if (idx >= 0) ids.splice(idx, 1);
                    else ids.push(key);
                    setChecklistTradeAssociation(tradeAssociationModalItemId, ids.length > 0 ? ids : null);
                  };
                  return (
                    <label key={i} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}>
                      <input type="checkbox" checked={isSelected} onChange={toggleTrade} />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <button type="button" onClick={() => setTradeAssociationModalItemId(null)} style={{ padding: "8px 16px", background: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: "pointer" }}>Done</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && selectedEntry && (
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
          onClick={handleDeleteCancel}
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
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              Delete Journal Entry
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: "1.5",
              }}
            >
              Are you sure you want to delete <strong>"{selectedEntry.title}"</strong>?
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              This action cannot be undone. All trades, checklist responses, and notes associated with this journal entry will be permanently deleted.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleDeleteCancel}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Emotional State Confirmation Modal */}
      {emotionalStateDeleteTarget && (
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
          onClick={handleEmotionalStateDeleteCancel}
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
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              Delete Emotional State
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "8px",
                lineHeight: "1.5",
              }}
            >
              Are you sure you want to delete this emotional state entry
              {emotionalStateDeleteTarget.type === "saved"
                ? ` (${emotionalStateDeleteTarget.states.map((s) => s.emotion).join(", ")})`
                : (() => {
                    const pendingList = pendingEmotionalStates.filter((p) => p.tradeIndex === emotionalStateDeleteTarget.tradeIndex);
                    const entry = pendingList[emotionalStateDeleteTarget.idx];
                    return entry ? ` (${Object.keys(entry.selectedEmotions).join(", ")})` : "";
                  })()}
              ?
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              {emotionalStateDeleteTarget.type === "pending"
                ? "This entry has not been saved yet. It will be removed from the list."
                : "This action cannot be undone. The emotional state entry will be permanently deleted."}
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleEmotionalStateDeleteCancel}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleEmotionalStateDeleteConfirm}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Title Required Modal */}
      {showTitleRequiredModal && (
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
          onClick={() => setShowTitleRequiredModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "400px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--text-primary)",
              }}
            >
              Journal Entry Title Required
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              Please enter a title for your journal entry before saving.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => {
                  setShowTitleRequiredModal(false);
                  setTimeout(() => {
                    titleInputRef.current?.focus();
                  }, 100);
                }}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link positions modal */}
      {showLinkPairsModal && (
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
          onClick={() => !savingLinkPairs && setShowLinkPairsModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "560px",
              maxHeight: "80vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px", color: "var(--text-primary)" }}>
              Link positions to this journal entry
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Select the positions from your Trades tab to link. Linked positions appear above the text area and are clickable to view the chart.
            </p>
            <div style={{ position: "relative", marginBottom: "12px", flexShrink: 0 }}>
              <Search
                size={18}
                style={{
                  position: "absolute",
                  left: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-secondary)",
                }}
              />
              <input
                type="text"
                placeholder="Search by symbol or date..."
                value={linkPairsSearchQuery}
                onChange={(e) => setLinkPairsSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 40px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px", flexShrink: 0 }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Sort by:</span>
              <select
                value={linkPairsSortBy}
                onChange={(e) => setLinkPairsSortBy(e.target.value as "date" | "symbol" | "pnl")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  outline: "none",
                }}
              >
                <option value="date">Date (exit)</option>
                <option value="symbol">Symbol</option>
                <option value="pnl">P&L</option>
              </select>
              <button
                type="button"
                onClick={() => setLinkPairsSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
                title={linkPairsSortDirection === "desc" ? "Newest first (click for oldest first)" : "Oldest first (click for newest first)"}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {linkPairsSortBy === "date" && (linkPairsSortDirection === "desc" ? "Newest first" : "Oldest first")}
                {linkPairsSortBy === "symbol" && (linkPairsSortDirection === "desc" ? "Z → A" : "A → Z")}
                {linkPairsSortBy === "pnl" && (linkPairsSortDirection === "desc" ? "High → Low" : "Low → High")}
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", marginBottom: "16px", border: "1px solid var(--border-color)", borderRadius: "8px", backgroundColor: "var(--bg-primary)" }}>
              {allPairsForPicker.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)" }}>No positions found. Add trades on the Trades tab first.</div>
              ) : (() => {
                const searchLower = linkPairsSearchQuery.toLowerCase().trim();
                let filtered = searchLower
                  ? allPairsForPicker.filter((pair) => {
                      const entryStr = format(new Date(pair.entry_timestamp), "MMM d, yyyy HH:mm");
                      const exitStr = format(new Date(pair.exit_timestamp), "MMM d, yyyy HH:mm");
                      const pnlStr = pair.net_profit_loss.toFixed(2);
                      return (
                        pair.symbol.toLowerCase().includes(searchLower) ||
                        entryStr.toLowerCase().includes(searchLower) ||
                        exitStr.toLowerCase().includes(searchLower) ||
                        pnlStr.includes(linkPairsSearchQuery.trim())
                      );
                    })
                  : [...allPairsForPicker];
                if (filtered.length === 0) {
                  return <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)" }}>No positions match your search.</div>;
                }
                const sorted = [...filtered].sort((a, b) => {
                  let comparison = 0;
                  if (linkPairsSortBy === "date") {
                    comparison = new Date(a.exit_timestamp).getTime() - new Date(b.exit_timestamp).getTime();
                  } else if (linkPairsSortBy === "symbol") {
                    comparison = a.symbol.localeCompare(b.symbol);
                  } else {
                    comparison = a.net_profit_loss - b.net_profit_loss;
                  }
                  return linkPairsSortDirection === "asc" ? comparison : -comparison;
                });
                return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", width: "40px" }} />
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Symbol</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Entry</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>Exit</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)" }}>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((pair) => {
                      const key = `${pair.entry_trade_id}_${pair.exit_trade_id}`;
                      const isSelected = linkPickerSelected.has(key);
                      return (
                        <tr
                          key={key}
                          style={{
                            borderBottom: "1px solid var(--border-color)",
                            cursor: "pointer",
                            backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
                          }}
                          onClick={() => {
                            setLinkPickerSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            });
                          }}
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setLinkPickerSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: "pointer" }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: "14px" }}>{pair.symbol}</td>
                          <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--text-secondary)" }}>{format(new Date(pair.entry_timestamp), "MMM d, yyyy HH:mm")}</td>
                          <td style={{ padding: "10px 12px", fontSize: "13px", color: "var(--text-secondary)" }}>{format(new Date(pair.exit_timestamp), "MMM d, yyyy HH:mm")}</td>
                          <td style={{ padding: "10px 12px", fontSize: "14px", textAlign: "right", fontWeight: "600", color: pair.net_profit_loss >= 0 ? "var(--profit)" : "var(--loss)" }}>
                            {pair.net_profit_loss >= 0 ? "+" : ""}{pair.net_profit_loss.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                );
              })()}
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !savingLinkPairs && setShowLinkPairsModal(false)}
                style={{ padding: "10px 20px", backgroundColor: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: savingLinkPairs ? "not-allowed" : "pointer", fontSize: "14px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingLinkPairs}
                onClick={async () => {
                  const pairs = Array.from(linkPickerSelected).map((key) => {
                    const [e, x] = key.split("_").map(Number);
                    return { entry_trade_id: e, exit_trade_id: x };
                  });
                  if (!selectedEntry?.id) {
                    const updated = allPairsForPicker.filter((p) => linkPickerSelected.has(`${p.entry_trade_id}_${p.exit_trade_id}`));
                    setPendingLinkedPairs(updated);
                    const tradeIdsFromPairs = new Set<number>();
                    for (const p of updated) {
                      tradeIdsFromPairs.add(p.entry_trade_id);
                      tradeIdsFromPairs.add(p.exit_trade_id);
                    }
                    const scope = { scope: "entry" as const, tradeIndex: null };
                    const newStateIds: number[] = [];
                    for (const tid of tradeIdsFromPairs) {
                      for (const sid of getEmotionalStateIdsForRealTrade(tid, allEmotionalStates)) {
                        if (!newStateIds.includes(sid)) newStateIds.push(sid);
                      }
                    }
                    if (newStateIds.length > 0) {
                      setEntryFormData((prev) => {
                        const existing = new Set(prev.linked_emotional_state_ids ?? []);
                        const merged = [...existing];
                        const mergedScopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) };
                        for (const sid of newStateIds) {
                          if (!existing.has(sid)) {
                            merged.push(sid);
                            mergedScopes[sid] = scope;
                          }
                        }
                        return { ...prev, linked_emotional_state_ids: merged, linked_emotional_state_link_scopes: mergedScopes };
                      });
                    }
                    setShowLinkPairsModal(false);
                    return;
                  }
                  setSavingLinkPairs(true);
                  try {
                    let updated: PairedTrade[];
                    if (dataMode === "sandbox") {
                      setSandboxJournalEntryPairs(selectedEntry.id, pairs);
                      updated = getSandboxJournalEntryPairsAsPairedTrades(selectedEntry.id) as unknown as PairedTrade[];
                      setLinkedPairs(updated);
                    } else {
                      await invoke("set_journal_entry_pairs", { journalEntryId: selectedEntry.id, pairs });
                      updated = await invoke<PairedTrade[]>("get_journal_entry_pairs", { journalEntryId: selectedEntry.id });
                      setLinkedPairs(updated);
                    }
                    const tradeIdsFromPairs = new Set<number>();
                    for (const p of updated) {
                      tradeIdsFromPairs.add(p.entry_trade_id);
                      tradeIdsFromPairs.add(p.exit_trade_id);
                    }
                    const scope = { scope: "entry" as const, tradeIndex: null };
                    const newStateIds: number[] = [];
                    const newScopes: Record<number, { scope: "entry" | "trades"; tradeIndex: number | null }> = {};
                    for (const tid of tradeIdsFromPairs) {
                      for (const sid of getEmotionalStateIdsForRealTrade(tid, allEmotionalStates)) {
                        if (!newStateIds.includes(sid)) {
                          newStateIds.push(sid);
                          newScopes[sid] = scope;
                        }
                      }
                    }
                    if (newStateIds.length > 0) {
                      setEntryFormData((prev) => {
                        const existing = new Set(prev.linked_emotional_state_ids ?? []);
                        const merged = [...existing];
                        const mergedScopes = { ...(prev.linked_emotional_state_link_scopes ?? {}) };
                        for (const sid of newStateIds) {
                          if (!existing.has(sid)) {
                            merged.push(sid);
                            mergedScopes[sid] = scope;
                          }
                        }
                        return { ...prev, linked_emotional_state_ids: merged, linked_emotional_state_link_scopes: mergedScopes };
                      });
                    }
                    setShowLinkPairsModal(false);
                  } catch (e) {
                    console.error("Failed to save linked pairs:", e);
                    alert("Failed to save linked pairs.");
                  } finally {
                    setSavingLinkPairs(false);
                  }
                }}
                style={{ padding: "10px 20px", backgroundColor: "var(--accent)", border: "none", borderRadius: "6px", color: "white", cursor: savingLinkPairs ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500" }}
              >
                {savingLinkPairs ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPairForChart && (
        <TradeChart
          symbol={selectedPairForChart.symbol}
          entryTimestamp={selectedPairForChart.entry_timestamp}
          exitTimestamp={selectedPairForChart.exit_timestamp}
          entryPrice={selectedPairForChart.entry_price}
          exitPrice={selectedPairForChart.exit_price}
          onClose={() => {
            setSelectedPairForChart(null);
            setSelectedPositionTrades(undefined);
          }}
          positionTrades={selectedPositionTrades}
        />
      )}
      </div>
    </div>
  );
}
