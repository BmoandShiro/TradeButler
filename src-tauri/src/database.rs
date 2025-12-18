use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
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
            notes TEXT
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

    Ok(())
}

pub fn get_connection(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path)
}

