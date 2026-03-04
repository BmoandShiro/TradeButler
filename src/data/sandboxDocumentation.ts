/**
 * Sandbox seed data and storage keys for Resources (Documentation) in Sandbox mode.
 */

export const SANDBOX_DOCUMENTATION_KEY = "tradebutler_documentation_sandbox";
export const SANDBOX_DOCUMENTATION_ORDER_KEY = "tradebutler_documentation_sandbox_order";

export interface DocPageSeed {
  id: string;
  title: string;
  content: string;
  parentId: string | null;
  order: number;
}

export function getSandboxDocumentationSeed(): DocPageSeed[] {
  return [
    {
      id: "sandbox-res-risk",
      title: "Risk Management Rules",
      parentId: null,
      order: 0,
      content: "<p><strong>Position sizing</strong></p><ul><li>Never risk more than 1–2% of account per trade.</li><li>Max 3–5 open positions at once.</li><li>Reduce size in drawdown.</li></ul><p><strong>Stops</strong></p><ul><li>Always use a hard stop (ATR or structure).</li><li>No moving stops against the trade.</li></ul>",
    },
    {
      id: "sandbox-res-premarket",
      title: "Pre-Market Checklist",
      parentId: null,
      order: 1,
      content: "<p>Run through this before the open:</p><ol><li>Review overnight news and futures.</li><li>Check watchlist for key levels and volume.</li><li>Note market regime (trending / range / gap).</li><li>Set alerts and plan entries.</li><li>Confirm risk per trade and daily loss limit.</li></ol>",
    },
    {
      id: "sandbox-res-premarket-levels",
      title: "Key Levels",
      parentId: "sandbox-res-premarket",
      order: 0,
      content: "<p>Mark on your chart:</p><ul><li>Previous day high / low / close</li><li>VWAP and session VWAP</li><li>Round numbers and options strikes</li><li>Multi-day support/resistance</li></ul>",
    },
    {
      id: "sandbox-res-premarket-setups",
      title: "Today's Setups",
      parentId: "sandbox-res-premarket",
      order: 1,
      content: "<p>List 1–3 planned setups with:</p><ul><li>Symbol and direction</li><li>Entry zone and invalidation</li><li>Target (R or level)</li><li>Which strategy (ORB, pullback, etc.)</li></ul>",
    },
    {
      id: "sandbox-res-plan",
      title: "Trading Plan Template",
      parentId: null,
      order: 2,
      content: "<p><strong>Edge</strong>: What you trade (e.g. ORB, pullbacks).</p><p><strong>Rules</strong>: Entry, exit, size, timeframes.</p><p><strong>Non‑negotiables</strong>: No revenge trades, no FOMO, max daily loss.</p><p><strong>Review</strong>: Weekly journal and stats.</p>",
    },
    {
      id: "sandbox-res-plan-rules",
      title: "Entry & Exit Rules",
      parentId: "sandbox-res-plan",
      order: 0,
      content: "<p><strong>Entry</strong>: Confluence of structure, volume, and timeframe. One clear trigger.</p><p><strong>Exit</strong>: Target (R or level), stop, or time stop. No discretionary “hoping.”</p>",
    },
    {
      id: "sandbox-res-journal",
      title: "Journaling Guidelines",
      parentId: null,
      order: 3,
      content: "<p>After each trade (or day), note:</p><ul><li>Setup and outcome (win/loss, R).</li><li>What went well and what to improve.</li><li>Emotional state (calm, FOMO, revenge).</li><li>One action for next time.</li></ul><p>Use TradeButler’s Journal and Emotions to keep this consistent.</p>",
    },
    {
      id: "sandbox-res-glossary",
      title: "Terminology",
      parentId: null,
      order: 4,
      content: "<p><strong>ORB</strong>: Opening Range Breakout – first 30 min range.</p><p><strong>VWAP</strong>: Volume-weighted average price.</p><p><strong>R (R-multiple)</strong>: Risk unit; 1R = 1× your stop distance in $.</p><p><strong>ADR</strong>: Average daily range.</p>",
    },
  ];
}

export function resetSandboxDocumentation(): void {
  if (typeof window === "undefined") return;
  const seed = getSandboxDocumentationSeed();
  window.localStorage.setItem(SANDBOX_DOCUMENTATION_KEY, JSON.stringify(seed));
  window.localStorage.setItem(
    SANDBOX_DOCUMENTATION_ORDER_KEY,
    JSON.stringify(seed.filter((p) => !p.parentId).sort((a, b) => a.order - b.order).map((p) => p.id))
  );
}
