import { useState, useEffect } from "react";
import { Plus, Trash2, Calculator, X, ChevronUp, ChevronDown } from "lucide-react";

interface PurchaseRow {
  id: string;
  shares: string;
  price: string;
}

const STORAGE_KEY = "tradebutler_average_down_calculator_data";
const DEFAULT_ROWS: PurchaseRow[] = [
  { id: "1", shares: "", price: "" },
  { id: "2", shares: "", price: "" },
  { id: "3", shares: "", price: "" },
  { id: "4", shares: "", price: "" },
  { id: "5", shares: "", price: "" },
];

export default function AverageDownCalculator() {
  const [rows, setRows] = useState<PurchaseRow[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure we have at least one row
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {
        // If parsing fails, use defaults
      }
    }
    return DEFAULT_ROWS;
  });

  const [averagePrice, setAveragePrice] = useState<number | null>(null);
  const [totalShares, setTotalShares] = useState<number>(0);
  const [totalCost, setTotalCost] = useState<number>(0);

  // Save to localStorage whenever rows change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  const addRow = () => {
    const newId = Date.now().toString();
    setRows([...rows, { id: newId, shares: "", price: "" }]);
  };

  const removeRow = (id: string) => {
    if (rows.length > 1) {
      setRows(rows.filter((row) => row.id !== id));
    }
  };

  const updateRow = (id: string, field: "shares" | "price", value: string) => {
    setRows(
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const incrementValue = (id: string, field: "shares" | "price", step: number = 1) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    
    const currentValue = parseFloat(row[field]) || 0;
    const newValue = (currentValue + step).toFixed(field === "price" ? 2 : 0);
    updateRow(id, field, newValue);
  };

  const decrementValue = (id: string, field: "shares" | "price", step: number = 1) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    
    const currentValue = parseFloat(row[field]) || 0;
    const newValue = Math.max(0, currentValue - step).toFixed(field === "price" ? 2 : 0);
    updateRow(id, field, newValue);
  };

  const calculateAverage = () => {
    let sharesSum = 0;
    let costSum = 0;

    rows.forEach((row) => {
      const shares = parseFloat(row.shares) || 0;
      const price = parseFloat(row.price) || 0;

      if (shares > 0 && price > 0) {
        sharesSum += shares;
        costSum += shares * price;
      }
    });

    if (sharesSum > 0) {
      const avg = costSum / sharesSum;
      setAveragePrice(avg);
      setTotalShares(sharesSum);
      setTotalCost(costSum);
    } else {
      setAveragePrice(null);
      setTotalShares(0);
      setTotalCost(0);
    }
  };

  const clearAll = () => {
    const confirmed = window.confirm(
      "Are you sure you want to clear all data? This action cannot be undone."
    );
    if (confirmed) {
      setRows(DEFAULT_ROWS);
      setAveragePrice(null);
      setTotalShares(0);
      setTotalCost(0);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <>
      <style>{`
        /* Hide default number input spinners */
        input[type="number"] {
          -moz-appearance: textfield; /* Firefox */
        }
        
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>
      <div
        style={{
          padding: "32px",
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
      <div
        style={{
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
          }}
        >
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              margin: 0,
            }}
          >
            <Calculator size={28} />
            Average Down Calculator
          </h1>
          <button
            onClick={clearAll}
            style={{
              padding: "8px 16px",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--loss)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontSize: "14px",
              fontWeight: "500",
            }}
            title="Clear all data"
          >
            <X size={16} />
            Clear
          </button>
        </div>
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-secondary)",
            lineHeight: "1.6",
            marginBottom: "8px",
          }}
        >
          <strong>Average Down Calculator</strong> - Calculate the average share price you paid for a stock position. 
          Track your cost whether you average up or average down on a position.
        </p>
      </div>

      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr 1fr auto",
            gap: "12px",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "var(--text-primary)",
            }}
          >
            #
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "var(--text-primary)",
            }}
          >
            Shares Bought
          </div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "var(--text-primary)",
            }}
          >
            Purchase Price
          </div>
          <div style={{ width: "40px" }}></div>
        </div>

        {rows.map((row, index) => (
          <div
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr 1fr auto",
              gap: "12px",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                fontWeight: "500",
              }}
            >
              {index + 1}.
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                value={row.shares}
                onChange={(e) => updateRow(row.id, "shares", e.target.value)}
                style={{
                  padding: "10px 36px 10px 12px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  width: "100%",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: "4px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <button
                  type="button"
                  onClick={() => incrementValue(row.id, "shares", 1)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  title="Increase"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => decrementValue(row.id, "shares", 1)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  title="Decrease"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <span
                style={{
                  position: "absolute",
                  left: "12px",
                  color: "var(--text-secondary)",
                  fontSize: "14px",
                  fontWeight: "500",
                  zIndex: 1,
                }}
              >
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={row.price}
                onChange={(e) => updateRow(row.id, "price", e.target.value)}
                style={{
                  padding: "10px 36px 10px 28px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  fontSize: "14px",
                  width: "100%",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: "4px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                <button
                  type="button"
                  onClick={() => incrementValue(row.id, "price", 0.01)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  title="Increase"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => decrementValue(row.id, "price", 0.01)}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: "2px",
                    cursor: "pointer",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                  title="Decrease"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
            <button
              onClick={() => removeRow(row.id)}
              disabled={rows.length === 1}
              style={{
                background: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "8px",
                cursor: rows.length === 1 ? "not-allowed" : "pointer",
                color: rows.length === 1 ? "var(--text-tertiary)" : "var(--loss)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: rows.length === 1 ? 0.5 : 1,
                width: "36px",
                height: "36px",
              }}
              title="Remove row"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <button
          onClick={addRow}
          style={{
            width: "100%",
            padding: "12px",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "14px",
            fontWeight: "500",
            marginTop: "8px",
          }}
        >
          <Plus size={16} />
          Add Row
        </button>
      </div>

      <button
        onClick={calculateAverage}
        style={{
          width: "100%",
          padding: "14px",
          backgroundColor: "var(--accent)",
          border: "none",
          borderRadius: "6px",
          color: "white",
          cursor: "pointer",
          fontSize: "16px",
          fontWeight: "600",
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
        }}
      >
        <Calculator size={18} />
        Calculate
      </button>

      {averagePrice !== null && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
          }}
        >
          <h2
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "16px",
            }}
          >
            Results
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px",
            }}
          >
            <div
              style={{
                padding: "16px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                }}
              >
                Average Price
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "var(--accent)",
                }}
              >
                ${averagePrice.toFixed(2)}
              </div>
            </div>
            <div
              style={{
                padding: "16px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                }}
              >
                Total Shares
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "var(--text-primary)",
                }}
              >
                {totalShares.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div
              style={{
                padding: "16px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                }}
              >
                Total Cost
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "var(--text-primary)",
                }}
              >
                ${totalCost.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}

