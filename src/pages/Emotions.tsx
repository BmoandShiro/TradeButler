import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format } from "date-fns";
import { Plus } from "lucide-react";

interface EmotionalState {
  id: number;
  timestamp: string;
  emotion: string;
  intensity: number;
  notes: string | null;
  trade_id: number | null;
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

export default function Emotions() {
  const [states, setStates] = useState<EmotionalState[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    emotion: "Neutral",
    intensity: 5,
    notes: "",
  });

  useEffect(() => {
    loadStates();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke("add_emotional_state", {
        timestamp: new Date().toISOString(),
        emotion: formData.emotion,
        intensity: formData.intensity,
        notes: formData.notes || null,
        tradeId: null,
      });
      setShowForm(false);
      setFormData({ emotion: "Neutral", intensity: 5, notes: "" });
      loadStates();
    } catch (error) {
      console.error("Error adding emotional state:", error);
      alert("Failed to add emotional state");
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
                onClick={() => setShowForm(false)}
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
            {states.map((state) => (
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

