import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ACCENT_PRESET_SWATCHES, normalizeHexInput, type AccentCustomPreset } from "../utils/journalAccentPresets";

/** Presets dropdown + native picker + hex + clear — same behavior as EMA/MA length chips. */
export function JournalSignalAccentColorRow({
  accent,
  onChipColor,
  onClearChipColor,
  customPresets,
  onAddCustomPreset,
  onRemoveCustomPreset,
}: {
  accent?: string;
  onChipColor: (hex: string) => void;
  onClearChipColor: () => void;
  customPresets: AccentCustomPreset[];
  onAddCustomPreset: (label: string, hex: string) => void;
  onRemoveCustomPreset: (id: string) => void;
}) {
  const [hexDraft, setHexDraft] = useState(() => accent ?? "");
  const [savePresetNameDraft, setSavePresetNameDraft] = useState("");
  useEffect(() => {
    setHexDraft(accent ?? "");
  }, [accent]);

  const presetWrapRef = useRef<HTMLDivElement | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  useEffect(() => {
    if (!presetOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = presetWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setPresetOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [presetOpen]);

  const commitHexDraft = () => {
    const n = normalizeHexInput(hexDraft);
    if (n) {
      onChipColor(n);
      setHexDraft(n);
    } else {
      setHexDraft(accent ?? "");
    }
  };

  return (
    <div
      className="ema-ma-accent-panel"
      ref={presetWrapRef}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        rowGap: 5,
        paddingTop: 4,
        marginTop: 1,
        borderTop: "1px solid var(--border-color)",
      }}
      title="Color: presets, picker, or hex (#RGB / #RRGGBB). Enter applies."
    >
      <div style={{ position: "relative", flex: "0 0 auto" }}>
        <button
          type="button"
          onClick={() => setPresetOpen((v) => !v)}
          title="Presets"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--border-color)",
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            borderRadius: 7,
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: (accent ?? "#64748B").toUpperCase(),
              border: "1px solid var(--border-color)",
              display: "inline-block",
            }}
          />
          Presets
          <span style={{ opacity: 0.9 }}>▾</span>
        </button>

        {presetOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 50,
              minWidth: 220,
              maxWidth: 280,
              maxHeight: 380,
              overflowY: "auto",
              background: "var(--bg-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: 10,
              padding: 8,
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 10, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.03em", marginBottom: 8 }}>
              Theme presets
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ACCENT_PRESET_SWATCHES.map(({ hex, label }) => {
                const selected = accent?.toUpperCase() === hex.toUpperCase();
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => {
                      const chosen = hex.toUpperCase();
                      onChipColor(chosen);
                      setHexDraft(chosen);
                      setPresetOpen(false);
                    }}
                    title={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: selected ? "2px solid var(--text-primary)" : "1px solid var(--border-color)",
                      background: selected ? "color-mix(in srgb, var(--bg-tertiary) 60%, var(--accent) 10%)" : "var(--bg-tertiary)",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: hex,
                        border: "1px solid var(--border-color)",
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: 11, fontWeight: 800 }}>{label}</span>
                  </button>
                );
              })}
            </div>
            {customPresets.length > 0 ? (
              <>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    color: "var(--text-secondary)",
                    letterSpacing: "0.03em",
                    marginTop: 10,
                    marginBottom: 8,
                    paddingTop: 8,
                    borderTop: "1px solid var(--border-color)",
                  }}
                >
                  My presets
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {customPresets.map((p) => {
                    const selected = accent?.toUpperCase() === p.hex.toUpperCase();
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => {
                            onChipColor(p.hex);
                            setHexDraft(p.hex);
                            setPresetOpen(false);
                          }}
                          title={`${p.label} (${p.hex})`}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: selected ? "2px solid var(--text-primary)" : "1px solid var(--border-color)",
                            background: selected ? "color-mix(in srgb, var(--bg-tertiary) 60%, var(--accent) 10%)" : "var(--bg-tertiary)",
                            cursor: "pointer",
                            color: "var(--text-primary)",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              background: p.hex,
                              border: "1px solid var(--border-color)",
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 11, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.label}
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Delete preset"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemoveCustomPreset(p.id);
                          }}
                          style={{
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-secondary)",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            borderRadius: 8,
                            padding: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid var(--border-color)",
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 900, color: "var(--text-secondary)", letterSpacing: "0.03em", marginBottom: 6 }}>Save as preset</div>
              <div style={{ fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.35, marginBottom: 6 }}>
                Uses the picker / hex for this field, or the hex field if you typed one.
              </div>
              <input
                type="text"
                value={savePresetNameDraft}
                onChange={(e) => setSavePresetNameDraft(e.target.value)}
                placeholder="Name"
                maxLength={48}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const label = savePresetNameDraft.trim();
                    const hex = normalizeHexInput(hexDraft) ?? (accent && /^#[0-9A-Fa-f]{6}$/i.test(accent) ? accent.toUpperCase() : null);
                    if (!label || !hex) return;
                    onAddCustomPreset(label, hex);
                    setSavePresetNameDraft("");
                  }
                }}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "5px 7px",
                  borderRadius: 8,
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  fontSize: 11,
                  outline: "none",
                  marginBottom: 6,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const label = savePresetNameDraft.trim();
                  const hex = normalizeHexInput(hexDraft) ?? (accent && /^#[0-9A-Fa-f]{6}$/i.test(accent) ? accent.toUpperCase() : null);
                  if (!label || !hex) return;
                  onAddCustomPreset(label, hex);
                  setSavePresetNameDraft("");
                }}
                disabled={
                  !savePresetNameDraft.trim() ||
                  !(normalizeHexInput(hexDraft) ?? (accent && /^#[0-9A-Fa-f]{6}$/i.test(accent) ? accent.toUpperCase() : null))
                }
                style={{
                  width: "100%",
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  borderRadius: 8,
                  padding: "6px 8px",
                  cursor: "pointer",
                  fontWeight: 800,
                  fontSize: 11,
                  opacity:
                    !savePresetNameDraft.trim() ||
                    !(normalizeHexInput(hexDraft) ?? (accent && /^#[0-9A-Fa-f]{6}$/i.test(accent) ? accent.toUpperCase() : null))
                      ? 0.45
                      : 1,
                }}
              >
                Save current color
              </button>
            </div>
          </div>
        )}
      </div>
      <input
        type="color"
        value={(accent ?? "#64748b").toLowerCase()}
        onChange={(e) => {
          const v = e.target.value.toUpperCase();
          onChipColor(v);
          setHexDraft(v);
        }}
        title="Pick a color"
        className="ema-ma-accent-color-native"
      />
      <input
        type="text"
        value={hexDraft}
        onChange={(e) => setHexDraft(e.target.value)}
        onBlur={commitHexDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitHexDraft();
          }
        }}
        placeholder="#RRGGBB"
        title="Hex color — Enter to apply"
        spellCheck={false}
        autoComplete="off"
        style={{
          width: 86,
          flex: "0 0 auto",
          padding: "3px 5px",
          borderRadius: 6,
          border: "1px solid var(--border-color)",
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          fontSize: 10,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          outline: "none",
        }}
      />
      {accent ? (
        <button
          type="button"
          onClick={() => {
            onClearChipColor();
            setHexDraft("");
          }}
          style={{
            border: "1px solid var(--border-color)",
            background: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 6,
            padding: "2px 6px",
            lineHeight: 1.2,
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
