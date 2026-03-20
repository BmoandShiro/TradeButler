/**
 * Emotional intensity color scale: 0 = green (calm), 10 = red (high), yellow/orange in between.
 * Used for emotional intensity (0–10) and survey scores (1–10 mapped to 0–10).
 */
export function getIntensityColor(intensity0To10: number): string {
  const v = Math.max(0, Math.min(10, intensity0To10)) / 10; // 0–1
  let r: number, g: number, b: number;
  if (v <= 0.33) {
    // Green to Yellow
    const t = v / 0.33;
    r = Math.round(34 + (255 - 34) * t);
    g = 197;
    b = Math.round(94 * (1 - t));
  } else if (v <= 0.66) {
    // Yellow to Orange
    const t = (v - 0.33) / 0.33;
    r = 255;
    g = Math.round(255 - 90 * t);
    b = 0;
  } else {
    // Orange to Red
    const t = (v - 0.66) / 0.34;
    r = 255;
    g = Math.round(165 * (1 - t));
    b = 0;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/** Map survey score 1–10 to 0–10 for the same gradient (1=green, 10=red). */
export function getSurveyScoreColor(score1To10: number): string {
  const intensity0To10 = ((score1To10 - 1) / 9) * 10; // 1→0, 10→10
  return getIntensityColor(intensity0To10);
}

/** Same as getSurveyScoreColor but as rgba for use as background (e.g. pill). */
export function getSurveyScoreBgRgba(score1To10: number, alpha: number = 0.22): string {
  const rgb = getSurveyScoreColor(score1To10);
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}
