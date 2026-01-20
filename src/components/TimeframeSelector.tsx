import { useState, useEffect, useRef } from "react";
import { Calendar } from "lucide-react";

export type Timeframe = "all" | "7d" | "30d" | "90d" | "180d" | "1y" | "ytd" | "custom";

export interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDatesChange?: (start: string, end: string) => void;
}

function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const parseDateValue = (val: string): { year: string; month: string; day: string } => {
    if (!val) return { year: "", month: "", day: "" };
    
    // Parse date string (format: YYYY-MM-DD)
    // Handle both ISO format and simple date format
    let date: Date;
    if (val.includes('T') || val.includes('Z')) {
      // ISO format with time
      date = new Date(val);
    } else {
      // Simple date format YYYY-MM-DD - parse in local timezone
      const parts = val.split('-').map(Number);
      if (parts.length === 3) {
        date = new Date(parts[0], parts[1] - 1, parts[2]);
      } else {
        date = new Date(val);
      }
    }
    
    if (!isNaN(date.getTime())) {
      return {
        year: date.getFullYear().toString(),
        month: (date.getMonth() + 1).toString().padStart(2, "0"),
        day: date.getDate().toString().padStart(2, "0"),
      };
    }
    return { year: "", month: "", day: "" };
  };
  
  const initialDate = parseDateValue(value);
  const [year, setYear] = useState<string>(initialDate.year);
  const [month, setMonth] = useState<string>(initialDate.month);
  const [day, setDay] = useState<string>(initialDate.day);
  const lastGeneratedDate = useRef<string>("");

  // Parse the date value when it changes from external source (only if different from what we generated)
  useEffect(() => {
    // Skip if this value change came from our own onChange call
    if (value === lastGeneratedDate.current) {
      return;
    }
    
    if (value) {
      const parsed = parseDateValue(value);
      // Update state if different
      if (year !== parsed.year) setYear(parsed.year);
      if (month !== parsed.month) setMonth(parsed.month);
      if (day !== parsed.day) setDay(parsed.day);
    } else {
      // Clear if value is empty
      if (year || month || day) {
        setYear("");
        setMonth("");
        setDay("");
      }
    }
  }, [value]);

  // Generate date string when year, month, or day changes - confirm immediately when complete
  useEffect(() => {
    if (year && month && day) {
      const dateStr = `${year}-${month}-${day}`;
      // Parse in local timezone to validate
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      // Validate the date is correct
      if (!isNaN(date.getTime()) && 
          date.getFullYear().toString() === year &&
          (date.getMonth() + 1).toString().padStart(2, "0") === month &&
          date.getDate().toString().padStart(2, "0") === day) {
        // Always call onChange immediately when we have a valid complete date
        // The lastGeneratedDate check prevents circular updates from parent
        if (lastGeneratedDate.current !== dateStr) {
          lastGeneratedDate.current = dateStr;
          onChange(dateStr);
        }
      }
    } else if (!year && !month && !day) {
      // Only clear if value is not already empty
      if (lastGeneratedDate.current !== "") {
        lastGeneratedDate.current = "";
        onChange("");
      }
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
          const newMonth = e.target.value;
          setMonth(newMonth);
          // Reset day if it's invalid for the new month
          if (year && day) {
            const maxDays = getDaysInMonth(parseInt(newMonth), parseInt(year));
            if (parseInt(day) > maxDays) {
              setDay(maxDays.toString().padStart(2, "0"));
            }
          }
          // Confirm immediately if we have all three fields
          if (newMonth && year && day) {
            const maxDays = getDaysInMonth(parseInt(newMonth), parseInt(year));
            const validDay = parseInt(day) > maxDays ? maxDays.toString().padStart(2, "0") : day;
            if (validDay !== day) {
              setDay(validDay);
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
        onChange={(e) => {
          setDay(e.target.value);
          // Confirm immediately when day is selected if we have month and year
          // The useEffect will handle the onChange call
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
          const newYear = e.target.value;
          setYear(newYear);
          // Reset day if it's invalid for the new year
          if (month && day) {
            const maxDays = getDaysInMonth(parseInt(month), parseInt(newYear));
            if (parseInt(day) > maxDays) {
              setDay(maxDays.toString().padStart(2, "0"));
            }
          }
          // Confirm immediately if we have all three fields
          // The useEffect will handle the onChange call
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
  const timeframes: { value: Timeframe; label: string }[] = [
    { value: "all", label: "All Time" },
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "90d", label: "Last 3 Months" },
    { value: "180d", label: "Last 6 Months" },
    { value: "1y", label: "Last Year" },
    { value: "ytd", label: "YTD" },
    { value: "custom", label: "Custom" },
  ];

  const handleTimeframeChange = (newValue: Timeframe) => {
    onChange(newValue);
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
                // Always call with both dates, preserving the other one
                onCustomDatesChange(date || "", customEndDate || "");
              }
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>to</span>
          <DatePicker
            value={customEndDate || ""}
            onChange={(date) => {
              if (onCustomDatesChange) {
                // Always call with both dates, preserving the other one
                onCustomDatesChange(customStartDate || "", date || "");
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
      // Parse the date strings (format: YYYY-MM-DD)
      // Create dates in local timezone to avoid UTC conversion issues
      const [startYear, startMonth, startDay] = customStart.split('-').map(Number);
      const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
      
      const [endYear, endMonth, endDay] = customEnd.split('-').map(Number);
      const endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
      
      return {
        start: startDate,
        end: endDate,
      };
    }
    return { start: null, end: null };
  }
  
  const end = new Date();
  end.setHours(23, 59, 59, 999); // End of today
  const start = new Date();
  start.setHours(0, 0, 0, 0); // Start of day
  
  switch (timeframe) {
    case "7d":
      start.setDate(end.getDate() - 6); // Include today, so 6 days ago
      break;
    case "30d":
      start.setDate(end.getDate() - 29); // Include today, so 29 days ago
      break;
    case "90d":
      start.setDate(end.getDate() - 89); // Include today, so 89 days ago
      break;
    case "180d":
      start.setDate(end.getDate() - 179); // Include today, so 179 days ago
      break;
    case "1y":
      start.setFullYear(end.getFullYear() - 1);
      start.setMonth(end.getMonth());
      start.setDate(end.getDate());
      break;
    case "ytd":
      start.setFullYear(end.getFullYear());
      start.setMonth(0);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    default:
      return { start: null, end: null };
  }
  
  return { start, end };
}

