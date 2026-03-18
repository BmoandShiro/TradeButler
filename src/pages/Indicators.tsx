import { useMemo, useState } from "react";
import { Code2, Plus, Search, X } from "lucide-react";
import { addIndicator, loadIndicators, type Indicator } from "../utils/indicatorsStore";

export default function IndicatorsPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Indicator | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const [newName, setNewName] = useState("");
  const [newAbbr, setNewAbbr] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCode, setNewCode] = useState("");

  const indicators = useMemo(() => loadIndicators(), [showAdd, selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return indicators;
    return indicators.filter((i) => {
      const hay = `${i.name} ${i.abbreviation} ${i.description}`.toLowerCase();
      return hay.includes(q);
    });
  }, [indicators, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "20px 24px", background: "var(--bg-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em" }}>Indicators</h1>
          <div style={{ marginTop: "6px", color: "var(--text-secondary)", fontSize: "14px" }}>
            Build a personal library of indicator snippets and notes. Click a card to view full description and code.
          </div>
        </div>
        <button
          onClick={() => {
            setNewName("");
            setNewAbbr("");
            setNewDesc("");
            setNewCode("");
            setShowAdd(true);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "var(--accent)",
            border: "none",
            borderRadius: "10px",
            padding: "10px 14px",
            color: "var(--bg-primary)",
            cursor: "pointer",
            fontWeight: 650,
          }}
        >
          <Plus size={18} />
          Add indicator
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: "520px" }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators..."
            style={{
              width: "100%",
              padding: "10px 12px 10px 40px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "10px",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
          {filtered.length} shown
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "14px", overflow: "auto", paddingBottom: "16px" }}>
        {filtered.map((i) => (
          <button
            key={i.id}
            onClick={() => setSelected(i)}
            style={{
              textAlign: "left",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "14px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.name}>
                {i.name}
              </div>
              <span style={{ fontSize: "11px", fontWeight: 800, padding: "3px 7px", borderRadius: "8px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
                {i.abbreviation}
              </span>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5, maxHeight: "3em", overflow: "hidden" }}>
              {i.description || "—"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)", fontSize: "12px" }}>
              <Code2 size={14} />
              View code
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: "var(--text-secondary)", padding: "18px", border: "1px dashed var(--border-color)", borderRadius: "12px" }}>
            No indicators yet. Click “Add indicator”.
          </div>
        )}
      </div>

      {/* View modal */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "980px", maxHeight: "82vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selected.name}
                </div>
                <span style={{ fontSize: "11px", fontWeight: 800, padding: "3px 7px", borderRadius: "8px", background: "var(--bg-tertiary)", border: "1px solid var(--border-color)", color: "var(--text-secondary)" }}>
                  {selected.abbreviation}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: "18px", display: "grid", gridTemplateColumns: "1fr", gap: "14px" }}>
              <div style={{ color: "var(--text-secondary)", lineHeight: 1.7, fontSize: "14px", whiteSpace: "pre-wrap" }}>
                {selected.description || "—"}
              </div>
              <div style={{ border: "1px solid var(--border-color)", borderRadius: "12px", overflow: "hidden", background: "var(--bg-secondary)" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Code
                </div>
                <pre style={{ margin: 0, padding: "14px 16px", overflow: "auto", color: "var(--text-primary)", fontSize: "12px", lineHeight: 1.6 }}>
                  {selected.code || "// (no code)"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 260, display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{ width: "100%", maxWidth: "860px", maxHeight: "86vh", overflow: "auto", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "14px", boxShadow: "0 18px 48px rgba(0,0,0,0.55)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ fontSize: "18px", fontWeight: 750, color: "var(--text-primary)" }}>Add indicator</div>
              <button
                onClick={() => setShowAdd(false)}
                style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "8px 10px", cursor: "pointer", display: "flex" }}
              >
                <X size={16} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim() || !newAbbr.trim()) return;
                addIndicator({ name: newName, abbreviation: newAbbr, description: newDesc, code: newCode });
                setShowAdd(false);
              }}
              style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: "10px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Name</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. RSI (Relative Strength Index)"
                    required
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Abbrev</label>
                  <input
                    value={newAbbr}
                    onChange={(e) => setNewAbbr(e.target.value)}
                    placeholder="RSI"
                    required
                    style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", textTransform: "uppercase" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={4}
                  placeholder="What it measures, how you use it, key thresholds, etc."
                  style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 650 }}>Code</label>
                <textarea
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  rows={10}
                  placeholder={"// paste code here (pine/python/etc)\n"}
                  style={{ padding: "10px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "10px", color: "var(--text-primary)", outline: "none", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: "12px", lineHeight: 1.6 }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" onClick={() => setShowAdd(false)} style={{ border: "1px solid var(--border-color)", background: "var(--bg-secondary)", color: "var(--text-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 650 }}>
                  Cancel
                </button>
                <button type="submit" style={{ border: "none", background: "var(--accent)", color: "var(--bg-primary)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontWeight: 750 }}>
                  Save indicator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

