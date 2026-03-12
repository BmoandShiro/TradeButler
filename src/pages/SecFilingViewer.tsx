import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/tauri";
import {
  FileText,
  ArrowLeft,
  ExternalLink,
  Calendar,
  Building2,
  User,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface FilingData {
  documentType: string;
  periodOfReport: string;
  issuerName: string;
  issuerSymbol: string;
  reportingOwners: {
    name: string;
    title: string;
    isDirector: boolean;
    isOfficer: boolean;
  }[];
  transactions: {
    securityTitle: string;
    transactionDate: string;
    transactionCode: string;
    shares: number;
    pricePerShare: number | null;
    sharesOwnedAfter: number;
    acquisitionOrDisposition: string;
  }[];
  footnotes: string[];
  signatureDate: string;
  signatureName: string;
}

export default function SecFilingViewer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const url = searchParams.get("url");
  const symbol = searchParams.get("symbol") || "";
  const formType = searchParams.get("form") || "";
  const filedDate = searchParams.get("date") || "";

  const [filingData, setFilingData] = useState<FilingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url) {
      fetchAndParseFile(url);
    } else {
      setError("No filing URL provided");
      setIsLoading(false);
    }
  }, [url]);

  const fetchAndParseFile = async (fileUrl: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Use Tauri backend to bypass CORS
      const text = await invoke<string>("fetch_sec_filing_content", { url: fileUrl });

      // Check if it looks like XML (starts with < and contains XML-like content)
      const trimmedText = text.trim();
      if (!trimmedText.startsWith("<") || trimmedText.includes("<!DOCTYPE html")) {
        // It's an HTML page, not raw XML - that's okay, show metadata only
        console.log("Filing is HTML format, showing metadata view");
        setFilingData(null);
        return;
      }

      // Parse the XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      // Check for parse errors
      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        console.warn("XML parse error, showing metadata view");
        setFilingData(null);
        return;
      }

      // Check if it's an ownership document (Form 3, 4, or 5)
      const ownershipDoc = xmlDoc.querySelector("ownershipDocument");
      if (ownershipDoc) {
        parseOwnershipDocument(ownershipDoc);
      } else {
        // Generic SEC filing - just show metadata
        setFilingData(null);
      }
    } catch (e) {
      console.error("Failed to fetch/parse filing:", e);
      // Don't show error - just show the metadata view with link to SEC
      setFilingData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const parseOwnershipDocument = (doc: Element) => {
    const getText = (selector: string): string => {
      const el = doc.querySelector(selector);
      return el?.textContent?.trim() || "";
    };

    // Parse issuer info
    const issuerName = getText("issuer > issuerName");
    const issuerSymbol = getText("issuer > issuerTradingSymbol");

    // Parse reporting owners
    const reportingOwners: FilingData["reportingOwners"] = [];
    doc.querySelectorAll("reportingOwner").forEach((owner) => {
      reportingOwners.push({
        name: owner.querySelector("rptOwnerName")?.textContent?.trim() || "",
        title: owner.querySelector("officerTitle")?.textContent?.trim() || "",
        isDirector: owner.querySelector("isDirector")?.textContent?.trim() === "1",
        isOfficer: owner.querySelector("isOfficer")?.textContent?.trim() === "1",
      });
    });

    // Parse transactions
    const transactions: FilingData["transactions"] = [];
    doc.querySelectorAll("nonDerivativeTransaction").forEach((tx) => {
      const securityTitle = tx.querySelector("securityTitle > value")?.textContent?.trim() || "";
      const transactionDate = tx.querySelector("transactionDate > value")?.textContent?.trim() || "";
      const transactionCode = tx.querySelector("transactionCoding > transactionCode")?.textContent?.trim() || "";
      const shares = parseFloat(tx.querySelector("transactionAmounts transactionShares > value")?.textContent || "0");
      const priceText = tx.querySelector("transactionAmounts transactionPricePerShare > value")?.textContent;
      const pricePerShare = priceText ? parseFloat(priceText) : null;
      const sharesOwnedAfter = parseFloat(tx.querySelector("postTransactionAmounts sharesOwnedFollowingTransaction > value")?.textContent || "0");
      const acquisitionOrDisposition = tx.querySelector("transactionAcquiredDisposedCode > value")?.textContent?.trim() || "";

      transactions.push({
        securityTitle,
        transactionDate,
        transactionCode,
        shares,
        pricePerShare,
        sharesOwnedAfter,
        acquisitionOrDisposition,
      });
    });

    // Parse footnotes
    const footnotes: string[] = [];
    doc.querySelectorAll("footnotes > footnote").forEach((fn) => {
      const text = fn.textContent?.trim();
      if (text) footnotes.push(text);
    });

    // Parse signature
    const signatureDate = getText("ownerSignature > signatureDate");
    const signatureName = getText("ownerSignature > signatureName");

    setFilingData({
      documentType: getText("documentType"),
      periodOfReport: getText("periodOfReport"),
      issuerName,
      issuerSymbol,
      reportingOwners,
      transactions,
      footnotes,
      signatureDate,
      signatureName,
    });
  };

  const getTransactionCodeLabel = (code: string): string => {
    const codes: Record<string, string> = {
      P: "Open Market Purchase",
      S: "Open Market Sale",
      A: "Grant/Award",
      D: "Disposition to Issuer",
      G: "Gift",
      F: "Tax Payment",
      M: "Option Exercise",
      C: "Conversion",
      X: "Exercise of Derivative",
      J: "Other",
    };
    return codes[code] || code;
  };

  const getFormTypeDescription = (form: string): string => {
    const descriptions: Record<string, string> = {
      "3": "Initial Statement of Beneficial Ownership",
      "4": "Statement of Changes in Beneficial Ownership",
      "5": "Annual Statement of Changes in Beneficial Ownership",
      "10-K": "Annual Report",
      "10-Q": "Quarterly Report",
      "8-K": "Current Report",
      "DEF 14A": "Proxy Statement",
      "S-1": "Registration Statement",
      "13F": "Institutional Investment Manager Holdings",
      "SC 13D": "Beneficial Ownership Report (>5%)",
      "SC 13G": "Beneficial Ownership Report (Passive)",
    };
    return descriptions[form] || "SEC Filing";
  };

  if (isLoading) {
    return (
      <div style={{ padding: "24px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px" }}>
        <RefreshCw size={32} className="spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-secondary)",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "12px" }}>
            <FileText size={24} />
            {formType ? `Form ${formType}` : "SEC Filing"}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--text-secondary)" }}>
            {getFormTypeDescription(formType)}
          </p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-primary)",
              textDecoration: "none",
              fontSize: "14px",
            }}
          >
            <ExternalLink size={16} />
            View Original
          </a>
        )}
      </div>

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

      {/* Filing Metadata */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
          padding: "20px",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Symbol</p>
            <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--accent)" }}>
              {filingData?.issuerSymbol || symbol || "—"}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Company</p>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: "500", color: "var(--text-primary)" }}>
              {filingData?.issuerName || "—"}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Filed Date</p>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: "500", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
              <Calendar size={14} />
              {filedDate || filingData?.periodOfReport || "—"}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px" }}>Form Type</p>
            <span
              style={{
                display: "inline-block",
                padding: "4px 10px",
                borderRadius: "4px",
                backgroundColor: formType.includes("4") ? "rgba(139, 92, 246, 0.2)" :
                               formType.includes("10-K") ? "rgba(16, 185, 129, 0.2)" :
                               formType.includes("10-Q") ? "rgba(59, 130, 246, 0.2)" :
                               formType.includes("8-K") ? "rgba(245, 158, 11, 0.2)" :
                               "var(--bg-primary)",
                color: formType.includes("4") ? "#8B5CF6" :
                      formType.includes("10-K") ? "#10B981" :
                      formType.includes("10-Q") ? "#3B82F6" :
                      formType.includes("8-K") ? "#F59E0B" :
                      "var(--text-primary)",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              {formType || filingData?.documentType || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Parsed Ownership Data (Form 3, 4, 5) */}
      {filingData && filingData.reportingOwners.length > 0 && (
        <>
          {/* Reporting Owners */}
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderRadius: "12px",
              border: "1px solid var(--border-color)",
              padding: "20px",
              marginBottom: "20px",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <User size={18} />
              Reporting Owner{filingData.reportingOwners.length > 1 ? "s" : ""}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {filingData.reportingOwners.map((owner, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "14px 16px",
                    backgroundColor: "var(--bg-primary)",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "var(--text-primary)" }}>
                      {owner.name}
                    </p>
                    {owner.title && (
                      <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-secondary)" }}>
                        {owner.title}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {owner.isDirector && (
                      <span style={{ padding: "4px 8px", borderRadius: "4px", backgroundColor: "rgba(59, 130, 246, 0.15)", color: "#3B82F6", fontSize: "11px", fontWeight: "600" }}>
                        Director
                      </span>
                    )}
                    {owner.isOfficer && (
                      <span style={{ padding: "4px 8px", borderRadius: "4px", backgroundColor: "rgba(139, 92, 246, 0.15)", color: "#8B5CF6", fontSize: "11px", fontWeight: "600" }}>
                        Officer
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Transactions */}
          {filingData.transactions.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
                marginBottom: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Building2 size={18} />
                Transactions
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {filingData.transactions.map((tx, idx) => {
                  const isAcquisition = tx.acquisitionOrDisposition === "A";
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "16px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "8px",
                        borderLeft: `3px solid ${isAcquisition ? "#10B981" : "#EF4444"}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                        <div>
                          <p style={{ margin: 0, fontSize: "14px", fontWeight: "500", color: "var(--text-primary)" }}>
                            {tx.securityTitle}
                          </p>
                          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                            {tx.transactionDate}
                          </p>
                        </div>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "4px",
                            backgroundColor: isAcquisition ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: isAcquisition ? "#10B981" : "#EF4444",
                            fontSize: "12px",
                            fontWeight: "600",
                          }}
                        >
                          {getTransactionCodeLabel(tx.transactionCode)}
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                        <div>
                          <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)" }}>Shares</p>
                          <p style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: isAcquisition ? "#10B981" : "#EF4444" }}>
                            {isAcquisition ? "+" : "-"}{tx.shares.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)" }}>Price/Share</p>
                          <p style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {tx.pricePerShare !== null ? `$${tx.pricePerShare.toFixed(2)}` : "N/A"}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)" }}>Total After</p>
                          <p style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "var(--text-primary)" }}>
                            {tx.sharesOwnedAfter.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footnotes */}
          {filingData.footnotes.length > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
                marginBottom: "20px",
              }}
            >
              <h3 style={{ fontSize: "16px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "16px" }}>
                Footnotes
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {filingData.footnotes.map((note, idx) => (
                  <p
                    key={idx}
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      color: "var(--text-secondary)",
                      lineHeight: "1.6",
                      padding: "12px",
                      backgroundColor: "var(--bg-primary)",
                      borderRadius: "6px",
                    }}
                  >
                    <strong style={{ color: "var(--text-primary)" }}>[{idx + 1}]</strong> {note}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Signature */}
          {filingData.signatureName && (
            <div
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
                padding: "20px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
                Signed by <strong style={{ color: "var(--text-primary)" }}>{filingData.signatureName}</strong>
                {filingData.signatureDate && ` on ${filingData.signatureDate}`}
              </p>
            </div>
          )}
        </>
      )}

      {/* For non-ownership filings or when parsing fails, show helpful info */}
      {!filingData && !error && (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            padding: "32px",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <FileText size={48} style={{ color: "var(--accent)", marginBottom: "16px" }} />
            <p style={{ margin: 0, fontSize: "16px", color: "var(--text-primary)", marginBottom: "8px" }}>
              {formType === "4" || formType === "3" || formType === "5" 
                ? "View Insider Ownership Filing"
                : formType.includes("10-K") 
                  ? "Annual Report (10-K)"
                  : formType.includes("10-Q")
                    ? "Quarterly Report (10-Q)"
                    : formType.includes("8-K")
                      ? "Current Report (8-K)"
                      : "SEC Filing"}
            </p>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
              {formType === "4" 
                ? "Shows changes in beneficial ownership of company securities by insiders"
                : formType === "3"
                  ? "Initial statement of beneficial ownership filed by company insiders"
                  : formType === "5"
                    ? "Annual statement of changes in beneficial ownership"
                    : formType.includes("10-K")
                      ? "Comprehensive overview of company's business and financial condition"
                      : formType.includes("10-Q")
                        ? "Quarterly update on company's financial performance"
                        : formType.includes("8-K")
                          ? "Report of significant events shareholders should know about"
                          : "Official document filed with the Securities and Exchange Commission"}
            </p>
          </div>

          {/* Quick Info Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "24px" }}>
            <div style={{ padding: "16px", backgroundColor: "var(--bg-primary)", borderRadius: "8px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Symbol</p>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "var(--accent)" }}>{symbol || "—"}</p>
            </div>
            <div style={{ padding: "16px", backgroundColor: "var(--bg-primary)", borderRadius: "8px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Form</p>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>{formType || "—"}</p>
            </div>
            <div style={{ padding: "16px", backgroundColor: "var(--bg-primary)", borderRadius: "8px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>Filed</p>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>{filedDate?.split(" ")[0] || "—"}</p>
            </div>
          </div>

          {url && (
            <div style={{ textAlign: "center" }}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "14px 24px",
                  borderRadius: "8px",
                  backgroundColor: "var(--accent)",
                  color: "white",
                  textDecoration: "none",
                  fontSize: "15px",
                  fontWeight: "600",
                }}
              >
                <ExternalLink size={18} />
                View Full Filing on SEC.gov
              </a>
              <p style={{ margin: "12px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                Opens in your browser with complete filing details
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
