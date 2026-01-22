import { Link, useLocation } from "react-router-dom";
import { 
  LayoutDashboard, 
  TrendingUp, 
  Heart, 
  BarChart3,
  Calendar,
  Target,
  Upload,
  Download,
  Trash2,
  TrendingDown,
  Calculator,
  DollarSign,
  FileText,
  Settings
} from "lucide-react";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open, save } from "@tauri-apps/api/dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";
import { createPortal } from "react-dom";
import appIcon from "../assets/app-icon.png";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const mainContentRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const previousPathRef = useRef<string>(location.pathname);
  
  // Initialize: Load saved scroll positions from localStorage
  useEffect(() => {
    // Load all saved scroll positions on mount
    const paths = ["/", "/trades", "/calendar", "/strategies", "/journal", "/emotions", "/analytics", "/evaluation", "/average-down-calculator", "/dividend-calculator", "/settings"];
    paths.forEach(path => {
      const saved = localStorage.getItem(`scroll_${path}`);
      if (saved) {
        const position = parseInt(saved, 10);
        if (!isNaN(position) && position > 0) {
          scrollPositions.current.set(path, position);
        }
      }
    });
  }, []);

  const handleImport = async () => {
    try {
      setIsImporting(true);
      const file = await open({
        filters: [
          { name: "All Supported", extensions: ["csv", "json"] },
          { name: "CSV", extensions: ["csv"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });

      if (file && typeof file === "string") {
        const contents = await readTextFile(file);
        
        // Check if it's JSON (export file) or CSV
        if (file.toLowerCase().endsWith(".json")) {
          const result = await invoke<{
            trades_imported: number;
            trades_skipped: number;
            strategies_imported: number;
            strategies_skipped: number;
            journal_entries_imported: number;
            journal_entries_skipped: number;
            // ... other fields
          }>("import_data", { jsonData: contents });
          
          const summary = [
            `Trades: ${result.trades_imported} imported, ${result.trades_skipped} skipped`,
            `Strategies: ${result.strategies_imported} imported, ${result.strategies_skipped} skipped`,
            `Journal Entries: ${result.journal_entries_imported} imported, ${result.journal_entries_skipped} skipped`,
          ].join("\n");
          
          alert(`Data imported successfully!\n\n${summary}`);
        } else {
          // CSV import
          await invoke("import_trades_csv", { csvData: contents });
          alert("Trades imported successfully!");
        }
        window.location.reload();
      }
    } catch (error) {
      console.error("Error importing:", error);
      alert("Failed to import: " + error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const filePath = await save({
        filters: [
          { name: "JSON", extensions: ["json"] },
        ],
        defaultPath: `TradeButler-Export-${new Date().toISOString().split('T')[0]}.json`,
      });

      if (filePath && typeof filePath === "string") {
        const jsonData = await invoke<string>("export_data");
        await writeTextFile(filePath, jsonData);
        alert("Data exported successfully!");
      }
    } catch (error) {
      console.error("Error exporting:", error);
      alert("Failed to export: " + error);
    } finally {
      setIsExporting(false);
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

  // Save scroll position for current route
  const saveScrollPosition = () => {
    if (mainContentRef.current) {
      const path = location.pathname;
      const scrollTop = mainContentRef.current.scrollTop;
      // Always save, even if 0, so we can restore to top if needed
      scrollPositions.current.set(path, scrollTop);
      localStorage.setItem(`scroll_${path}`, scrollTop.toString());
    }
  };


  // Save scroll position when route changes
  useEffect(() => {
    // Save the previous route's scroll position (from cleanup of previous effect)
    const currentPath = location.pathname;

    return () => {
      // Save current route's scroll position before switching away
      const pathToSave = previousPathRef.current;
      if (mainContentRef.current && pathToSave) {
        const scrollTop = mainContentRef.current.scrollTop;
        scrollPositions.current.set(pathToSave, scrollTop);
        localStorage.setItem(`scroll_${pathToSave}`, scrollTop.toString());
      }
      // Update ref for next time
      previousPathRef.current = currentPath;
    };
  }, [location.pathname]);

  // Restore scroll position after route change and DOM update
  // Using useLayoutEffect ensures this runs synchronously before paint
  useLayoutEffect(() => {
    if (!mainContentRef.current) return;
    
    const path = location.pathname;
    const saved = localStorage.getItem(`scroll_${path}`);
    if (!saved) return;
    
    const position = parseInt(saved, 10);
    if (isNaN(position) || position < 0) return;
    
    const container = mainContentRef.current;
    
    // Function to actually restore the scroll
    const doRestore = () => {
      if (!container) return false;
      
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      
      // If we have scrollable content, restore the position
      if (scrollHeight > clientHeight || position === 0) {
        const maxScroll = Math.max(0, scrollHeight - clientHeight);
        const targetScroll = Math.min(position, maxScroll);
        
        // Only restore if we're not already at the target position
        if (Math.abs(container.scrollTop - targetScroll) > 1) {
          container.scrollTop = targetScroll;
        }
        return true; // Successfully restored
      }
      return false; // Content not ready yet
    };
    
    // Try immediately
    if (doRestore()) return;
    
    // Use MutationObserver to detect when content is actually loaded
    const observer = new MutationObserver(() => {
      if (doRestore()) {
        observer.disconnect();
      }
    });
    
    // Start observing
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    
    // Disconnect after 3 seconds if content never loads
    const timeout = setTimeout(() => {
      observer.disconnect();
    }, 3000);
    
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [location.pathname]);

  // Save scroll position on scroll
  useEffect(() => {
    const container = mainContentRef.current;
    if (!container) return;

    const handleScroll = () => {
      saveScrollPosition();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [location.pathname]);

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
    { path: "/settings", icon: Settings, label: "Settings" },
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "10px",
            }}
          >
            <img
              src={appIcon}
              alt="TradeButler"
              style={{
                width: "56px",
                height: "56px",
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
            <h1
              style={{
                fontSize: "24px",
                fontWeight: "bold",
                color: "var(--accent)",
                margin: 0,
              }}
            >
              TradeButler
            </h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              onClick={handleImport}
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
              {isImporting ? "Importing..." : "Import"}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--accent)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: "500",
                opacity: isExporting ? 0.6 : 1,
              }}
            >
              <Download size={16} />
              {isExporting ? "Exporting..." : "Export"}
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
        ref={mainContentRef}
        style={{
          flex: 1,
          overflow: "auto",
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

