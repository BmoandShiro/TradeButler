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
  BookOpen,
  Settings,
  Lock,
  Unlock,
  Plus
} from "lucide-react";
import { format } from "date-fns";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open, save } from "@tauri-apps/api/dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";
import { createPortal } from "react-dom";
import appIcon from "../assets/app-icon.png";
import { applyTheme } from "../utils/themeManager";
import LockScreen from "./LockScreen";
import GalaxyLockScreen from "./GalaxyLockScreen";
import AuroraLockScreen from "./AuroraLockScreen";
import MilkyWayLockScreen from "./MilkyWayLockScreen";
import GalaxyBackground from "./GalaxyBackground";
import { isLocked, hasPassword, lockApp } from "../utils/passwordManager";
import { getLockScreenStyle } from "../utils/lockScreenManager";
import { getGalaxyThemeSettings } from "../utils/galaxyThemeManager";
import { applyGalaxyBackgroundStyles } from "../utils/galaxyBackgroundStyles";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showAddTradeModal, setShowAddTradeModal] = useState(false);
  const [addTradeForm, setAddTradeForm] = useState({
    symbol: "",
    side: "BUY",
    quantity: "",
    price: "",
    tradeDate: format(new Date(), "yyyy-MM-dd"),
    tradeTime: format(new Date(), "HH:mm"),
    orderType: "MARKET",
    fees: "",
    notes: "",
  });
  const [isAddingTrade, setIsAddingTrade] = useState(false);
  const [addTradeError, setAddTradeError] = useState<string | null>(null);
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isAppLocked, setIsAppLocked] = useState(() => isLocked());
  const [useGalaxyBackground, setUseGalaxyBackground] = useState(() => {
    const settings = getGalaxyThemeSettings();
    console.log("Initial galaxy background state:", settings.useAsBackground, settings);
    return settings.useAsBackground;
  });
  const [galaxyBgColor, setGalaxyBgColor] = useState(() => getGalaxyThemeSettings().backgroundColor);
  const [appVersion, setAppVersion] = useState<string>("");
  const mainContentRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const previousPathRef = useRef<string>(location.pathname);
  
  // Load app version from backend (single source: Cargo.toml)
  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  // Initialize: Load saved scroll positions from localStorage
  useEffect(() => {
    // Load all saved scroll positions on mount
    const paths = ["/", "/trades", "/calendar", "/strategies", "/journal", "/resources", "/emotions", "/analytics", "/evaluation", "/average-down-calculator", "/dividend-calculator", "/settings"];
    paths.forEach(path => {
      const saved = localStorage.getItem(`scroll_${path}`);
      if (saved) {
        const position = parseInt(saved, 10);
        if (!isNaN(position) && position > 0) {
          scrollPositions.current.set(path, position);
        }
      }
    });
    
    // Check lock state on mount
    setIsAppLocked(isLocked());
    
    // Check galaxy background setting
    const initialSettings = getGalaxyThemeSettings();
    setUseGalaxyBackground(initialSettings.useAsBackground);
    setGalaxyBgColor(initialSettings.backgroundColor);
    
    // Listen for galaxy settings changes
    const checkGalaxySettings = () => {
      const settings = getGalaxyThemeSettings();
      const newUseBackground = settings.useAsBackground;
      const newBgColor = settings.backgroundColor;
      
      console.log("checkGalaxySettings called - useAsBackground:", newUseBackground, "backgroundColor:", newBgColor);
      
      setUseGalaxyBackground((prev) => {
        if (prev !== newUseBackground) {
          console.log("Updating useGalaxyBackground from", prev, "to", newUseBackground);
          return newUseBackground;
        }
        return prev;
      });
      setGalaxyBgColor((prev) => {
        if (prev !== newBgColor) {
          return newBgColor;
        }
        return prev;
      });
    };
    
    // Check periodically to catch changes (reduced frequency to prevent performance issues)
    const interval = setInterval(checkGalaxySettings, 500); // Changed from 50ms to 500ms
    window.addEventListener("storage", checkGalaxySettings);
    
    // Also listen for custom event that Settings can dispatch
    const handleGalaxySettingsChange = (_e: Event) => {
      // Immediately check and update
      const settings = getGalaxyThemeSettings();
      const newUseBackground = settings.useAsBackground;
      const newBgColor = settings.backgroundColor;
      
      console.log("Galaxy settings changed:", { newUseBackground, newBgColor });
      
      setUseGalaxyBackground(newUseBackground);
      setGalaxyBgColor(newBgColor);
      
      // Apply styles after a brief delay to ensure DOM is ready
      if (newUseBackground) {
        setTimeout(() => {
          applyGalaxyBackgroundStyles();
          // Also force a re-render check
          setTimeout(applyGalaxyBackgroundStyles, 200);
        }, 100);
      }
    };
    window.addEventListener("galaxySettingsChanged", handleGalaxySettingsChange);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", checkGalaxySettings);
      window.removeEventListener("galaxySettingsChanged", handleGalaxySettingsChange);
    };
  }, []);

  // Debug: Log state changes
  useEffect(() => {
    console.log("useGalaxyBackground changed to:", useGalaxyBackground);
  }, [useGalaxyBackground]);

  // Apply styles to make page backgrounds transparent when galaxy background is enabled
  useEffect(() => {
    if (useGalaxyBackground) {
      // Use multiple timeouts to catch DOM updates at different stages
      const timeouts: NodeJS.Timeout[] = [];
      
      const applyStyles = () => {
        applyGalaxyBackgroundStyles();
      };
      
      // Apply immediately and at intervals
      timeouts.push(setTimeout(applyStyles, 50));
      timeouts.push(setTimeout(applyStyles, 150));
      timeouts.push(setTimeout(applyStyles, 300));
      
      // Also apply when route changes
      const applyOnRouteChange = () => {
        setTimeout(applyStyles, 100);
      };
      window.addEventListener("popstate", applyOnRouteChange);
      
      // Also listen for navigation events
      const handleLocationChange = () => {
        setTimeout(applyStyles, 100);
      };
      window.addEventListener("pushstate", handleLocationChange);
      window.addEventListener("replacestate", handleLocationChange);
      
      return () => {
        timeouts.forEach(clearTimeout);
        window.removeEventListener("popstate", applyOnRouteChange);
        window.removeEventListener("pushstate", handleLocationChange);
        window.removeEventListener("replacestate", handleLocationChange);
      };
    } else {
      // When disabled, restore page backgrounds
      const contentWrapper = document.querySelector(".galaxy-background-content");
      if (contentWrapper) {
        const pageRoots = Array.from(contentWrapper.children) as HTMLElement[];
        pageRoots.forEach((pageRoot) => {
          if (pageRoot && pageRoot.tagName === "DIV") {
            const currentStyle = pageRoot.getAttribute("style") || "";
            // Remove the transparent background override
            const newStyle = currentStyle.replace(/background-color\s*:\s*transparent\s*!important;?/gi, "");
            pageRoot.setAttribute("style", newStyle);
          }
        });
      }
    }
  }, [useGalaxyBackground, location.pathname]);

  const handleLockToggle = () => {
    if (hasPassword()) {
      lockApp();
      setIsAppLocked(true);
    } else {
      // If no password is set, navigate to settings
      window.location.href = "/settings";
    }
  };

  const handleUnlock = () => {
    setIsAppLocked(false);
  };

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
          // Parse JSON to check for theme colors
          let importData;
          try {
            importData = JSON.parse(contents);
          } catch (e) {
            throw new Error("Invalid JSON file");
          }
          
          // Extract theme colors if present
          if (importData.theme_colors) {
            try {
              localStorage.setItem("tradebutler_theme_colors", JSON.stringify(importData.theme_colors));
              // Apply the imported theme
              applyTheme(importData.theme_colors);
            } catch (e) {
              console.warn("Failed to import theme colors:", e);
            }
          }
          
          // Extract custom presets if present
          if (importData.custom_theme_presets) {
            try {
              localStorage.setItem("tradebutler_custom_theme_presets", JSON.stringify(importData.custom_theme_presets));
            } catch (e) {
              console.warn("Failed to import custom presets:", e);
            }
          }
          
          // Remove theme_colors and custom_theme_presets from import data before passing to Rust (it doesn't expect them)
          const { theme_colors, custom_theme_presets, ...dataForRust } = importData;
          const jsonDataForRust = JSON.stringify(dataForRust);
          
          const result = await invoke<{
            trades_imported: number;
            trades_skipped: number;
            strategies_imported: number;
            strategies_skipped: number;
            journal_entries_imported: number;
            journal_entries_skipped: number;
            // ... other fields
          }>("import_data", { jsonData: jsonDataForRust });
          
          const summary = [
            `Trades: ${result.trades_imported} imported, ${result.trades_skipped} skipped`,
            `Strategies: ${result.strategies_imported} imported, ${result.strategies_skipped} skipped`,
            `Journal Entries: ${result.journal_entries_imported} imported, ${result.journal_entries_skipped} skipped`,
            importData.theme_colors ? `Theme: Imported successfully` : "",
            importData.custom_theme_presets ? `Custom Presets: ${importData.custom_theme_presets.length} imported` : "",
          ].filter(Boolean).join("\n");
          
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
    console.log("handleExport called");
    try {
      setIsExporting(true);
      console.log("isExporting set to true");
      
      // First, get the export data
      console.log("Calling export_data command...");
      const jsonData = await invoke<string>("export_data");
      console.log("Export data retrieved, length:", jsonData.length);
      
      // Parse the JSON to add theme colors and custom presets
      const exportData = JSON.parse(jsonData);
      
      // Get theme colors from localStorage
      const themeColors = localStorage.getItem("tradebutler_theme_colors");
      if (themeColors) {
        try {
          exportData.theme_colors = JSON.parse(themeColors);
        } catch (e) {
          console.warn("Failed to parse theme colors:", e);
        }
      }
      
      // Get custom presets from localStorage
      const customPresets = localStorage.getItem("tradebutler_custom_theme_presets");
      if (customPresets) {
        try {
          exportData.custom_theme_presets = JSON.parse(customPresets);
        } catch (e) {
          console.warn("Failed to parse custom presets:", e);
        }
      }
      
      // Convert back to JSON string
      const finalJsonData = JSON.stringify(exportData, null, 2);
      
      // Then, ask user where to save it
      console.log("Opening save dialog...");
      const filePath = await save({
        filters: [
          { name: "JSON", extensions: ["json"] },
        ],
        defaultPath: `TradeButler-Export-${new Date().toISOString().split('T')[0]}.json`,
      });
      console.log("Save dialog returned:", filePath);

      if (filePath && typeof filePath === "string") {
        console.log("Saving to:", filePath);
        await writeTextFile(filePath, finalJsonData);
        console.log("File saved successfully");
        alert(`Data exported successfully to:\n${filePath}`);
      } else {
        console.log("Export cancelled by user or filePath is null");
        // User cancelled, don't show error
      }
    } catch (error) {
      console.error("Error exporting:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to export: ${errorMessage}\n\nCheck the console (F12) for more details.`);
    } finally {
      setIsExporting(false);
      console.log("isExporting set to false");
    }
  };

  const handleAddTradeSubmit = async () => {
    setAddTradeError(null);
    const qty = parseFloat(addTradeForm.quantity);
    const pr = parseFloat(addTradeForm.price);
    const feeVal = addTradeForm.fees.trim() === "" ? null : parseFloat(addTradeForm.fees);
    if (!addTradeForm.symbol.trim()) {
      setAddTradeError("Symbol is required.");
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setAddTradeError("Quantity must be a positive number.");
      return;
    }
    if (isNaN(pr) || pr < 0) {
      setAddTradeError("Price must be a non-negative number.");
      return;
    }
    const timestamp = `${addTradeForm.tradeDate}T${addTradeForm.tradeTime}:00Z`;
    try {
      setIsAddingTrade(true);
      await invoke<number>("add_trade_manual", {
        symbol: addTradeForm.symbol.trim(),
        side: addTradeForm.side,
        quantity: qty,
        price: pr,
        timestamp,
        order_type: addTradeForm.orderType || null,
        fees: feeVal,
        notes: addTradeForm.notes.trim() || null,
        strategy_id: null,
      });
      setShowAddTradeModal(false);
      setAddTradeForm({
        symbol: "",
        side: "BUY",
        quantity: "",
        price: "",
        tradeDate: format(new Date(), "yyyy-MM-dd"),
        tradeTime: format(new Date(), "HH:mm"),
        orderType: "MARKET",
        fees: "",
        notes: "",
      });
      window.dispatchEvent(new CustomEvent("tradeButlerTradeAdded"));
      alert("Trade added successfully.");
    } catch (err) {
      setAddTradeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAddingTrade(false);
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
    const currentPath = location.pathname;
    const previousPath = previousPathRef.current;

    // Save the previous route's scroll position
    // Try to get it from the in-memory map first (most up-to-date)
    // If not available, try to read from DOM (but it might already be the new page)
    if (previousPath && previousPath !== currentPath) {
      let scrollTop: number;
      
      // First, try to get from in-memory map (saved by scroll event handler)
      if (scrollPositions.current.has(previousPath)) {
        scrollTop = scrollPositions.current.get(previousPath)!;
      } else if (mainContentRef.current) {
        // Fallback: try to read from DOM
        scrollTop = mainContentRef.current.scrollTop;
      } else {
        // Last resort: try localStorage
        const saved = localStorage.getItem(`scroll_${previousPath}`);
        scrollTop = saved ? parseInt(saved, 10) : 0;
      }
      
      // Only save if we got a valid value and it's not 0 (unless it was intentionally saved as 0)
      // Actually, save it anyway - 0 is a valid scroll position
      scrollPositions.current.set(previousPath, scrollTop);
      localStorage.setItem(`scroll_${previousPath}`, scrollTop.toString());
    }

    // Update ref for next time
    previousPathRef.current = currentPath;
  }, [location.pathname]);

  // Restore scroll position after route change and DOM update
  // Using useLayoutEffect ensures this runs synchronously before paint
  useLayoutEffect(() => {
    if (!mainContentRef.current) return;
    
    const path = location.pathname;
    
    // Try to get from in-memory map first (most up-to-date), then localStorage
    let position: number;
    if (scrollPositions.current.has(path)) {
      position = scrollPositions.current.get(path)!;
    } else {
      const saved = localStorage.getItem(`scroll_${path}`);
      if (!saved) return;
      position = parseInt(saved, 10);
      if (isNaN(position) || position < 0) return;
    }
    
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
          // Update in-memory map after restoring
          scrollPositions.current.set(path, targetScroll);
          return true; // Successfully restored
        }
        return true; // Already at target position
      }
      return false; // Content not ready yet
    };
    
    // Try immediately
    if (doRestore()) return;
    
    // Use MutationObserver to detect when content is actually loaded
    let observer: MutationObserver | null = new MutationObserver(() => {
      if (doRestore() && observer) {
        observer.disconnect();
        observer = null;
      }
    });
    
    // Start observing
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    
    // Also try after a short delay (for cases where MutationObserver doesn't catch it)
    const timeout1 = setTimeout(() => {
      if (doRestore() && observer) {
        observer.disconnect();
        observer = null;
      }
    }, 100);
    
    // Disconnect after 3 seconds if content never loads
    const timeout2 = setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, 3000);
    
    return () => {
      if (observer) observer.disconnect();
      clearTimeout(timeout1);
      clearTimeout(timeout2);
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
    { path: "/resources", icon: BookOpen, label: "Resources" },
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
              onClick={() => { setAddTradeError(null); setShowAddTradeModal(true); }}
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
              }}
            >
              <Plus size={16} />
              Add Trade
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

        <nav style={{ flex: 1, overflowY: "auto", padding: "0" }}>
          {/* Lock Button - Above Dashboard */}
          <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--border-color)" }}>
            <button
              onClick={handleLockToggle}
              disabled={!hasPassword()}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: isAppLocked ? "var(--accent)" : "var(--bg-tertiary)",
                color: isAppLocked ? "white" : "var(--text-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                cursor: hasPassword() ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                fontSize: "13px",
                fontWeight: "500",
                opacity: hasPassword() ? 1 : 0.5,
                transition: "all 0.2s",
              }}
              title={hasPassword() ? (isAppLocked ? "App is locked" : "Lock app") : "Set a password in Settings first"}
            >
              {isAppLocked ? <Lock size={16} /> : <Unlock size={16} />}
              {isAppLocked ? "Locked" : "Lock"}
            </button>
          </div>
          
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
            {appVersion ? `v${appVersion}` : "v—"} Created By:
            <br />
            @BMOandShiro @PlaneStation
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main
        ref={mainContentRef}
        data-galaxy-background={useGalaxyBackground ? "true" : "false"}
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: useGalaxyBackground 
            ? galaxyBgColor 
            : "var(--bg-primary)",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {useGalaxyBackground && (
          <GalaxyBackground />
        )}
        <div 
          className={useGalaxyBackground ? "galaxy-background-content" : ""}
          style={{ 
            position: "relative", 
            zIndex: useGalaxyBackground ? 1 : 0, 
            flex: 1, 
            display: "flex", 
            flexDirection: "column",
            minHeight: "100%",
            backgroundColor: useGalaxyBackground ? "transparent" : undefined,
          }}
        >
          {children}
        </div>
      </main>
      
      {/* Lock Screen Overlay */}
      {isAppLocked && (
        (() => {
          const style = getLockScreenStyle();
          if (style === "galaxy") {
            return <GalaxyLockScreen onUnlock={handleUnlock} />;
          } else if (style === "aurora") {
            return <AuroraLockScreen onUnlock={handleUnlock} />;
          } else if (style === "milkyway") {
            return <MilkyWayLockScreen onUnlock={handleUnlock} />;
          } else {
            return <LockScreen onUnlock={handleUnlock} />;
          }
        })()
      )}

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

      {/* Add Trade Modal */}
      {showAddTradeModal && createPortal(
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
            zIndex: 1000,
          }}
          onClick={() => !isAddingTrade && setShowAddTradeModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "440px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "var(--text-primary)" }}>
              Add Trade
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Add a single trade manually (paper trades, commons, or options). You can assign it to a strategy later from the Trades or Strategies page.
            </p>
            {addTradeError && (
              <div style={{ marginBottom: "12px", padding: "8px 12px", background: "var(--loss)", color: "white", borderRadius: "6px", fontSize: "13px" }}>
                {addTradeError}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Symbol *</label>
                <input
                  type="text"
                  placeholder="e.g. AAPL or AAPL251219C00150000"
                  value={addTradeForm.symbol}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, symbol: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Side *</label>
                  <select
                    value={addTradeForm.side}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, side: e.target.value }))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-primary)",
                      color: addTradeForm.side === "BUY" ? "var(--profit)" : "var(--loss)",
                      fontSize: "14px",
                      fontWeight: "600",
                    }}
                  >
                    <option value="BUY" style={{ color: "var(--profit)" }}>BUY</option>
                    <option value="SELL" style={{ color: "var(--loss)" }}>SELL</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Shares or contracts"
                    value={addTradeForm.quantity}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, quantity: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Price *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={addTradeForm.price}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, price: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Fees (optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={addTradeForm.fees}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, fees: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Date *</label>
                  <input
                    type="date"
                    value={addTradeForm.tradeDate}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, tradeDate: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Time *</label>
                  <input
                    type="time"
                    value={addTradeForm.tradeTime}
                    onChange={(e) => setAddTradeForm(f => ({ ...f, tradeTime: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Order type</label>
                <select
                  value={addTradeForm.orderType}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, orderType: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="DAY">DAY</option>
                  <option value="GTC">GTC</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", color: "var(--text-secondary)", marginBottom: "4px" }}>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="Optional notes"
                  value={addTradeForm.notes}
                  onChange={(e) => setAddTradeForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "14px" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                onClick={() => !isAddingTrade && setShowAddTradeModal(false)}
                disabled={isAddingTrade}
                style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "10px 20px", color: "var(--text-primary)", cursor: isAddingTrade ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddTradeSubmit}
                disabled={isAddingTrade}
                style={{ background: "var(--accent)", border: "none", borderRadius: "6px", padding: "10px 20px", color: "white", cursor: isAddingTrade ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "500", opacity: isAddingTrade ? 0.7 : 1 }}
              >
                {isAddingTrade ? "Adding..." : "Add Trade"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

