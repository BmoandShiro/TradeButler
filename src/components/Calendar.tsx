import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DailyPnL {
  date: string;
  profit_loss: number;
  trade_count: number;
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyPnL, setDailyPnL] = useState<Record<string, DailyPnL>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDailyPnL();
  }, [currentDate]);

  const loadDailyPnL = async () => {
    try {
      const data = await invoke<DailyPnL[]>("get_daily_pnl");
      const pnlMap: Record<string, DailyPnL> = {};
      data.forEach((day) => {
        pnlMap[day.date] = day;
      });
      setDailyPnL(pnlMap);
    } catch (error) {
      console.error("Error loading daily P&L:", error);
    } finally {
      setLoading(false);
    }
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get first day of week for the month start
  const firstDayOfWeek = monthStart.getDay();
  const emptyDays = Array(firstDayOfWeek).fill(null);

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const getDayPnL = (date: Date): DailyPnL | null => {
    const dateStr = format(date, "yyyy-MM-dd");
    return dailyPnL[dateStr] || null;
  };

  const getDayColor = (pnl: number | null): string => {
    if (pnl === null) return "transparent";
    if (pnl > 0) return "var(--profit)";
    if (pnl < 0) return "var(--loss)";
    return "var(--border-color)";
  };

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <p>Loading calendar...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={previousMonth}
          style={{
            background: "transparent",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "8px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <h2 style={{ fontSize: "20px", fontWeight: "600" }}>
          {format(currentDate, "MMMM yyyy")}
        </h2>
        <button
          onClick={nextMonth}
          style={{
            background: "transparent",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "8px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
        {weekDays.map((day) => (
          <div
            key={day}
            style={{
              textAlign: "center",
              padding: "8px",
              fontSize: "12px",
              fontWeight: "600",
              color: "var(--text-secondary)",
            }}
          >
            {day}
          </div>
        ))}

        {emptyDays.map((_, index) => (
          <div key={`empty-${index}`} />
        ))}

        {daysInMonth.map((day) => {
          const dayPnL = getDayPnL(day);
          const isCurrentDay = isToday(day);
          const pnlColor = getDayColor(dayPnL?.profit_loss ?? null);

          return (
            <div
              key={day.toISOString()}
              style={{
                aspectRatio: "1",
                border: isCurrentDay ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "8px",
                backgroundColor: pnlColor !== "transparent" ? `${pnlColor}15` : "transparent",
                cursor: dayPnL ? "pointer" : "default",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={
                dayPnL
                  ? `${format(day, "MMM d, yyyy")}\nP&L: $${dayPnL.profit_loss.toFixed(2)}\nTrades: ${dayPnL.trade_count}`
                  : format(day, "MMM d, yyyy")
              }
            >
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: isCurrentDay ? "700" : "500",
                  color: isCurrentDay ? "var(--accent)" : "var(--text-primary)",
                  marginBottom: "4px",
                }}
              >
                {format(day, "d")}
              </span>
              {dayPnL && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    color: dayPnL.profit_loss >= 0 ? "var(--profit)" : "var(--loss)",
                  }}
                >
                  {dayPnL.profit_loss >= 0 ? "+" : ""}
                  ${Math.abs(dayPnL.profit_loss).toFixed(0)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: "20px",
          marginTop: "20px",
          paddingTop: "20px",
          borderTop: "1px solid var(--border-color)",
          fontSize: "12px",
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "3px",
              backgroundColor: "var(--profit)",
              opacity: 0.2,
            }}
          />
          <span>Profit Day</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "3px",
              backgroundColor: "var(--loss)",
              opacity: 0.2,
            }}
          />
          <span>Loss Day</span>
        </div>
      </div>
    </div>
  );
}

