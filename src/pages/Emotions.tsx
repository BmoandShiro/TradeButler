import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { Plus, X, TrendingUp, AlertTriangle, Target, Shield, BarChart3, Heart, ClipboardList } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface EmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
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

// Helper function to get gradient color from red -> yellow -> green
// normalizedValue: 0 (bad/red) to 1 (good/green), with 0.5 being neutral/yellow
function getGradientColor(normalizedValue: number): string {
  // Clamp value between 0 and 1
  const value = Math.max(0, Math.min(1, normalizedValue));
  
  // Calculate RGB values for smooth gradient
  let r: number, g: number, b: number;
  
  if (value <= 0.5) {
    // Red to Yellow: value goes from 0 to 0.5
    const t = value * 2; // Normalize to 0-1
    r = 255;
    g = Math.round(255 * t);
    b = 0;
  } else {
    // Yellow to Green: value goes from 0.5 to 1
    const t = (value - 0.5) * 2; // Normalize to 0-1
    r = Math.round(255 * (1 - t));
    g = 255;
    b = 0;
  }
  
  return `rgb(${r}, ${g}, ${b})`;
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

  // Prepare chart data for emotional states over time
  const chartData = useMemo(() => {
    return states
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((state) => ({
        date: format(new Date(state.timestamp), "MMM dd"),
        intensity: state.intensity,
        emotion: state.emotion,
      }));
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

      {/* Emotional Intensity Over Time Chart */}
      {states.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "30px",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "20px" }}>Emotional Intensity Over Time</h2>
          <ResponsiveContainer width="100%" height={300}>
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
  const [showForm, setShowForm] = useState(false);
  const [editingState, setEditingState] = useState<EmotionalState | null>(null);
  const [formTab, setFormTab] = useState<"basic" | SurveyTabType>("basic");
  const [formData, setFormData] = useState({
    emotion: "Neutral",
    intensity: 5,
    notes: "",
  });
  const [surveyResponses, setSurveyResponses] = useState<Record<string, number>>({});

  useEffect(() => {
    loadStates();
    loadSurveys();
  }, []);

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
    try {
      if (editingState) {
        // Update existing state
        await invoke("update_emotional_state", {
          id: editingState.id,
          emotion: formData.emotion,
          intensity: formData.intensity,
          notes: formData.notes || null,
        });
      } else {
        // Create new state
        const stateId = await invoke<number>("add_emotional_state", {
          timestamp: new Date().toISOString(),
          emotion: formData.emotion,
          intensity: formData.intensity,
          notes: formData.notes || null,
          tradeId: null,
        });

        // Survey is optional: only persist if user changed at least one answer from default (3)
        const shouldSaveSurvey = Object.values(SURVEY_QUESTIONS)
          .flat()
          .some((q) => (surveyResponses?.[q.key] ?? 3) !== 3);

        if (shouldSaveSurvey) {
          try {
            await invoke("add_emotion_survey", {
              emotional_state_id: stateId,
              timestamp: new Date().toISOString(),
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
            alert("State saved but failed to save survey");
          }
        }
      }

      await loadStates();
      await loadSurveys();
      
      // Reset form
      setShowForm(false);
      setEditingState(null);
      setFormTab("basic");
      setFormData({ emotion: "Neutral", intensity: 5, notes: "" });
      const initial: Record<string, number> = {};
      Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
        initial[q.key] = 3;
      });
      setSurveyResponses(initial);
    } catch (error) {
      console.error("Error saving emotional state:", error);
      alert(`Failed to ${editingState ? "update" : "add"} emotional state`);
    }
  };

  const handleDelete = async (state: EmotionalState) => {
    if (!confirm(`Are you sure you want to delete this emotional state (${state.emotion})?`)) {
      return;
    }

    try {
      await invoke("delete_emotional_state", { id: state.id });
      await loadStates();
      await loadSurveys();
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

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading emotional states...</p>
      </div>
    );
  }

  const currentSurveyQuestions = formTab !== "basic" ? SURVEY_QUESTIONS[formTab] : [];

  return (
    <div style={{ padding: "30px", overflowY: "auto", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Emotional States</h1>
        <button
          onClick={() => {
            setEditingState(null);
            setFormData({ emotion: "Neutral", intensity: 5, notes: "" });
            const initial: Record<string, number> = {};
            Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
              initial[q.key] = 3;
            });
            setSurveyResponses(initial);
            setShowForm(!showForm);
            setFormTab("basic");
          }}
          style={{
            padding: "10px 20px",
            backgroundColor: "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          <Plus size={16} />
          Add State
        </button>
      </div>

      {/* Recent Emotional States - Prominently displayed near the top */}
      {states.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "30px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Recent Emotional States</h2>
            <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
              {states.length} {states.length === 1 ? "state" : "states"} recorded
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {states
              .slice()
              .reverse()
              .slice(0, 12)
              .map((state) => {
                // Normalize intensity (1-10) to 0-1 for color gradient
                const normalized = (state.intensity - 1) / 9;
                const color = getGradientColor(normalized);
                const dateStr = format(new Date(state.timestamp), "MMM dd, yyyy");
                const timeStr = format(new Date(state.timestamp), "HH:mm");
                const hasSurvey = surveys.some((s) => s.emotional_state_id === state.id);
                
                return (
                  <div
                    key={state.id}
                    onClick={() => {
                      setEditingState(state);
                      setFormData({ emotion: state.emotion, intensity: state.intensity, notes: state.notes || "" });
                      setShowForm(true);
                      setFormTab("basic");
                    }}
                    style={{
                      padding: "14px 18px",
                      backgroundColor: "var(--bg-tertiary)",
                      borderRadius: "8px",
                      textAlign: "center",
                      border: `2px solid ${color}`,
                      minWidth: "140px",
                      flex: "1 1 140px",
                      position: "relative",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                    }}
                  >
                    {hasSurvey && (
                      <div
                        style={{
                          position: "absolute",
                          top: "6px",
                          right: "6px",
                          width: "8px",
                          height: "8px",
                          backgroundColor: "var(--accent)",
                          borderRadius: "50%",
                          border: "1px solid var(--bg-primary)",
                        }}
                        title="Survey completed"
                      />
                    )}
                    <div style={{ fontSize: "11px", fontWeight: "600", marginBottom: "6px", color: "var(--text-secondary)" }}>
                      {dateStr}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                      {timeStr}
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "6px", color }}>
                      {state.emotion}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "4px", color: "var(--text-primary)" }}>
                      Intensity: {state.intensity}/10
                    </div>
                    {state.notes && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          marginTop: "6px",
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={state.notes}
                      >
                        {state.notes}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          {states.length > 12 && (
            <div style={{ marginTop: "16px", textAlign: "center", fontSize: "14px", color: "var(--text-secondary)" }}>
              Showing 12 most recent of {states.length} states
            </div>
          )}
        </div>
      )}

      <MetricsDisplay surveys={surveys} states={states} />

      {showForm && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "0",
            marginBottom: "30px",
            overflow: "hidden",
          }}
        >
          {/* Form Header */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-tertiary)" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
              {editingState ? `Edit Emotional State: ${editingState.emotion}` : "Add New Emotional State"}
            </h2>
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

          <form onSubmit={handleSubmit}>
            <div style={{ padding: "24px" }}>
              {formTab === "basic" && (
                <>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Emotion
                    </label>
                    <select
                      value={formData.emotion}
                      onChange={(e) => setFormData({ ...formData, emotion: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "14px",
                      }}
                    >
                      {EMOTIONS.map((emotion) => (
                        <option key={emotion} value={emotion}>
                          {emotion}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Intensity: {formData.intensity}/10
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={formData.intensity}
                      onChange={(e) => setFormData({ ...formData, intensity: parseInt(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", color: "var(--text-secondary)" }}>
                      Notes (optional)
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "10px",
                        backgroundColor: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-primary)",
                        fontSize: "14px",
                        minHeight: "80px",
                        resize: "vertical",
                      }}
                    />
                  </div>

                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "6px" }}>
                    Survey tabs are optional — if you don’t change any answers, nothing will be saved for the survey.
                  </p>
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
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingState(null);
                  setFormTab("basic");
                  setFormData({ emotion: "Neutral", intensity: 5, notes: "" });
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
              {editingState && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(editingState);
                    setShowForm(false);
                    setEditingState(null);
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
              )}
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
                {editingState ? "Update State" : "Save State"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && states.length === 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "var(--text-secondary)" }}>
            No emotional states recorded. Click "Add State" to get started.
          </p>
        </div>
      )}
    </div>
  );
}
