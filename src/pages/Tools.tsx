import { useSearchParams } from "react-router-dom";
import { Calculator, DollarSign } from "lucide-react";
import AverageDownCalculator from "./AverageDownCalculator";
import DividendCalculator from "./DividendCalculator";

type ToolTab = "average-down" | "dividend";

export default function Tools() {
  const [searchParams, setSearchParams] = useSearchParams();
  const calc = (searchParams.get("calc") || "average-down") as ToolTab;
  const validCalc = calc === "dividend" ? "dividend" : "average-down";

  const setCalc = (value: ToolTab) => {
    setSearchParams(value === "average-down" ? {} : { calc: value });
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
      </div>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {validCalc === "average-down" ? <AverageDownCalculator /> : <DividendCalculator />}
      </div>
    </div>
  );
}
