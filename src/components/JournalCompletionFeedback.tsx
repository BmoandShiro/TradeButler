import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const CLEAR_MS = 780;

/**
 * Triggers a one-shot glow animation (see `.journal-completion-flash` in index.css).
 * Uses a double requestAnimationFrame so repeated interactions replay the animation.
 */
export function useJournalCompletionFlash(clearMs: number = CLEAR_MS) {
  const [active, setActive] = useState(false);
  const clearTidRef = useRef<number | null>(null);

  const trigger = useCallback(() => {
    setActive(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setActive(true);
        if (clearTidRef.current != null) window.clearTimeout(clearTidRef.current);
        clearTidRef.current = window.setTimeout(() => {
          setActive(false);
          clearTidRef.current = null;
        }, clearMs);
      });
    });
  }, [clearMs]);

  useEffect(
    () => () => {
      if (clearTidRef.current != null) window.clearTimeout(clearTidRef.current);
    },
    []
  );

  return { active, trigger };
}

/**
 * Wraps a row or control group; flashes on checkbox change or button (type=button) clicks inside.
 * Range sliders use `JournalSliderShell` for their own glow — we do not flash on pointer-up (avoids a second glow on release).
 */
export function JournalCompletionOutline({
  children,
  style,
  className,
  completionTone = "accent",
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Use "warning" for mantra / survey (secondary) widgets so glow matches orange bar and checkboxes */
  completionTone?: "accent" | "warning";
}) {
  const { active, trigger } = useJournalCompletionFlash();

  return (
    <div
      className={[
        className,
        active ? "journal-completion-flash" : "",
        active && completionTone === "warning" ? "journal-completion-flash--warning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onChangeCapture={(e) => {
        const el = e.target as HTMLInputElement;
        if (el?.tagName === "INPUT" && el.type === "checkbox") trigger();
      }}
      onClickCapture={(e) => {
        const t = e.target as HTMLElement | null;
        const btn = t?.closest("button");
        if (btn && (btn as HTMLButtonElement).type === "button") trigger();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Range control with track fill; each input tick runs a **whole-control** glow on the outer shell.
 */
export function JournalSliderShell({
  min,
  max,
  value,
  onChange,
  disabled,
  readOnly,
  accentColor = "var(--accent)",
  className,
  style,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
  accentColor?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const lastGlowAtRef = useRef(0);
  const span = max - min;
  const pct = span <= 0 ? 0 : ((value - min) / span) * 100;

  /** Throttle so fast drags don’t strobe; still feels responsive (~4–5 Hz max). */
  const GLOW_MIN_MS = 200;

  const pulseTick = useCallback(() => {
    const now = performance.now();
    if (now - lastGlowAtRef.current < GLOW_MIN_MS) return;
    lastGlowAtRef.current = now;
    const el = shellRef.current;
    if (!el) return;
    el.classList.remove("journal-slider-tick-flash");
    void el.offsetWidth;
    el.classList.add("journal-slider-tick-flash");
  }, []);

  return (
    <div
      ref={shellRef}
      className={["journal-slider-shell", className].filter(Boolean).join(" ")}
      style={{
        ...style,
        ["--journal-slider-pct" as string]: `${pct}%`,
        ["--journal-slider-accent" as string]: accentColor,
      }}
    >
      <div className="journal-slider-track-bg" aria-hidden />
      <div className="journal-slider-track-fill" aria-hidden />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled || readOnly}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        className="journal-slider-input"
        onInput={pulseTick}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
    </div>
  );
}
