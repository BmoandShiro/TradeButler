/**
 * Sync version from single source (src-tauri/Cargo.toml) to:
 * - src-tauri/tauri.conf.json (package.version)
 * - package.json (version)
 * - src-tauri/src/commands.rs (comment example TradeButler-X.Y.Z.msi)
 *
 * Run from repo root (TradeButler folder): npm run version:sync
 * After running, do: npm install (updates package-lock.json), cargo build (updates Cargo.lock).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARGO_TOML = path.join(ROOT, "src-tauri", "Cargo.toml");
const TAURI_CONF = path.join(ROOT, "src-tauri", "tauri.conf.json");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const COMMANDS_RS = path.join(ROOT, "src-tauri", "src", "commands.rs");

function readVersionFromCargo() {
  const content = fs.readFileSync(CARGO_TOML, "utf8");
  const m = content.match(/version\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("Could not find version in " + CARGO_TOML);
  return m[1];
}

function updateTauriConf(version) {
  const data = JSON.parse(fs.readFileSync(TAURI_CONF, "utf8"));
  if (!data.package) data.package = {};
  data.package.version = version;
  fs.writeFileSync(TAURI_CONF, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("Updated src-tauri/tauri.conf.json -> version:", version);
}

function updatePackageJson(version) {
  const data = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  data.version = version;
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("Updated package.json -> version:", version);
}

function updateCommandsRs(version) {
  let content = fs.readFileSync(COMMANDS_RS, "utf8");
  content = content.replace(
    /(TradeButler-)\d+\.\d+\.\d+(\.msi)/g,
    `$1${version}$2`
  );
  fs.writeFileSync(COMMANDS_RS, content, "utf8");
  console.log("Updated src-tauri/src/commands.rs (comment example) -> TradeButler-" + version + ".msi");
}

function main() {
  console.log("Single source: src-tauri/Cargo.toml");
  const version = readVersionFromCargo();
  console.log("Version:", version);
  updateTauriConf(version);
  updatePackageJson(version);
  updateCommandsRs(version);
  console.log("Done. Run 'npm install' and 'cargo build' to refresh lockfiles.");
}

main();
