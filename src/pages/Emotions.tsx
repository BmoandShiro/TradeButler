import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { Plus, X, TrendingUp, AlertTriangle, Target, Shield, BarChart3 } from "lucide-react";

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

function EmotionSurveyModal({
  isOpen,
  onClose,
  emotionalStateId,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  emotionalStateId: number | null;
  onComplete: () => void;
}) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [currentSection, setCurrentSection] = useState<"before" | "during" | "after">("before");

  useEffect(() => {
    if (isOpen) {
      // Initialize all responses to 3 (middle)
      const initial: Record<string, number> = {};
      Object.values(SURVEY_QUESTIONS).flat().forEach((q) => {
        initial[q.key] = 3;
      });
      setResponses(initial);
      setCurrentSection("before");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!emotionalStateId) return;

    try {
      await invoke("add_emotion_survey", {
        emotional_state_id: emotionalStateId,
        timestamp: new Date().toISOString(),
        before_calm_clear: responses.before_calm_clear,
        before_urgency_pressure: responses.before_urgency_pressure,
        before_confidence_vs_validation: responses.before_confidence_vs_validation,
        before_fomo: responses.before_fomo,
        before_recovering_loss: responses.before_recovering_loss,
        before_patient_detached: responses.before_patient_detached,
        before_trust_process: responses.before_trust_process,
        before_emotional_state: responses.before_emotional_state,
        during_stable: responses.during_stable,
        during_tension_stress: responses.during_tension_stress,
        during_tempted_interfere: responses.during_tempted_interfere,
        during_need_control: responses.during_need_control,
        during_fear_loss: responses.during_fear_loss,
        during_excitement_greed: responses.during_excitement_greed,
        during_mentally_present: responses.during_mentally_present,
        after_accept_outcome: responses.after_accept_outcome,
        after_emotional_reaction: responses.after_emotional_reaction,
        after_confidence_affected: responses.after_confidence_affected,
        after_tempted_another_trade: responses.after_tempted_another_trade,
        after_proud_discipline: responses.after_proud_discipline,
      });
      onComplete();
      onClose();
    } catch (error) {
      console.error("Error saving survey:", error);
      alert("Failed to save survey");
    }
  };

  if (!isOpen) return null;

  const currentQuestions = SURVEY_QUESTIONS[currentSection];
  const canProceed = currentSection === "after";
  const canGoBack = currentSection !== "before";

  return (
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
    >
      <div
        style={{
          backgroundColor: "var(--bg-primary)",
          borderRadius: "12px",
          padding: "30px",
          maxWidth: "700px",
          maxHeight: "90vh",
          overflowY: "auto",
          width: "90%",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "bold" }}>
            Emotions Survey - {currentSection === "before" ? "Before Trade" : currentSection === "during" ? "During Trade" : "After Trade"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              padding: "4px",
            }}
          >
            <X size={24} />
          </button>
        </div>

        <div style={{ marginBottom: "24px" }}>
          {currentQuestions.map((q, idx) => (
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
                  value={responses[q.key] || 3}
                  onChange={(e) => setResponses({ ...responses, [q.key]: parseInt(e.target.value) })}
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
                  {responses[q.key] || 3}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          {canGoBack && (
            <button
              onClick={() => {
                if (currentSection === "during") setCurrentSection("before");
                else if (currentSection === "after") setCurrentSection("during");
              }}
              style={{
                padding: "10px 20px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Back
            </button>
          )}
          {!canProceed && (
            <button
              onClick={() => {
                if (currentSection === "before") setCurrentSection("during");
                else if (currentSection === "during") setCurrentSection("after");
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
              Next
            </button>
          )}
          {canProceed && (
            <button
              onClick={handleSubmit}
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
              Complete Survey
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricsDisplay({ surveys }: { surveys: EmotionSurvey[] }) {
  if (surveys.length === 0) return null;

  // Calculate metrics
  const calculateMetric = (values: number[], inverted: boolean = false) => {
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

  // FOMO Index (before_fomo average)
  const fomoValues = surveys.map((s) => s.before_fomo);
  const fomoIndex = calculateMetric(fomoValues);

  // Discipline Consistency (avg of before_patient_detached, during_need_control, after_proud_discipline - inverted)
  const disciplineValues = surveys.flatMap((s) => [
    6 - s.before_patient_detached,
    6 - s.during_need_control,
    s.after_proud_discipline, // Already positive (1 = proud, 5 = money focused)
  ]);
  const disciplineConsistency = calculateMetric(disciplineValues);

  // Revenge-trade Risk (before_recovering_loss, after_tempted_another_trade)
  const revengeTradeValues = surveys.flatMap((s) => [s.before_recovering_loss, s.after_tempted_another_trade]);
  const revengeTradeRisk = calculateMetric(revengeTradeValues);

  // Overconfidence after wins (would need trade outcome - using after_confidence_affected for now)
  // This would ideally be filtered by winning trades only
  const overconfidenceValues = surveys.map((s) => s.after_confidence_affected);
  const overconfidenceAfterWins = calculateMetric(overconfidenceValues);

  // Fear after losses (during_fear_loss, after_confidence_affected - inverted)
  // Would ideally be filtered by losing trades
  const fearAfterLossesValues = surveys.flatMap((s) => [s.during_fear_loss, s.after_confidence_affected]);
  const fearAfterLosses = calculateMetric(fearAfterLossesValues);

  const metrics = [
    {
      name: "Emotional Stability Index",
      value: emotionalStabilityIndex.toFixed(2),
      max: 5,
      icon: Shield,
      color: emotionalStabilityIndex >= 3.5 ? "#22c55e" : emotionalStabilityIndex >= 2.5 ? "#eab308" : "#ef4444",
      description: "Your ability to stay emotionally stable during and after trades",
    },
    {
      name: "FOMO Index",
      value: fomoIndex.toFixed(2),
      max: 5,
      icon: AlertTriangle,
      color: fomoIndex <= 2 ? "#22c55e" : fomoIndex <= 3 ? "#eab308" : "#ef4444",
      description: "How often FOMO influences your trading decisions (lower is better)",
      inverted: true,
    },
    {
      name: "Discipline Consistency",
      value: disciplineConsistency.toFixed(2),
      max: 5,
      icon: Target,
      color: disciplineConsistency >= 3.5 ? "#22c55e" : disciplineConsistency >= 2.5 ? "#eab308" : "#ef4444",
      description: "Your consistency in maintaining discipline throughout trades",
    },
    {
      name: "Revenge-Trade Risk",
      value: revengeTradeRisk.toFixed(2),
      max: 5,
      icon: TrendingUp,
      color: revengeTradeRisk <= 2 ? "#22c55e" : revengeTradeRisk <= 3 ? "#eab308" : "#ef4444",
      description: "Tendency to take trades to recover from losses (lower is better)",
      inverted: true,
    },
    {
      name: "Overconfidence After Wins",
      value: overconfidenceAfterWins.toFixed(2),
      max: 5,
      icon: BarChart3,
      color: overconfidenceAfterWins <= 2.5 ? "#22c55e" : overconfidenceAfterWins <= 3.5 ? "#eab308" : "#ef4444",
      description: "How wins affect your confidence and decision-making",
      inverted: true,
    },
    {
      name: "Fear After Losses",
      value: fearAfterLosses.toFixed(2),
      max: 5,
      icon: AlertTriangle,
      color: fearAfterLosses <= 2 ? "#22c55e" : fearAfterLosses <= 3 ? "#eab308" : "#ef4444",
      description: "Emotional impact of losses on future trading (lower is better)",
      inverted: true,
    },
  ];

  return (
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
                <Icon size={20} style={{ color: metric.color }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "4px" }}>{metric.name}</div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: metric.color }}>
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
                    backgroundColor: metric.color,
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
  );
}

export default function Emotions() {
  const [states, setStates] = useState<EmotionalState[]>([]);
  const [surveys, setSurveys] = useState<EmotionSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [pendingStateId, setPendingStateId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    emotion: "Neutral",
    intensity: 5,
    notes: "",
    takeSurvey: false,
  });

  useEffect(() => {
    loadStates();
    loadSurveys();
  }, []);

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
      const stateId = await invoke<number>("add_emotional_state", {
        timestamp: new Date().toISOString(),
        emotion: formData.emotion,
        intensity: formData.intensity,
        notes: formData.notes || null,
        tradeId: null,
      });
      
      await loadStates();
      
      if (formData.takeSurvey) {
        setPendingStateId(stateId);
        setShowSurvey(true);
      } else {
        setShowForm(false);
        setFormData({ emotion: "Neutral", intensity: 5, notes: "", takeSurvey: false });
      }
    } catch (error) {
      console.error("Error adding emotional state:", error);
      alert("Failed to add emotional state");
    }
  };

  const handleSurveyComplete = () => {
    loadSurveys();
    setShowForm(false);
    setFormData({ emotion: "Neutral", intensity: 5, notes: "", takeSurvey: false });
    setPendingStateId(null);
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

  return (
    <div style={{ padding: "30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Emotional States</h1>
        <button
          onClick={() => setShowForm(!showForm)}
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

      <MetricsDisplay surveys={surveys} />

      {showForm && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "30px",
          }}
        >
          <form onSubmit={handleSubmit}>
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

            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.takeSurvey}
                  onChange={(e) => setFormData({ ...formData, takeSurvey: e.target.checked })}
                  style={{ cursor: "pointer" }}
                />
                <span>Take emotions survey after saving</span>
              </label>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
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
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormData({ emotion: "Neutral", intensity: 5, notes: "", takeSurvey: false });
                }}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showSurvey && (
        <EmotionSurveyModal
          isOpen={showSurvey}
          onClose={() => {
            setShowSurvey(false);
            setPendingStateId(null);
          }}
          emotionalStateId={pendingStateId}
          onComplete={handleSurveyComplete}
        />
      )}

      {states.length === 0 ? (
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
      ) : (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {states.map((state) => {
              const hasSurvey = surveys.some((s) => s.emotional_state_id === state.id);
              return (
                <div
                  key={state.id}
                  style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--border-color)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                      <span
                        style={{
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "14px",
                          fontWeight: "600",
                          backgroundColor: "var(--bg-tertiary)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {state.emotion}
                      </span>
                      <span
                        style={{
                          fontSize: "14px",
                          color: getIntensityColor(state.intensity),
                          fontWeight: "600",
                        }}
                      >
                        Intensity: {state.intensity}/10
                      </span>
                      {hasSurvey && (
                        <span
                          style={{
                            fontSize: "12px",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            backgroundColor: "var(--accent)",
                            color: "white",
                          }}
                        >
                          Survey Completed
                        </span>
                      )}
                    </div>
                    {state.notes && (
                      <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "4px" }}>
                        {state.notes}
                      </p>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    {formatDate(state.timestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
