/**
 * Demo (sandbox) emotion survey data.
 * Each survey is linked to an emotional state; responses use 1–5 scale (3 = neutral).
 * Values are varied so Psychological Metrics show realistic, non-flat scores.
 */

export interface DemoEmotionSurvey {
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

/** Clamp to 1–5 (survey scale). */
function s(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v)));
}

/**
 * Deterministic but varied 1–5 value. seed and key identify the question;
 * bias shifts average. Uses wider spread so metrics show clear reds and greens (1–2 and 4–5).
 */
function varied(seed: number, key: string, bias: number = 0): number {
  const k = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const t = (seed * 31 + k * 17) % 100;
  const u = t / 100;
  const spread = 2.2;
  const base = 2.5 + (u - 0.5) * spread + bias;
  return s(base);
}

/**
 * Build demo surveys for a subset of emotional states so Psychological Metrics
 * are populated with realistic variation (not all 2.5/5).
 */
export function getDemoEmotionSurveys(
  emotionalStates: { id: number; timestamp: string }[]
): DemoEmotionSurvey[] {
  const out: DemoEmotionSurvey[] = [];
  let surveyId = 1;
  for (let i = 0; i < emotionalStates.length; i++) {
    const state = emotionalStates[i];
    if (!state?.timestamp) continue;
    const seed = state.id * 7 + i;
    const survey: DemoEmotionSurvey = {
      id: surveyId++,
      emotional_state_id: state.id,
      timestamp: state.timestamp,
      before_calm_clear: varied(seed, "before_calm_clear", i % 5 === 0 ? 1.2 : i % 5 === 2 ? -1.1 : 0.2),
      before_urgency_pressure: varied(seed, "before_urgency", i % 4 === 0 ? 0.9 : i % 4 === 2 ? -0.9 : -0.3),
      before_confidence_vs_validation: varied(seed, "before_conf", i % 6 === 0 ? -1 : i % 6 === 3 ? 0.8 : 0.2),
      before_fomo: varied(seed, "before_fomo", i % 4 === 0 ? 1.0 : i % 4 === 1 ? -0.8 : -0.2),
      before_recovering_loss: varied(seed, "before_recover", i % 3 === 0 ? 0.7 : -0.9),
      before_patient_detached: varied(seed, "before_patient", i % 5 === 1 ? -0.8 : i % 5 === 4 ? 0.9 : 0.3),
      before_trust_process: varied(seed, "before_trust", i % 4 === 0 ? 0.8 : -0.2),
      before_emotional_state: varied(seed, "before_emotional", i % 5 === 2 ? 0.9 : -0.4),
      during_stable: varied(seed, "during_stable", i % 4 === 0 ? -0.9 : i % 4 === 2 ? 0.7 : -0.25),
      during_tension_stress: varied(seed, "during_tension", i % 3 === 0 ? 0.8 : -0.7),
      during_tempted_interfere: varied(seed, "during_tempted", i % 5 === 0 ? 0.6 : -0.5),
      during_need_control: varied(seed, "during_control", i % 4 === 1 ? 0.7 : -0.3),
      during_fear_loss: varied(seed, "during_fear", i % 3 === 0 ? 1.0 : i % 3 === 1 ? -0.8 : -0.2),
      during_excitement_greed: varied(seed, "during_excitement", i % 4 === 0 ? 0.8 : i % 4 === 2 ? -0.6 : 0.1),
      during_mentally_present: varied(seed, "during_present", i % 5 === 0 ? -0.7 : i % 5 === 3 ? 0.8 : 0.2),
      after_accept_outcome: varied(seed, "after_accept", i % 4 === 0 ? 0.9 : i % 4 === 2 ? -0.6 : 0.15),
      after_emotional_reaction: varied(seed, "after_reaction", i % 3 === 0 ? 0.7 : -0.5),
      after_confidence_affected: varied(seed, "after_confidence", i % 5 === 0 ? 0.8 : -0.4),
      after_tempted_another_trade: varied(seed, "after_tempted", i % 4 === 0 ? 0.9 : -0.8),
      after_proud_discipline: varied(seed, "after_proud", i % 5 === 0 ? -0.6 : i % 5 === 2 ? 0.9 : 0.25),
    };
    out.push(survey);
  }
  return out;
}
