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
 * bias shifts average (e.g. -0.5 = slightly lower, +0.5 = slightly higher).
 */
function varied(seed: number, key: string, bias: number = 0): number {
  const k = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const t = (seed * 31 + k * 17) % 100;
  const u = t / 100;
  const base = 2.5 + (u - 0.5) * 1.2 + bias;
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
      before_calm_clear: varied(seed, "before_calm_clear", i % 5 === 0 ? 0.4 : -0.2),
      before_urgency_pressure: varied(seed, "before_urgency", -0.3),
      before_confidence_vs_validation: varied(seed, "before_conf", 0.2),
      before_fomo: varied(seed, "before_fomo", i % 4 === 0 ? 0.5 : -0.2),
      before_recovering_loss: varied(seed, "before_recover", -0.4),
      before_patient_detached: varied(seed, "before_patient", 0.3),
      before_trust_process: varied(seed, "before_trust", 0.1),
      before_emotional_state: varied(seed, "before_emotional", -0.1),
      during_stable: varied(seed, "during_stable", -0.25),
      during_tension_stress: varied(seed, "during_tension", -0.35),
      during_tempted_interfere: varied(seed, "during_tempted", -0.3),
      during_need_control: varied(seed, "during_control", -0.2),
      during_fear_loss: varied(seed, "during_fear", i % 3 === 0 ? 0.3 : -0.2),
      during_excitement_greed: varied(seed, "during_excitement", 0.1),
      during_mentally_present: varied(seed, "during_present", 0.2),
      after_accept_outcome: varied(seed, "after_accept", 0.15),
      after_emotional_reaction: varied(seed, "after_reaction", -0.2),
      after_confidence_affected: varied(seed, "after_confidence", -0.15),
      after_tempted_another_trade: varied(seed, "after_tempted", -0.4),
      after_proud_discipline: varied(seed, "after_proud", 0.25),
    };
    out.push(survey);
  }
  return out;
}
