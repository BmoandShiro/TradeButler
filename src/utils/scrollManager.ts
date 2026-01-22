/**
 * Scroll Manager Utility
 * Handles persistent scroll position saving and restoration
 */

export type TabType = string | "notes" | "trades" | "checklists" | "survey" | "trade" | "what_went_well" | "what_could_be_improved" | "emotional_state";

export interface ScrollState {
  tabPositions: Map<TabType, number>;
  leftPanelScroll?: number;
  rightPanelScroll?: number;
}

/**
 * Save tab scroll positions to localStorage
 */
export function saveTabScrollPositions(
  tabPositions: Map<TabType, number>,
  storageKey: string
): void {
  const tabPositionsObj: Record<string, number> = {};
  tabPositions.forEach((pos, tab) => {
    tabPositionsObj[tab] = pos;
  });
  localStorage.setItem(`${storageKey}_tab_scroll_positions`, JSON.stringify(tabPositionsObj));
}

/**
 * Restore tab scroll positions from localStorage
 */
export function restoreTabScrollPositions(
  storageKey: string
): Map<TabType, number> {
  const saved = localStorage.getItem(`${storageKey}_tab_scroll_positions`);
  const positions = new Map<TabType, number>();
  
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      Object.entries(parsed).forEach(([tab, pos]) => {
        positions.set(tab, pos as number);
      });
    } catch (e) {
      console.error(`Error restoring tab scroll positions for ${storageKey}:`, e);
    }
  }
  
  return positions;
}

/**
 * Save panel scroll positions to localStorage
 */
export function savePanelScrollPositions(
  leftPanelScroll: number | null,
  rightPanelScroll: number | null,
  storageKey: string
): void {
  if (leftPanelScroll !== null) {
    localStorage.setItem(`${storageKey}_left_panel_scroll`, leftPanelScroll.toString());
  }
  if (rightPanelScroll !== null) {
    localStorage.setItem(`${storageKey}_right_panel_scroll`, rightPanelScroll.toString());
  }
}

/**
 * Restore panel scroll positions from localStorage
 */
export function restorePanelScrollPositions(
  storageKey: string
): { leftPanelScroll: number | null; rightPanelScroll: number | null } {
  const leftSaved = localStorage.getItem(`${storageKey}_left_panel_scroll`);
  const rightSaved = localStorage.getItem(`${storageKey}_right_panel_scroll`);
  
  return {
    leftPanelScroll: leftSaved ? parseInt(leftSaved, 10) : null,
    rightPanelScroll: rightSaved ? parseInt(rightSaved, 10) : null,
  };
}

/**
 * Save all scroll positions (tabs + panels) at once
 */
export function saveAllScrollPositions(
  tabPositions: Map<TabType, number>,
  leftPanelScroll: number | null,
  rightPanelScroll: number | null,
  storageKey: string
): void {
  saveTabScrollPositions(tabPositions, storageKey);
  savePanelScrollPositions(leftPanelScroll, rightPanelScroll, storageKey);
}

/**
 * Restore all scroll positions (tabs + panels) at once
 */
export function restoreAllScrollPositions(
  storageKey: string
): ScrollState {
  return {
    tabPositions: restoreTabScrollPositions(storageKey),
    ...restorePanelScrollPositions(storageKey),
  };
}

/**
 * Save current tab's scroll position before switching
 * This should be called when clicking a tab button
 */
export function saveCurrentTabScroll(
  currentTab: TabType,
  tabScrollPositions: Map<TabType, number>,
  tabContentRef: HTMLElement | null,
  rightPanelScrollRef: HTMLElement | null,
  activeTab: TabType
): void {
  // Save current active tab's scroll position
  if (activeTab === currentTab) {
    // If the current tab uses the right panel scroll (like "notes" in Strategies)
    if (rightPanelScrollRef) {
      tabScrollPositions.set(activeTab, rightPanelScrollRef.scrollTop);
    } else if (tabContentRef) {
      // If the tab has its own scroll container
      tabScrollPositions.set(activeTab, tabContentRef.scrollTop);
    }
  }
}
