import { invoke } from "@tauri-apps/api/tauri";
import type { DataMode } from "./dataMode";
import {
  loadStrategyIndicatorIds,
  saveStrategyIndicatorIds,
  loadStrategyRuleIndicatorIds,
  saveStrategyRuleIndicatorIds,
  loadStrategyRuleTexts,
  saveStrategyRuleTexts,
  loadStrategyCustomRuleSets,
  saveStrategyCustomRuleSets,
  loadStrategyRulesEnabled,
  saveStrategyRulesEnabled,
  type StrategyRuleType,
} from "./indicatorsStore";
import {
  getSandboxStrategyChecklist,
  loadSandboxState,
  saveSandboxState,
  updateSandboxStrategy,
} from "./sandboxStore";
import type { ExampleStrategy } from "../exampleData";
import {
  PLANESTATION_CHECKLIST_MIRROR_KEY,
  PLANESTATION_DEMO_STRATEGY_ID,
  PLANESTATION_DEMO_STRATEGY_NAME,
  isPlanestationDemoSyncEnabled,
} from "./planestationConstants";

const CHECKLIST_TYPE_ORDER_KEY = "tradebutler_checklist_type_order";
const CHECKLIST_TITLES_KEY = "tradebutler_checklist_titles";

function copyStrategyKeyedLocalStorage(storageKey: string, sourceId: number, targetId: number) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sk = String(sourceId);
    const tk = String(targetId);
    if (parsed[sk] === undefined) return;
    parsed[tk] = JSON.parse(JSON.stringify(parsed[sk]));
    localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

function ensurePlanestationStrategyFirstInSandboxState() {
  const state = loadSandboxState();
  const without = state.strategies.filter((s) => s.id !== PLANESTATION_DEMO_STRATEGY_ID);
  const existing = state.strategies.find((s) => s.id === PLANESTATION_DEMO_STRATEGY_ID);
  const planestation: ExampleStrategy =
    existing ?? {
      id: PLANESTATION_DEMO_STRATEGY_ID,
      name: PLANESTATION_DEMO_STRATEGY_NAME,
      description: "Mirrors My Strategy in demo mode (developer sync).",
      notes: null,
      created_at: new Date().toISOString(),
      color: "#a855f7",
      author: "Planestation",
    };
  saveSandboxState({ ...state, strategies: [planestation, ...without] });
}

/**
 * When the strategy named "My Strategy" is saved (real/paper/sandbox), copy its definition into
 * sandbox id 7 as "Planestation's Strategy" for demo mode. Opt out: tradebutler_planestation_demo_sync = "0".
 */
export async function syncPlanestationDemoFromMyStrategy(
  sourceMode: DataMode,
  sourceStrategyId: number,
  row: {
    description: string | null;
    notes: string | null;
    color: string | null;
    author: string | null;
  }
): Promise<void> {
  if (!isPlanestationDemoSyncEnabled()) return;
  if (sourceStrategyId < 1) return;

  ensurePlanestationStrategyFirstInSandboxState();

  /** Strategy Details tab only shows `notes`; mirror description into notes when notes is empty. */
  const notesForDetails =
    row.notes && String(row.notes).trim().length > 0
      ? row.notes
      : row.description && String(row.description).trim().length > 0
        ? row.description
        : null;

  updateSandboxStrategy(PLANESTATION_DEMO_STRATEGY_ID, {
    name: PLANESTATION_DEMO_STRATEGY_NAME,
    description: row.description,
    notes: notesForDetails,
    color: row.color,
    author: row.author?.trim() || "Planestation",
  });

  const targetMode: DataMode = "sandbox";
  const tid = PLANESTATION_DEMO_STRATEGY_ID;

  saveStrategyIndicatorIds(targetMode, tid, loadStrategyIndicatorIds(sourceMode, sourceStrategyId));
  const ruleTypes: StrategyRuleType[] = ["entry", "takeProfit", "custom"];
  for (const rt of ruleTypes) {
    saveStrategyRuleIndicatorIds(targetMode, tid, rt, loadStrategyRuleIndicatorIds(sourceMode, sourceStrategyId, rt));
    saveStrategyRuleTexts(targetMode, tid, rt, loadStrategyRuleTexts(sourceMode, sourceStrategyId, rt));
  }
  saveStrategyCustomRuleSets(targetMode, tid, loadStrategyCustomRuleSets(sourceMode, sourceStrategyId));
  saveStrategyRulesEnabled(targetMode, tid, loadStrategyRulesEnabled(sourceMode, sourceStrategyId));

  copyStrategyKeyedLocalStorage(CHECKLIST_TYPE_ORDER_KEY, sourceStrategyId, tid);
  copyStrategyKeyedLocalStorage(CHECKLIST_TITLES_KEY, sourceStrategyId, tid);

  if (sourceMode === "sandbox") {
    const items = getSandboxStrategyChecklist(sourceStrategyId);
    const mirrored = items.map((it: { id: number; strategy_id: number }, idx: number) => ({
      ...it,
      id: 900_000 + idx,
      strategy_id: tid,
    }));
    localStorage.setItem(PLANESTATION_CHECKLIST_MIRROR_KEY, JSON.stringify(mirrored));
    return;
  }

  try {
    type ClItem = Record<string, unknown> & {
      id: number;
      strategy_id: number;
    };
    const items = await invoke<ClItem[]>("get_strategy_checklist", {
      strategyId: sourceStrategyId,
      checklistType: null,
    });
    const mirrored = items.map((it, idx) => ({
      ...it,
      id: 900_000 + idx,
      strategy_id: tid,
    }));
    localStorage.setItem(PLANESTATION_CHECKLIST_MIRROR_KEY, JSON.stringify(mirrored));
  } catch (e) {
    console.warn("Planestation demo: could not mirror checklists", e);
  }
}
