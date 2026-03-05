/**
 * One-off script to check strategy_checklists for duplicate rows.
 * Run: node scripts/check-checklist-duplicates.js
 * DB path: %APPDATA%\com.tradebutler.app\tradebutler.db (Windows)
 */
import fs from "fs";

const dbPath =
  process.env.APPDATA?.replace(/\\/g, "/") + "/com.tradebutler.app/tradebutler.db";
const winPath = process.platform === "win32" ? dbPath?.replace(/\//g, "\\") : dbPath;

if (!winPath || !fs.existsSync(winPath)) {
  console.error("Database not found at", winPath || dbPath);
  process.exit(1);
}

async function main() {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(winPath);
  const db = new SQL.Database(buf);

  const dupQuery = `
    SELECT strategy_id, checklist_type, item_text, item_order, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM strategy_checklists
    WHERE item_text != '__empty_custom_checklist_placeholder__'
    GROUP BY strategy_id, checklist_type, item_text, item_order
    HAVING COUNT(*) > 1
  `;
  const res = db.exec(dupQuery);
  db.close();

  if (!res.length || !res[0].values.length) {
    console.log("No duplicate rows found in strategy_checklists (same strategy_id, checklist_type, item_text, item_order).");
    return;
  }

  const cols = res[0].columns;
  console.log("Duplicate rows in strategy_checklists:\n");
  console.log(cols.join(" | "));
  console.log("-".repeat(80));
  for (const row of res[0].values) {
    console.log(row.join(" | "));
  }
  console.log("\nTotal duplicate groups:", res[0].values.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
