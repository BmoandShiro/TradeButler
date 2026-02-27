import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DailyPnL {
  date: string;
  profit_loss: number;
  trade_count: number;
}

interface CalendarJournalEntry {
  id: number;
  date: string;
  title: string;
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyPnL, setDailyPnL] = useState<Record<string, DailyPnL>>({});
  const [loading, setLoading] = useState(true);
  const [journalEntriesByDate, setJournalEntriesByDate] = useState<Record<string, CalendarJournalEntry[]>>({});
  const [openJournalDate, setOpenJournalDate] = useState<string | null>(null);
  const [openJournalPage, setOpenJournalPage] = useState<number>(0);
  const navigate = useNavigate();

  useEffect(() => {
    loadCalendarData();
  }, [currentDate]);

  const loadCalendarData = async () => {
    try {
      const [pnlData, journalData] = await Promise.all([
        invoke<DailyPnL[]>("get_daily_pnl"),
        invoke<CalendarJournalEntry[]>("get_journal_entries"),
      ]);

      const pnlMap: Record<string, DailyPnL> = {};
      pnlData.forEach((day) => {
        pnlMap[day.date] = day;
      });
      setDailyPnL(pnlMap);

      const journalMap: Record<string, CalendarJournalEntry[]> = {};
      journalData.forEach((entry) => {
        if (!journalMap[entry.date]) {
          journalMap[entry.date] = [];
        }
        journalMap[entry.date].push(entry);
      });
      setJournalEntriesByDate(journalMap);
    } catch (error) {
      console.error("Error loading calendar data:", error);
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

  const getDayJournalEntries = (date: Date): CalendarJournalEntry[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return journalEntriesByDate[dateStr] || [];
  };

  const getDateKey = (date: Date): string => format(date, "yyyy-MM-dd");

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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            value={currentDate.getMonth()}
            onChange={(e) => {
              const newMonth = parseInt(e.target.value);
              setCurrentDate(new Date(currentDate.getFullYear(), newMonth, 1));
            }}
            style={{
              padding: "8px 12px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {[
              "January",
              "February",
              "March",
              "April",
              "May",
              "June",
              "July",
              "August",
              "September",
              "October",
              "November",
              "December",
            ].map((month, index) => (
              <option key={month} value={index}>
                {month}
              </option>
            ))}
          </select>
          <select
            value={currentDate.getFullYear()}
            onChange={(e) => {
              const newYear = parseInt(e.target.value);
              setCurrentDate(new Date(newYear, currentDate.getMonth(), 1));
            }}
            style={{
              padding: "8px 12px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
              outline: "none",
              minWidth: "90px",
            }}
          >
            {Array.from({ length: 30 }, (_, i) => {
              const year = new Date().getFullYear() - 10 + i;
              return (
                <option key={year} value={year}>
                  {year}
                </option>
              );
            })}
          </select>
        </div>
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
          const journalEntries = getDayJournalEntries(day);
          const isCurrentDay = isToday(day);
          const pnlColor = getDayColor(dayPnL?.profit_loss ?? null);
          const dateKey = getDateKey(day);
          const isDropdownOpen = openJournalDate === dateKey;

          return (
            <div
              key={day.toISOString()}
              style={{
                aspectRatio: "1",
                border: isCurrentDay ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "8px",
                backgroundColor: pnlColor !== "transparent" ? `${pnlColor}15` : "transparent",
                cursor: dayPnL || journalEntries.length > 0 ? "pointer" : "default",
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
              {journalEntries.length > 0 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenJournalPage(0);
                      setOpenJournalDate((prev) => (prev === dateKey ? null : dateKey));
                    }}
                    style={{
                      marginTop: "6px",
                      padding: "3px 6px",
                      fontSize: "10px",
                      borderRadius: "6px",
                      border: "1px solid var(--accent)",
                      backgroundColor: isDropdownOpen ? "var(--accent)" : "transparent",
                      color: isDropdownOpen ? "var(--bg-secondary)" : "var(--accent)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`View ${journalEntries.length} journal entr${journalEntries.length === 1 ? "y" : "ies"}`}
                  >
                    Journal entries ({journalEntries.length})
                  </button>
                  {isDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: "4px",
                        zIndex: 10,
                        minWidth: "180px",
                        maxWidth: "220px",
                        maxHeight: "180px",
                        overflowY: "auto",
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
                        padding: "8px",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "6px",
                          fontSize: "11px",
                          fontWeight: 600,
                          color: "var(--text-secondary)",
                        }}
                      >
                        <span>{format(day, "MMM d, yyyy")}</span>
                        <button
                          onClick={() => {
                            setOpenJournalPage(0);
                            setOpenJournalDate(null);
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--text-secondary)",
                            fontSize: "10px",
                            cursor: "pointer",
                          }}
                        >
                          Close
                        </button>
                      </div>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        {(() => {
                          const entriesPerPage = 10;
                          const totalPages = Math.ceil(journalEntries.length / entriesPerPage) || 1;
                          const currentPage = Math.min(openJournalPage, totalPages - 1);
                          const startIndex = currentPage * entriesPerPage;
                          const pageEntries = journalEntries.slice(startIndex, startIndex + entriesPerPage);

                          return (
                            <>
                              {pageEntries.map((entry) => (
                                <li key={entry.id}>
                                  <button
                                    onClick={() => navigate("/journal", { state: { openEntryId: entry.id } })}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      padding: 0,
                                      textAlign: "left",
                                      fontSize: "11px",
                                      color: "var(--accent)",
                                      cursor: "pointer",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      width: "100%",
                                    }}
                                    title={entry.title}
                                  >
                                    {entry.title || "Untitled entry"}
                                  </button>
                                </li>
                              ))}
                              {totalPages > 1 && (
                                <li
                                  style={{
                                    marginTop: "6px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    fontSize: "10px",
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      setOpenJournalPage((prev) => (prev > 0 ? prev - 1 : prev))
                                    }
                                    disabled={currentPage === 0}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      color: currentPage === 0 ? "var(--text-muted)" : "var(--accent)",
                                      cursor: currentPage === 0 ? "default" : "pointer",
                                      padding: 0,
                                    }}
                                  >
                                    ‹ Prev
                                  </button>
                                  <span>
                                    Page {currentPage + 1} of {totalPages}
                                  </span>
                                  <button
                                    onClick={() =>
                                      setOpenJournalPage((prev) =>
                                        prev < totalPages - 1 ? prev + 1 : prev
                                      )
                                    }
                                    disabled={currentPage >= totalPages - 1}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      color:
                                        currentPage >= totalPages - 1
                                          ? "var(--text-muted)"
                                          : "var(--accent)",
                                      cursor:
                                        currentPage >= totalPages - 1 ? "default" : "pointer",
                                      padding: 0,
                                    }}
                                  >
                                    Next ›
                                  </button>
                                </li>
                              )}
                            </>
                          );
                        })()}
                      </ul>
                    </div>
                  )}
                </>
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

