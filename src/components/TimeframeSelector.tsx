import { useState } from "react";
import { Calendar } from "lucide-react";

export type Timeframe = "all" | "7d" | "30d" | "90d" | "180d" | "1y" | "custom";

export interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDatesChange?: (start: string, end: string) => void;
}

export function TimeframeSelector({
  value,
  onChange,
  customStartDate,
  customEndDate,
  onCustomDatesChange,
}: TimeframeSelectorProps) {
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const timeframes: { value: Timeframe; label: string }[] = [
    { value: "all", label: "All Time" },
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "90d", label: "Last 3 Months" },
    { value: "180d", label: "Last 6 Months" },
    { value: "1y", label: "Last Year" },
    { value: "custom", label: "Custom" },
  ];

  const handleTimeframeChange = (newValue: Timeframe) => {
    onChange(newValue);
    if (newValue === "custom") {
      setShowCustomPicker(true);
    } else {
      setShowCustomPicker(false);
    }
  };

  const getDateRange = (timeframe: Timeframe): { start: Date; end: Date } | null => {
    if (timeframe === "all") return null;
    
    const end = new Date();
    const start = new Date();
    
    switch (timeframe) {
      case "7d":
        start.setDate(end.getDate() - 7);
        break;
      case "30d":
        start.setDate(end.getDate() - 30);
        break;
      case "90d":
        start.setDate(end.getDate() - 90);
        break;
      case "180d":
        start.setDate(end.getDate() - 180);
        break;
      case "1y":
        start.setFullYear(end.getFullYear() - 1);
        break;
      default:
        return null;
    }
    
    return { start, end };
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0" }}>
      <Calendar size={16} color="var(--text-secondary)" />
      <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Timeframe:</span>
      <div
        style={{
          display: "flex",
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: "6px",
          padding: "2px",
          border: "1px solid var(--border-color)",
        }}
      >
        {timeframes.map((tf) => (
          <button
            key={tf.value}
            onClick={() => handleTimeframeChange(tf.value)}
            style={{
              padding: "6px 12px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
              border: "none",
              backgroundColor: value === tf.value ? "var(--accent)" : "transparent",
              color: value === tf.value ? "white" : "var(--text-primary)",
              transition: "all 0.2s",
            }}
          >
            {tf.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="date"
            value={customStartDate || ""}
            onChange={(e) => {
              if (onCustomDatesChange) {
                onCustomDatesChange(e.target.value, customEndDate || "");
              }
            }}
            onFocus={(e) => {
              e.stopPropagation();
              e.currentTarget.select();
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{
              padding: "6px 10px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              fontSize: "13px",
              cursor: "text",
              outline: "none",
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>to</span>
          <input
            type="date"
            value={customEndDate || ""}
            onChange={(e) => {
              if (onCustomDatesChange) {
                onCustomDatesChange(customStartDate || "", e.target.value);
              }
            }}
            onFocus={(e) => {
              e.stopPropagation();
              e.currentTarget.select();
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{
              padding: "6px 10px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              fontSize: "13px",
              cursor: "text",
              outline: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function getTimeframeDates(timeframe: Timeframe, customStart?: string, customEnd?: string): { start: Date | null; end: Date | null } {
  if (timeframe === "all") {
    return { start: null, end: null };
  }
  
  if (timeframe === "custom") {
    if (customStart && customEnd) {
      return {
        start: new Date(customStart),
        end: new Date(customEnd),
      };
    }
    return { start: null, end: null };
  }
  
  const end = new Date();
  const start = new Date();
  
  switch (timeframe) {
    case "7d":
      start.setDate(end.getDate() - 7);
      break;
    case "30d":
      start.setDate(end.getDate() - 30);
      break;
    case "90d":
      start.setDate(end.getDate() - 90);
      break;
    case "180d":
      start.setDate(end.getDate() - 180);
      break;
    case "1y":
      start.setFullYear(end.getFullYear() - 1);
      break;
    default:
      return { start: null, end: null };
  }
  
  return { start, end };
}

