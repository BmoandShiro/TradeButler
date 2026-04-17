/**
 * Demo strategy "Planestation's Strategy" mirrors the live/paper strategy named "My Strategy"
 * for developers (Planestation, BMO). Opt out: localStorage tradebutler_planestation_demo_sync = "0"
 */
export const PLANESTATION_DEMO_STRATEGY_ID = 7;
export const PLANESTATION_DEMO_STRATEGY_NAME = "Planestation's Strategy";
export const MY_STRATEGY_NAME_FOR_PLANESTATION_SYNC = "My Strategy";
export const PLANESTATION_SYNC_ENABLED_KEY = "tradebutler_planestation_demo_sync";
/** Checklist rows for sandbox id 7 when mirroring from DB (static seed has no items for 7). */
export const PLANESTATION_CHECKLIST_MIRROR_KEY = "tradebutler_planestation_sandbox_checklist_mirror";

export function isPlanestationDemoSyncEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PLANESTATION_SYNC_ENABLED_KEY) !== "0";
}

export function loadPlanestationChecklistMirror(): unknown[] | null {
  try {
    const raw = localStorage.getItem(PLANESTATION_CHECKLIST_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as unknown[]) : null;
  } catch {
    return null;
  }
}
