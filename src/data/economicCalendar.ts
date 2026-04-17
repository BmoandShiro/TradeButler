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

const URL_FOMC = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const URL_BLS_CPI = "https://www.bls.gov/schedule/news_release/cpi.htm";
const URL_BLS_PPI = "https://www.bls.gov/schedule/news_release/ppi.htm";
const URL_BLS_EMPLOYMENT = "https://www.bls.gov/schedule/news_release/empsit.htm";
const URL_CENSUS_RETAIL = "https://www.census.gov/retail/marts/www/marts.html";
const URL_BEA_GDP = "https://www.bea.gov/data/gdp/gross-domestic-product";
const URL_BEA_SCHEDULE = "https://www.bea.gov/news/schedule";
const URL_CONFERENCE_BOARD = "https://www.conference-board.org/topics/us-leading-indicators";
const URL_ISM = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/";
const URL_DOL_CLAIMS = "https://www.dol.gov/agencies/eta/news/weekly-claims";
const URL_TRADING_ECONOMICS_US = "https://tradingeconomics.com/united-states/calendar";

/**
 * Best-effort link to an official schedule or a reputable macro calendar.
 * Works with static `eventType` keys and Finnhub-style titles (e.g. "CPI m/m", "Non Farm Payrolls").
 */
export function resolveEconomicEventResourceUrl(eventType: string, title: string): string {
  const typeSlug = (eventType || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const text = `${eventType} ${title}`.toLowerCase();

  if (typeSlug === "fomc" || /fomc|fed rate|interest rate decision|federal reserve statement|powell press/.test(text)) {
    return URL_FOMC;
  }
  if (
    typeSlug === "cpi" ||
    /\bcpi\b|consumer price index|core cpi|inflation rate|harmonised cpi|hicp/.test(text)
  ) {
    return URL_BLS_CPI;
  }
  if (typeSlug === "ppi" || /\bppi\b|producer price/.test(text)) {
    return URL_BLS_PPI;
  }
  if (
    typeSlug === "jobs" ||
    /non[\s-]?farm|nfp|employment situation|change in nonfarm|payrolls|average hourly earnings/.test(text)
  ) {
    return URL_BLS_EMPLOYMENT;
  }
  if (
    typeSlug === "retail_sales" ||
    /retail sales|retail ex auto|control group retail/.test(text)
  ) {
    return URL_CENSUS_RETAIL;
  }
  if (typeSlug === "gdp" || /\bgdp\b|gross domestic product/.test(text)) {
    return URL_BEA_GDP;
  }
  if (/bea|personal income|personal spending|pce|core pce/.test(text)) {
    return URL_BEA_SCHEDULE;
  }
  if (
    typeSlug === "consumer_confidence" ||
    /consumer confidence|consumer sentiment|michigan|umich|u\.?mich/.test(text)
  ) {
    return URL_CONFERENCE_BOARD;
  }
  if (
    typeSlug === "ism_manufacturing" ||
    /ism manufacturing|ism services|ism non-manufacturing|pmi manufacturing|pmi services|s&p global manufacturing pmi|s&p global services pmi/.test(
      text
    )
  ) {
    return URL_ISM;
  }
  if (
    typeSlug === "unemployment_claims" ||
    /jobless|initial claims|continuing claims|unemployment claims/.test(text)
  ) {
    return URL_DOL_CLAIMS;
  }
  if (/housing starts|building permits|new home sales/.test(text)) {
    return "https://www.census.gov/construction/nrc/index.html";
  }
  if (/durable goods orders/.test(text)) {
    return "https://www.census.gov/manufacturing/m3/adv/index.html";
  }
  if (/trade balance|goods trade balance/.test(text)) {
    return "https://www.bea.gov/data/international-transactions/international-transactions";
  }
  if (/jolts|job openings/.test(text)) {
    return "https://www.bls.gov/jlt/";
  }
  if (/adp employment|adp nonfarm/.test(text)) {
    return "https://www.adpemploymentreport.com/";
  }

  return URL_TRADING_ECONOMICS_US;
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
