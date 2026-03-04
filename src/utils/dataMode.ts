export type DataMode = "sandbox" | "real" | "paper";

const STORAGE_KEY = "tradebutler_data_mode";

export function getCurrentDataMode(): DataMode {
  if (typeof window === "undefined") {
    return "real";
  }
  let saved = window.localStorage.getItem(STORAGE_KEY);
  // Migrate legacy "example" to "sandbox"
  if (saved === "example") {
    saved = "sandbox";
    window.localStorage.setItem(STORAGE_KEY, saved);
  }
  if (saved === "sandbox" || saved === "real" || saved === "paper") {
    return saved;
  }
  return "real";
}

export function setCurrentDataMode(mode: DataMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(
    new CustomEvent("tradeButlerDataModeChanged", {
      detail: { mode },
    })
  );
}

export function subscribeToDataMode(
  callback: (mode: DataMode) => void
): () => void {
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ mode?: DataMode }>;
    if (custom.detail?.mode) {
      callback(custom.detail.mode);
    }
  };
  window.addEventListener("tradeButlerDataModeChanged", handler as EventListener);
  return () => {
    window.removeEventListener(
      "tradeButlerDataModeChanged",
      handler as EventListener
    );
  };
}

