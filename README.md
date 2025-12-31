# TradeButler

A local-first trading analytics and metrics application with emotional state tracking.

## Features

- 📊 **Trade Analytics**: Import CSV files to automatically log trades and view comprehensive metrics
- 📈 **Real-time Metrics**: Track win rate, P&L, volume, and more
- 💭 **Emotional State Tracking**: Log your emotional state while trading to identify patterns
- 🎨 **Dark Theme**: Beautiful, modern dark theme optimized for Windows 11
- 🔒 **Privacy First**: All data stored locally on your machine
- 🌐 **Future Networking**: Infrastructure ready for trading groups (coming soon)

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Tauri (Rust)
- **Database**: SQLite (local)
- **Charts**: Recharts (analytics), Lightweight Charts (interactive stock charts)
- **Drag & Drop**: @dnd-kit (dashboard customization)

## Getting Started

### Prerequisites

- **Node.js 18+** and npm - [Download](https://nodejs.org/)
- **Rust & Cargo** - [Install from rustup.rs](https://rustup.rs/)
- **Windows 11** (or Windows 10)
- **Microsoft Visual C++ Build Tools** - [Download](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (required for Rust on Windows)

See [REQUIREMENTS.md](REQUIREMENTS.md) for detailed setup instructions.

### Quick Setup

1. **Run the setup script** (configures environment automatically):
```powershell
.\setup.ps1
```

This will:
- Check if Rust/Cargo is installed
- Add Cargo to your PATH permanently (if needed)
- Install npm dependencies

2. **Run in development mode:**

**Option A: Use the convenience script (recommended)**
```powershell
# PowerShell
.\dev.ps1

# Or Batch file
dev.bat
```

**Option B: Manual command**
```bash
npm run tauri:dev
```

3. **Build for production:**
```bash
npm run tauri:build
```

The built application will be in `src-tauri/target/release/`

## CSV Import Format

Your CSV file should have the following columns (headers required):
- `symbol`: Trading symbol (e.g., "AAPL", "BTC/USD")
- `side`: "BUY" or "SELL"
- `quantity`: Number of shares/units
- `price`: Price per unit
- `timestamp`: ISO 8601 format (e.g., "2024-01-15T10:30:00Z")
- `order_type`: (Optional) Order type (e.g., "MARKET", "LIMIT") - defaults to "MARKET"
- `status`: (Optional) Order status (e.g., "FILLED", "PENDING") - defaults to "FILLED"
- `fees`: (Optional) Trading fees
- `notes`: (Optional) Additional notes

See `example-trades.csv` for a sample file format.

## Roadmap

- [x] Enhanced P&L calculation with trade pairing (FIFO/LIFO)
- [x] Advanced charting and visualization (equity curve, drawdown analysis, interactive stock charts)
- [x] Trade filtering and search
- [x] Strategy assignment and performance tracking
- [x] Evaluation metrics (weekday/time-of-day performance, tilt analysis, concentration metrics)
- [ ] Trading group networking features
- [ ] Export functionality
- [ ] Performance optimization

## License

MIT

