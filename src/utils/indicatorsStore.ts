import type { DataMode } from "./dataMode";

export interface Indicator {
  id: string; // uuid-ish
  kind?: "builtin" | "custom";
  name: string;
  abbreviation: string; // shown in strategy/journal UI
  description: string;
  code: string;
  createdAt: number;
  accentColor?: string;
  exampleImage?: string; // data url
  category?: "Custom" | "Momentum" | "Trend" | "Volatility" | "Volume" | "Structure" | "Pattern";
}

const INDICATORS_KEY = "tradebutler_indicators_v1";
const STRATEGY_INDICATORS_KEY = "tradebutler_strategy_indicators_v1";
const JOURNAL_INDICATOR_VALUES_KEY = "tradebutler_journal_indicator_values_v1";

const BUILTIN_ACCENT_COLORS = ["#7C3AED", "#2563EB", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#22C55E"];
const CUSTOM_ACCENT_COLOR = "#F59E0B";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pointsToPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  return points
    .map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function makeIndicatorExampleImageForId(id: string, abbreviation: string, accentColor: string): string {
  const bg = "rgba(255,255,255,0.06)";
  const border = "rgba(255,255,255,0.22)";
  const grid = "rgba(255,255,255,0.10)";
  // Keep the thumbnail purely visual (no text), but still vary it per indicator.
  const dotR = 5.8 + (hashString(abbreviation) % 30) / 10; // 5.8..8.7
  const dotOpacity = 0.14 + (hashString(abbreviation + "_o") % 20) / 100; // 0.14..0.33
  const w = 360;
  const h = 200;
  const pad = 18;
  const innerX = pad + 8;
  const innerY = pad + 6;
  const innerW = w - pad * 2 - 8;
  const innerH = h - pad * 2 - 10;

  const x0 = innerX;
  const x1 = innerX + innerW;
  const y0 = innerY;
  const y1 = innerY + innerH;

  const accent = accentColor;

  // Shared scaffolding: gradient + framed chart area.
  const header = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.95"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.45"/>
      </linearGradient>
      <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.05"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" fill="url(#g)"/>
    <rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="14" fill="${bg}" stroke="${border}"/>
    <g opacity="1">
      <path d="M ${x0} ${y0} L ${x1} ${y0}" stroke="${grid}" stroke-width="1"/>
      <path d="M ${x0} ${y0 + innerH * 0.5} L ${x1} ${y0 + innerH * 0.5}" stroke="${grid}" stroke-width="1"/>
      <path d="M ${x0} ${y1} L ${x1} ${y1}" stroke="${grid}" stroke-width="1"/>
    </g>
  `;

  const accentLine = `stroke="${accent}" stroke-width="2.4" fill="none" stroke-linecap="round"`;
  const accentSoftLine = `stroke="${accent}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.7"`;

  // Map [0..1] to chart coordinates.
  const mapY = (t: number) => y1 - t * innerH;
  const mapX = (t: number) => x0 + t * innerW;

  // Generic sparkline fallback (not just text).
  const fallbackPath = pointsToPath([
    [mapX(0.05), mapY(0.22)],
    [mapX(0.18), mapY(0.48)],
    [mapX(0.35), mapY(0.35)],
    [mapX(0.52), mapY(0.64)],
    [mapX(0.68), mapY(0.52)],
    [mapX(0.85), mapY(0.74)],
    [mapX(0.95), mapY(0.58)],
  ]);

  let glyph = `
    <path d="${fallbackPath}" ${accentLine}/>
    <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="${grid}" stroke-width="1"/>
    <circle cx="${(w / 2).toFixed(2)}" cy="${(h - 22).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}" opacity="${dotOpacity.toFixed(2)}"/>
  `;

  switch (id) {
    case "rsi": {
      // RSI oscillator: line with 70/30 levels.
      const pts = [
        [0.06, 0.25],
        [0.18, 0.42],
        [0.32, 0.35],
        [0.46, 0.60],
        [0.60, 0.52],
        [0.72, 0.70],
        [0.86, 0.44],
        [0.95, 0.58],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.7)} L ${x1} ${mapY(0.7)}" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.3)} L ${x1} ${mapY(0.3)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "stoch_rsi":
    case "stoch": {
      // Stochastic oscillator: two lines.
      const fast = [
        [0.06, 0.20],
        [0.18, 0.55],
        [0.32, 0.38],
        [0.46, 0.68],
        [0.60, 0.42],
        [0.72, 0.76],
        [0.86, 0.52],
        [0.95, 0.60],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const slow = [
        [0.06, 0.32],
        [0.18, 0.48],
        [0.32, 0.44],
        [0.46, 0.55],
        [0.60, 0.50],
        [0.72, 0.62],
        [0.86, 0.46],
        [0.95, 0.50],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(slow)}" ${accentSoftLine}/>
        <path d="${pointsToPath(fast)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.8)} L ${x1} ${mapY(0.8)}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.2)} L ${x1} ${mapY(0.2)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
      `;
      break;
    }
    case "macd": {
      // MACD: histogram bars + two lines.
      const baselineY = mapY(0.5);
      const bars = [0.62, 0.45, 0.58, 0.28, 0.36, 0.16, 0.42, 0.25];
      const barW = innerW / (bars.length * 1.35);
      glyph = `
        <g>
          ${bars
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / bars.length);
              const barTop = baselineY - (v - 0.5) * (innerH * 0.85);
              const barBottom = baselineY;
              const up = v >= 0.5;
              const fill = up ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)";
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${Math.min(barTop, barBottom).toFixed(
                2
              )}" width="${barW.toFixed(2)}" height="${Math.abs(barTop - barBottom).toFixed(
                2
              )}" rx="3" fill="${fill}" />`;
            })
            .join("\n")}
        </g>
      `;

      const line1 = [
        [0.08, 0.60],
        [0.24, 0.52],
        [0.40, 0.58],
        [0.56, 0.44],
        [0.72, 0.50],
        [0.88, 0.46],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const line2 = [
        [0.08, 0.55],
        [0.24, 0.48],
        [0.40, 0.54],
        [0.56, 0.48],
        [0.72, 0.46],
        [0.88, 0.44],
        [0.95, 0.48],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph += `
        <path d="${pointsToPath(line1)}" ${accentLine}/>
        <path d="${pointsToPath(line2)}" stroke="rgba(255,255,255,0.75)" stroke-width="2" fill="none" stroke-linecap="round"/>
      `;
      break;
    }
    case "bollinger":
    case "bb_bandwidth":
    case "bb_percent_b": {
      // Bollinger: three bands (basis + upper/lower); add width cue for bandwidth.
      const basis = [
        [0.06, 0.48],
        [0.20, 0.54],
        [0.36, 0.40],
        [0.52, 0.62],
        [0.68, 0.52],
        [0.84, 0.66],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const upper = basis.map(([x, y]) => [x, y - innerH * 0.12] as [number, number]);
      const lower = basis.map(([x, y]) => [x, y + innerH * 0.12] as [number, number]);

      glyph = `
        <path d="${pointsToPath(lower)}" stroke="rgba(255,255,255,0.35)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(upper)}" stroke="rgba(255,255,255,0.65)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(basis)}" ${accentLine}/>
      `;
      if (id === "bb_bandwidth") {
        glyph += `
          <g opacity="0.9">
            ${[0.18, 0.26, 0.34, 0.42, 0.50, 0.58, 0.66, 0.74, 0.82]
              .map((tx, i) => {
                const v = [0.20, 0.35, 0.42, 0.28, 0.50, 0.62, 0.48, 0.56, 0.44][i];
                const cx = mapX(tx);
                const barW = innerW / 12;
                const top = mapY(0.25 + v * 0.55);
                return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(2)}" height="${(y1 - top).toFixed(
                  2
                )}" rx="3" fill="${accent}" opacity="0.20"/>`;
              })
              .join("")}
          </g>
        `;
      }
      break;
    }
    case "money_flow":
    case "cmf": {
      // Money Flow / CMF: bars up/down around midline.
      const mid = mapY(0.5);
      const vals = [0.72, 0.42, 0.60, 0.35, 0.68, 0.30, 0.55, 0.46];
      const barW = innerW / vals.length - 4;
      glyph = `
        <g>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const up = v >= 0.5;
              const valT = Math.abs(v - 0.5) * 2; // 0..1ish
              const barH = valT * innerH * 0.7;
              const yTop = up ? mid - barH : mid;
              const hBar = up ? barH : barH;
              const fill = up ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)";
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${yTop.toFixed(2)}" width="${barW.toFixed(
                2
              )}" height="${hBar.toFixed(2)}" rx="3" fill="${fill}" />`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "volume":
    case "vpvr": {
      // Volume: bars with a simple "value area" highlight.
      const vals = [0.25, 0.55, 0.38, 0.70, 0.42, 0.62, 0.34, 0.76, 0.50];
      const barW = innerW / vals.length - 4;
      const base = y1;
      glyph = `
        <g>
          <rect x="${(x0 + innerW * 0.42).toFixed(2)}" y="${(y0 + innerH * 0.25).toFixed(2)}" width="${(innerW * 0.18).toFixed(
            2
          )}" height="${(innerH * 0.65).toFixed(2)}" rx="8" fill="${accent}" opacity="0.14"/>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const barH = v * innerH * 0.75;
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${(base - barH).toFixed(
                2
              )}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="3" fill="${accent}" opacity="${
                id === "vpvr" ? 0.22 : 0.30
              }"/>`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "roc": {
      // ROC: centered line around midline.
      const pts = [
        [0.06, 0.52],
        [0.20, 0.62],
        [0.34, 0.50],
        [0.48, 0.58],
        [0.62, 0.44],
        [0.76, 0.56],
        [0.90, 0.48],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
      `;
      break;
    }
    case "sma":
    case "ema":
    case "ma":
    case "wma":
    case "vwma": {
      // Moving average: a jagged price line + a smoothing MA line.
      const price = [
        [0.06, 0.40],
        [0.14, 0.60],
        [0.22, 0.48],
        [0.30, 0.70],
        [0.38, 0.44],
        [0.46, 0.62],
        [0.54, 0.50],
        [0.62, 0.66],
        [0.70, 0.52],
        [0.78, 0.74],
        [0.86, 0.56],
        [0.95, 0.66],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const ma = [
        [0.06, 0.48],
        [0.22, 0.55],
        [0.38, 0.54],
        [0.54, 0.56],
        [0.70, 0.58],
        [0.86, 0.60],
        [0.95, 0.62],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      glyph = `
        <path d="${pointsToPath(price)}" stroke="rgba(255,255,255,0.30)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(ma)}" ${accentLine}/>
      `;
      break;
    }
    case "vwap": {
      // VWAP: a steady line + highlighted cross points.
      const v = [
        [0.06, 0.44],
        [0.20, 0.50],
        [0.35, 0.46],
        [0.50, 0.56],
        [0.66, 0.52],
        [0.82, 0.60],
        [0.95, 0.55],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const line = pointsToPath(v);
      glyph = `
        <path d="${line}" ${accentLine}/>
        ${[0.18, 0.48, 0.74].map((tx) => {
          const cx = mapX(tx);
          const cy = mapY(0.46 + (tx % 0.2) * 0.12);
          return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="4.5" fill="${accent}" opacity="0.75"/>`;
        }).join("")}
      `;
      break;
    }
    case "fib_levels": {
      // Fibonacci: 3 horizontal lines and a diagonal.
      glyph = `
        <path d="M ${x0} ${y0 + innerH * 0.18} L ${x1} ${y1 - innerH * 0.12}" stroke="${accent}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.95"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.35)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" stroke="rgba(255,255,255,0.45)" stroke-width="2" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.28)} L ${x1} ${mapY(0.28)}" stroke="rgba(255,255,255,0.25)" stroke-width="2" stroke-linecap="round"/>
      `;
      break;
    }
    case "ichimoku_cloud": {
      // Ichimoku: two lines + a filled cloud between them.
      const tenkan = [
        [0.06, 0.60],
        [0.22, 0.52],
        [0.38, 0.58],
        [0.54, 0.46],
        [0.70, 0.54],
        [0.86, 0.50],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const kijun = [
        [0.06, 0.48],
        [0.22, 0.44],
        [0.38, 0.50],
        [0.54, 0.42],
        [0.70, 0.48],
        [0.86, 0.46],
        [0.95, 0.49],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);

      const top = tenkan.map((p, i) => [p[0] + innerW * 0.02, kijun[i][1]] as [number, number]);
      const bottom = tenkan.map((p) => [p[0] + innerW * 0.02, p[1]] as [number, number]);

      const cloudPath = `M ${top.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L ")} L ${bottom
        .slice()
        .reverse()
        .map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
        .join(" L ")} Z`;

      glyph = `
        <path d="${pointsToPath(tenkan)}" ${accentLine}/>
        <path d="${pointsToPath(kijun)}" stroke="rgba(255,255,255,0.75)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${cloudPath}" fill="url(#fillA)" stroke="rgba(255,255,255,0.18)"/>
      `;
      break;
    }
    case "supertrend": {
      // Supertrend: step-like zigzag with a trailing line.
      const pts = [
        [0.06, 0.62],
        [0.18, 0.55],
        [0.30, 0.68],
        [0.42, 0.52],
        [0.54, 0.64],
        [0.66, 0.50],
        [0.78, 0.60],
        [0.90, 0.48],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        ${[0.18, 0.42, 0.66, 0.90]
          .map((tx) => {
            const cx = mapX(tx);
            const cy = mapY(0.5 + Math.sin(tx * 10) * 0.1);
            return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.8" fill="${accent}" opacity="0.8"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "order_block_timeframe": {
      // (Concept) fallthrough: keep default glyph.
      break;
    }
    case "adx": {
      // ADX: two lines with a central baseline + a strength cue.
      const p1 = [
        [0.06, 0.35],
        [0.22, 0.52],
        [0.38, 0.44],
        [0.54, 0.62],
        [0.70, 0.48],
        [0.86, 0.58],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const p2 = [
        [0.06, 0.42],
        [0.22, 0.38],
        [0.38, 0.54],
        [0.54, 0.46],
        [0.70, 0.58],
        [0.86, 0.50],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(p2)}" ${accentLine}/>
        <path d="${pointsToPath(p1)}" stroke="rgba(255,255,255,0.70)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        <rect x="${(x0 + innerW * 0.70).toFixed(2)}" y="${(y0 + innerH * 0.18).toFixed(2)}" width="${(innerW * 0.18).toFixed(
          2
        )}" height="${(innerH * 0.35).toFixed(2)}" rx="10" fill="${accent}" opacity="0.14"/>
      `;
      break;
    }
    case "atr":
    case "atr_pct": {
      // ATR: volatility bars (range).
      const vals = [0.28, 0.40, 0.33, 0.55, 0.42, 0.62, 0.48, 0.58, 0.44];
      const barW = innerW / vals.length - 4;
      glyph = `
        <g>
          ${vals
            .map((v, i) => {
              const cx = x0 + (i + 0.5) * (innerW / vals.length);
              const barH = v * innerH * 0.82;
              const top = y1 - barH;
              return `<rect x="${(cx - barW / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barW.toFixed(
                2
              )}" height="${barH.toFixed(2)}" rx="3" fill="${accent}" opacity="${
                id === "atr_pct" ? 0.28 : 0.32
              }"/>`;
            })
            .join("\n")}
        </g>
      `;
      break;
    }
    case "vortex": {
      // Vortex: two lines and a stronger baseline band.
      const a = [
        [0.06, 0.55],
        [0.22, 0.45],
        [0.38, 0.60],
        [0.54, 0.42],
        [0.70, 0.58],
        [0.86, 0.46],
        [0.95, 0.54],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const b = [
        [0.06, 0.42],
        [0.22, 0.56],
        [0.38, 0.48],
        [0.54, 0.62],
        [0.70, 0.50],
        [0.86, 0.64],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <rect x="${(x0 + innerW * 0.12).toFixed(2)}" y="${(y0 + innerH * 0.14).toFixed(2)}" width="${(innerW * 0.76).toFixed(
          2
        )}" height="${(innerH * 0.08).toFixed(2)}" rx="8" fill="${accent}" opacity="0.14"/>
        <path d="${pointsToPath(a)}" stroke="rgba(255,255,255,0.72)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="${pointsToPath(b)}" ${accentLine}/>
      `;
      break;
    }
    case "ema_ribbon": {
      // Ribbon: stacked EMA lines.
      const levels = [
        0.66, 0.60, 0.54, 0.48, 0.42,
      ];
      glyph = `
        ${levels
          .map((t, i) => {
            const pts = [
              [0.06, t - 0.06],
              [0.20, t + 0.04],
              [0.36, t - 0.02],
              [0.52, t + 0.03],
              [0.68, t - 0.02],
              [0.84, t + 0.02],
              [0.95, t - 0.01],
            ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
            const opacity = (0.90 - i * 0.12).toFixed(2);
            return `<path d="${pointsToPath(pts)}" stroke="${accent}" stroke-width="${(2 - i * 0.15).toFixed(
              2
            )}" fill="none" stroke-linecap="round" opacity="${opacity}"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "psar": {
      // Parabolic SAR: dot trail above/below.
      const dots = [
        [0.10, 0.40],
        [0.20, 0.45],
        [0.32, 0.38],
        [0.44, 0.52],
        [0.56, 0.46],
        [0.68, 0.56],
        [0.80, 0.48],
        [0.92, 0.58],
      ];
      glyph = `
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
        ${dots
          .map(([tx, ty], i) => {
            const cx = mapX(tx);
            const cy = mapY(ty);
            const r = (3.2 + (i % 2) * 0.7).toFixed(2);
            return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${accent}" opacity="0.88"/>`;
          })
          .join("")}
      `;
      break;
    }
    case "keltner":
    case "donchian": {
      // Channels: upper/lower boundaries + middle line.
      const upperT = 0.72;
      const lowerT = 0.30;
      glyph = `
        <path d="M ${x0} ${mapY(upperT)} L ${x1} ${mapY(upperT + 0.02)}" stroke="rgba(255,255,255,0.65)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(lowerT)} L ${x1} ${mapY(lowerT - 0.02)}" stroke="rgba(255,255,255,0.30)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.52)} L ${x1} ${mapY(0.52)}" ${accentSoftLine}/>
        ${id === "donchian" ? `<rect x="${(x0 + innerW * 0.58).toFixed(2)}" y="${(y0 + innerH * 0.20).toFixed(2)}" width="${(innerW * 0.24).toFixed(2)}" height="${(innerH * 0.6).toFixed(2)}" rx="10" fill="${accent}" opacity="0.10"/>` : ``}
      `;
      break;
    }
    case "cci": {
      // CCI: oscillator with -100/0/100 zones.
      const pts = [
        [0.06, 0.54],
        [0.20, 0.68],
        [0.35, 0.44],
        [0.50, 0.62],
        [0.65, 0.34],
        [0.80, 0.58],
        [0.95, 0.48],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.20)} L ${x1} ${mapY(0.20)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.50)} L ${x1} ${mapY(0.50)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "williams_r": {
      // Williams %R: oscillator with 0 / -50 / -100 feel (three lines).
      const pts = [
        [0.06, 0.62],
        [0.18, 0.48],
        [0.32, 0.58],
        [0.46, 0.40],
        [0.60, 0.54],
        [0.74, 0.42],
        [0.88, 0.56],
        [0.95, 0.50],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.20)} L ${x1} ${mapY(0.20)}" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.50)} L ${x1} ${mapY(0.50)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
        <path d="M ${x0} ${mapY(0.80)} L ${x1} ${mapY(0.80)}" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      `;
      break;
    }
    case "obv": {
      // OBV: step line + direction changes.
      const pts = [
        [0.06, 0.46],
        [0.16, 0.52],
        [0.24, 0.44],
        [0.36, 0.58],
        [0.48, 0.48],
        [0.60, 0.62],
        [0.72, 0.50],
        [0.84, 0.66],
        [0.95, 0.56],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(pts)}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.20)" stroke-width="1"/>
      `;
      break;
    }
    case "chaikin_osc": {
      // Chaikin Oscillator: two lines around zero.
      const a = [
        [0.06, 0.60],
        [0.24, 0.50],
        [0.42, 0.56],
        [0.60, 0.44],
        [0.78, 0.52],
        [0.95, 0.46],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      const b = [
        [0.06, 0.52],
        [0.24, 0.56],
        [0.42, 0.48],
        [0.60, 0.56],
        [0.78, 0.46],
        [0.95, 0.52],
      ].map(([tx, ty]) => [mapX(tx), mapY(ty)] as [number, number]);
      glyph = `
        <path d="${pointsToPath(a)}" ${accentLine}/>
        <path d="${pointsToPath(b)}" stroke="rgba(255,255,255,0.72)" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.24)" stroke-width="1"/>
      `;
      break;
    }
    default: {
      // Keep fallback sparkline but ensure it is still a mini "indicator" visual.
      glyph = `
        <path d="${fallbackPath}" ${accentLine}/>
        <path d="M ${x0} ${mapY(0.5)} L ${x1} ${mapY(0.5)}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
        ${id.includes("fib") ? ` <path d="M ${x0} ${mapY(0.8)} L ${x1} ${mapY(0.3)}" stroke="${accent}" stroke-width="2" fill="none" stroke-linecap="round"/>` : ""}
        <circle cx="${(w / 2).toFixed(2)}" cy="${(h - 22).toFixed(2)}" r="${dotR.toFixed(2)}" fill="${accent}" opacity="${dotOpacity.toFixed(2)}"/>
      `;
      break;
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${header}
      <g>${glyph}</g>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getBuiltinAccentColor(id: string): string {
  const idx = hashString(id) % BUILTIN_ACCENT_COLORS.length;
  return BUILTIN_ACCENT_COLORS[idx];
}

function withLibraryMeta(
  ind: Omit<Indicator, "kind" | "accentColor" | "exampleImage"> &
    {
      kind?: Indicator["kind"];
      accentColor?: string;
      exampleImage?: string;
    }
): Indicator {
  const kind = ind.kind ?? "builtin";
  const accentColor = ind.accentColor ?? (kind === "custom" ? CUSTOM_ACCENT_COLOR : getBuiltinAccentColor(ind.id));
  const exampleImage =
    ind.exampleImage ?? makeIndicatorExampleImageForId(ind.id, ind.abbreviation, accentColor);
  const category =
    ind.category ??
    (kind === "custom"
      ? ("Custom" as const)
      : undefined);
  return { ...ind, kind, accentColor, exampleImage, category };
}

// Built-in indicators: merged into the library on load so everyone has a starting set.
// Codes/descriptions are templates; users can still add their own indicators to override behavior.
const BUILTIN_INDICATORS: Array<Omit<Indicator, "createdAt">> = [
  {
    id: "rsi",
    name: "RSI",
    abbreviation: "RSI",
    category: "Momentum",
    description: "Relative Strength Index (momentum oscillator) used to gauge overbought/oversold conditions.",
    code: "// RSI template\n// indicator('RSI', overlay=false)\n// input length = 14\n// plot(rsi(close, length), 'RSI')\n",
  },
  {
    id: "stoch_rsi",
    name: "Stoch RSI",
    abbreviation: "StochRSI",
    category: "Momentum",
    description: "Stochastic oscillator applied to RSI values (often used for mean reversion setups).",
    code: "// StochRSI template\n// plot(stoch(rsi(close, rsiLen), ...), 'StochRSI')\n",
  },
  {
    id: "macd",
    name: "MACD",
    abbreviation: "MACD",
    category: "Momentum",
    description: "Moving Average Convergence Divergence (trend/momentum), based on EMA cross and histogram momentum.",
    code: "// MACD template\n// [macdLine, signalLine, hist] = macd(close, fastLen, slowLen, signalLen)\n",
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    abbreviation: "BB",
    category: "Volatility",
    description: "Volatility bands around a moving average (useful for squeeze and band-walk styles).",
    code: "// Bollinger Bands template\n// basis = sma(close, len)\n// dev = stdev(close, len) * mult\n// plot(basis + dev)\n",
  },
  {
    id: "money_flow",
    name: "Money Flow Index (MFI)",
    abbreviation: "MFI",
    category: "Momentum",
    description: "Money Flow Index uses price and volume to measure buying/selling pressure.",
    code: "// MFI template\n// mfi = mfi(high, low, close, volume, len)\n",
  },
  {
    id: "roc",
    name: "Rate of Change (ROC)",
    abbreviation: "ROC",
    category: "Momentum",
    description: "Rate of Change momentum indicator, measuring percentage change over N periods.",
    code: "// ROC template\n// roc = (close - close[rocLen]) / close[rocLen] * 100\n",
  },
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    abbreviation: "SMA",
    category: "Trend",
    description: "Simple moving average for trend direction and smoothing.",
    code: "// SMA template\n// plot(sma(close, len), 'SMA')\n",
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    abbreviation: "EMA",
    category: "Trend",
    description: "Exponential moving average for trend direction with higher weight on recent prices.",
    code: "// EMA template\n// plot(ema(close, len), 'EMA')\n",
  },
  {
    id: "ma",
    name: "Moving Averages (MA)",
    abbreviation: "MA",
    category: "Trend",
    description: "Generic moving average helper (use SMA/EMA/other MA types depending on your strategy).",
    code: "// MA template\n",
  },
  {
    id: "fib_levels",
    name: "Fibonacci Levels",
    abbreviation: "Fib",
    category: "Structure",
    description: "Fibonacci retracement levels (supports sweep/reversal style entries).",
    code: "// Fib levels template\n",
  },
  {
    id: "order_block_timeframe",
    name: "Order Block Timeframe",
    abbreviation: "OB-TF",
    category: "Structure",
    description: "Concept indicator: identifies order blocks on a chosen higher timeframe.",
    code: "// Order Block TF template (conceptual)\n// You may compute OB zones externally and feed them as data.\n",
  },
  {
    id: "elliott_wave",
    name: "Elliott Wave (concept)",
    abbreviation: "EW",
    category: "Structure",
    description: "Concept indicator representing wave counts/labels for wave-tracking strategies.",
    code: "// Elliott Wave template (conceptual)\n",
  },
  {
    id: "choch_bos_timeframe",
    name: "CHoCH + BOS Timeframe",
    abbreviation: "CHoCH/BOS",
    category: "Structure",
    description: "Concept indicator for market structure shifts (CHoCH) and break of structure (BOS) on a selected timeframe.",
    code: "// CHoCH/BOS template (conceptual)\n",
  },
  {
    id: "sfp",
    name: "SFP (Swing Failure Pattern)",
    abbreviation: "SFP",
    category: "Pattern",
    description: "Concept indicator that tags SFP liquidity grabs for reversal/continuation entries.",
    code: "// SFP template (conceptual)\n",
  },
  {
    id: "fvg",
    name: "FVG (Fair Value Gap)",
    abbreviation: "FVG",
    category: "Pattern",
    description: "Concept indicator for fair value gaps (imbalances) based on candle ranges.",
    code: "// FVG template (conceptual)\n",
  },
  {
    id: "divergence",
    name: "Divergence",
    abbreviation: "Div",
    category: "Momentum",
    description: "Concept indicator for bullish/bearish divergence across oscillators and price.",
    code: "// Divergence template (conceptual)\n",
  },
  {
    id: "supertrend",
    name: "Supertrend",
    abbreviation: "ST",
    category: "Trend",
    description: "Trend-following indicator using ATR bands to signal direction.",
    code: "// Supertrend template\n",
  },
  {
    id: "ichimoku_cloud",
    name: "Ichimoku Cloud",
    abbreviation: "Ich",
    category: "Trend",
    description: "Ichimoku Kinko Hyo cloud indicator for trend direction using Tenkan/Kijun and Senkou spans.",
    code:
      "// Ichimoku Cloud template\n" +
      "// This is a placeholder template.\n" +
      "// Common inputs:\n" +
      "// conversionLineLen = 9\n" +
      "// baseLineLen = 26\n" +
      "// spanBLen = 52\n",
  },
  {
    id: "volume",
    name: "Volume",
    abbreviation: "Vol",
    category: "Volume",
    description: "Volume and volume-based confirmation values.",
    code: "// Volume template\n",
  },
];

// If a strategy has no stored indicator associations yet for the active mode,
// use a sensible starter set so the Journal indicators UI has something to show.
export const DEFAULT_STRATEGY_INDICATOR_IDS: string[] = [
  "rsi",
  "stoch_rsi",
  "macd",
  "bollinger",
  "money_flow",
  "roc",
  "ma",
  "ema",
  "sma",
  "fib_levels",
  "order_block_timeframe",
  "elliott_wave",
  "choch_bos_timeframe",
  "sfp",
  "fvg",
  "divergence",
  "supertrend",
  "ichimoku_cloud",
  "volume",
];

type StrategyIndicatorsMap = Record<string, Record<string, string[]>>; // mode -> strategyId -> indicatorIds
type JournalIndicatorValuesMap = Record<
  string,
  string
>; // `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}` -> value

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadIndicators(): Indicator[] {
  const saved = safeParse<Indicator[]>(localStorage.getItem(INDICATORS_KEY), []).filter((i) => !!i && typeof i.id === "string");

  const merged: Indicator[] = [];

  // Always use the current code-defined built-ins (localStorage should only store custom indicators).
  // This prevents old cached built-in records (from earlier versions) from breaking category filters.
  for (const bi of BUILTIN_INDICATORS) {
    merged.push(
      withLibraryMeta({
        ...(bi as Omit<Indicator, "createdAt">),
        createdAt: 0,
        kind: "builtin",
      } as Indicator)
    );
  }

  // Add any user-added indicators not present in built-ins.
  for (const s of saved) {
    if (!BUILTIN_INDICATORS.some((bi) => bi.id === s.id)) {
      merged.push(
        withLibraryMeta({
          ...(s as Indicator),
          kind: "custom",
        } as Indicator)
      );
    }
  }

  return merged;
}

export function saveIndicators(indicators: Indicator[]) {
  localStorage.setItem(INDICATORS_KEY, JSON.stringify(indicators));
}

export function addIndicator(input: Omit<Indicator, "id" | "createdAt">): Indicator {
  // Custom indicator: mark as custom + give it a distinct accent color.
  const kind: Indicator["kind"] = "custom";
  const accentColor = input.accentColor ?? CUSTOM_ACCENT_COLOR;
  const indicatorId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const abbreviation = input.abbreviation.trim().toUpperCase();
  const providedImage = input.exampleImage && input.exampleImage.trim() ? input.exampleImage : undefined;
  const indicator: Indicator = {
    id: indicatorId,
    createdAt: Date.now(),
    kind,
    name: input.name.trim(),
    abbreviation,
    description: input.description.trim(),
    code: input.code,
    accentColor,
    exampleImage: providedImage ?? makeIndicatorExampleImageForId(indicatorId, abbreviation, accentColor),
    category: input.category ?? ("Custom" as const),
  };
  const all = loadIndicators();
  saveIndicators([indicator, ...all]);
  return indicator;
}

export function updateIndicator(id: string, patch: Partial<Omit<Indicator, "id" | "createdAt">>) {
  const all = loadIndicators();
  const next = all.map((i) =>
    i.id === id
      ? {
          ...i,
          ...patch,
          name: patch.name != null ? patch.name : i.name,
          abbreviation: patch.abbreviation != null ? patch.abbreviation.toUpperCase() : i.abbreviation,
          description: patch.description != null ? patch.description : i.description,
          code: patch.code != null ? patch.code : i.code,
          // Treat "" as "auto" so we fall back to the generator on reload.
          exampleImage: patch.exampleImage === "" ? undefined : patch.exampleImage != null ? patch.exampleImage : i.exampleImage,
          accentColor: patch.accentColor != null ? patch.accentColor : i.accentColor,
          kind: patch.kind != null ? patch.kind : i.kind,
          category: patch.category ?? i.category,
        }
      : i
  );
  saveIndicators(next);
}

export function getPrebuiltIndicatorThumbnails(abbreviation: string, accentColor: string = CUSTOM_ACCENT_COLOR) {
  const abbr = abbreviation.trim() ? abbreviation.trim().toUpperCase() : "IND";
  return BUILTIN_INDICATORS.map((i) => ({
    id: i.id,
    name: i.name,
    abbreviation: i.abbreviation,
    image: makeIndicatorExampleImageForId(i.id, abbr, accentColor),
  }));
}

export function deleteIndicator(id: string) {
  saveIndicators(loadIndicators().filter((i) => i.id !== id));
}

export function loadStrategyIndicatorIds(mode: DataMode, strategyId: number): string[] {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  const byMode = data[mode] ?? {};
  const stored = byMode[String(strategyId)];
  const indicatorIds = new Set(loadIndicators().map((i) => i.id));

  if (Array.isArray(stored)) {
    const cleaned = stored.filter((id) => indicatorIds.has(id));
    return cleaned.length > 0 ? cleaned : DEFAULT_STRATEGY_INDICATOR_IDS;
  }

  return DEFAULT_STRATEGY_INDICATOR_IDS;
}

export function saveStrategyIndicatorIds(mode: DataMode, strategyId: number, indicatorIds: string[]) {
  const data = safeParse<StrategyIndicatorsMap>(localStorage.getItem(STRATEGY_INDICATORS_KEY), {});
  const byMode = data[mode] ?? {};
  byMode[String(strategyId)] = Array.from(new Set(indicatorIds));
  data[mode] = byMode;
  localStorage.setItem(STRATEGY_INDICATORS_KEY, JSON.stringify(data));
}

export type IndicatorPhase = "entry" | "exit";

export function loadJournalIndicatorValue(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string
): string {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  return data[key] ?? "";
}

export function setJournalIndicatorValue(
  mode: DataMode,
  entryId: number,
  tradeIndex: number,
  phase: IndicatorPhase,
  indicatorId: string,
  timeframe: string,
  value: string
) {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const key = `${mode}:${entryId}:${tradeIndex}:${phase}:${indicatorId}:${timeframe}`;
  if (!value.trim()) {
    delete data[key];
  } else {
    data[key] = value;
  }
  localStorage.setItem(JOURNAL_INDICATOR_VALUES_KEY, JSON.stringify(data));
}

export function migrateJournalIndicatorDraftValues(mode: DataMode, fromEntryId: number, toEntryId: number) {
  const data = safeParse<JournalIndicatorValuesMap>(localStorage.getItem(JOURNAL_INDICATOR_VALUES_KEY), {});
  const prefix = `${mode}:${fromEntryId}:`;
  const newPrefix = `${mode}:${toEntryId}:`;
  let changed = false;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      delete data[key];
      const rest = key.slice(prefix.length);
      data[`${newPrefix}${rest}`] = value;
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(JOURNAL_INDICATOR_VALUES_KEY, JSON.stringify(data));
  }
}

