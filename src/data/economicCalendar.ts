/**
 * Economic Calendar Data
 * 
 * This file contains known dates for major economic events.
 * These dates are used to populate the calendar with economic events
 * that are not specific to any particular stock symbol.
 * 
 * The primary data source is the Rust backend (get_economic_calendar command),
 * but this file serves as a reference for the data structure and known dates.
 */

export interface EconomicEvent {
  date: string;           // YYYY-MM-DD format
  eventType: string;      // fomc, cpi, gdp, jobs, ppi, retail_sales, etc.
  title: string;
  description?: string;
  importance: "high" | "medium" | "low";
}

// FOMC Meeting Dates (Federal Reserve interest rate decisions)
// These are typically 2-day meetings ending on Wednesday
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

export const FOMC_DATES_2025: EconomicEvent[] = [
  { date: "2025-01-29", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-03-19", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-05-07", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-06-18", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-07-30", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-09-17", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-11-05", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2025-12-17", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
];

export const FOMC_DATES_2026: EconomicEvent[] = [
  { date: "2026-01-28", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-03-18", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-05-06", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-06-17", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-07-29", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-09-16", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-11-04", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
  { date: "2026-12-16", eventType: "fomc", title: "FOMC Meeting", description: "Federal Reserve interest rate decision", importance: "high" },
];

// Economic event type definitions
export const ECONOMIC_EVENT_TYPES = {
  fomc: {
    label: "FOMC Meeting",
    shortLabel: "FOMC",
    description: "Federal Reserve interest rate decision and policy statement",
    importance: "high" as const,
    color: "#EF4444", // Red
  },
  cpi: {
    label: "CPI Report",
    shortLabel: "CPI",
    description: "Consumer Price Index - measures inflation",
    importance: "high" as const,
    color: "#F97316", // Orange
  },
  ppi: {
    label: "PPI Report",
    shortLabel: "PPI",
    description: "Producer Price Index - wholesale inflation",
    importance: "medium" as const,
    color: "#EC4899", // Pink
  },
  gdp: {
    label: "GDP Report",
    shortLabel: "GDP",
    description: "Gross Domestic Product growth rate",
    importance: "high" as const,
    color: "#3B82F6", // Blue
  },
  jobs: {
    label: "Jobs Report (NFP)",
    shortLabel: "NFP",
    description: "Non-Farm Payrolls - employment situation",
    importance: "high" as const,
    color: "#6366F1", // Indigo
  },
  retail_sales: {
    label: "Retail Sales",
    shortLabel: "RET",
    description: "Monthly retail sales data",
    importance: "medium" as const,
    color: "#14B8A6", // Teal
  },
  consumer_confidence: {
    label: "Consumer Confidence",
    shortLabel: "CC",
    description: "Consumer Confidence Index",
    importance: "medium" as const,
    color: "#8B5CF6", // Purple
  },
  ism_manufacturing: {
    label: "ISM Manufacturing",
    shortLabel: "ISM",
    description: "Institute for Supply Management Manufacturing Index",
    importance: "medium" as const,
    color: "#0EA5E9", // Sky blue
  },
  unemployment_claims: {
    label: "Unemployment Claims",
    shortLabel: "UE",
    description: "Weekly Initial Jobless Claims",
    importance: "low" as const,
    color: "#64748B", // Slate
  },
};

// Helper to get event color
export function getEconomicEventColor(eventType: string): string {
  const event = ECONOMIC_EVENT_TYPES[eventType as keyof typeof ECONOMIC_EVENT_TYPES];
  return event?.color || "#9CA3AF";
}

// Helper to get event short label
export function getEconomicEventShortLabel(eventType: string): string {
  const event = ECONOMIC_EVENT_TYPES[eventType as keyof typeof ECONOMIC_EVENT_TYPES];
  return event?.shortLabel || eventType.toUpperCase();
}

// Helper to get event full label
export function getEconomicEventLabel(eventType: string): string {
  const event = ECONOMIC_EVENT_TYPES[eventType as keyof typeof ECONOMIC_EVENT_TYPES];
  return event?.label || eventType;
}

// Get all FOMC dates for a given year
export function getFOMCDatesForYear(year: number): EconomicEvent[] {
  if (year === 2025) return FOMC_DATES_2025;
  if (year === 2026) return FOMC_DATES_2026;
  return [];
}

// Get all economic events for a date range
export function getEconomicEventsForRange(startDate: Date, endDate: Date): EconomicEvent[] {
  const events: EconomicEvent[] = [];
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  
  // Add FOMC dates
  for (let year = startYear; year <= endYear; year++) {
    const fomcDates = getFOMCDatesForYear(year);
    events.push(...fomcDates);
  }
  
  // Filter to date range
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  
  return events.filter(e => e.date >= startStr && e.date <= endStr);
}
