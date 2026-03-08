/**
 * Seed data for strategy checklists and survey metrics in Sandbox mode.
 * Used when Strategies page loads in sandbox so checklists/surveys appear filled out.
 */

export interface SandboxChecklistItem {
  id: number;
  strategy_id: number;
  item_text: string;
  is_checked: boolean;
  item_order: number;
  checklist_type: string;
  parent_id: number | null;
  /** For survey items: true = high (5) is good, false = low (1) is good. */
  high_is_good?: boolean | null;
}

export interface SandboxSurveyMetricWithValue {
  id: number;
  strategy_id: number;
  name: string;
  description: string | null;
  formula_type: string;
  item_ids: string;
  display_order: number;
  computed_value: number | null;
  color_scale: string | null;
}

let checklistId = 1;
function ci(strategyId: number, text: string, order: number, type: string, checked: boolean, parentId: number | null = null, highIsGood?: boolean): SandboxChecklistItem {
  return {
    id: checklistId++,
    strategy_id: strategyId,
    item_text: text,
    is_checked: checked,
    item_order: order,
    checklist_type: type,
    parent_id: parentId,
    ...(type === "survey" && highIsGood !== undefined && { high_is_good: highIsGood }),
  };
}

const surveyIdsByStrategy: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

function buildStrategyChecklistItems(): SandboxChecklistItem[] {
  checklistId = 1;
  const items: SandboxChecklistItem[] = [];
  const strategyIds = [1, 2, 3, 4, 5, 6] as const;

  for (const strategyId of strategyIds) {
    const c = (text: string, order: number, type: string) => ci(strategyId, text, order, type, true);
    items.push(c("Market bias (bull/bear/sideways) noted", 0, "daily_analysis"), c("Key levels and catalysts reviewed", 1, "daily_analysis"), c("Watchlist aligned with strategy", 2, "daily_analysis"));
    items.push(c("Stick to the plan; one trade at a time", 0, "daily_mantra"), c("Risk first, profit second", 1, "daily_mantra"));
  }

  for (const strategyId of strategyIds) {
    const c = (text: string, order: number, type: string) => ci(strategyId, text, order, type, true);
    if (strategyId === 1) {
      items.push(c("ADR > 3%?", 0, "entry"), c("Premarket volume > 1M?", 1, "entry"), c("First 30m range established?", 2, "entry"), c("Breakout with volume confirmation?", 3, "entry"));
      items.push(c("Target 2R or prior high", 0, "take_profit"), c("Stop below range low", 1, "take_profit"));
      const s1 = [ci(strategyId, "How calm/clear before entry? (1-5)", 0, "survey", true, null, true), ci(strategyId, "How confident in setup? (1-5)", 1, "survey", true, null, true), ci(strategyId, "Urgency to enter? (1-5)", 2, "survey", true, null, false), ci(strategyId, "Trust in process (1-5)", 3, "survey", true, null, true)];
      items.push(...s1);
      surveyIdsByStrategy[1] = s1.map((x) => x.id);
    } else if (strategyId === 2) {
      items.push(c("Daily trend identified?", 0, "entry"), c("38-50% pullback complete?", 1, "entry"), c("5m confirmation candle?", 2, "entry"), c("Risk defined (ATR/level)?", 3, "entry"));
      items.push(c("Target: prior structure", 0, "take_profit"), c("Stop: below pullback low", 1, "take_profit"));
      const s2 = [ci(strategyId, "Patience level (1-5)", 0, "survey", true, null, true), ci(strategyId, "FOMO level (1-5)", 1, "survey", true, null, false), ci(strategyId, "Discipline to wait (1-5)", 2, "survey", true, null, true), ci(strategyId, "Pullback mindset (1-5)", 3, "survey", true, null, true)];
      items.push(...s2);
      surveyIdsByStrategy[2] = s2.map((x) => x.id);
    } else if (strategyId === 3) {
      items.push(c("Key level identified?", 0, "entry"), c("Max 1R risk per idea?", 1, "entry"), c("1-2 trades per week rule?", 2, "entry"));
      items.push(c("Profit target set (%)", 0, "take_profit"), c("Time stop (expiry)", 1, "take_profit"));
      const s3 = [ci(strategyId, "Calm before trade (1-5)", 0, "survey", true, null, true), ci(strategyId, "Greed/fear balance (1-5)", 1, "survey", true, null, true), ci(strategyId, "Stick to plan (1-5)", 2, "survey", true, null, true), ci(strategyId, "Post-trade clarity (1-5)", 3, "survey", true, null, true)];
      items.push(...s3);
      surveyIdsByStrategy[3] = s3.map((x) => x.id);
    } else if (strategyId === 4) {
      items.push(c("Momentum confirmed (volume + price)", 0, "entry"), c("Within first 90 min?", 1, "entry"), c("Tight stop set (max 2R)", 2, "entry"));
      items.push(c("Target 1–2R or time stop", 0, "take_profit"), c("Stop on loss of momentum", 1, "take_profit"));
      const s4 = [ci(strategyId, "Speed of decision (1-5)", 0, "survey", true, null, true), ci(strategyId, "Emotional control (1-5)", 1, "survey", true, null, true), ci(strategyId, "Follow-through (1-5)", 2, "survey", true, null, true), ci(strategyId, "Execution calm (1-5)", 3, "survey", true, null, true)];
      items.push(...s4);
      surveyIdsByStrategy[4] = s4.map((x) => x.id);
    } else if (strategyId === 5) {
      items.push(c("Breakout level and volume confirmed", 0, "entry"), c("Daily/4H structure aligned", 1, "entry"), c("Scale-out plan (1.5R, 3R)", 2, "entry"));
      items.push(c("Scale at 1.5R and 3R", 0, "take_profit"), c("Stop below breakout or swing low", 1, "take_profit"));
      const s5 = [ci(strategyId, "Patience to hold (1-5)", 0, "survey", true, null, true), ci(strategyId, "Conviction in thesis (1-5)", 1, "survey", true, null, true), ci(strategyId, "Avoided early exit (1-5)", 2, "survey", true, null, true), ci(strategyId, "Scale-out discipline (1-5)", 3, "survey", true, null, true)];
      items.push(...s5);
      surveyIdsByStrategy[5] = s5.map((x) => x.id);
    } else {
      items.push(c("Extended move identified (2+ ATR?)", 0, "entry"), c("VWAP/MA level clear", 1, "entry"), c("2:1 R:R defined", 2, "entry"));
      items.push(c("Target: mean (VWAP/MA)", 0, "take_profit"), c("Stop beyond extension", 1, "take_profit"));
      const s6 = [ci(strategyId, "Fade discipline (1-5)", 0, "survey", true, null, true), ci(strategyId, "No revenge (1-5)", 1, "survey", true, null, true), ci(strategyId, "Execution calm (1-5)", 2, "survey", true, null, true), ci(strategyId, "Mean reversion patience (1-5)", 3, "survey", true, null, true)];
      items.push(...s6);
      surveyIdsByStrategy[6] = s6.map((x) => x.id);
    }
  }
  return items;
}

let metricId = 1;
function sm(strategyId: number, name: string, desc: string | null, itemIds: number[], order: number): SandboxSurveyMetricWithValue {
  return {
    id: metricId++,
    strategy_id: strategyId,
    name,
    description: desc,
    formula_type: "custom",
    item_ids: JSON.stringify(itemIds),
    display_order: order,
    computed_value: 3.2 + (metricId % 5) * 0.3,
    color_scale: "ryg",
  };
}

function buildStrategySurveyMetrics(): SandboxSurveyMetricWithValue[] {
  metricId = 1;
  const s1 = surveyIdsByStrategy[1];
  const s2 = surveyIdsByStrategy[2];
  const s3 = surveyIdsByStrategy[3];
  const s4 = surveyIdsByStrategy[4];
  const s5 = surveyIdsByStrategy[5];
  const s6 = surveyIdsByStrategy[6];
  return [
    sm(1, "Pre-trade clarity", "Average of calm/clear and confidence", s1.length >= 2 ? [s1[0], s1[1]] : s1, 0),
    sm(1, "Entry urgency", "Urgency to enter (lower = more patient)", s1.length >= 3 ? [s1[2]] : [], 1),
    sm(1, "Composite mindset", "Average of all survey items", s1, 2),
    sm(2, "Patience score", "Average patience and discipline", s2.length >= 2 ? [s2[0], s2[2]] : s2, 0),
    sm(2, "FOMO level", "FOMO (lower = better)", s2.length >= 2 ? [s2[1]] : [], 1),
    sm(2, "Pullback mindset", "Overall pullback readiness", s2, 2),
    sm(3, "Options mindset", "Calm and plan adherence", s3.length >= 2 ? [s3[0], s3[2]] : s3, 0),
    sm(3, "Greed/fear balance", "Balance (3 = neutral)", s3.length >= 2 ? [s3[1]] : [], 1),
    sm(3, "Post-trade clarity", "Clarity after exit", s3.length >= 4 ? [s3[3]] : s3.slice(-1), 2),
    sm(4, "Scalp execution", "Speed + control", s4.length >= 2 ? [s4[0], s4[1]] : s4, 0),
    sm(4, "Follow-through", "Stuck to plan", s4.length >= 3 ? [s4[2]] : [], 1),
    sm(5, "Swing patience", "Hold vs early exit", s5.length >= 2 ? [s5[0], s5[2]] : s5, 0),
    sm(5, "Conviction", "Thesis strength", s5.length >= 2 ? [s5[1]] : [], 1),
    sm(6, "Mean reversion discipline", "Fade + no revenge", s6.length >= 2 ? [s6[0], s6[1]] : s6, 0),
    sm(6, "Execution calm", "Emotional control", s6.length >= 3 ? [s6[2]] : s6.slice(-1), 1),
  ];
}

export const SANDBOX_STRATEGY_CHECKLIST_ITEMS = buildStrategyChecklistItems();
export const SANDBOX_STRATEGY_SURVEY_METRICS = buildStrategySurveyMetrics();
