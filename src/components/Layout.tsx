import { Link, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, 
  TrendingUp, 
  Heart, 
  BarChart3,
  Calendar,
  Target,
  Upload,
  Trash2,
  TrendingDown,
  Calculator,
  DollarSign,
  FileText
} from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";
import { createPortal } from "react-dom";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isImporting, setIsImporting] = useState(false);
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const handleImportCSV = async () => {
    try {
      setIsImporting(true);
      const file = await open({
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (file && typeof file === "string") {
        const contents = await readTextFile(file);
        await invoke("import_trades_csv", { csvData: contents });
        alert("Trades imported successfully!");
        window.location.reload();
      }
    } catch (error) {
      console.error("Error importing CSV:", error);
      alert("Failed to import CSV: " + error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearAllData = () => {
    setShowClearDataModal(true);
    setDeleteConfirmText("");
  };

  const handleConfirmClearData = async () => {
    if (deleteConfirmText !== "DELETE") {
      return;
    }

    try {
      await invoke("clear_all_trades");
      setShowClearDataModal(false);
      setDeleteConfirmText("");
      alert("All trade data has been cleared successfully!");
      window.location.reload();
    } catch (error) {
      console.error("Error clearing data:", error);
      alert("Failed to clear data: " + error);
    }
  };

  const handleCancelClearData = () => {
    setShowClearDataModal(false);
    setDeleteConfirmText("");
  };

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/trades", icon: TrendingUp, label: "Trades" },
    { path: "/calendar", icon: Calendar, label: "Calendar" },
    { path: "/strategies", icon: Target, label: "Strategies" },
    { path: "/journal", icon: FileText, label: "Journal" },
    { path: "/emotions", icon: Heart, label: "Emotions" },
    { path: "/analytics", icon: BarChart3, label: "Analytics" },
    { path: "/evaluation", icon: TrendingDown, label: "Evaluation" },
    { path: "/average-down-calculator", icon: Calculator, label: "Average Down Calculator" },
    { path: "/dividend-calculator", icon: DollarSign, label: "Dividend Calculator" },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: "240px",
          backgroundColor: "var(--bg-secondary)",
          borderRight: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
        }}
      >
        <div style={{ padding: "0 20px 20px" }}>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              marginBottom: "10px",
              color: "var(--accent)",
            }}
          >
            TradeButler
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={handleImportCSV}
              disabled={isImporting}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                opacity: isImporting ? 0.6 : 1,
              }}
            >
              <Upload size={16} />
              {isImporting ? "Importing..." : "Import CSV"}
            </button>
            <button
              onClick={handleClearAllData}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--loss)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              <Trash2 size={16} />
              Clear All Data
            </button>
          </div>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 20px",
                  color: isActive ? "var(--accent)" : "var(--text-secondary)",
                  backgroundColor: isActive ? "var(--bg-tertiary)" : "transparent",
                  textDecoration: "none",
                  borderLeft: isActive ? "3px solid var(--accent)" : "3px solid transparent",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                <Icon size={20} />
                <span style={{ fontSize: "14px", fontWeight: isActive ? "500" : "400" }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer in Sidebar */}
        <div
          style={{
            padding: "20px",
            borderTop: "1px solid var(--border-color)",
            marginTop: "auto",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              textAlign: "center",
              lineHeight: "1.4",
            }}
          >
            v1.0.0.0-alpha Created By:
            <br />
            @BMOandShiro @PlaneStation
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          overflow: "hidden",
          backgroundColor: "var(--bg-primary)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </main>

      {/* Clear Data Confirmation Modal */}
      {showClearDataModal && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={handleCancelClearData}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "500px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: "20px",
                fontWeight: "600",
                marginBottom: "12px",
                color: "var(--danger)",
              }}
            >
              ⚠️ Delete All Trade Data
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "16px",
                lineHeight: "1.5",
              }}
            >
              This action will <strong>permanently delete ALL trade data</strong> from your database.
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
              }}
            >
              This cannot be undone. Type <strong style={{ color: "var(--danger)" }}>DELETE</strong> in the box below to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--bg-primary)",
                border: `1px solid ${deleteConfirmText === "DELETE" ? "var(--danger)" : "var(--border-color)"}`,
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "14px",
                marginBottom: "20px",
                outline: "none",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && deleteConfirmText === "DELETE") {
                  handleConfirmClearData();
                } else if (e.key === "Escape") {
                  handleCancelClearData();
                }
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleCancelClearData}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClearData}
                disabled={deleteConfirmText !== "DELETE"}
                style={{
                  background: deleteConfirmText === "DELETE" ? "var(--danger)" : "var(--bg-tertiary)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: deleteConfirmText === "DELETE" ? "pointer" : "not-allowed",
                  fontSize: "14px",
                  fontWeight: "500",
                  opacity: deleteConfirmText === "DELETE" ? 1 : 0.5,
                }}
              >
                Delete All Data
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

