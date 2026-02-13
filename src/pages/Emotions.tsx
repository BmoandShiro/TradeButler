import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { Plus, X, TrendingUp, AlertTriangle, Target, Shield, BarChart3, Heart, ClipboardList, Maximize2, Minimize2, Edit2, Trash2, ArrowLeft, RotateCcw } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
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
    journalEntryId?: number | null;
    journalTradeId?: number | null;
    journalTradeIds?: number[];
  }>(() => {
    const saved = localStorage.getItem('emotions_form_data');
    const nowIso = new Date().toISOString();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const je = parsed.journalEntryId ?? null;
        const jtIds = Array.isArray(parsed.journalTradeIds) ? parsed.journalTradeIds : (parsed.journalTradeId != null ? [parsed.journalTradeId] : []);
        const sel = parsed.selectedEmotions && typeof parsed.selectedEmotions === "object" ? parsed.selectedEmotions : {};
        const ts = typeof parsed.timestamp === "string" && parsed.timestamp ? parsed.timestamp : nowIso;
        return {
          timestamp: ts,
          selectedEmotions: sel,
          notes: parsed.notes ?? "",
          takeSurvey: parsed.takeSurvey || false,
          journalEntryId: je,
          journalTradeId: parsed.journalTradeId ?? null,
          journalTradeIds: jtIds,
        };
      } catch {
        return { timestamp: nowIso, selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryId: null, journalTradeId: null, journalTradeIds: [] };
      }
    }
    return { timestamp: nowIso, selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryId: null, journalTradeId: null, journalTradeIds: [] };
  });
  // When editing, we may edit a group of states (same timestamp). This holds all states in the group.
  const [editingStateGroup, setEditingStateGroup] = useState<EmotionalState[] | null>(null);
  const [journalEntries, setJournalEntries] = useState<{ id: number; date: string; title: string }[]>([]);
  const [journalTradesForLink, setJournalTradesForLink] = useState<{ id: number; symbol: string | null; trade_order: number }[]>([]);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<EmotionalState | null>(null);
  
  // Ref for main scroll container
  const mainScrollRef = useRef<HTMLDivElement>(null);

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
    if (formData.journalEntryId == null) {
      setJournalTradesForLink([]);
      return;
    }
    (async () => {
      try {
        const trades = await invoke<{ id: number; symbol: string | null; trade_order: number }[]>("get_journal_trades", {
          journalEntryId: formData.journalEntryId,
        });
        setJournalTradesForLink(trades);
      } catch {
        setJournalTradesForLink([]);
      }
    })();
  }, [formData.journalEntryId]);

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
    const journalEntryId = formData.journalEntryId ?? null;
    const journalTradeId = formData.journalTradeId ?? null;

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
            tradeId: null,
            journalEntryId,
            journalTradeId,
          });
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
        setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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
        setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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
          tradeId: null,
          journalEntryId,
          journalTradeId,
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
      setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", takeSurvey: false, journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading emotional states...</p>
      </div>
    );
  }

  const currentSurveyQuestions = formTab !== "basic" ? SURVEY_QUESTIONS[formTab] : [];

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
                  setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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
                  setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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

        {/* Recent entries list – compact overview, scroll to view all (7 visible) */}
        {!showForm && states.length > 0 && (() => {
          const groups = groupStatesByTimestamp(states);
          const visibleCount = 7;
          const hasMore = groups.length > visibleCount;
          return (
            <div style={{ padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  {groups.length} {groups.length === 1 ? "entry" : "entries"} · scroll to see all
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  flexWrap: "wrap",
                  maxHeight: "320px",
                  overflowY: "auto",
                  overflowX: "hidden",
                  paddingRight: "6px",
                  marginRight: "-6px",
                  paddingTop: "10px",
                }}
              >
                {[...groups].reverse().map((group) => {
                  const first = group[0];
                  const timestamp = first.timestamp;
                  const dateStr = format(new Date(timestamp), "MMM dd, yyyy");
                  const hasSurvey = group.some((s) => surveys.some((surv) => surv.emotional_state_id === s.id));
                  const avgIntensity = group.reduce((s, e) => s + e.intensity, 0) / group.length;
                  const overallIntensity = Math.round(avgIntensity * 10) / 10;
                  const { gradient, color, glow, border, borderHover, badgeBg, badgeShadow } = getIntensityGradientStyles(overallIntensity);
                  const notes = first.notes || "";

                  return (
                    <div
                      key={timestamp}
                      onClick={() => {
                        saveScrollPosition();
                        setEditingState(first);
                        setEditingStateGroup(group);
                        setIsEditingSelectedState(false);
                        setIsMaximized(false);
                        const selectedEmotions: Record<string, number> = {};
                        for (const s of group) selectedEmotions[s.emotion] = s.intensity;
                        setFormData({
                          timestamp: first.timestamp,
                          selectedEmotions,
                          notes,
                          journalEntryId: first.journal_entry_id ?? null,
                          journalTradeId: first.journal_trade_id ?? null,
                          journalTradeIds: first.journal_trade_id != null ? [first.journal_trade_id] : [],
                        });
                        setShowForm(true);
                        setFormTab("basic");
                      }}
                      style={{
                        padding: "16px 18px",
                        backgroundImage: gradient,
                        backgroundColor: "var(--bg-tertiary)",
                        borderRadius: "14px",
                        minWidth: "140px",
                        flex: "1 1 140px",
                        maxWidth: "180px",
                        position: "relative",
                        cursor: "pointer",
                        transition: "transform 0.2s ease, box-shadow 0.2s ease",
                        border: `1px solid ${border}`,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = glow;
                        e.currentTarget.style.borderColor = borderHover;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                        e.currentTarget.style.borderColor = border;
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
              {hasMore && (
                <div style={{ marginTop: "12px", textAlign: "center", fontSize: "12px", color: "var(--text-secondary)" }}>
                  Scroll to view all {groups.length} entries
                </div>
              )}
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
            height: editingState && isMaximized ? "calc(100vh - 220px)" : editingState ? "calc(100vh - 180px)" : "auto",
            minHeight: editingState ? "400px" : "auto",
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
                      onClick={() => setIsEditingSelectedState(true)}
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
                    <button
                      type="button"
                      onClick={() => {
                        const first = editingStateGroup?.[0] ?? editingState;
                        if (!first) return;
                        const selectedEmotions: Record<string, number> = {};
                        for (const s of editingStateGroup || [editingState!]) {
                          selectedEmotions[s.emotion] = s.intensity;
                        }
                        setFormData((prev) => ({
                          ...prev,
                          timestamp: first.timestamp,
                          selectedEmotions,
                          notes: first.notes || "",
                        }));
                        setIsEditingSelectedState(false);
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
                      title="Undo changes and return to view"
                    >
                      <RotateCcw size={16} />
                      Undo
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

          {/* Form Tabs */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-tertiary)",
            }}
          >
            {[
              { id: "basic" as const, label: "Basic Info" },
              ...(editingState ? [] : [
                { id: "before" as SurveyTabType, label: "Before Trade" },
                { id: "during" as SurveyTabType, label: "During Trade" },
                { id: "after" as SurveyTabType, label: "After Trade" },
              ]),
            ].map((tab) => {
              const isActive = formTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFormTab(tab.id)}
                  style={{
                    padding: "12px 20px",
                    background: isActive ? "var(--bg-secondary)" : "transparent",
                    border: "none",
                    borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: isActive ? "600" : "400",
                    transition: "all 0.2s",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <form id="emotion-form" onSubmit={handleSubmit}>
            <div style={{ 
              padding: "24px", 
              display: "flex", 
              flexDirection: "column", 
              minHeight: 0,
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
            }}>
              {formTab === "basic" && (
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

                  <div style={{ 
                    display: "flex", 
                    flexDirection: "column", 
                    minHeight: "200px",
                    marginBottom: "16px",
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

                  <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Link to Journal
                    </label>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                      Optionally link this state to a journal entry and/or a specific implementation.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <label style={{ display: "block", marginBottom: "4px", fontSize: "12px" }}>Journal entry</label>
                        <select
                          value={formData.journalEntryId != null ? String(formData.journalEntryId) : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setFormData({
                              ...formData,
                              journalEntryId: v ? parseInt(v, 10) : null,
                              journalTradeId: null,
                              journalTradeIds: [],
                            });
                          }}
                          disabled={!!editingState && !isEditingSelectedState}
                          style={{
                            width: "100%",
                            padding: "8px",
                            backgroundColor: "var(--bg-tertiary)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--text-primary)",
                            fontSize: "14px",
                          }}
                        >
                          <option value="">None</option>
                          {journalEntries.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.date} – {entry.title || "Untitled"}
                            </option>
                          ))}
                        </select>
                      </div>
                      {formData.journalEntryId != null && (
                        <div>
                          <label style={{ display: "block", marginBottom: "8px", fontSize: "12px" }}>Associate with implementations</label>
                          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "10px" }}>
                            {journalTradesForLink.length === 0
                              ? "This entry has no implementations yet. This state will apply to the whole entry."
                              : "By default this applies to the whole entry. Optionally link to specific implementations in this entry:"}
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={(formData.journalTradeIds ?? []).length === 0}
                                onChange={() => setFormData({ ...formData, journalTradeIds: [] })}
                                disabled={!!editingState && !isEditingSelectedState}
                              />
                              <span>Whole entry (all implementations)</span>
                            </label>
                            {journalTradesForLink.length > 0 && (
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
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {!editingState && (
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "8px" }}>
                      Survey tabs are optional — if you don't change any answers, nothing will be saved for the survey.
                    </p>
                  )}
                </>
              )}

              {formTab !== "basic" && (
                <div>
                  {currentSurveyQuestions.map((q, idx) => (
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
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", minWidth: "20px" }}>5</span>
                        <span
                          style={{
                            minWidth: "40px",
                            textAlign: "center",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: "var(--accent)",
                          }}
                        >
                          {surveyResponses[q.key] || 3}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form Actions */}
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
                          setIsMaximized(false);
                          setFormTab("basic");
                          setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
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
                        onClick={() => setIsEditingSelectedState(true)}
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
                          setIsEditingSelectedState(false);
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
                      <button
                        type="button"
                        onClick={() => {
                          const first = editingStateGroup?.[0] ?? editingState;
                          if (!first) return;
                          const selectedEmotions: Record<string, number> = {};
                          for (const s of editingStateGroup || [editingState!]) {
                            selectedEmotions[s.emotion] = s.intensity;
                          }
                          setFormData((prev) => ({
                            ...prev,
                            timestamp: first.timestamp,
                            selectedEmotions,
                            notes: first.notes || "",
                          }));
                          setIsEditingSelectedState(false);
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
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      saveScrollPosition();
                      setShowForm(false);
                      setEditingState(null);
                      setEditingStateGroup(null);
                      setIsEditingSelectedState(false);
                      setFormTab("basic");
                      setFormData({ timestamp: new Date().toISOString(), selectedEmotions: {}, notes: "", journalEntryId: null, journalTradeId: null, journalTradeIds: [] });
                      const initial: Record<string, number> = {};
                      Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
                        initial[q.key] = 3;
                      });
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
                </>
              )}
            </div>
          </form>
        </div>
        )}

        {/* Emotional Intensity Over Time – below entry section (list or form) */}
        {states.length > 0 && chartData.length > 0 && (
          <div
            style={{
              margin: "0 24px 24px",
              padding: "20px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
              Emotional Intensity Over Time
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--text-secondary)"
                  style={{ fontSize: "12px" }}
                />
                <YAxis
                  domain={[0, 10]}
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
                  dataKey="intensity"
                  stroke={getGradientColor(0.8)}
                  strokeWidth={2}
                  dot={{ fill: getGradientColor(0.8), r: 4 }}
                  name="Intensity"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
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
