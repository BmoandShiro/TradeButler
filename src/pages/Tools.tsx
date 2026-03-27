import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator, DollarSign, BarChart3, TrendingUp, Grid3X3, Coins } from "lucide-react";
import AverageDownCalculator from "./AverageDownCalculator";
import DividendCalculator from "./DividendCalculator";
import BasicFinancials from "./BasicFinancials";
import IpoCalendar from "./IpoCalendar";
import GridLadderTool from "./GridLadderTool";
import DividendTracker from "./DividendTracker";

type ToolTab =
  | "average-down"
  | "dividend"
  | "dividend-tracker"
  | "basic-financials"
  | "ipo-calendar"
  | "grid-ladder";
const TOOLS_LAST_CALC_KEY = "tradebutler_tools_last_calc";

export default function Tools() {
  const [searchParams, setSearchParams] = useSearchParams();
  const calcFromUrl = searchParams.get("calc");
  const calcFromStorage = !calcFromUrl
    ? localStorage.getItem(TOOLS_LAST_CALC_KEY)
    : null;
  const calc = (calcFromUrl || calcFromStorage || "average-down") as ToolTab;
  const validCalc = [
    "average-down",
    "dividend",
    "dividend-tracker",
    "basic-financials",
    "ipo-calendar",
    "grid-ladder",
  ].includes(calc)
    ? calc
    : "average-down";

  const setCalc = (value: ToolTab) => {
    // Preserve symbol parameter when switching to basic-financials
    const symbol = searchParams.get("symbol");
    if (value === "average-down") {
      setSearchParams({});
    } else if (value === "basic-financials" && symbol) {
      setSearchParams({ calc: value, symbol });
    } else {
      setSearchParams({ calc: value });
    }
  };

  useEffect(() => {
    localStorage.setItem(TOOLS_LAST_CALC_KEY, validCalc);
  }, [validCalc]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          gap: "8px",
          padding: "16px 24px 0",
          marginBottom: "8px",
          borderBottom: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        <button
          type="button"
          onClick={() => setCalc("average-down")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "average-down" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor: validCalc === "average-down" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
            color: validCalc === "average-down" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <Calculator size={18} />
          Average Down
        </button>
        <button
          type="button"
          onClick={() => setCalc("dividend")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "dividend" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor: validCalc === "dividend" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
            color: validCalc === "dividend" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <DollarSign size={18} />
          Dividend Calculator
        </button>
        <button
          type="button"
          onClick={() => setCalc("dividend-tracker")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "dividend-tracker" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor:
              validCalc === "dividend-tracker"
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "var(--bg-secondary)",
            color: validCalc === "dividend-tracker" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <Coins size={18} />
          Dividend Tracker
        </button>
        <button
          type="button"
          onClick={() => setCalc("basic-financials")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "basic-financials" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor: validCalc === "basic-financials" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
            color: validCalc === "basic-financials" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <BarChart3 size={18} />
          Basic Financials
        </button>
        <button
          type="button"
          onClick={() => setCalc("ipo-calendar")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "ipo-calendar" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor: validCalc === "ipo-calendar" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--bg-secondary)",
            color: validCalc === "ipo-calendar" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <TrendingUp size={18} />
          IPO Calendar
        </button>
        <button
          type="button"
          onClick={() => setCalc("grid-ladder")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: validCalc === "grid-ladder" ? "1px solid var(--accent)" : "1px solid var(--border-color)",
            backgroundColor:
              validCalc === "grid-ladder"
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "var(--bg-secondary)",
            color: validCalc === "grid-ladder" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <Grid3X3 size={18} />
          Grid Ladder
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {validCalc === "average-down" && <AverageDownCalculator />}
        {validCalc === "dividend" && <DividendCalculator />}
        {validCalc === "dividend-tracker" && <DividendTracker />}
        {validCalc === "basic-financials" && <BasicFinancials />}
        {validCalc === "ipo-calendar" && <IpoCalendar />}
        {validCalc === "grid-ladder" && <GridLadderTool />}
      </div>
    </div>
  );
}
