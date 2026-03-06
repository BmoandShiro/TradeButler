import { test, expect } from "@playwright/test";

test.describe("Analytics Demo -> Real mode switch", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const emptyArr: unknown[] = [];
      const emptyCurve = { points: [] as { date: string; value: number }[], startValue: 0 };
      (window as unknown as { __TAURI_IPC__?: (opts: { cmd: string; callback: number; error: number }) => void }).__TAURI_IPC__ = (opts: { cmd: string; callback: number; error: number }) => {
        const win = window as unknown as Record<string, unknown>;
        const cb = win[`_${opts.callback}`] as (r: unknown) => void;
        const err = win[`_${opts.error}`] as (e: unknown) => void;
        if (typeof cb !== "function") return;
        let result: unknown;
        if (opts.cmd === "get_trades") result = emptyArr;
        else if (opts.cmd === "get_symbol_pnl") result = emptyArr;
        else if (opts.cmd === "get_equity_curve") result = emptyCurve;
        else if (opts.cmd === "get_journal_entries") result = emptyArr;
        else if (opts.cmd === "get_all_journal_trades") result = emptyArr;
        else if (opts.cmd === "get_strategies") result = emptyArr;
        else result = {};
        setTimeout(() => cb(result), 0);
      };
    });
  });

  test("switching from Demo to Real updates Analytics and console shows expected flow", async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("[DataMode]") ||
        text.includes("[Layout]") ||
        text.includes("[Analytics]")
      ) {
        logs.push(text);
      }
    });

    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    await page.evaluate(() => {
      localStorage.setItem("tradebutler_data_mode", "sandbox");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    const realButton = page.locator("button", { hasText: "Real" });
    await expect(realButton).toBeVisible();
    await realButton.click();

    await page.waitForTimeout(1500);

    const hasDataModeDispatch = logs.some(
      (l) => l.includes("setCurrentDataMode") && l.includes("real")
    );
    const hasSubscriptionReceived = logs.some(
      (l) => l.includes("subscription callback received mode") && l.includes("real")
    );
    const hasModeLoadTargetEffect = logs.some(
      (l) => l.includes("modeLoadTarget effect running") && l.includes("real")
    );
    const hasLoadDataReal = logs.some(
      (l) => l.includes("loadData called") && l.includes("effectiveMode") && l.includes("real")
    );

    const summary = logs.join("\n");
    expect(hasDataModeDispatch, `Expected [DataMode] setCurrentDataMode: real in logs.\n${summary}`).toBe(true);
    expect(hasSubscriptionReceived, `Expected Analytics subscription callback with mode real.\n${summary}`).toBe(true);
    expect(hasModeLoadTargetEffect, `Expected modeLoadTarget effect running for real.\n${summary}`).toBe(true);
    expect(hasLoadDataReal, `Expected loadData called with effectiveMode real.\n${summary}`).toBe(true);
  });
});
