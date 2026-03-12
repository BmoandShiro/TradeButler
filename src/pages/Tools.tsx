import { useSearchParams } from "react-router-dom";
import { Calculator, DollarSign, BarChart3 } from "lucide-react";
import AverageDownCalculator from "./AverageDownCalculator";
import DividendCalculator from "./DividendCalculator";
import BasicFinancials from "./BasicFinancials";

type ToolTab = "average-down" | "dividend" | "basic-financials";

export default function Tools() {
  const [searchParams, setSearchParams] = useSearchParams();
  const calc = (searchParams.get("calc") || "average-down") as ToolTab;
  const validCalc = ["average-down", "dividend", "basic-financials"].includes(calc) ? calc : "average-down";

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
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {validCalc === "average-down" && <AverageDownCalculator />}
        {validCalc === "dividend" && <DividendCalculator />}
        {validCalc === "basic-financials" && <BasicFinancials />}
      </div>
    </div>
  );
}
