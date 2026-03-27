import { createContext } from "react";

export type CurrentPriceSyncContextValue = { enabled: boolean; seconds: number; tick: number };

export const CurrentPriceSyncContext = createContext<CurrentPriceSyncContextValue | null>(null);
