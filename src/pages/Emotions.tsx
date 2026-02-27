import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { Plus, X, TrendingUp, AlertTriangle, Target, Shield, BarChart3, Heart, ClipboardList, Maximize2, Minimize2, Edit2, Trash2, ArrowLeft, RotateCcw, ExternalLink, ChevronDown } from "lucide-react";
import { LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import RichTextEditor from "../components/RichTextEditor";

interface EmotionalState {
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

interface EmotionSurvey {
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

type SurveyTabType = "before" | "during" | "after";

const EMOTIONS = [
  "Confident",
  "Anxious",
  "Frustrated",
  "Excited",
  "Calm",
  "Greedy",
  "Fearful",
  "Optimistic",
  "Pessimistic",
  "Neutral",
];

/** Noun form for chart tabs and titles (e.g. "Confident" → "Confidence") */
const EMOTION_DISPLAY_NAMES: Record<string, string> = {
  Confident: "Confidence",
  Anxious: "Anxiety",
  Frustrated: "Frustration",
  Excited: "Excitement",
  Calm: "Calm",
  Greedy: "Greed",
  Fearful: "Fear",
  Optimistic: "Optimism",
  Pessimistic: "Pessimism",
  Neutral: "Neutral",
};

const DEFAULT_INTENSITY = 0;

const INTENSITY_SCALE_LABEL = "0 = not present → 10 = extremely strong. Rate how strongly you feel each emotion; there’s no single “neutral” — values are used for trends and insights over time.";

const INTENSITY_LABELS: Record<number, string> = {
  0: "None", 1: "Barely", 2: "Slight", 3: "Mild", 4: "Moderate", 5: "Noticeable",
  6: "Strong", 7: "Very strong", 8: "Intense", 9: "Severe", 10: "Extreme",
};

function isEntryFormModified(selectedEmotions: Record<string, number>, notes: string): boolean {
  const hasEmotions = Object.keys(selectedEmotions).length > 0;
  const hasNotes = (notes || "").trim() !== "";
  return hasEmotions || hasNotes;
}

/** Group emotional states by timestamp (same timestamp = one "entry" with shared notes). */
function groupStatesByTimestamp(states: EmotionalState[]): EmotionalState[][] {
  const byTs = new Map<string, EmotionalState[]>();
  for (const s of states) {
    const key = s.timestamp;
    if (!byTs.has(key)) byTs.set(key, []);
    byTs.get(key)!.push(s);
  }
  return Array.from(byTs.values()).sort(
    (a, b) => new Date(b[0].timestamp).getTime() - new Date(a[0].timestamp).getTime()
  );
}

const SURVEY_QUESTIONS = {
  before: [
    {
      key: "before_calm_clear",
      question: "How calm and mentally clear did you feel before considering this trade?",
      scale: "1 = Very anxious/confused, 5 = Very calm/clear",
    },
    {
      key: "before_urgency_pressure",
      question: "Did you feel any urgency or pressure to \"make something happen\" in the market?",
      scale: "1 = No urgency, 5 = Extreme pressure",
    },
    {
      key: "before_confidence_vs_validation",
      question: "Were you feeling confident in yourself, or seeking validation from a win?",
      scale: "1 = Confident in self, 5 = Seeking validation",
    },
    {
      key: "before_fomo",
      question: "Did fear of missing out (FOMO) influence your desire to enter?",
      scale: "1 = No FOMO, 5 = Strong FOMO",
    },
    {
      key: "before_recovering_loss",
      question: "Were you trying to recover from a previous loss emotionally?",
      scale: "1 = Not at all, 5 = Strongly trying to recover",
    },
    {
      key: "before_patient_detached",
      question: "Did you feel patient and detached, or restless and impulsive?",
      scale: "1 = Patient/detached, 5 = Restless/impulsive",
    },
    {
      key: "before_trust_process",
      question: "How strong was your trust in your process at that moment?",
      scale: "1 = No trust, 5 = Complete trust",
    },
    {
      key: "before_emotional_state",
      question: "Were you feeling bored, excited, anxious, or neutral before entry?",
      scale: "1 = Neutral/calm, 5 = Extremely emotional (any)",
    },
  ],
  during: [
    {
      key: "during_stable",
      question: "How stable were your emotions once the trade was live?",
      scale: "1 = Very stable, 5 = Very unstable",
    },
    {
      key: "during_tension_stress",
      question: "Did you feel tension, nervousness, or physical stress while price moved?",
      scale: "1 = No tension, 5 = Extreme tension/stress",
    },
    {
      key: "during_tempted_interfere",
      question: "Were you tempted to interfere with the trade out of fear or hope?",
      scale: "1 = No temptation, 5 = Strong temptation",
    },
    {
      key: "during_need_control",
      question: "Did you feel a need to \"control\" the outcome instead of letting it play out?",
      scale: "1 = Let it play, 5 = Strong need to control",
    },
    {
      key: "during_fear_loss",
      question: "How strong was your fear of loss while in the position?",
      scale: "1 = No fear, 5 = Extreme fear",
    },
    {
      key: "during_excitement_greed",
      question: "How strong was your excitement or greed as price moved in your favor?",
      scale: "1 = Calm, 5 = Extreme excitement/greed",
    },
    {
      key: "during_mentally_present",
      question: "Did you feel mentally present, or distracted and reactive?",
      scale: "1 = Very present, 5 = Very distracted/reactive",
    },
  ],
  after: [
    {
      key: "after_accept_outcome",
      question: "How well did you accept the outcome emotionally, regardless of win or loss?",
      scale: "1 = Full acceptance, 5 = Poor acceptance",
    },
    {
      key: "after_emotional_reaction",
      question: "Did you feel relief, frustration, disappointment, or satisfaction?",
      scale: "1 = Neutral/balanced, 5 = Strong emotional reaction",
    },
    {
      key: "after_confidence_affected",
      question: "Did the result affect your confidence in yourself?",
      scale: "1 = No effect, 5 = Strong effect (positive or negative)",
    },
    {
      key: "after_tempted_another_trade",
      question: "Did you feel tempted to immediately take another trade to change your emotional state?",
      scale: "1 = No temptation, 5 = Strong temptation",
    },
    {
      key: "after_proud_discipline",
      question: "Did you feel proud of your discipline, or focused only on the money outcome?",
      scale: "1 = Proud of discipline, 5 = Only focused on money",
    },
  ],
};

// Helper function to get gradient color from red -> yellow -> green (for metrics: higher = better)
// normalizedValue: 0 (bad/red) to 1 (good/green), with 0.5 being neutral/yellow
function getGradientColor(normalizedValue: number): string {
  const value = Math.max(0, Math.min(1, normalizedValue));
  let r: number, g: number, b: number;
  if (value <= 0.5) {
    const t = value * 2;
    r = 255;
    g = Math.round(255 * t);
    b = 0;
  } else {
    const t = (value - 0.5) * 2;
    r = Math.round(255 * (1 - t));
    g = 255;
    b = 0;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// Intensity color for emotional states: 0/10 = green (calm), 10/10 = red (high), yellow → orange in between
function getIntensityColorForEmotion(intensity: number): string {
  const v = Math.max(0, Math.min(10, intensity)) / 10; // 0–1
  let r: number, g: number, b: number;
  if (v <= 0.33) {
    // Green to Yellow
    const t = v / 0.33;
    r = Math.round(34 + (255 - 34) * t);
    g = 197;
    b = Math.round(94 * (1 - t));
  } else if (v <= 0.66) {
    // Yellow to Orange
    const t = (v - 0.33) / 0.33;
    r = 255;
    g = Math.round(255 - 90 * t);
    b = 0;
  } else {
    // Orange to Red
    const t = (v - 0.66) / 0.34;
    r = 255;
    g = Math.round(165 * (1 - t));
    b = 0;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// Gradient and glow for state overview cards (0–10 intensity)
function getIntensityGradientStyles(intensity: number): { gradient: string; color: string; glow: string; border: string; borderHover: string } {
  const color = getIntensityColorForEmotion(intensity);
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const r = match ? match[1] : "128";
  const g = match ? match[2] : "128";
  const b = match ? match[3] : "128";
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  const gradient = `linear-gradient(145deg, ${rgba(0.2)} 0%, ${rgba(0.06)} 40%, transparent 70%)`;
  const glow = `0 0 20px ${rgba(0.25)}, 0 4px 12px rgba(0,0,0,0.2)`;
  return {
    gradient,
    color,
    glow,
    border: rgba(0.35),
    borderHover: rgba(0.6),
    badgeBg: `linear-gradient(145deg, ${rgba(0.28)} 0%, ${rgba(0.12)} 100%)`,
    badgeShadow: `inset 0 1px 0 ${rgba(0.4)}, 0 2px 10px ${rgba(0.25)}`,
  };
}

function MetricsDisplay({ surveys, states }: { surveys: EmotionSurvey[]; states: EmotionalState[] }) {
  if (surveys.length === 0 && states.length === 0) return null;

  // Calculate metrics
  const calculateMetric = (values: number[], inverted: boolean = false) => {
    if (values.length === 0) return 3;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return inverted ? 6 - avg : avg; // Invert if needed (1-5 scale, so 6-avg gives inverse)
  };

  // Emotional Stability Index (avg of during_stable, during_mentally_present, after_accept_outcome)
  const emotionalStabilityValues = surveys.flatMap((s) => [
    6 - s.during_stable, // Inverted - higher is better
    6 - s.during_mentally_present, // Inverted
    6 - s.after_accept_outcome, // Inverted
  ]);
  const emotionalStabilityIndex = calculateMetric(emotionalStabilityValues);

  // FOMO Index (before_fomo average) - lower is better, so we invert
  const fomoValues = surveys.map((s) => s.before_fomo);
  const fomoIndex = 6 - calculateMetric(fomoValues); // Inverted because lower is better

  // Discipline Consistency (avg of before_patient_detached, during_need_control, after_proud_discipline - inverted)
  const disciplineValues = surveys.flatMap((s) => [
    6 - s.before_patient_detached,
    6 - s.during_need_control,
    s.after_proud_discipline, // Already positive (1 = proud, 5 = money focused)
  ]);
  const disciplineConsistency = calculateMetric(disciplineValues);

  // Revenge-trade Risk (before_recovering_loss, after_tempted_another_trade) - lower is better
  const revengeTradeValues = surveys.flatMap((s) => [s.before_recovering_loss, s.after_tempted_another_trade]);
  const revengeTradeRisk = 6 - calculateMetric(revengeTradeValues); // Inverted because lower is better

  // Overconfidence after wins - lower is better
  const overconfidenceValues = surveys.map((s) => s.after_confidence_affected);
  const overconfidenceAfterWins = 6 - calculateMetric(overconfidenceValues); // Inverted because lower is better

  // Fear after losses - lower is better
  const fearAfterLossesValues = surveys.flatMap((s) => [s.during_fear_loss, s.after_confidence_affected]);
  const fearAfterLosses = 6 - calculateMetric(fearAfterLossesValues); // Inverted because lower is better

  // Helper to normalize metric value (0-1) where 1 is best
  const normalizeForColor = (value: number, max: number = 5): number => {
    return Math.max(0, Math.min(1, value / max));
  };

  const metrics = [
    {
      name: "Emotional Stability Index",
      value: emotionalStabilityIndex.toFixed(2),
      max: 5,
      icon: Shield,
      normalizedValue: normalizeForColor(emotionalStabilityIndex),
      description: "Your ability to stay emotionally stable during and after trades",
    },
    {
      name: "FOMO Index",
      value: fomoIndex.toFixed(2),
      max: 5,
      icon: AlertTriangle,
      normalizedValue: normalizeForColor(fomoIndex), // Already inverted in calculation
      description: "How often FOMO influences your trading decisions (lower is better)",
    },
    {
      name: "Discipline Consistency",
      value: disciplineConsistency.toFixed(2),
      max: 5,
      icon: Target,
      normalizedValue: normalizeForColor(disciplineConsistency),
      description: "Your consistency in maintaining discipline throughout trades",
    },
    {
      name: "Revenge-Trade Risk",
      value: revengeTradeRisk.toFixed(2),
      max: 5,
      icon: TrendingUp,
      normalizedValue: normalizeForColor(revengeTradeRisk), // Already inverted
      description: "Tendency to take trades to recover from losses (lower is better)",
    },
    {
      name: "Overconfidence After Wins",
      value: overconfidenceAfterWins.toFixed(2),
      max: 5,
      icon: BarChart3,
      normalizedValue: normalizeForColor(overconfidenceAfterWins), // Already inverted
      description: "How wins affect your confidence and decision-making",
    },
    {
      name: "Fear After Losses",
      value: fearAfterLosses.toFixed(2),
      max: 5,
      icon: AlertTriangle,
      normalizedValue: normalizeForColor(fearAfterLosses), // Already inverted
      description: "Emotional impact of losses on future trading (lower is better)",
    },
  ];

  // Prepare chart data for emotional states over time — one data point per day (average intensity)
  const chartData = useMemo(() => {
    const byDay = new Map<string, { sum: number; count: number; t: number }>();
    for (const state of states) {
      const d = new Date(state.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const t = d.getTime();
      const existing = byDay.get(key);
      if (!existing) {
        byDay.set(key, { sum: state.intensity, count: 1, t });
      } else {
        existing.sum += state.intensity;
        existing.count += 1;
      }
    }
    return Array.from(byDay.entries())
      .map(([key, { sum, count, t }]) => ({
        date: format(new Date(t), "MMM dd"),
        intensity: Math.round((sum / count) * 10) / 10,
        _sortKey: key,
      }))
      .sort((a, b) => (a._sortKey as string).localeCompare(b._sortKey as string))
      .map(({ _sortKey, ...rest }) => rest);
  }, [states]);

  // Prepare survey trends data
  const surveyChartData = useMemo(() => {
    if (surveys.length === 0) return [];
    
    return surveys
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((survey) => {
        const stability = (6 - survey.during_stable + 6 - survey.during_mentally_present + 6 - survey.after_accept_outcome) / 3;
        const discipline = (6 - survey.before_patient_detached + 6 - survey.during_need_control + survey.after_proud_discipline) / 3;
        const fomo = 6 - survey.before_fomo;
        
        return {
          date: format(new Date(survey.timestamp), "MMM dd"),
          stability: parseFloat(stability.toFixed(2)),
          discipline: parseFloat(discipline.toFixed(2)),
          fomo: parseFloat(fomo.toFixed(2)),
        };
      });
  }, [surveys]);

  return (
    <div style={{ marginBottom: "30px" }}>
      {/* Metrics Cards */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          padding: "24px",
          marginBottom: "30px",
        }}
      >
        <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "20px" }}>Psychological Metrics</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          {metrics.map((metric) => {
            const Icon = metric.icon;
            const percentage = (parseFloat(metric.value) / metric.max) * 100;
            const color = getGradientColor(metric.normalizedValue);
            return (
              <div
                key={metric.name}
                style={{
                  backgroundColor: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                  <Icon size={20} style={{ color }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>{metric.name}</div>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color }}>
                      {metric.value}<span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>/{metric.max}</span>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    height: "6px",
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "3px",
                    overflow: "hidden",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${percentage}%`,
                      backgroundColor: color,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.4" }}>{metric.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Survey Trends Chart */}
      {surveys.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "30px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>Emotional Metrics Trends</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={surveyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-secondary)"
                style={{ fontSize: "12px" }}
              />
              <YAxis 
                domain={[0, 5]}
                stroke="var(--text-secondary)"
                style={{ fontSize: "12px" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="stability" 
                stroke={getGradientColor(0.9)}
                strokeWidth={2}
                dot={{ fill: getGradientColor(0.9), r: 4 }}
                name="Emotional Stability"
              />
              <Line 
                type="monotone" 
                dataKey="discipline" 
                stroke={getGradientColor(0.85)}
                strokeWidth={2}
                dot={{ fill: getGradientColor(0.85), r: 4 }}
                name="Discipline"
              />
              <Line 
                type="monotone" 
                dataKey="fomo" 
                stroke={getGradientColor(0.75)}
                strokeWidth={2}
                dot={{ fill: getGradientColor(0.75), r: 4 }}
                name="FOMO Resistance"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}

export default function Emotions() {
  const [states, setStates] = useState<EmotionalState[]>([]);
  const [surveys, setSurveys] = useState<EmotionSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(() => {
    const saved = localStorage.getItem('emotions_show_form');
    return saved === "true";
  });
  const [showSurvey, setShowSurvey] = useState(false);
  const [pendingStateId, setPendingStateId] = useState<number | null>(null);
  const [editingState, setEditingState] = useState<EmotionalState | null>(null);
  const [isEditingSelectedState, setIsEditingSelectedState] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [formTab, setFormTab] = useState<"basic" | SurveyTabType>("basic");
  const [formData, setFormData] = useState<{
    timestamp: string;
    selectedEmotions: Record<string, number>;
    notes: string;
    takeSurvey?: boolean;
    journalEntryIds: number[];
    journalTradeId?: number | null;
    journalTradeIds?: number[];
    tradeIds: number[];
  }>(() => {
    const saved = localStorage.getItem('emotions_form_data');
    const nowIso = new Date().toISOString();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const jeIds = Array.isArray(parsed.journalEntryIds) ? parsed.journalEntryIds : (parsed.journalEntryId != null ? [parsed.journalEntryId] : []);
        const jtIds = Array.isArray(parsed.journalTradeIds) ? parsed.journalTradeIds : (parsed.journalTradeId != null ? [parsed.journalTradeId] : []);
        const tIds = Array.isArray(parsed.tradeIds) ? parsed.tradeIds : (parsed.tradeId != null ? [parsed.tradeId] : []);
        const sel = parsed.selectedEmotions && typeof parsed.selectedEmotions === "object" ? parsed.selectedEmotions : {};
        const ts = typeof parsed.timestamp === "string" && parsed.timestamp ? parsed.timestamp : nowIso;
        return {
          timestamp: ts,
          selectedEmotions: sel,
          notes: parsed.notes ?? "",
          takeSurvey: parsed.takeSurvey || false,
          journalEntryIds: jeIds,
          journalTradeId: parsed.journalTradeId ?? null,
          journalTradeIds: jtIds,
          tradeIds: tIds,
        };
      } catch {
        return { timestamp: nowIso, selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryIds: [], journalTradeIds: [], tradeIds: [] };
      }
    }
    return { timestamp: nowIso, selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryIds: [], journalTradeIds: [], tradeIds: [] };
  });
  // When editing, we may edit a group of states (same timestamp). This holds all states in the group.
  const [editingStateGroup, setEditingStateGroup] = useState<EmotionalState[] | null>(null);
  const [journalEntries, setJournalEntries] = useState<{ id: number; date: string; title: string }[]>([]);
  const [journalTradesForLink, setJournalTradesForLink] = useState<{ id: number; symbol: string | null; trade_order: number }[]>([]);
  const [realTrades, setRealTrades] = useState<{ id: number; symbol: string; timestamp: string; side: string; quantity: number; price: number; pnl?: number }[]>([]);
  const [journalDropdownOpen, setJournalDropdownOpen] = useState(false);
  const [tradeDropdownOpen, setTradeDropdownOpen] = useState(false);
  const journalDropdownRef = useRef<HTMLDivElement>(null);
  const tradeDropdownRef = useRef<HTMLDivElement>(null);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<EmotionalState | null>(null);
  const [emotionChartTab, setEmotionChartTab] = useState<string>("Overall");
  const [showAllEmotionalStates, setShowAllEmotionalStates] = useState(false);
  const [emotionalStatesPage, setEmotionalStatesPage] = useState(1);
  const EMOTIONAL_STATES_PAGE_SIZE = 24;
  const navigate = useNavigate();
  const location = useLocation();
  type FormDataSnapshot = {
    timestamp: string;
    selectedEmotions: Record<string, number>;
    notes: string;
    journalEntryIds: number[];
    journalTradeId?: number | null;
    journalTradeIds?: number[];
    tradeIds: number[];
  };
  const [emotionalStateEditHistory, setEmotionalStateEditHistory] = useState<FormDataSnapshot[]>([]);
  const skipHistoryPushRef = useRef(false);

  // Ref for main scroll container
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const intensitySectionRef = useRef<HTMLDivElement>(null);

  // Save scroll position
  const saveScrollPosition = () => {
    if (mainScrollRef.current) {
      localStorage.setItem('emotions_scroll_position', mainScrollRef.current.scrollTop.toString());
    }
  };

  // Restore scroll position
  const restoreScrollPosition = () => {
    if (mainScrollRef.current) {
      const saved = localStorage.getItem('emotions_scroll_position');
      if (saved) {
        const position = parseInt(saved, 10);
        if (!isNaN(position) && position > 0) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            if (mainScrollRef.current) {
              mainScrollRef.current.scrollTop = position;
            }
          });
        }
      }
    }
  };

  // Save form state
  useEffect(() => {
    localStorage.setItem('emotions_show_form', showForm.toString());
    localStorage.setItem('emotions_form_data', JSON.stringify(formData));
  }, [showForm, formData]);

  // Save scroll position when form opens/closes
  useEffect(() => {
    saveScrollPosition();
  }, [showForm]);

  // Restore scroll position on mount
  useEffect(() => {
    // Wait a bit for content to load
    const timer = setTimeout(() => {
      restoreScrollPosition();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Save scroll position on scroll
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      saveScrollPosition();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    loadStates();
    loadSurveys();
  }, []);

  // When navigating from Journal via "Open in Emotions", open that entry in read-only mode
  useEffect(() => {
    const openTimestamp = (location.state as { openTimestamp?: string } | null)?.openTimestamp;
    if (!openTimestamp || states.length === 0) return;
    const groups = groupStatesByTimestamp(states);
    const group = groups.find((g) => g[0].timestamp === openTimestamp);
    if (!group?.length) return;
    const first = group[0];
    const selectedEmotions: Record<string, number> = {};
    for (const s of group) selectedEmotions[s.emotion] = s.intensity;
    let jeIds: number[] = [];
    if (first.journal_entry_ids) {
      try {
        const parsed = JSON.parse(first.journal_entry_ids) as number[];
        if (Array.isArray(parsed)) jeIds = parsed;
      } catch {
        if (first.journal_entry_id != null) jeIds = [first.journal_entry_id];
      }
    } else if (first.journal_entry_id != null) {
      jeIds = [first.journal_entry_id];
    }
    let tIds: number[] = [];
    if (first.trade_ids) {
      try {
        const parsed = JSON.parse(first.trade_ids) as number[];
        if (Array.isArray(parsed)) tIds = parsed;
      } catch {
        if (first.trade_id != null) tIds = [first.trade_id];
      }
    } else if (first.trade_id != null) {
      tIds = [first.trade_id];
    }
    setEditingState(first);
    setEditingStateGroup(group);
    setIsEditingSelectedState(false);
    setFormData({
      timestamp: first.timestamp,
      selectedEmotions,
      notes: first.notes || "",
      journalEntryIds: jeIds,
      journalTradeId: first.journal_trade_id ?? null,
      journalTradeIds: first.journal_trade_id != null ? [first.journal_trade_id] : [],
      tradeIds: tIds,
    });
    setShowForm(true);
    setFormTab("basic");
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, states, navigate]);

  // Push form changes to edit history when editing (for multi-step Undo); skip when restoring from Undo
  useEffect(() => {
    if (!isEditingSelectedState || !editingState || skipHistoryPushRef.current) {
      if (skipHistoryPushRef.current) skipHistoryPushRef.current = false;
      return;
    }
    const snapshot: FormDataSnapshot = {
      timestamp: formData.timestamp,
      selectedEmotions: { ...formData.selectedEmotions },
      notes: formData.notes,
      journalEntryIds: [...(formData.journalEntryIds ?? [])],
      journalTradeId: formData.journalTradeId ?? null,
      journalTradeIds: formData.journalTradeIds ? [...formData.journalTradeIds] : [],
      tradeIds: [...(formData.tradeIds ?? [])],
    };
    setEmotionalStateEditHistory((prev) => [...prev, snapshot].slice(-10));
  }, [formData.timestamp, formData.notes, formData.selectedEmotions, formData.journalEntryIds, formData.journalTradeId, formData.journalTradeIds, formData.tradeIds, isEditingSelectedState, editingState]);

  useEffect(() => {
    if (!showForm) return;
    (async () => {
      try {
        const entries = await invoke<{ id: number; date: string; title: string }[]>("get_journal_entries");
        setJournalEntries(entries);
      } catch {
        setJournalEntries([]);
      }
    })();
  }, [showForm]);

  useEffect(() => {
    if (!showForm) return;
    (async () => {
      try {
        const trades = await invoke<{ id: number; symbol: string; timestamp: string; side: string; quantity: number; price: number }[]>("get_trades");
        let pnlMap: Record<number, number> = {};
        try {
          const withPairing = await invoke<{ trade: { id: number }; entry_pairs: { net_profit_loss: number }[]; exit_pairs: { net_profit_loss: number }[] }[]>("get_trades_with_pairing", { pairing_method: null, start_date: null, end_date: null });
          for (const row of withPairing) {
            const id = row.trade?.id;
            if (id == null) continue;
            const entrySum = (row.entry_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            const exitSum = (row.exit_pairs || []).reduce((s, p) => s + (p?.net_profit_loss ?? 0), 0);
            pnlMap[id] = (pnlMap[id] ?? 0) + entrySum + exitSum;
          }
        } catch {
          /* PnL optional */
        }
        const withPnl = trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          timestamp: t.timestamp,
          side: t.side,
          quantity: t.quantity ?? 0,
          price: t.price ?? 0,
          pnl: pnlMap[t.id] !== undefined && pnlMap[t.id] !== 0 ? pnlMap[t.id] : undefined,
        }));
        setRealTrades(withPnl);
      } catch {
        setRealTrades([]);
      }
    })();
  }, [showForm]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (journalDropdownRef.current && !journalDropdownRef.current.contains(e.target as Node)) setJournalDropdownOpen(false);
      if (tradeDropdownRef.current && !tradeDropdownRef.current.contains(e.target as Node)) setTradeDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const firstJeId = formData.journalEntryIds?.[0] ?? null;
    if (firstJeId == null) {
      setJournalTradesForLink([]);
      return;
    }
    (async () => {
      try {
        const trades = await invoke<{ id: number; symbol: string | null; trade_order: number }[]>("get_journal_trades", {
          journalEntryId: firstJeId,
        });
        setJournalTradesForLink(trades);
      } catch {
        setJournalTradesForLink([]);
      }
    })();
  }, [formData.journalEntryIds]);

  useEffect(() => {
    if (!showForm) return;
    // Initialize survey responses (optional, but always available)
    if (Object.keys(surveyResponses).length === 0) {
      const initial: Record<string, number> = {};
      Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
        initial[q.key] = 3;
      });
      setSurveyResponses(initial);
    }
  }, [showForm, surveyResponses]);

  const loadStates = async () => {
    try {
      const data = await invoke<EmotionalState[]>("get_emotional_states");
      setStates(data);
    } catch (error) {
      console.error("Error loading emotional states:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSurveys = async () => {
    try {
      const data = await invoke<EmotionSurvey[]>("get_all_emotion_surveys");
      setSurveys(data);
    } catch (error) {
      console.error("Error loading surveys:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selected = formData.selectedEmotions;
    const emotionKeys = Object.keys(selected);
    const notes = formData.notes || null;
    const timestamp = formData.timestamp || new Date().toISOString();
    const journalEntryIds = formData.journalEntryIds ?? [];
    const tradeIds = formData.tradeIds ?? [];
    const journalTradeId = formData.journalTradeId ?? null;
    const journalEntryIdLegacy = journalEntryIds[0] ?? null;
    const tradeIdLegacy = tradeIds[0] ?? null;

    try {
      if (editingStateGroup?.length) {
        if (!isEditingSelectedState) return;
        if (emotionKeys.length === 0) {
          alert("Select at least one emotion.");
          return;
        }
        // Delete all states in the group, then re-add from form
        for (const s of editingStateGroup) {
          await invoke("delete_emotional_state", { id: s.id });
        }
        for (const emotion of emotionKeys) {
          await invoke<number>("add_emotional_state", {
            timestamp,
            emotion,
            intensity: selected[emotion],
            notes,
            tradeId: tradeIdLegacy,
            journalEntryId: journalEntryIdLegacy,
            journalTradeId,
            journalEntryIds: journalEntryIds.length > 0 ? JSON.stringify(journalEntryIds) : null,
            tradeIds: tradeIds.length > 0 ? JSON.stringify(tradeIds) : null,
          });
        }
        await loadStates();
        await loadSurveys();
        saveScrollPosition();
        setShowForm(false);
        setEditingState(null);
        setEditingStateGroup(null);
        setIsEditingSelectedState(false);
        setEmotionalStateEditHistory([]);
        setIsMaximized(false);
        setFormTab("basic");
        setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
        return;
      }

      // New entry: require at least one emotion
      if (!isEntryFormModified(selected, formData.notes)) {
        saveScrollPosition();
        setShowForm(false);
        setEditingState(null);
        setEditingStateGroup(null);
        setIsEditingSelectedState(false);
        setIsMaximized(false);
        setFormTab("basic");
        setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
        return;
      }
      if (emotionKeys.length === 0) {
        alert("Select at least one emotion.");
        return;
      }

      let firstStateId: number | null = null;
      for (const emotion of emotionKeys) {
        const stateId = await invoke<number>("add_emotional_state", {
          timestamp,
          emotion,
          intensity: selected[emotion],
          notes,
          tradeId: tradeIdLegacy,
          journalEntryId: journalEntryIdLegacy,
          journalTradeId,
          journalEntryIds: journalEntryIds.length > 0 ? JSON.stringify(journalEntryIds) : null,
          tradeIds: tradeIds.length > 0 ? JSON.stringify(tradeIds) : null,
        });
        if (firstStateId === null) firstStateId = stateId;
      }

      const shouldSaveSurvey = Object.values(SURVEY_QUESTIONS)
        .flat()
        .some((q) => (surveyResponses?.[q.key] ?? 3) !== 3);

      if (shouldSaveSurvey && firstStateId != null) {
        try {
          await invoke("add_emotion_survey", {
            emotional_state_id: firstStateId,
            timestamp,
            before_calm_clear: surveyResponses.before_calm_clear ?? 3,
            before_urgency_pressure: surveyResponses.before_urgency_pressure ?? 3,
            before_confidence_vs_validation: surveyResponses.before_confidence_vs_validation ?? 3,
            before_fomo: surveyResponses.before_fomo ?? 3,
            before_recovering_loss: surveyResponses.before_recovering_loss ?? 3,
            before_patient_detached: surveyResponses.before_patient_detached ?? 3,
            before_trust_process: surveyResponses.before_trust_process ?? 3,
            before_emotional_state: surveyResponses.before_emotional_state ?? 3,
            during_stable: surveyResponses.during_stable ?? 3,
            during_tension_stress: surveyResponses.during_tension_stress ?? 3,
            during_tempted_interfere: surveyResponses.during_tempted_interfere ?? 3,
            during_need_control: surveyResponses.during_need_control ?? 3,
            during_fear_loss: surveyResponses.during_fear_loss ?? 3,
            during_excitement_greed: surveyResponses.during_excitement_greed ?? 3,
            during_mentally_present: surveyResponses.during_mentally_present ?? 3,
            after_accept_outcome: surveyResponses.after_accept_outcome ?? 3,
            after_emotional_reaction: surveyResponses.after_emotional_reaction ?? 3,
            after_confidence_affected: surveyResponses.after_confidence_affected ?? 3,
            after_tempted_another_trade: surveyResponses.after_tempted_another_trade ?? 3,
            after_proud_discipline: surveyResponses.after_proud_discipline ?? 3,
          });
        } catch (error) {
          console.error("Error saving survey:", error);
          alert("Entry saved but failed to save survey");
        }
      }

      await loadStates();
      await loadSurveys();
      saveScrollPosition();
      setShowForm(false);
      setEditingState(null);
      setEditingStateGroup(null);
      setIsEditingSelectedState(false);
      setIsMaximized(false);
      setFormTab("basic");
      setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
      localStorage.removeItem('emotions_form_data');
      localStorage.setItem('emotions_show_form', "false");
      const initial: Record<string, number> = {};
      Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
        initial[q.key] = 3;
      });
      setSurveyResponses(initial);
    } catch (error) {
      console.error("Error saving emotional state:", error);
      alert(`Failed to ${editingStateGroup?.length ? "update" : "add"} emotional state`);
    }
  };

  const handleDeleteClick = (state: EmotionalState) => {
    setDeleteTarget(state);
  };

  const handleDeleteCancel = () => {
    setDeleteTarget(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const toDelete = editingStateGroup?.length ? editingStateGroup : [deleteTarget];
      for (const s of toDelete) {
        await invoke("delete_emotional_state", { id: s.id });
      }
      await loadStates();
      await loadSurveys();
      if (editingStateGroup?.some((s) => s.id === deleteTarget.id) || editingState?.id === deleteTarget.id) {
        saveScrollPosition();
        setShowForm(false);
        setEditingState(null);
        setEditingStateGroup(null);
        setIsEditingSelectedState(false);
        setIsMaximized(false);
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting emotional state:", error);
      alert("Failed to delete emotional state");
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM dd, yyyy HH:mm");
    } catch {
      return dateString;
    }
  };

  const getIntensityColor = (intensity: number) => {
    if (intensity <= 3) return "var(--text-secondary)";
    if (intensity <= 6) return "var(--warning)";
    return "var(--danger)";
  };

  // One data point per day for Emotional Intensity Over Time chart (in Emotional States section)
  const chartData = useMemo(() => {
    const byDay = new Map<string, { sum: number; count: number; t: number }>();
    for (const state of states) {
      const d = new Date(state.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const t = d.getTime();
      const existing = byDay.get(key);
      if (!existing) {
        byDay.set(key, { sum: state.intensity, count: 1, t });
      } else {
        existing.sum += state.intensity;
        existing.count += 1;
      }
    }
    return Array.from(byDay.entries())
      .map(([key, { sum, count, t }]) => ({
        date: format(new Date(t), "MMM dd"),
        intensity: Math.round((sum / count) * 10) / 10,
        _sortKey: key,
      }))
      .sort((a, b) => (a._sortKey as string).localeCompare(b._sortKey as string))
      .map(({ _sortKey, ...rest }) => rest);
  }, [states]);

  // Per-emotion chart data: one data point per day per emotion
  const chartDataByEmotion = useMemo(() => {
    const out: Record<string, { date: string; intensity: number }[]> = {};
    for (const emotion of EMOTIONS) {
      const byDay = new Map<string, { sum: number; count: number; t: number }>();
      for (const state of states) {
        if (state.emotion !== emotion) continue;
        const d = new Date(state.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const t = d.getTime();
        const existing = byDay.get(key);
        if (!existing) {
          byDay.set(key, { sum: state.intensity, count: 1, t });
        } else {
          existing.sum += state.intensity;
          existing.count += 1;
        }
      }
      out[emotion] = Array.from(byDay.entries())
        .map(([key, { sum, count, t }]) => ({
          date: format(new Date(t), "MMM dd"),
          intensity: Math.round((sum / count) * 10) / 10,
          _sortKey: key,
        }))
        .sort((a, b) => (a._sortKey as string).localeCompare(b._sortKey as string))
        .map(({ _sortKey, ...rest }) => rest);
    }
    return out;
  }, [states]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading emotional states...</p>
      </div>
    );
  }

  return (
    <div ref={mainScrollRef} style={{ padding: "30px", overflowY: "auto", height: "100%", minHeight: 0 }}>
      <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "28px", color: "var(--text-primary)" }}>Emotions</h1>

      {/* Psychological Metrics – at top */}
      <MetricsDisplay surveys={surveys} states={states} />

      {/* Emotional States – dedicated section with + Add State */}
      <section
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          padding: "0",
          marginBottom: "32px",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-tertiary)",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Emotional States
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {showForm ? (
              <button
                type="button"
                onClick={() => {
                  saveScrollPosition();
                  setShowForm(false);
                  setEditingState(null);
                  setEditingStateGroup(null);
                  setIsEditingSelectedState(false);
                  setIsMaximized(false);
                  setFormTab("basic");
                  setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 18px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "600",
                }}
                title="Back to Emotional States"
              >
                <ArrowLeft size={18} />
                Back
              </button>
            ) : (
              <button
                onClick={() => {
                  saveScrollPosition();
                  setEditingState(null);
                  setIsEditingSelectedState(true);
                  setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
                  setEditingStateGroup(null);
                  const initial: Record<string, number> = {};
                  Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
                    initial[q.key] = 3;
                  });
                  setSurveyResponses(initial);
                  setShowForm(true);
                  setFormTab("basic");
                }}
                style={{
                  padding: "10px 18px",
                  backgroundColor: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14px",
                  fontWeight: "600",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                }}
              >
                <Plus size={18} />
                Add State
              </button>
            )}
          </div>
        </div>

        {/* Recent entries list – one row (oldest→newest left→right); "View all" with pagination */}
        {states.length > 0 && (() => {
          const groups = groupStatesByTimestamp(states);
          const oneRowCount = 8;
          const previewGroups = groups.slice(0, oneRowCount);
          const hasMore = groups.length > oneRowCount;
          const previewDisplay = [...previewGroups].reverse();
          const totalPages = Math.max(1, Math.ceil(groups.length / EMOTIONAL_STATES_PAGE_SIZE));
          const paginatedGroups = showAllEmotionalStates
            ? groups.slice((emotionalStatesPage - 1) * EMOTIONAL_STATES_PAGE_SIZE, emotionalStatesPage * EMOTIONAL_STATES_PAGE_SIZE)
            : [];
          const displayGroups = showAllEmotionalStates ? paginatedGroups : previewDisplay;
          return (
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  {groups.length} {groups.length === 1 ? "entry" : "entries"}
                  {!showAllEmotionalStates && hasMore && ` · showing ${previewGroups.length} most recent (newest on right)`}
                  {showAllEmotionalStates && ` · page ${emotionalStatesPage} of ${totalPages}`}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {showAllEmotionalStates && totalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={() => setEmotionalStatesPage((p) => Math.max(1, p - 1))}
                        disabled={emotionalStatesPage <= 1}
                        style={{
                          padding: "6px 12px",
                          fontSize: "12px",
                          fontWeight: "600",
                          color: emotionalStatesPage <= 1 ? "var(--text-secondary)" : "var(--accent)",
                          background: "transparent",
                          border: `1px solid ${emotionalStatesPage <= 1 ? "var(--border-color)" : "var(--accent)"}`,
                          borderRadius: "6px",
                          cursor: emotionalStatesPage <= 1 ? "default" : "pointer",
                          opacity: emotionalStatesPage <= 1 ? 0.6 : 1,
                        }}
                      >
                        Previous
                      </button>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "70px", textAlign: "center" }}>
                        {emotionalStatesPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEmotionalStatesPage((p) => Math.min(totalPages, p + 1))}
                        disabled={emotionalStatesPage >= totalPages}
                        style={{
                          padding: "6px 12px",
                          fontSize: "12px",
                          fontWeight: "600",
                          color: emotionalStatesPage >= totalPages ? "var(--text-secondary)" : "var(--accent)",
                          background: "transparent",
                          border: `1px solid ${emotionalStatesPage >= totalPages ? "var(--border-color)" : "var(--accent)"}`,
                          borderRadius: "6px",
                          cursor: emotionalStatesPage >= totalPages ? "default" : "pointer",
                          opacity: emotionalStatesPage >= totalPages ? 0.6 : 1,
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllEmotionalStates(!showAllEmotionalStates);
                        if (!showAllEmotionalStates) setEmotionalStatesPage(1);
                      }}
                      style={{
                        padding: "8px 14px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: "var(--accent)",
                        background: "transparent",
                        border: "1px solid var(--accent)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      {showAllEmotionalStates ? "Show less" : `View all ${groups.length} entries`}
                    </button>
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  flexWrap: showAllEmotionalStates ? "wrap" : "nowrap",
                  maxHeight: showAllEmotionalStates ? "320px" : "none",
                  overflowY: showAllEmotionalStates ? "auto" : "hidden",
                  overflowX: showAllEmotionalStates ? "hidden" : "auto",
                  paddingRight: "6px",
                  marginRight: "-6px",
                  paddingTop: "10px",
                }}
              >
                {displayGroups.map((group) => {
                  const first = group[0];
                  const timestamp = first.timestamp;
                  const dateStr = format(new Date(timestamp), "MMM dd, yyyy");
                  const hasSurvey = group.some((s) => surveys.some((surv) => surv.emotional_state_id === s.id));
                  const avgIntensity = group.reduce((s, e) => s + e.intensity, 0) / group.length;
                  const overallIntensity = Math.round(avgIntensity * 10) / 10;
                  const { gradient, color, glow, border, borderHover, badgeBg, badgeShadow } = getIntensityGradientStyles(overallIntensity);
                  const notes = first.notes || "";
                  const isSelected = showForm && editingState?.timestamp === timestamp;

                  return (
                    <div
                      key={timestamp}
                      onClick={() => {
                        if (isSelected) {
                          saveScrollPosition();
                          setShowForm(false);
                          setEditingState(null);
                          setEditingStateGroup(null);
                          setIsEditingSelectedState(false);
                          setEmotionalStateEditHistory([]);
                          setIsMaximized(false);
                          setFormTab("basic");
                          return;
                        }
                        saveScrollPosition();
                        setEditingState(first);
                        setEditingStateGroup(group);
                        setIsEditingSelectedState(false);
                        setIsMaximized(false);
                        const selectedEmotions: Record<string, number> = {};
                        for (const s of group) selectedEmotions[s.emotion] = s.intensity;
                        let jeIds: number[] = [];
                        if (first.journal_entry_ids) {
                          try {
                            const parsed = JSON.parse(first.journal_entry_ids) as number[];
                            if (Array.isArray(parsed)) jeIds = parsed;
                          } catch {
                            if (first.journal_entry_id != null) jeIds = [first.journal_entry_id];
                          }
                        } else if (first.journal_entry_id != null) {
                          jeIds = [first.journal_entry_id];
                        }
                        let tIds: number[] = [];
                        if (first.trade_ids) {
                          try {
                            const parsed = JSON.parse(first.trade_ids) as number[];
                            if (Array.isArray(parsed)) tIds = parsed;
                          } catch {
                            if (first.trade_id != null) tIds = [first.trade_id];
                          }
                        } else if (first.trade_id != null) {
                          tIds = [first.trade_id];
                        }
                        setFormData({
                          timestamp: first.timestamp,
                          selectedEmotions,
                          notes,
                          journalEntryIds: jeIds,
                          journalTradeId: first.journal_trade_id ?? null,
                          journalTradeIds: first.journal_trade_id != null ? [first.journal_trade_id] : [],
                          tradeIds: tIds,
                        });
                        setShowForm(true);
                        setFormTab("basic");
                      }}
                      style={{
                        padding: "16px 18px",
                        backgroundImage: gradient,
                        backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-tertiary)",
                        borderRadius: "14px",
                        minWidth: "140px",
                        flex: showAllEmotionalStates ? "1 1 140px" : "0 0 140px",
                        maxWidth: showAllEmotionalStates ? "180px" : "180px",
                        position: "relative",
                        cursor: "pointer",
                        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
                        border: isSelected ? "2px solid var(--accent)" : `1px solid ${border}`,
                        boxShadow: isSelected ? "0 0 0 1px var(--accent), 0 4px 16px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.15)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = isSelected ? "0 0 0 2px var(--accent), 0 6px 20px rgba(0,0,0,0.25)" : glow;
                        e.currentTarget.style.borderColor = isSelected ? "var(--accent)" : borderHover;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = isSelected ? "0 0 0 1px var(--accent), 0 4px 16px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.15)";
                        e.currentTarget.style.borderColor = isSelected ? "var(--accent)" : border;
                      }}
                    >
                      {hasSurvey && (
                        <div
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            width: "8px",
                            height: "8px",
                            backgroundColor: "var(--accent)",
                            borderRadius: "50%",
                            border: "1px solid var(--bg-primary)",
                            boxShadow: "0 0 6px var(--accent)",
                          }}
                          title="Survey completed"
                        />
                      )}
                      <div style={{ fontSize: "11px", fontWeight: "600", marginBottom: "12px", color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
                        {dateStr}
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "56px",
                          height: "56px",
                          borderRadius: "50%",
                          background: badgeBg,
                          border: `2px solid ${color}`,
                          boxShadow: badgeShadow,
                        }}
                      >
                        <span style={{ fontSize: "16px", fontWeight: "700", color, lineHeight: 1 }}>
                          {overallIntensity}<span style={{ fontSize: "9px", opacity: 0.85 }}>/10</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Empty state when no entries and form closed */}
        {!showForm && states.length === 0 && (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-secondary)", fontSize: "14px" }}>
            No emotional states yet. Click <strong>Add State</strong> above to log how you feel.
          </div>
        )}

        {/* Add/Edit form – inside this section when open */}
        {showForm && (
        <div
          style={{
            borderTop: "1px solid var(--border-color)",
            padding: "0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: editingState && isMaximized ? "calc(100vh - 220px)" : editingState ? "calc(100vh - 180px)" : "85vh",
            maxHeight: editingState ? undefined : "85vh",
            minHeight: editingState ? "400px" : "300px",
            position: isMaximized ? "fixed" : "relative",
            top: isMaximized ? "50px" : "auto",
            left: isMaximized ? "50px" : "auto",
            right: isMaximized ? "50px" : "auto",
            bottom: isMaximized ? "50px" : "auto",
            zIndex: isMaximized ? 1000 : "auto",
          }}
        >
          {/* Form Header */}
          <div style={{ 
            padding: "20px 24px", 
            borderBottom: "1px solid var(--border-color)", 
            backgroundColor: "var(--bg-tertiary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
              {editingState
                ? `${editingStateGroup?.length ? `${editingStateGroup.length} emotions — ` : ""}${format(new Date(editingState.timestamp), "MMM dd, yyyy HH:mm")}`
                : "Add New Emotional State"}
            </h2>
            {!editingState && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    saveScrollPosition();
                    setShowForm(false);
                    setEditingState(null);
                    setEditingStateGroup(null);
                    setFormTab("basic");
                    setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
                    const initial: Record<string, number> = {};
                    Object.values(SURVEY_QUESTIONS).flat().forEach((q) => { initial[q.key] = 3; });
                    setSurveyResponses(initial);
                  }}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="emotion-form"
                  onClick={(e) => {
                    e.preventDefault();
                    const form = document.getElementById("emotion-form") as HTMLFormElement;
                    if (form) form.requestSubmit();
                  }}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "var(--accent)",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  Save State
                </button>
              </div>
            )}
            {editingState && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "6px",
                    padding: "8px",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {!isEditingSelectedState ? (
                  <>
                    <button
                      onClick={() => {
                        setIsEditingSelectedState(true);
                        setEmotionalStateEditHistory([]);
                      }}
                      style={{
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "8px",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteClick(editingState)}
                      style={{
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "8px",
                        color: "var(--danger)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    {emotionalStateEditHistory.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newHistory = emotionalStateEditHistory.slice(0, -1);
                          const prev = newHistory[newHistory.length - 1];
                          setEmotionalStateEditHistory(newHistory);
                          if (prev) {
                            skipHistoryPushRef.current = true;
                            setFormData((f) => ({
                              ...f,
                              timestamp: prev.timestamp,
                              selectedEmotions: { ...prev.selectedEmotions },
                              notes: prev.notes,
                              journalEntryIds: [...(prev.journalEntryIds ?? [])],
                              journalTradeId: prev.journalTradeId ?? null,
                              journalTradeIds: prev.journalTradeIds ? [...prev.journalTradeIds] : [],
                              tradeIds: [...(prev.tradeIds ?? [])],
                            }));
                          }
                        }}
                        style={{
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          padding: "8px 12px",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          justifyContent: "center",
                          fontWeight: "500",
                          fontSize: "13px",
                        }}
                        title="Undo"
                      >
                        <RotateCcw size={16} />
                        Undo
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const first = editingStateGroup?.[0] ?? editingState;
                        if (!first) return;
                        const selectedEmotions: Record<string, number> = {};
                        for (const s of editingStateGroup || [editingState!]) {
                          selectedEmotions[s.emotion] = s.intensity;
                        }
                        let jeIds: number[] = [];
                        if (first.journal_entry_ids) {
                          try {
                            const parsed = JSON.parse(first.journal_entry_ids) as number[];
                            if (Array.isArray(parsed)) jeIds = parsed;
                          } catch {
                            if (first.journal_entry_id != null) jeIds = [first.journal_entry_id];
                          }
                        } else if (first.journal_entry_id != null) {
                          jeIds = [first.journal_entry_id];
                        }
                        let tIds: number[] = [];
                        if (first.trade_ids) {
                          try {
                            const parsed = JSON.parse(first.trade_ids) as number[];
                            if (Array.isArray(parsed)) tIds = parsed;
                          } catch {
                            if (first.trade_id != null) tIds = [first.trade_id];
                          }
                        } else if (first.trade_id != null) {
                          tIds = [first.trade_id];
                        }
                        setFormData((prev) => ({
                          ...prev,
                          timestamp: first.timestamp,
                          selectedEmotions,
                          notes: first.notes || "",
                          journalEntryIds: jeIds,
                          journalTradeId: first.journal_trade_id ?? null,
                          journalTradeIds: first.journal_trade_id != null ? [first.journal_trade_id] : [],
                          tradeIds: tIds,
                        }));
                        setIsEditingSelectedState(false);
                        setEmotionalStateEditHistory([]);
                      }}
                      style={{
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "8px 12px",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        justifyContent: "center",
                        fontWeight: "500",
                        fontSize: "13px",
                      }}
                      title="Cancel"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      form="emotion-form"
                      onClick={(e) => {
                        e.preventDefault();
                        const form = document.getElementById("emotion-form") as HTMLFormElement;
                        if (form) {
                          form.requestSubmit();
                        }
                      }}
                      style={{
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: "6px",
                        padding: "8px 16px",
                        color: "white",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "500",
                        fontSize: "14px",
                      }}
                      title="Save Changes"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <form id="emotion-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div style={{ 
              padding: "24px", 
              display: "flex", 
              flexDirection: "column", 
              minHeight: 0,
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
            }}>
              {/* Single unified form: emotions first, then each group of questions */}
              {(
                <>
                  {/* Date — editable when creating or editing */}
                  <div style={{ marginBottom: "24px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Date
                    </h3>
                    <input
                      type="date"
                      value={(() => {
                        try {
                          const d = new Date(formData.timestamp);
                          if (isNaN(d.getTime())) return "";
                          const pad = (n: number) => String(n).padStart(2, "0");
                          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                        } catch {
                          return "";
                        }
                      })()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        setFormData((prev) => ({ ...prev, timestamp: `${v}T12:00:00.000Z` }));
                      }}
                      disabled={!!editingState && !isEditingSelectedState}
                      style={{
                        padding: "10px 14px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        color: "var(--text-primary)",
                        fontSize: "14px",
                        maxWidth: "200px",
                      }}
                    />
                  </div>

                  {/* Scale explanation — always visible so users understand 1–10 */}
                  <div
                    style={{
                      marginBottom: "24px",
                      padding: "14px 18px",
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "10px",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {INTENSITY_SCALE_LABEL}
                    </p>
                  </div>

                  <div style={{ marginBottom: "28px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Emotions
                    </h3>
                    <p style={{ margin: "0 0 14px", fontSize: "13px", color: "var(--text-secondary)" }}>
                      Tap to add or remove; then set strength below.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      {EMOTIONS.map((emotion) => {
                        const intensity = formData.selectedEmotions[emotion];
                        const isSelected = intensity !== undefined;
                        const canEdit = !editingState || isEditingSelectedState;
                        return (
                          <button
                            key={emotion}
                            type="button"
                            onClick={() => {
                              if (!canEdit) return;
                              if (isSelected) {
                                const next = { ...formData.selectedEmotions };
                                delete next[emotion];
                                setFormData({ ...formData, selectedEmotions: next });
                              } else {
                                setFormData({
                                  ...formData,
                                  selectedEmotions: { ...formData.selectedEmotions, [emotion]: DEFAULT_INTENSITY },
                                });
                                requestAnimationFrame(() => {
                                  intensitySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                });
                              }
                            }}
                            style={{
                              padding: "10px 18px",
                              borderRadius: "999px",
                              border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-color)"}`,
                              backgroundColor: isSelected ? "var(--bg-hover)" : "var(--bg-tertiary)",
                              color: "var(--text-primary)",
                              fontSize: "13px",
                              fontWeight: isSelected ? "600" : "500",
                              cursor: canEdit ? "pointer" : "default",
                              opacity: canEdit ? 1 : 0.8,
                              boxShadow: isSelected ? "0 0 0 1px var(--accent)" : "none",
                              transition: "border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
                            }}
                          >
                            {emotion}
                            {isSelected && (
                              <span style={{ marginLeft: "6px", opacity: 0.9, fontWeight: "500" }}>{intensity}/10</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {Object.keys(formData.selectedEmotions).length > 0 && (
                    <div
                      ref={intensitySectionRef}
                      style={{
                        marginBottom: "28px",
                        padding: "20px",
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "12px",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <h3 style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Set intensity
                      </h3>
                      <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <span>0</span>
                        <div style={{ flex: 1, height: "2px", background: "var(--border-color)", borderRadius: 1 }} />
                        <span>10</span>
                        <span style={{ marginLeft: "4px" }}>← strength of feeling</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        {Object.entries(formData.selectedEmotions).map(([emotion, intensity]) => (
                          <div
                            key={emotion}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "16px",
                              flexWrap: "wrap",
                              padding: "12px 0",
                              borderBottom: "1px solid var(--border-color)",
                            }}
                          >
                            <span style={{ minWidth: "100px", fontSize: "14px", fontWeight: "500", color: "var(--text-primary)" }}>{emotion}</span>
                            <input
                              type="range"
                              min="0"
                              max="10"
                              value={intensity}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  selectedEmotions: { ...formData.selectedEmotions, [emotion]: parseInt(e.target.value) },
                                })
                              }
                              disabled={!!editingState && !isEditingSelectedState}
                              style={{
                                flex: "1",
                                minWidth: "140px",
                                maxWidth: "300px",
                                height: "6px",
                                accentColor: "var(--accent)",
                              }}
                            />
                            <span style={{ fontSize: "14px", fontWeight: "600", color: getIntensityColorForEmotion(intensity), minWidth: "32px", textAlign: "right" }}>
                              {intensity}/10
                            </span>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "72px" }}>
                              {INTENSITY_LABELS[intensity]}
                            </span>
                            {(!editingState || isEditingSelectedState) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = { ...formData.selectedEmotions };
                                  delete next[emotion];
                                  setFormData({ ...formData, selectedEmotions: next });
                                }}
                                style={{
                                  padding: "6px 12px",
                                  background: "transparent",
                                  color: "var(--text-secondary)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "8px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  fontWeight: "500",
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Link to Journal
                    </label>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Optionally link this state to one or more journal entries. You can also associate with specific implementations for the first selected entry.
                    </p>
                    {(formData.journalEntryIds ?? []).length > 0 && (
                      <div style={{ marginBottom: "16px", padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>Linked journals</div>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {(formData.journalEntryIds ?? []).map((entryId) => {
                            const linkedEntry = journalEntries.find((e) => e.id === entryId);
                            return (
                              <li key={entryId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                                <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                                  {linkedEntry ? `${linkedEntry.date} – ${linkedEntry.title || "Untitled"}` : `Journal entry #${entryId}`}
                                </span>
                                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={() => navigate("/journal", { state: { openEntryId: entryId, openTradeId: formData.journalTradeId ?? undefined } })}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 10px", fontSize: "12px", fontWeight: "500", color: "var(--accent)", background: "transparent", border: "1px solid var(--accent)", borderRadius: "6px", cursor: "pointer" }}
                                  >
                                    <ExternalLink size={12} />
                                    Open
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, journalEntryIds: (formData.journalEntryIds ?? []).filter((id) => id !== entryId), journalTradeId: null, journalTradeIds: [] })}
                                    disabled={!!editingState && !isEditingSelectedState}
                                    style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: editingState && !isEditingSelectedState ? "default" : "pointer" }}
                                  >
                                    Unlink
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    <div style={{ marginBottom: "12px", position: "relative" }} ref={journalDropdownRef}>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px" }}>Select journal entries</label>
                      <button
                        type="button"
                        onClick={() => setJournalDropdownOpen((o) => !o)}
                        disabled={!!editingState && !isEditingSelectedState}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          padding: "10px 12px",
                          backgroundColor: "var(--bg-tertiary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                          cursor: editingState && !isEditingSelectedState ? "default" : "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>{(formData.journalEntryIds ?? []).length === 0 ? "Select journal entries..." : `${(formData.journalEntryIds ?? []).length} journal entr${(formData.journalEntryIds ?? []).length === 1 ? "y" : "ies"} selected`}</span>
                        <ChevronDown size={18} style={{ flexShrink: 0, opacity: journalDropdownOpen ? 0.8 : 0.6, transform: journalDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </button>
                      {journalDropdownOpen && (
                        <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "260px", overflowY: "auto", minWidth: "280px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: "2px", padding: "6px" }}>
                          {journalEntries.map((entry) => {
                            const ids = formData.journalEntryIds ?? [];
                            const isSelected = ids.includes(entry.id);
                            const toggle = () => {
                              const next = isSelected ? ids.filter((id) => id !== entry.id) : [...ids, entry.id];
                              setFormData({ ...formData, journalEntryIds: next, journalTradeId: null, journalTradeIds: [] });
                            };
                            return (
                              <label key={entry.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "8px 10px", borderRadius: "6px", margin: 0 }} className="dropdown-item-hover">
                                <input type="checkbox" checked={isSelected} onChange={toggle} disabled={!!editingState && !isEditingSelectedState} />
                                <span style={{ fontSize: "14px" }}>{entry.date} – {entry.title || "Untitled"}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {(formData.journalEntryIds ?? []).length > 0 && journalTradesForLink.length > 0 && (
                      <div style={{ marginTop: "12px" }}>
                        <label style={{ display: "block", marginBottom: "8px", fontSize: "12px" }}>Implementations (first selected entry)</label>
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "10px" }}>
                          Optionally link to specific implementations in the first selected journal entry:
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                            <input type="checkbox" checked={(formData.journalTradeIds ?? []).length === 0} onChange={() => setFormData({ ...formData, journalTradeIds: [] })} disabled={!!editingState && !isEditingSelectedState} />
                            <span>Whole entry (all implementations)</span>
                          </label>
                          <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "4px" }}>
                            {journalTradesForLink.map((t, i) => {
                              const ids = formData.journalTradeIds ?? [];
                              const isSelected = ids.includes(t.id);
                              const toggle = () => {
                                const next = isSelected ? ids.filter((id) => id !== t.id) : [...ids, t.id];
                                setFormData({ ...formData, journalTradeIds: next });
                              };
                              return (
                                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", flexShrink: 0 }}>
                                  <input type="checkbox" checked={isSelected} onChange={toggle} disabled={!!editingState && !isEditingSelectedState} />
                                  <span>{t.symbol || `Implementation ${i + 1}`}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Link to real trades
                    </label>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Optionally link this state to one or more trades from your Trades list (brokerage trades). Select multiple at a time.
                    </p>
                    {(formData.tradeIds ?? []).length > 0 && (
                      <div style={{ marginBottom: "12px", padding: "12px 14px", backgroundColor: "var(--bg-tertiary)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "8px" }}>Linked trades</div>
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                          {(formData.tradeIds ?? []).map((tradeId) => {
                            const linkedTrade = realTrades.find((t) => t.id === tradeId);
                            return (
                              <li key={tradeId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                                <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                                  {linkedTrade ? (
                                    <>
                                      {linkedTrade.symbol} {linkedTrade.side}
                                      {linkedTrade.quantity != null && linkedTrade.quantity !== 0 ? ` · ${Number(linkedTrade.quantity) === Math.floor(linkedTrade.quantity) ? linkedTrade.quantity : linkedTrade.quantity.toFixed(2)}` : ""}
                                      {linkedTrade.pnl != null && linkedTrade.pnl !== 0 ? (
                                        <span style={{ color: linkedTrade.pnl >= 0 ? "var(--success, #22c55e)" : "var(--danger)" }}> · PnL {linkedTrade.pnl >= 0 ? "+" : ""}{linkedTrade.pnl.toFixed(2)}</span>
                                      ) : null}
                                      {" · "}{format(new Date(linkedTrade.timestamp), "MMM dd, yyyy HH:mm")}
                                    </>
                                  ) : `Trade #${tradeId}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, tradeIds: (formData.tradeIds ?? []).filter((id) => id !== tradeId) })}
                                  disabled={!!editingState && !isEditingSelectedState}
                                  style={{ padding: "6px 10px", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", background: "transparent", border: "1px solid var(--border-color)", borderRadius: "6px", cursor: editingState && !isEditingSelectedState ? "default" : "pointer" }}
                                >
                                  Unlink
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    <div style={{ position: "relative" }} ref={tradeDropdownRef}>
                      <label style={{ display: "block", marginBottom: "6px", fontSize: "12px" }}>Select trades</label>
                      <button
                        type="button"
                        onClick={() => setTradeDropdownOpen((o) => !o)}
                        disabled={!!editingState && !isEditingSelectedState}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          padding: "10px 12px",
                          backgroundColor: "var(--bg-tertiary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                          cursor: editingState && !isEditingSelectedState ? "default" : "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>{(formData.tradeIds ?? []).length === 0 ? "Select trades..." : `${(formData.tradeIds ?? []).length} trade${(formData.tradeIds ?? []).length === 1 ? "" : "s"} selected`}</span>
                        <ChevronDown size={18} style={{ flexShrink: 0, opacity: tradeDropdownOpen ? 0.8 : 0.6, transform: tradeDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </button>
                      {tradeDropdownOpen && (
                        <div style={{ position: "absolute", zIndex: 50, marginTop: "4px", maxHeight: "260px", overflowY: "auto", minWidth: "320px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: "2px", padding: "6px" }}>
                          {realTrades.map((t) => {
                            const ids = formData.tradeIds ?? [];
                            const isSelected = ids.includes(t.id);
                            const toggle = () => {
                              const next = isSelected ? ids.filter((id) => id !== t.id) : [...ids, t.id];
                              setFormData({ ...formData, tradeIds: next });
                            };
                            return (
                              <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "8px 10px", borderRadius: "6px", margin: 0 }} className="dropdown-item-hover">
                                <input type="checkbox" checked={isSelected} onChange={toggle} disabled={!!editingState && !isEditingSelectedState} />
                                <span style={{ fontSize: "14px" }}>
                                  {t.symbol} {t.side}
                                  {t.quantity != null && t.quantity !== 0 ? ` · ${Number(t.quantity) === Math.floor(t.quantity) ? t.quantity : t.quantity.toFixed(2)}` : ""}
                                  {t.pnl != null && t.pnl !== 0 ? (
                                    <span style={{ color: t.pnl >= 0 ? "var(--success, #22c55e)" : "var(--danger)", marginLeft: "4px" }}>· PnL {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}</span>
                                  ) : null}
                                  {" · "}{format(new Date(t.timestamp), "MMM dd, yyyy")}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {!editingState && (
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
                      Survey questions are optional — if you don't change any answers, nothing will be saved for the survey.
                    </p>
                  )}

                  {/* Question groups: Before Trade, During Trade, After Trade (single page, no tabs) */}
                  {!editingState && (
                    <>
                      {(["before", "during", "after"] as const).map((phase) => (
                        <div key={phase} style={{ marginTop: "28px", paddingTop: "20px", borderTop: "1px solid var(--border-color)" }}>
                          <h3 style={{ margin: "0 0 16px", fontSize: "13px", fontWeight: "600", color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {phase === "before" ? "Before Trade" : phase === "during" ? "During Trade" : "After Trade"}
                          </h3>
                          {SURVEY_QUESTIONS[phase].map((q, idx) => (
                            <div key={q.key} style={{ marginBottom: "24px" }}>
                              <label style={{ display: "block", marginBottom: "12px", fontSize: "15px", fontWeight: "500" }}>
                                {idx + 1}. {q.question}
                              </label>
                              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>{q.scale}</p>
                              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "20px" }}>1</span>
                                <input
                                  type="range"
                                  min="1"
                                  max="5"
                                  value={surveyResponses[q.key] || 3}
                                  onChange={(e) => setSurveyResponses({ ...surveyResponses, [q.key]: parseInt(e.target.value) })}
                                  style={{ flex: 1, accentColor: "var(--accent)" }}
                                />
                                <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "20px" }}>5</span>
                                <span style={{ minWidth: "40px", textAlign: "center", fontSize: "14px", fontWeight: "600", color: "var(--accent)" }}>
                                  {surveyResponses[q.key] || 3}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Notes at the very bottom (under all questions) */}
                  <div style={{ 
                    marginTop: "28px", 
                    paddingTop: "20px", 
                    borderTop: "1px solid var(--border-color)",
                    display: "flex", 
                    flexDirection: "column", 
                    minHeight: "200px",
                  }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Notes (for this whole entry)
                    </h3>
                    <div style={{ 
                      minHeight: "180px",
                      display: "flex", 
                      flexDirection: "column", 
                      backgroundColor: "var(--bg-secondary)",
                      borderRadius: "8px",
                      padding: "1px"
                    }}>
                      <RichTextEditor
                        key={`notes-${editingState?.id || 'new'}-${isEditingSelectedState ? 'edit' : 'view'}`}
                        value={formData.notes}
                        onChange={(content: string) => setFormData({ ...formData, notes: content })}
                        placeholder="Add notes about your emotional state for this entry..."
                        readOnly={editingState !== null && !isEditingSelectedState}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Form Actions — only when editing (new entry uses header buttons) */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid var(--border-color)",
                backgroundColor: "var(--bg-tertiary)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              {editingState ? (
                <>
                  {!isEditingSelectedState ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          saveScrollPosition();
                          setShowForm(false);
                          setEditingState(null);
                          setEditingStateGroup(null);
                          setIsEditingSelectedState(false);
                          setEmotionalStateEditHistory([]);
                          setIsMaximized(false);
                          setFormTab("basic");
                          setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryIds: [], journalTradeIds: [], tradeIds: [] });
                        }}
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingSelectedState(true);
                          setEmotionalStateEditHistory([]);
                        }}
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "var(--accent)",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: "500",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          saveScrollPosition();
                          handleDeleteClick(editingState);
                          setEditingState(null);
                          setEditingStateGroup(null);
                          setIsEditingSelectedState(false);
                          setEmotionalStateEditHistory([]);
                          setIsMaximized(false);
                        }}
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "var(--danger)",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: "500",
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      {emotionalStateEditHistory.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const newHistory = emotionalStateEditHistory.slice(0, -1);
                            const prev = newHistory[newHistory.length - 1];
                            setEmotionalStateEditHistory(newHistory);
                            if (prev) {
                              skipHistoryPushRef.current = true;
                              setFormData((f) => ({
                                ...f,
                                timestamp: prev.timestamp,
                                selectedEmotions: { ...prev.selectedEmotions },
                                notes: prev.notes,
                                journalEntryIds: [...(prev.journalEntryIds ?? [])],
                                journalTradeId: prev.journalTradeId ?? null,
                                journalTradeIds: prev.journalTradeIds ? [...prev.journalTradeIds] : [],
                                tradeIds: [...(prev.tradeIds ?? [])],
                              }));
                            }
                          }}
                          style={{
                            padding: "10px 20px",
                            backgroundColor: "var(--bg-secondary)",
                            color: "var(--text-primary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "14px",
                          }}
                        >
                          Undo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const first = editingStateGroup?.[0] ?? editingState;
                          if (!first) return;
                          const selectedEmotions: Record<string, number> = {};
                          for (const s of editingStateGroup || [editingState!]) {
                            selectedEmotions[s.emotion] = s.intensity;
                          }
                          let jeIds: number[] = [];
                          if (first.journal_entry_ids) {
                            try {
                              const parsed = JSON.parse(first.journal_entry_ids) as number[];
                              if (Array.isArray(parsed)) jeIds = parsed;
                            } catch {
                              if (first.journal_entry_id != null) jeIds = [first.journal_entry_id];
                            }
                          } else if (first.journal_entry_id != null) {
                            jeIds = [first.journal_entry_id];
                          }
                          let tIds: number[] = [];
                          if (first.trade_ids) {
                            try {
                              const parsed = JSON.parse(first.trade_ids) as number[];
                              if (Array.isArray(parsed)) tIds = parsed;
                            } catch {
                              if (first.trade_id != null) tIds = [first.trade_id];
                            }
                          } else if (first.trade_id != null) {
                            tIds = [first.trade_id];
                          }
                          setFormData((prev) => ({
                            ...prev,
                            timestamp: first.timestamp,
                            selectedEmotions,
                            notes: first.notes || "",
                            journalEntryIds: jeIds,
                            journalTradeId: first.journal_trade_id ?? null,
                            journalTradeIds: first.journal_trade_id != null ? [first.journal_trade_id] : [],
                            tradeIds: tIds,
                          }));
                          setIsEditingSelectedState(false);
                          setEmotionalStateEditHistory([]);
                        }}
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        style={{
                          padding: "10px 20px",
                          backgroundColor: "var(--accent)",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: "500",
                        }}
                      >
                        Save
                      </button>
                    </>
                  )}
                </>
              ) : null}
            </div>
          </form>
        </div>
        )}

        {/* Emotional Intensity Over Time – tabbed by Overall / per emotion */}
        {!showForm && states.length > 0 && (() => {
          const IntensityDot = (props: { cx?: number; cy?: number; payload?: { intensity?: number } }) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null || payload?.intensity == null) return null;
            const color = getIntensityColorForEmotion(payload.intensity);
            return (
              <g>
                <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.35} stroke="none" />
                <circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--bg-primary)" strokeWidth={2} />
              </g>
            );
          };
          const ActiveIntensityDot = (props: { cx?: number; cy?: number; payload?: { intensity?: number } }) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null) return null;
            const color = getIntensityColorForEmotion(payload?.intensity ?? 0);
            return (
              <g>
                <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.3} stroke="none" />
                <circle cx={cx} cy={cy} r={6} fill={color} stroke="var(--bg-primary)" strokeWidth={2.5} />
              </g>
            );
          };
          const tabOptions = ["Overall", ...EMOTIONS];
          const currentData = emotionChartTab === "Overall" ? chartData : (chartDataByEmotion[emotionChartTab] ?? []);
          const hasData = currentData.length > 0;
          const segments = Math.max(0, currentData.length - 1);
          const segmentData: Record<string, number | string | null>[] = currentData.map((row) => {
            const out: Record<string, number | string | null> = { date: row.date, intensity: row.intensity };
            for (let j = 0; j < segments; j++) out[`seg${j}`] = null;
            return out;
          });
          for (let j = 0; j < segments; j++) {
            segmentData[j][`seg${j}`] = currentData[j].intensity;
            segmentData[j + 1][`seg${j}`] = currentData[j + 1].intensity;
          }
          const chartTitle = emotionChartTab === "Overall" ? "Emotional Intensity Over Time" : `${EMOTION_DISPLAY_NAMES[emotionChartTab] ?? emotionChartTab} Over Time`;
          return (
            <div
              style={{
                margin: "0 24px 24px",
                padding: "0 0 24px",
                backgroundImage: "linear-gradient(145deg, rgba(34, 197, 94, 0.06) 0%, transparent 40%, transparent 60%, rgba(255, 80, 80, 0.06) 100%)",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "14px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  padding: "16px 24px 0",
                  borderBottom: "1px solid var(--border-color)",
                  marginBottom: "20px",
                }}
              >
                {tabOptions.map((tab) => {
                  const isActive = emotionChartTab === tab;
                  const tabLabel = tab === "Overall" ? tab : (EMOTION_DISPLAY_NAMES[tab] ?? tab);
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEmotionChartTab(tab)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        border: `1px solid ${isActive ? "var(--accent)" : "var(--border-color)"}`,
                        background: isActive ? "var(--accent)" : "transparent",
                        color: isActive ? "white" : "var(--text-secondary)",
                        fontSize: "13px",
                        fontWeight: isActive ? 600 : 500,
                        cursor: "pointer",
                      }}
                    >
                      {tabLabel}
                    </button>
                  );
                })}
              </div>
              <div style={{ padding: "0 24px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "20px", color: "var(--text-primary)", letterSpacing: "0.02em" }}>
                  {chartTitle}
                </h3>
                {hasData ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={segmentData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="2 2" stroke="var(--border-color)" strokeOpacity={0.5} vertical={false} />
                      <XAxis
                        dataKey="date"
                        axisLine={{ stroke: "var(--border-color)", strokeOpacity: 0.6 }}
                        tickLine={false}
                        tick={{ fill: "var(--text-secondary)", fontSize: 11, fontWeight: 500 }}
                        dy={4}
                      />
                      <YAxis
                        domain={[0, 10]}
                        width={28}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "var(--text-secondary)", fontSize: 11, fontWeight: 500 }}
                        dx={-4}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const intensityEntry = payload.find((p) => p.dataKey === "intensity");
                          const value = intensityEntry?.value as number | undefined;
                          if (value == null) return null;
                          return (
                            <div
                              style={{
                                backgroundColor: "var(--bg-secondary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "10px",
                                color: "var(--text-primary)",
                                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                                padding: "12px 16px",
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                              <div style={{ color: getIntensityColorForEmotion(value), fontWeight: 700 }}>
                                {value} / 10
                              </div>
                            </div>
                          );
                        }}
                      />
                      {Array.from({ length: segments }, (_, i) => {
                        const color = getIntensityColorForEmotion((currentData[i].intensity + currentData[i + 1].intensity) / 2);
                        return (
                          <Line
                            key={i}
                            type="monotone"
                            dataKey={`seg${i}`}
                            stroke={color}
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={false}
                            connectNulls
                            legendType="none"
                            isAnimationActive={false}
                          />
                        );
                      })}
                      <Line
                        type="monotone"
                        dataKey="intensity"
                        stroke="transparent"
                        strokeWidth={0}
                        dot={<IntensityDot />}
                        activeDot={<ActiveIntensityDot />}
                        legendType="none"
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-secondary)", fontSize: "14px" }}>
                    No data yet for {emotionChartTab === "Overall" ? "overall intensity" : (EMOTION_DISPLAY_NAMES[emotionChartTab] ?? emotionChartTab).toLowerCase()}. Log entries with this emotion to see the trend.
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      {/* Delete Emotional State Confirmation Modal */}
      {deleteTarget && (
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
              {editingStateGroup?.length ? ` (${editingStateGroup.map((s) => s.emotion).join(", ")})` : ""}?
              {!editingStateGroup?.length && deleteTarget && (
                <> <strong>"{deleteTarget.emotion}"</strong></>
              )}
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              This action cannot be undone. The emotional state{editingStateGroup?.length ? "s" : ""} will be permanently deleted.
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
    </div>
  );
}
