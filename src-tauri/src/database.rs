use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Trade {
    pub id: Option<i64>,
    pub symbol: String,
    pub side: String, // "BUY" or "SELL"
    pub quantity: f64,
    pub price: f64,
    pub timestamp: String,
    pub order_type: String,
    pub status: String,
    pub fees: Option<f64>,
    pub notes: Option<String>,
    pub strategy_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmotionalState {
    pub id: Option<i64>,
    pub timestamp: String,
    pub emotion: String, // "Confident", "Anxious", "Frustrated", "Excited", etc.
    pub intensity: i32, // 1-10 scale
    pub notes: Option<String>,
    pub trade_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Strategy {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub color: Option<String>,
}

pub fn init_database(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;

    // Create trades table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity REAL NOT NULL,
            price REAL NOT NULL,
            timestamp TEXT NOT NULL,
            order_type TEXT NOT NULL,
            status TEXT NOT NULL,
            fees REAL,
            notes TEXT,
            strategy_id INTEGER
        )",
        [],
    )?;

    // Create emotional_states table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS emotional_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            emotion TEXT NOT NULL,
            intensity INTEGER NOT NULL,
            notes TEXT,
            trade_id INTEGER,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        )",
        [],
    )?;

    // Create strategies table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            color TEXT
        )",
        [],
    )?;

    // Add strategy_id to trades if it doesn't exist (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
    // We'll try to add it and ignore the error if it already exists
    let _ = conn.execute(
        "ALTER TABLE trades ADD COLUMN strategy_id INTEGER",
        [],
    );
    
    // Create index for strategy_id
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id)",
        [],
    )?;

    // Create indexes for better query performance
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_emotional_states_timestamp ON emotional_states(timestamp)",
        [],
    )?;

    // Create pair_notes table for storing notes on trade pairs
    conn.execute(
        "CREATE TABLE IF NOT EXISTS pair_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_trade_id INTEGER NOT NULL,
            exit_trade_id INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(entry_trade_id, exit_trade_id)
        )",
        [],
    )?;

    // Create index for pair_notes
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pair_notes_trades ON pair_notes(entry_trade_id, exit_trade_id)",
        [],
    )?;

    // Create strategy_checklists table for storing strategy checklist items
    conn.execute(
        "CREATE TABLE IF NOT EXISTS strategy_checklists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            strategy_id INTEGER NOT NULL,
            item_text TEXT NOT NULL,
            is_checked INTEGER NOT NULL DEFAULT 0,
            item_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index for strategy_checklists
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_strategy_checklists_strategy ON strategy_checklists(strategy_id)",
        [],
    )?;

    Ok(())
}

pub fn get_connection(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path)
}

