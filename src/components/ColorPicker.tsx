import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClose?: () => void;
}

export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const saturationRef = useRef<HTMLDivElement>(null);
  const skipOnChange = useRef(true); // Skip onChange on initial render

  // Convert hex to HSL
  const hexToHsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  };

  // Convert HSL to hex
  const hslToHex = (h: number, s: number, l: number) => {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  // Convert RGB to hex
  const rgbToHex = (r: number, g: number, b: number) => {
    return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
  };

  // Convert hex to RGB
  const hexToRgb = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  };

  // Initialize state from value prop
  const getInitialState = () => {
    if (value) {
      const hsl = hexToHsl(value);
      const rgb = hexToRgb(value);
      return { hsl, rgb };
    }
    return {
      hsl: { h: 217, s: 91, l: 60 }, // Default blue
      rgb: { r: 59, g: 130, b: 246 },
    };
  };

  const initialState = getInitialState();
  const [hue, setHue] = useState(initialState.hsl.h);
  const [saturation, setSaturation] = useState(initialState.hsl.s);
  const [lightness, setLightness] = useState(initialState.hsl.l);
  const [rgb, setRgb] = useState(initialState.rgb);

  // Update RGB when HSL changes
  useEffect(() => {
    const hex = hslToHex(hue, saturation, lightness);
    const newRgb = hexToRgb(hex);
    setRgb(newRgb);
    
    // Only call onChange if this was a user change, not initial render
    if (!skipOnChange.current) {
      onChange(hex);
    } else {
      skipOnChange.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hue, saturation, lightness]); // onChange is intentionally excluded to prevent infinite loops

  // Update when value prop changes externally
  useEffect(() => {
    if (value) {
      const currentHex = hslToHex(hue, saturation, lightness);
      if (currentHex.toLowerCase() !== value.toLowerCase()) {
        skipOnChange.current = true; // Don't trigger onChange when updating from prop
        const hsl = hexToHsl(value);
        setHue(hsl.h);
        setSaturation(hsl.s);
        setLightness(hsl.l);
        setRgb(hexToRgb(value));
      }
    }
  }, [value]);

  // Handle saturation/lightness area click
  const handleSaturationClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!saturationRef.current) return;
    skipOnChange.current = false; // User interaction, allow onChange
    const rect = saturationRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setSaturation(Math.round(x * 100));
    setLightness(Math.round((1 - y) * 100));
  };

  // Handle hue slider
  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    skipOnChange.current = false; // User interaction, allow onChange
    setHue(parseInt(e.target.value));
  };

  // Handle RGB inputs
  const handleRgbChange = (channel: "r" | "g" | "b", val: number) => {
    skipOnChange.current = false; // User interaction, allow onChange
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, val)) };
    setRgb(newRgb);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    const hsl = hexToHsl(hex);
    setHue(hsl.h);
    setSaturation(hsl.s);
    setLightness(hsl.l);
    onChange(hex);
  };

  const currentColor = hslToHex(hue, saturation, lightness);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        style={{
          width: "100%",
          height: "36px",
          border: "1px solid var(--border-color)",
          borderRadius: "4px",
          cursor: "pointer",
          backgroundColor: value || "#3b82f6",
          padding: "2px",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: value || "#3b82f6",
            borderRadius: "2px",
          }}
        />
      </button>

      {isOpen && (
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
            zIndex: 2000,
          }}
          onClick={() => {
            setIsOpen(false);
            if (onClose) onClose();
          }}
        >
          <div
            ref={pickerRef}
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
              minWidth: "300px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Saturation/Lightness area */}
            <div
              ref={saturationRef}
              style={{
                width: "100%",
                height: "200px",
                background: `linear-gradient(to right, hsl(${hue}, 100%, 50%), hsl(${hue}, 0%, 50%)), linear-gradient(to top, #000, transparent)`,
                borderRadius: "8px",
                position: "relative",
                cursor: "crosshair",
                marginBottom: "16px",
                border: "1px solid var(--border-color)",
              }}
              onMouseDown={(e) => {
                handleSaturationClick(e);
                const handleMove = (moveEvent: MouseEvent) => {
                  if (!saturationRef.current) return;
                  const rect = saturationRef.current.getBoundingClientRect();
                  skipOnChange.current = false; // User interaction, allow onChange
                  const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));
                  setSaturation(Math.round(x * 100));
                  setLightness(Math.round((1 - y) * 100));
                };
                const handleUp = () => {
                  document.removeEventListener("mousemove", handleMove);
                  document.removeEventListener("mouseup", handleUp);
                };
                document.addEventListener("mousemove", handleMove);
                document.addEventListener("mouseup", handleUp);
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${saturation}%`,
                  top: `${100 - lightness}%`,
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  border: "2px solid white",
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "none",
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
                }}
              />
            </div>

            {/* Hue slider */}
            <div style={{ marginBottom: "16px" }}>
              <input
                type="range"
                min="0"
                max="360"
                value={hue}
                onChange={handleHueChange}
                style={{
                  width: "100%",
                  height: "12px",
                  background: `linear-gradient(to right, 
                    hsl(0, 100%, 50%), 
                    hsl(60, 100%, 50%), 
                    hsl(120, 100%, 50%), 
                    hsl(180, 100%, 50%), 
                    hsl(240, 100%, 50%), 
                    hsl(300, 100%, 50%), 
                    hsl(360, 100%, 50%))`,
                  borderRadius: "6px",
                  outline: "none",
                  cursor: "pointer",
                  WebkitAppearance: "none",
                }}
              />
            </div>

            {/* Color preview and RGB inputs */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  backgroundColor: currentColor,
                  borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, display: "flex", gap: "8px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    R
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.r}
                      onChange={(e) => handleRgbChange("r", parseInt(e.target.value) || 0)}
                      style={{
                        width: "100%",
                        padding: "6px 24px 6px 8px",
                        backgroundColor: "var(--bg-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    />
                    <div style={{ position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", gap: "0" }}>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("r", Math.min(255, rgb.r + 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("r", Math.max(0, rgb.r - 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    G
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.g}
                      onChange={(e) => handleRgbChange("g", parseInt(e.target.value) || 0)}
                      style={{
                        width: "100%",
                        padding: "6px 24px 6px 8px",
                        backgroundColor: "var(--bg-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    />
                    <div style={{ position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", gap: "0" }}>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("g", Math.min(255, rgb.g + 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("g", Math.max(0, rgb.g - 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                    B
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.b}
                      onChange={(e) => handleRgbChange("b", parseInt(e.target.value) || 0)}
                      style={{
                        width: "100%",
                        padding: "6px 24px 6px 8px",
                        backgroundColor: "var(--bg-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        color: "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    />
                    <div style={{ position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", gap: "0" }}>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("b", Math.min(255, rgb.b + 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRgbChange("b", Math.max(0, rgb.b - 1))}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: "0",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-secondary)",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Hex input */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                Hex
              </label>
              <input
                type="text"
                value={currentColor.toUpperCase()}
                onChange={(e) => {
                  const hex = e.target.value;
                  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                    skipOnChange.current = false; // User interaction, allow onChange
                    const hsl = hexToHsl(hex);
                    setHue(hsl.h);
                    setSaturation(hsl.s);
                    setLightness(hsl.l);
                    setRgb(hexToRgb(hex));
                    onChange(hex);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "4px",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontFamily: "monospace",
                }}
              />
            </div>

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onClose) onClose();
              }}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "var(--accent)",
                border: "none",
                borderRadius: "6px",
                color: "white",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
