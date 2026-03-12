import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { format, addMonths, startOfMonth, endOfMonth } from "date-fns";
import {
  RefreshCw,
  AlertCircle,
  Calendar,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Building2,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { getFinnhubApiKey, hasFinnhubApiKey } from "../utils/finnhubManager";

interface IpoEvent {
  symbol: string | null;
  name: string | null;
  date: string | null;
  exchange: string | null;
  price: string | null;
  shares: number | null;
  status: string | null;
}

export default function IpoCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [ipos, setIpos] = useState<IpoEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasApiKey = hasFinnhubApiKey();

  const fetchIpos = useCallback(async () => {
    const apiKey = getFinnhubApiKey();
    if (!apiKey) {
      setError("Please configure your Finnhub API key in Settings");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const fromDate = format(monthStart, "yyyy-MM-dd");
      const toDate = format(monthEnd, "yyyy-MM-dd");

      const data = await invoke<IpoEvent[]>("fetch_finnhub_ipo_calendar", {
        apiKey,
        fromDate,
        toDate,
      });

      // Sort by date
      const sorted = data.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });

      setIpos(sorted);
    } catch (e) {
      console.error("Failed to fetch IPO calendar:", e);
      setError(typeof e === "string" ? e : "Failed to fetch IPO data");
    } finally {
      setIsLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    if (hasApiKey) {
      fetchIpos();
    }
  }, [fetchIpos, hasApiKey]);

  const goToPreviousMonth = () => {
    setCurrentDate(addMonths(currentDate, -1));
  };

  const goToNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const getStatusColor = (status: string | null): string => {
    if (!status) return "var(--text-secondary)";
    const s = status.toLowerCase();
    if (s === "priced" || s === "expected") return "#10B981";
    if (s === "filed" || s === "pending") return "#F59E0B";
    if (s === "withdrawn") return "#EF4444";
    return "var(--text-secondary)";
  };

  const formatShares = (shares: number | null): string => {
    if (!shares) return "—";
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(1)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(0)}K`;
    return shares.toString();
  };

  if (!hasApiKey) {
    return (
      <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
            border: "1px solid var(--border-color)",
          }}
        >
          <AlertCircle size={48} color="var(--text-secondary)" style={{ marginBottom: "16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "8px" }}>
            Finnhub API Key Required
          </h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "24px" }}>
            To view IPO Calendar, you need to configure a Finnhub API key. It's free to sign up!
          </p>
          <a
            href="https://finnhub.io/register"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 20px",
              borderRadius: "8px",
              backgroundColor: "var(--accent)",
              color: "white",
              textDecoration: "none",
              fontSize: "14px",
              fontWeight: "500",
            }}
          >
            <ExternalLink size={16} />
            Get Free API Key
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "12px" }}>
          <TrendingUp size={28} />
          IPO Calendar
        </h1>
        <button
          onClick={fetchIpos}
          disabled={isLoading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-primary)",
            fontSize: "14px",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={16} className={isLoading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Month Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <button
          onClick={goToPreviousMonth}
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <h2 style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)", minWidth: "200px", textAlign: "center" }}>
          {format(currentDate, "MMMM yyyy")}
        </h2>
        <button
          onClick={goToNextMonth}
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#EF4444",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* IPO List */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          <RefreshCw size={32} className="spin" style={{ marginBottom: "16px" }} />
          <p>Loading IPO data...</p>
        </div>
      ) : ipos.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "var(--text-secondary)",
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
          }}
        >
          <Calendar size={48} style={{ marginBottom: "16px", opacity: 0.5 }} />
          <p style={{ fontSize: "16px" }}>No IPOs scheduled for {format(currentDate, "MMMM yyyy")}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ipos.map((ipo, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: "20px",
              }}
            >
              {/* Date */}
              <div style={{ minWidth: "80px", textAlign: "center" }}>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "2px" }}>
                  {ipo.date ? format(new Date(ipo.date), "MMM") : "—"}
                </p>
                <p style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)" }}>
                  {ipo.date ? format(new Date(ipo.date), "dd") : "—"}
                </p>
              </div>

              {/* Company Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  {ipo.symbol && (
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "4px",
                        backgroundColor: "var(--accent)",
                        color: "var(--bg-primary)",
                        fontSize: "12px",
                        fontWeight: "600",
                      }}
                    >
                      {ipo.symbol}
                    </span>
                  )}
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "4px",
                      backgroundColor: `color-mix(in srgb, ${getStatusColor(ipo.status)} 20%, transparent)`,
                      color: getStatusColor(ipo.status),
                      fontSize: "11px",
                      fontWeight: "600",
                      textTransform: "uppercase",
                    }}
                  >
                    {ipo.status || "Unknown"}
                  </span>
                </div>
                <p style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px" }}>
                  {ipo.name || "Unknown Company"}
                </p>
                {ipo.exchange && (
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Building2 size={12} /> {ipo.exchange}
                  </p>
                )}
              </div>

              {/* Pricing Info */}
              <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>Price Range</p>
                  <p style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <DollarSign size={14} />
                    {ipo.price || "TBD"}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>Shares</p>
                  <p style={{ fontSize: "15px", fontWeight: "600", color: "var(--text-primary)" }}>
                    {formatShares(ipo.shares)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
