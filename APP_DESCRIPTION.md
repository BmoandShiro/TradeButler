# TradeButler — App Descriptions

Use the sections below for your **CV/Resume**, **GitHub**, and **download/release** pages. **Section 1** is optimized with recruiter-friendly buzzwords and ATS keywords to help land interviews.

---

## 1. CV / Resume — Buzzword-Optimized (job-search ready)

Use this for Projects, Portfolio, or Experience bullets. Written to pass ATS filters and resonate with recruiters and hiring managers.

### ATS keywords (paste into Skills or Summary)
*Use this comma-separated list in a “Technologies” or “Keywords” line so ATS and recruiters match you to roles.*

```
Full-stack development, TypeScript, React, Rust, Tauri, SQLite, SQL, data modeling, RESTful APIs, single-page application (SPA), state management, component-based architecture, responsive UI, Vite, local-first, offline-first, production deployment, end-to-end ownership, cross-platform desktop, Windows, analytics, data visualization, Recharts, performance optimization, security (authentication, encryption), JSON, CSV parsing, ETL, build tooling, CI/CD-ready, shipped product
```

### One-liner (for tight space)
**TradeButler** — End-to-end **full-stack** desktop app (React, TypeScript, Tauri/Rust, SQLite): **architected** and **shipped** local-first trading analytics with P&L, strategy tracking, emotional surveys, FIFO/LIFO **data pipelines**, equity curves, and in-app updates.

### Short paragraph (2–3 sentences) — strong action verbs
**TradeButler** is a **production-ready**, local-first Windows desktop app for trade logging, **analytics**, and emotional-state tracking. **Architected** and **delivered** the full stack: a **Rust/Tauri** backend with 60+ **command handlers**, **SQLite** schema design and migrations, and a **React/TypeScript** frontend with **custom dashboards**, **drag-and-drop** metric layout, **strategy checklists**, and **psychometric surveys**. **Implemented** CSV/Webull **data import**, FIFO/LIFO **trade pairing**, **equity-curve** and **drawdown** analytics, **interactive charts** (Lightweight Charts), **theme/lock-screen** customization, **in-app version checker** (Settings) with one-click updates (portable .exe or MSI **installer**), and multi-format **distribution** (portable, MSI, NSIS).

### Bullet list (pick 4–6 for CV) — buzzword-heavy

- **Full-stack & architecture:** Architected and delivered end-to-end ownership of a production desktop app—Rust/Tauri backend (~5.6k LOC), React/TypeScript SPA, SQLite data layer—with 60+ Tauri command handlers for trades, strategies, journal, emotions, analytics, and app lifecycle; demonstrated full-stack development and cross-platform desktop delivery.
- **Data engineering & analytics:** Built scalable data pipelines (import → pair → P&L): CSV/Webull ETL, FIFO/LIFO pairing logic, symbol- and strategy-level aggregations, daily rollups; implemented equity curve, max/longest drawdown, best surge, and risk metrics (Sharpe-style, tilt, concentration) in Rust for performance-critical analytics.
- **Frontend & UX:** Implemented responsive, component-based UI: customizable dashboard with drag-and-drop metric cards (@dnd-kit), timeframe filters (7d–1y, YTD, custom range), sortable/filterable data tables, per-route scroll state; integrated rich-text editor (Quill), nested/grouped strategy checklists with drag-reorder, and data visualization (Recharts, Lightweight Charts).
- **Data modeling & product:** Designed and shipped a 20-question psychometric “before/during/after trade” survey with Likert scales, SQLite persistence, and Recharts visualization to support data-driven emotional-pattern and tilt analysis; end-to-end ownership from schema to UI.
- **Security & theming:** Implemented optional app lock (PIN/password), four lock-screen themes, theme presets with custom color picker, and app-wide galaxy background; demonstrated attention to security, UX customization, and production polish.
- **DevOps & distribution:** Delivered in-app version checker (Settings) calling GitHub Releases API, semantic version compare, installer-vs-portable detection (exe path), one-click MSI or portable .exe download, release notes in update modal; multi-format distribution (portable .exe, MSI, NSIS) via Tauri; shipped maintainable, user-updatable desktop product.

### Tech stack (for “Technologies” or “Skills demonstrated”) — keyword-rich
**Frontend:** React 18, TypeScript, Vite, React Router, Zustand, Recharts, Lightweight Charts, Quill, @dnd-kit, date-fns, Lucide — *component architecture, state management, data visualization, responsive UI*  
**Backend / runtime:** Tauri 1.x, Rust, rusqlite, serde, chrono — *cross-platform desktop, async, type-safe APIs*  
**Data:** SQLite, schema design, migrations — *local-first, offline-first, data modeling*  
**Distribution:** Tauri bundler (portable exe, MSI, NSIS), in-app update checks — *production deployment, shipped product*

---

### 1b. Strengthened CV text (with technical details)

*Use this version when you want to show depth: encryption, schema, pairing logic, scroll restoration, export/import, and other implementation specifics. Copy-paste the paragraph and the six sections below.*

---

**Opening paragraph**

TradeButler is a production-ready, local-first Windows desktop application for trade logging, analytics, and emotional-state tracking. Architected and delivered the full stack: a Rust/Tauri backend with 60+ command handlers, SQLite schema design and migrations, and a React/TypeScript frontend with custom dashboards, drag-and-drop metric layout, strategy checklists, and psychometric surveys. In-app version checker (Settings), one-click updates (installer or portable), and multi-format distribution (portable .exe, MSI, NSIS) round out the deployment story.

---

**Full-Stack Architecture & Development**

Architected and delivered end-to-end ownership of a production desktop app—Rust/Tauri backend (~5.6k LOC in a single commands module), React/TypeScript SPA, SQLite data layer—with 60+ `#[tauri::command]` handlers exposed via Tauri IPC (`invoke`) for trades, strategies, journal, emotions, analytics, chart/quote fetching, and app lifecycle (version check, export/import, clear data). Version sourced at compile time via `env!("CARGO_PKG_VERSION")`. Demonstrated full-stack development and cross-platform desktop delivery with complete ownership from design to distribution.

---

**Data Engineering & Analytics**

Built scalable data pipelines (import → pair → P&L): CSV/Webull ETL with custom timestamp parsing (Webull **MM/DD/YYYY HH:MM:SS** → ISO 8601); **FIFO/LIFO** pairing implemented in Rust with **HashMap**-based long/short position tracking per symbol, **prorated fees** per partial fill, and **options-aware P&L** (options symbol detection via C/P + date pattern, **100× multiplier** for contract P&L). Symbol- and strategy-level aggregations, daily rollups, and duplicate detection on import (e.g. by symbol, side, quantity, price, timestamp). Implemented equity curve, max/longest drawdown, best surge, and risk metrics (Sharpe-style, tilt, concentration) in Rust for performance-critical analytics.

---

**Frontend & User Experience**

Implemented responsive, component-based UI: customizable dashboard with drag-and-drop metric cards (@dnd-kit), timeframe filters (7d–1y, YTD, custom range), sortable/filterable data tables. **Per-route scroll persistence**: `localStorage` key `scroll_${path}` plus in-memory ref; restore in **useLayoutEffect** (before paint) with **MutationObserver** (childList, subtree, attributes) and 100ms / 3s fallback timeouts when content loads asynchronously; passive scroll listeners for live save. Dedicated **scrollManager** for tab- and panel-level scroll in Journal/Strategies (tab positions and left/right panel scroll persisted per storage key). Integrated rich-text editor (Quill), nested/grouped strategy checklists with drag-reorder, and data visualization (Recharts, Lightweight Charts).

**Trade chart (entries & exits):** Built an **interactive candlestick chart** (Lightweight Charts) that shows how a position was opened and closed. **Historical price** is loaded via a Tauri command (Yahoo Finance) for the symbol and date range. Each **buy** is a green **arrow-up** marker and each **sell** a red **arrow-down** marker, with labels like “BUY 10 @ $150.25” so every fill is visible on the chart. **Horizontal price lines** show the effective **entry** and **exit** levels (teal and red by default; user-configurable). When viewing a paired trade or a multi-fill position, the chart shows all fills as markers and the overall entry/exit as lines. **P&L** for the selection is shown in the chart header (e.g. “P&L: $ -0.52”). The chart updates with symbol, date range, and timeframe (1m–1d); options symbols use the underlying for historical data.

---

**Data Modeling & Product Innovation**

Designed and maintained **10+ normalized SQLite tables** (trades, emotional_states, strategies, pair_notes, strategy_checklists, journal_entries, journal_trades, journal_checklist_responses, emotion_surveys) with **indexes** on timestamp, symbol, strategy_id, journal_entry_id, and **ON DELETE CASCADE** where appropriate. **Additive migrations** via `ALTER TABLE` for new columns (e.g. display_order, checklist_type, parent_id, journal_trades columns) without breaking existing installs. Shipped a 20-question psychometric "before/during/after trade" survey with Likert 1–5, persisted in **emotion_surveys** (20 columns), and Recharts visualization for data-driven emotional-pattern and tilt analysis. End-to-end ownership from schema design to UI implementation, demonstrating product thinking and user psychology understanding.

---

**Security & Customization**

Implemented optional app lock with PIN (6-digit) or password authentication: **PBKDF2-SHA256** key derivation (100,000 iterations), **128-bit cryptographically random salt** via Web Crypto API (`crypto.getRandomValues`), **constant-time comparison** on verify to mitigate timing attacks, and **no plaintext storage**—hash and salt stored separately in localStorage with legacy migration to PBKDF2 on next successful login. **Destructive-action confirmations**: in-app "Clear All Data" requires the user to type **"DELETE"** exactly before enabling the confirm button; **forgot-PIN reset** on the lock screen requires typing **"I FORGOT MY PASSWORD I WILL LOSE ALL DATA"** before full data wipe and credential removal (custom theme presets preserved across reset). Delivered four lock-screen themes, theme presets with custom color picker, and app-wide galaxy background—demonstrating attention to security hygiene, UX safeguards, and production polish.

---

**DevOps & Distribution**

Delivered an **in-app version checker** in Settings that calls the **GitHub Releases API** (`/repos/.../releases/latest`, fallback to `/releases` on 404), performs **semantic version comparison** (x.y.z), and returns current vs latest, download URL, **release notes** (GitHub release body), and **installer vs portable** flag. **Update flow**: user taps "Check for updates" → if a newer version exists, a modal shows release notes (Markdown-rendered "What's New") and a Download button; **installer detection** (exe path contains "Program Files") determines behavior—**installer builds** get one-click **MSI download and run** (`download_and_install_update`); **portable builds** get a save-dialog then **portable .exe download** to user-chosen path (`download_portable_update`). **Distribution** includes both **portable** (single .exe, no install, run from folder or USB) and **installer** builds (**MSI** for standard Windows install, Start Menu, Add/Remove Programs; **NSIS** as alternative installer)—all produced by the Tauri bundler. **JSON backup/restore**: versioned **ExportData** (version "1.0", `export_date` RFC3339, all entity types); **ImportResult** with per-entity **imported/skipped** counts; **ID mapping** on import to preserve foreign keys. Shipped maintainable, user-updatable desktop product with professional deployment pipeline.

---

**Technical details you can name-drop in interviews**

| Area | Details |
|------|--------|
| **App lock** | PBKDF2-SHA256, 100k iterations, 16-byte salt, Web Crypto API, constant-time compare, legacy migration to PBKDF2. |
| **Confirmations** | "DELETE" for in-app clear-all-trades; "I FORGOT MY PASSWORD I WILL LOSE ALL DATA" for lock-screen full reset (all four lock themes). |
| **Pairing** | HashMap long/short positions per symbol, FIFO/LIFO, prorated fees, options detection (C/P + date), 100× multiplier. |
| **Schema** | 10+ tables, indexes on timestamp/symbol/strategy_id, ON DELETE CASCADE, additive ALTER TABLE migrations. |
| **Scroll UX** | Per-route localStorage + in-memory map, useLayoutEffect + MutationObserver, passive scroll, scrollManager for tabs/panels. |
| **Export/import** | Versioned ExportData, ImportResult imported/skipped counts, ID mapping for FK preservation. |
| **Version checker** | In-app (Settings); GitHub Releases API (latest, fallback on 404); semantic x.y.z compare; returns current, latest, download_url, release_notes (Markdown in modal), is_installer. |
| **Update flow** | Installer (exe in "Program Files"): one-click MSI download + run. Portable: save-dialog → portable .exe to user path. |
| **Distribution** | Portable (single .exe, no install, folder/USB); MSI (Start Menu, Add/Remove Programs); NSIS (alternative installer); Tauri bundler. |
| **Trade charts** | Lightweight Charts candlestick; green/red arrow markers per buy/sell fill (qty, price); horizontal entry/exit lines; P&L in header; Yahoo Finance via Tauri; options use underlying for history. |

---

## 2. GitHub — Project description & feature list

### Tagline
**TradeButler** — A local-first trading journal and analytics app for Windows. Log trades, track strategies, analyze P&L and drawdowns, and review emotional patterns—all offline.

### Short summary (for repo “About” / top of README)
TradeButler is a desktop application for traders who want a private, offline-first journal: CSV/Webull import, automatic trade pairing (FIFO/LIFO), strategy-based organization, rich journaling with checklists, emotional-state and psychometric surveys, and analytics (equity curve, drawdowns, weekday/time-of-day performance). Built with **Tauri (Rust)** and **React/TypeScript**; data stays in a local SQLite database.

### Features (for README “Features” section)

**Trade management**
- Import trades from CSV or Webull-format CSV
- Automatic trade pairing (FIFO or LIFO) with configurable method
- View by individual fills or by closed pairs; filter by symbol, strategy, date
- Assign trades to strategies; filter and sort (date, symbol, P&L, quantity, etc.)
- Per-pair notes; **interactive trade chart** (Lightweight Charts): candlestick plus green/red arrow markers for each buy/sell fill, horizontal entry/exit price lines, P&L in header; symbol/date-range and timeframe (1m–1d) loading

**Strategies**
- Create, edit, reorder, and color-code strategies
- Strategy-level checklists with custom types, nested groups, and drag-and-drop ordering
- Strategy performance metrics and comparison across timeframes

**Journal**
- Date-based journal entries with rich-text (Quill) and strategy linkage
- Multiple “trade rows” per entry: symbol, position, timeframe, entry/exit type, what went well / could improve, emotional state, notes, outcome
- Link journal entries to strategy checklists and psychometric survey responses
- Maximizable panels and scroll-position memory across routes

**Emotions & psychology**
- Log emotional states (type + intensity) with optional trade link
- Optional 20-question “before / during / after trade” survey (Likert 1–5)
- Charts and lists to review emotion and survey patterns over time

**Analytics & evaluation**
- Dashboard: win rate, P&L, volume, streaks, expectancy, profit factor, Sharpe-style ratio, max drawdown, best/worst day, fees, etc.
- Customizable dashboard: drag-and-drop metric cards, show/hide, add from preset list
- Timeframe filters: 7d, 30d, 90d, 180d, 1y, YTD, custom date range
- Analytics: equity curve, drawdown (max/longest), best surge, symbol P&L
- Evaluation: performance by weekday, day-of-month, and time-of-day; strategy comparison; tilt and concentration metrics

**Calculators**
- Average-down calculator: average entry price across multiple lots
- Dividend calculator: dividend scenarios with optional DRIP

**Calendar**
- Calendar view of trading activity and performance

**Settings & security**
- Theme system: preset themes + custom colors (picker); saved preferences
- Optional app lock (PIN or password) with multiple lock-screen visuals (default, Galaxy, Aurora, Milky Way)
- Optional galaxy-style background across the app
- In-app update check: detect new version, download portable .exe or MSI, run installer
- JSON backup/restore (export and import)

**Data & privacy**
- All data in a local SQLite database; no required cloud or account
- Optional use of network only for version checks, chart data, and stock quotes

### Tech stack (for README)
- **Frontend:** React 18, TypeScript, Vite, React Router, Zustand, Recharts, Lightweight Charts, Quill, @dnd-kit, date-fns, Lucide React
- **Backend / runtime:** Tauri 1.x, Rust
- **Database:** SQLite (rusqlite)
- **Build / distribution:** Vite, Tauri CLI; outputs portable .exe, MSI, NSIS on Windows

---

## 3. Download / Release page — User-facing copy

### Headline
**TradeButler** — Your trades, your data, on your machine.

### Subhead
A free, local-first trading journal for Windows. Import trades, track strategies, analyze performance, and learn from your emotions—without sending your data to the cloud.

### Why TradeButler?
- **Private:** Everything stays on your PC in a local database.
- **Flexible:** CSV or Webull export? Import in one click. FIFO or LIFO? Your choice.
- **Structured:** Strategies, checklists, and journals keep your process consistent.
- **Insightful:** Equity curves, drawdowns, win rate, and “before/during/after” emotion surveys help you spot patterns. Interactive charts show each entry and exit on the price chart.
- **Yours:** No account, no subscription, no lock-in. Export and backup anytime.

### What you can do
- **Log trades** — Import from CSV/Webull or add manually; auto-pair entries and exits (FIFO/LIFO).
- **Organize by strategy** — Tag trades, use checklists, and see performance per strategy.
- **Journal** — Rich-text notes, per-trade reflections, and linked checklists.
- **Track emotions** — Quick emotion logs plus an optional 20-question survey to review mindset around trades.
- **Analyze** — Dashboard with customizable metrics, equity curve, drawdowns, and performance by weekday and time of day. **Visualize trades** on interactive candlestick charts: each buy/sell fill as a marker, entry/exit lines, and P&L in the header.
- **Plan** — Average-down and dividend calculators built in.
- **Customize** — Themes, custom colors, lock screen style, and optional app lock (PIN/password).
- **Stay updated** — In-app check for new versions and one-click download (portable or installer).

### Downloads
- **Portable** — Single .exe, no install. Run from a folder or USB.
- **Installer (MSI)** — Standard Windows install, Start Menu shortcut, Add/Remove Programs.

### System requirements
- Windows 10/11 (64-bit)
- ~50–100 MB disk space
- WebView2 (usually already present or prompted by Windows)

---

*Use **Section 1** for your CV and portfolio. Use **Section 2** for the GitHub README “About” and Features. Use **Section 3** for the download or release announcement page.*
