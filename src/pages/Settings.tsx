import { useState } from "react";
import { Settings as SettingsIcon, Download, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/tauri";
import { createPortal } from "react-dom";

interface VersionInfo {
  current: string;
  latest: string;
  is_up_to_date: boolean;
  download_url?: string;
  release_notes?: string;
  is_installer: boolean;
}

export default function Settings() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const checkVersion = async () => {
    try {
      setIsChecking(true);
      setError(null);
      console.log("Starting version check...");
      const info = await invoke<VersionInfo>("check_version");
      console.log("Version check successful:", info);
      setVersionInfo(info);
      
      if (!info.is_up_to_date) {
        setShowUpdateModal(true);
      }
    } catch (err: any) {
      console.error("Version check error:", err);
      console.error("Error type:", typeof err);
      console.error("Error constructor:", err?.constructor?.name);
      
      // Handle Tauri error format
      let errorMessage = "Failed to check version";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      } else if (err?.message) {
        errorMessage = err.message;
      } else if (err?.toString) {
        errorMessage = err.toString();
      } else {
        errorMessage = JSON.stringify(err);
      }
      
      console.error("Final error message:", errorMessage);
      setError(errorMessage);
    } finally {
      setIsChecking(false);
    }
  };

  const downloadUpdate = async () => {
    if (!versionInfo?.download_url) return;

    try {
      setIsDownloading(true);
      setError(null);
      
      if (versionInfo.is_installer) {
        // For installer version, download and run the installer
        await invoke("download_and_install_update", { 
          download_url: versionInfo.download_url 
        });
        alert("Update downloaded and installer started. Please follow the installation wizard. Your data will be preserved.");
      } else {
        // For portable version, download to user's Downloads folder
        const downloadPath = await invoke<string>("download_portable_update", { 
          download_url: versionInfo.download_url 
        });
        alert(`Update downloaded to: ${downloadPath}\n\nPlease close TradeButler and replace the old executable with the new one. Your data will be preserved.`);
      }
      
      setShowUpdateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download update");
      console.error("Download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCancelUpdate = () => {
    setShowUpdateModal(false);
  };

  return (
    <div
      style={{
        padding: "24px",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
          }}
        >
          <SettingsIcon size={28} color="var(--accent)" />
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "600",
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Settings
          </h1>
        </div>

        {/* Version Checker Section */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "24px",
          }}
        >
          <h2
            style={{
              fontSize: "20px",
              fontWeight: "600",
              color: "var(--text-primary)",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <RefreshCw size={20} />
            Version Checker
          </h2>

          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              marginBottom: "20px",
              lineHeight: "1.6",
            }}
          >
            Check if you're running the latest version of TradeButler. Updates preserve all your data.
          </p>

          <button
            onClick={checkVersion}
            disabled={isChecking}
            style={{
              padding: "12px 24px",
              backgroundColor: "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isChecking ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: "500",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: isChecking ? 0.6 : 1,
            }}
          >
            {isChecking ? (
              <>
                <RefreshCw size={16} className="spinning" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Check for Updates
              </>
            )}
          </button>

          {error && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "var(--loss)",
              }}
            >
              <AlertCircle size={16} />
              <span style={{ fontSize: "14px" }}>{error}</span>
            </div>
          )}

          {versionInfo && (
            <div
                style={{
                marginTop: "20px",
                padding: "16px",
                backgroundColor: versionInfo.is_up_to_date 
                  ? "rgba(34, 197, 94, 0.1)" 
                  : "rgba(251, 191, 36, 0.1)",
                border: `1px solid ${versionInfo.is_up_to_date 
                  ? "rgba(34, 197, 94, 0.3)" 
                  : "rgba(251, 191, 36, 0.3)"}`,
                borderRadius: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "12px",
                }}
              >
                {versionInfo.is_up_to_date ? (
                  <CheckCircle size={20} color="rgb(34, 197, 94)" />
                ) : (
                  <XCircle size={20} color="rgb(251, 191, 36)" />
                )}
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "600",
                    color: versionInfo.is_up_to_date 
                      ? "rgb(34, 197, 94)" 
                      : "rgb(251, 191, 36)",
                  }}
                >
                  {versionInfo.is_up_to_date 
                    ? "You're up to date!" 
                    : "Update available"}
                </span>
              </div>

              <div
                style={{
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  lineHeight: "1.8",
                }}
              >
                <div>
                  <strong>Current Version:</strong> {versionInfo.current}
                </div>
                <div>
                  <strong>Latest Version:</strong> {versionInfo.latest}
                </div>
                <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
                  <strong>Installation Type:</strong> {versionInfo.is_installer ? "Installer" : "Portable"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Update Available Modal */}
      {showUpdateModal && versionInfo && !versionInfo.is_up_to_date && createPortal(
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
          onClick={handleCancelUpdate}
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
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Download size={20} color="var(--accent)" />
              Update Available
            </h3>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-primary)",
                marginBottom: "16px",
                lineHeight: "1.5",
              }}
            >
              A new version of TradeButler is available!
            </p>
            <div
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                padding: "12px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                lineHeight: "1.6",
              }}
            >
              <div><strong>Current:</strong> {versionInfo.current}</div>
              <div><strong>Latest:</strong> {versionInfo.latest}</div>
              {versionInfo.release_notes && (
                <div style={{ marginTop: "12px" }}>
                  <strong>What's New:</strong>
                  <div
                    style={{
                      marginTop: "4px",
                      whiteSpace: "pre-wrap",
                      maxHeight: "200px",
                      overflowY: "auto",
                      overflowX: "hidden",
                      padding: "8px",
                      backgroundColor: "var(--bg-primary)",
                      borderRadius: "4px",
                      border: "1px solid var(--border-color)",
                      fontSize: "12px",
                      lineHeight: "1.5",
                    }}
                  >
                    {versionInfo.release_notes}
                  </div>
                </div>
              )}
            </div>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                marginBottom: "20px",
                lineHeight: "1.5",
                fontStyle: "italic",
              }}
            >
              {versionInfo.is_installer 
                ? "The installer will update your application. Your data will be preserved."
                : "Download the new portable version. Close TradeButler and replace the executable. Your data will be preserved."}
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleCancelUpdate}
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
                Later
              </button>
              <button
                onClick={downloadUpdate}
                disabled={isDownloading}
                style={{
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  color: "white",
                  cursor: isDownloading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  opacity: isDownloading ? 0.6 : 1,
                }}
              >
                {isDownloading ? (
                  <>
                    <RefreshCw size={16} className="spinning" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Download Update
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
