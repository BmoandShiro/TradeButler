import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";

interface ViewFinancialsButtonProps {
  symbol: string;
  size?: number;
  showLabel?: boolean;
}

export default function ViewFinancialsButton({ symbol, size = 14, showLabel = false }: ViewFinancialsButtonProps) {
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigate(`/tools?calc=basic-financials&symbol=${encodeURIComponent(symbol.toUpperCase())}`);
  };

  return (
    <button
      onClick={handleClick}
      title={`View financials for ${symbol}`}
      style={{
        background: "none",
        border: "none",
        padding: showLabel ? "4px 8px" : "4px",
        cursor: "pointer",
        color: "var(--text-secondary)",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        borderRadius: "4px",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--accent)";
        e.currentTarget.style.backgroundColor = "rgba(var(--accent-rgb), 0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <BarChart3 size={size} />
      {showLabel && <span style={{ fontSize: "12px" }}>Financials</span>}
    </button>
  );
}
