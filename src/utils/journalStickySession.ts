/**
 * Sticky journal editor (session-scoped)
 *
 * - Storage: sessionStorage key `tradebutler_journal_editor_sticky_${dataMode}`; payload JSON includes `dataMode`.
 * - Legacy `localStorage` `journal_work_in_progress` is migrated into the current mode key once, then removed.
 *
 * Explicit navigation to a different journal entry (sidebar, deep link with location.state.openEntryId,
 * overview cards, etc.) replaces the sticky session — no stack; last explicit target wins.
 *
 * Browser refresh / hard reload: survives while the tab session lives (sessionStorage).
 * Closing the tab: cleared with sessionStorage.
 * Logout / wipe: call `clearAllJournalStickySessions()` (also wired from full localStorage clears where applicable).
 *
 * Manual QA:
 * 1) Journal → Add Entry → type title/body → navigate to Trades → back to Journal → still creating with fields.
 * 2) Open an entry → Edit → change text → navigate away → return → still editing same entry with changes.
 * 3) From Emotions “Open in Journal” (or Trades/Calendar with openEntryId) → sticky draft is cleared; that entry opens.
 * 4) Refresh (F5) on Journal while editing → session restores within the same tab session; new tab has no sticky.
 * 5) Full data delete from lock screen → sticky cleared (session keys removed).
 */

import type { DataMode } from "./dataMode";

export const LEGACY_JOURNAL_WIP_KEY = "journal_work_in_progress";
export const JOURNAL_STICKY_PREFIX = "tradebutler_journal_editor_sticky_";

export function journalStickyKeyForMode(mode: DataMode): string {
  return `${JOURNAL_STICKY_PREFIX}${mode}`;
}

/** One-time migration from long-lived local draft to tab-scoped session storage. */
export function migrateLegacyJournalWipToSession(currentMode: DataMode): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    const legacy = localStorage.getItem(LEGACY_JOURNAL_WIP_KEY);
    if (!legacy) return;
    const key = journalStickyKeyForMode(currentMode);
    if (sessionStorage.getItem(key)) {
      localStorage.removeItem(LEGACY_JOURNAL_WIP_KEY);
      return;
    }
    const parsed = JSON.parse(legacy) as { dataMode?: DataMode; isCreating?: boolean; isEditing?: boolean };
    if (parsed.dataMode != null && parsed.dataMode !== currentMode) {
      return;
    }
    const withMode = { ...parsed, dataMode: currentMode };
    sessionStorage.setItem(key, JSON.stringify(withMode));
    localStorage.removeItem(LEGACY_JOURNAL_WIP_KEY);
  } catch {
    /* ignore */
  }
}

export function clearJournalWip(mode: DataMode): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(journalStickyKeyForMode(mode));
    localStorage.removeItem(LEGACY_JOURNAL_WIP_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAllJournalStickySessions(): void {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(JOURNAL_STICKY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
    localStorage.removeItem(LEGACY_JOURNAL_WIP_KEY);
  } catch {
    /* ignore */
  }
}

/** Sidebar / nav: treat like an unsaved draft if create/edit WIP exists for this mode. */
export function hasJournalNavDraft(mode: DataMode): boolean {
  if (typeof window === "undefined") return false;
  migrateLegacyJournalWipToSession(mode);
  try {
    const raw = sessionStorage.getItem(journalStickyKeyForMode(mode));
    if (raw) {
      const p = JSON.parse(raw) as { isCreating?: boolean; isEditing?: boolean };
      return !!(p.isCreating || p.isEditing);
    }
  } catch {
    /* ignore */
  }
  return !!localStorage.getItem(LEGACY_JOURNAL_WIP_KEY);
}
