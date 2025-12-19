import { useState, useEffect } from "react";
import { Calendar } from "lucide-react";

export type Timeframe = "all" | "7d" | "30d" | "90d" | "180d" | "1y" | "custom";

export interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDatesChange?: (start: string, end: string) => void;
}

function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [year, setYear] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState<string>("");

  // Parse the date value when it changes
  useEffect(() => {
    if (value) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        setYear(date.getFullYear().toString());
        setMonth((date.getMonth() + 1).toString().padStart(2, "0"));
        setDay(date.getDate().toString().padStart(2, "0"));
      }
    } else {
      setYear("");
      setMonth("");
      setDay("");
    }
  }, [value]);

  // Generate date string when year, month, or day changes
  useEffect(() => {
    if (year && month && day) {
      const dateStr = `${year}-${month}-${day}`;
      const date = new Date(dateStr);
      if (!isNaN(date.getTime()) && date.getFullYear().toString() === year) {
        onChange(dateStr);
      }
    } else if (!year && !month && !day) {
      onChange("");
    }
  }, [year, month, day, onChange]);

  // Generate year options (last 20 years to next 5 years)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 26 }, (_, i) => currentYear - 20 + i);

  // Generate month options
  const months = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, "0"));

  // Generate day options based on month and year
  const getDaysInMonth = (monthNum: number, yearNum: number) => {
    return new Date(yearNum, monthNum, 0).getDate();
  };

  const days = year && month
    ? Array.from(
        { length: getDaysInMonth(parseInt(month), parseInt(year)) },
        (_, i) => (i + 1).toString().padStart(2, "0")
      )
    : Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, "0"));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "6px 10px",
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "4px",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <select
        value={month}
        onChange={(e) => {
          setMonth(e.target.value);
          // Reset day if it's invalid for the new month
          if (year && day) {
            const maxDays = getDaysInMonth(parseInt(e.target.value), parseInt(year));
            if (parseInt(day) > maxDays) {
              setDay(maxDays.toString().padStart(2, "0"));
            }
          }
        }}
        style={{
          padding: "4px 6px",
          backgroundColor: "var(--bg-tertiary)",
          border: "none",
          borderRadius: "3px",
          color: "var(--text-primary)",
          fontSize: "13px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">MM</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <span style={{ color: "var(--text-secondary)" }}>/</span>
      <select
        value={day}
        onChange={(e) => setDay(e.target.value)}
        style={{
          padding: "4px 6px",
          backgroundColor: "var(--bg-tertiary)",
          border: "none",
          borderRadius: "3px",
          color: "var(--text-primary)",
          fontSize: "13px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">DD</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <span style={{ color: "var(--text-secondary)" }}>/</span>
      <select
        value={year}
        onChange={(e) => {
          setYear(e.target.value);
          // Reset day if it's invalid for the new year
          if (month && day) {
            const maxDays = getDaysInMonth(parseInt(month), parseInt(e.target.value));
            if (parseInt(day) > maxDays) {
              setDay(maxDays.toString().padStart(2, "0"));
            }
          }
        }}
        style={{
          padding: "4px 6px",
          backgroundColor: "var(--bg-tertiary)",
          border: "none",
          borderRadius: "3px",
          color: "var(--text-primary)",
          fontSize: "13px",
          cursor: "pointer",
          outline: "none",
          minWidth: "70px",
        }}
      >
        <option value="">YYYY</option>
        {years.map((y) => (
          <option key={y} value={y.toString()}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
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
          <DatePicker
            value={customStartDate || ""}
            onChange={(date) => {
              if (onCustomDatesChange) {
                onCustomDatesChange(date, customEndDate || "");
              }
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>to</span>
          <DatePicker
            value={customEndDate || ""}
            onChange={(date) => {
              if (onCustomDatesChange) {
                onCustomDatesChange(customStartDate || "", date);
              }
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

