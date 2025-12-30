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
  TrendingDown
} from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { readTextFile } from "@tauri-apps/api/fs";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isImporting, setIsImporting] = useState(false);

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

  const handleClearAllData = async () => {
    const confirmed = window.confirm(
      "⚠️ WARNING: This will delete ALL trade data!\n\n" +
      "This action cannot be undone. Are you sure you want to continue?\n\n" +
      "Click OK to delete all trades, or Cancel to abort."
    );

    if (!confirmed) {
      return;
    }

    try {
      await invoke("clear_all_trades");
      alert("All trade data has been cleared successfully!");
      window.location.reload();
    } catch (error) {
      console.error("Error clearing data:", error);
      alert("Failed to clear data: " + error);
    }
  };

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/trades", icon: TrendingUp, label: "Trades" },
    { path: "/calendar", icon: Calendar, label: "Calendar" },
    { path: "/strategies", icon: Target, label: "Strategies" },
    { path: "/emotions", icon: Heart, label: "Emotions" },
    { path: "/analytics", icon: BarChart3, label: "Analytics" },
    { path: "/evaluation", icon: TrendingDown, label: "Evaluation" },
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
      </aside>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: "var(--bg-primary)",
        }}
      >
        {children}
      </main>
    </div>
  );
}

