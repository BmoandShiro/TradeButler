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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmotionSurvey {
    pub id: Option<i64>,
    pub emotional_state_id: i64,
    pub timestamp: String,
    // Before the Trade (1-8)
    pub before_calm_clear: i32, // 1-5
    pub before_urgency_pressure: i32, // 1-5
    pub before_confidence_vs_validation: i32, // 1-5
    pub before_fomo: i32, // 1-5
    pub before_recovering_loss: i32, // 1-5
    pub before_patient_detached: i32, // 1-5
    pub before_trust_process: i32, // 1-5
    pub before_emotional_state: i32, // 1-5 (bored, excited, anxious, neutral)
    // During the Trade (9-15)
    pub during_stable: i32, // 1-5
    pub during_tension_stress: i32, // 1-5
    pub during_tempted_interfere: i32, // 1-5
    pub during_need_control: i32, // 1-5
    pub during_fear_loss: i32, // 1-5
    pub during_excitement_greed: i32, // 1-5
    pub during_mentally_present: i32, // 1-5
    // After the Trade (16-20)
    pub after_accept_outcome: i32, // 1-5
    pub after_emotional_reaction: i32, // 1-5
    pub after_confidence_affected: i32, // 1-5
    pub after_tempted_another_trade: i32, // 1-5
    pub after_proud_discipline: i32, // 1-5
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Strategy {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub color: Option<String>,
    pub display_order: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JournalEntry {
    pub id: Option<i64>,
    pub date: String,
    pub title: String,
    pub strategy_id: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JournalTrade {
    pub id: Option<i64>,
    pub journal_entry_id: i64,
    pub symbol: Option<String>,
    pub position: Option<String>,
    pub timeframe: Option<String>,
    pub entry_type: Option<String>,
    pub exit_type: Option<String>,
    pub trade: Option<String>,
    pub what_went_well: Option<String>,
    pub what_could_be_improved: Option<String>,
    pub emotional_state: Option<String>,
    pub notes: Option<String>,
    pub outcome: Option<String>,
    pub trade_order: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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
    
    // Add display_order to strategies if it doesn't exist
    let _ = conn.execute(
        "ALTER TABLE strategies ADD COLUMN display_order INTEGER DEFAULT 0",
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
            checklist_type TEXT NOT NULL DEFAULT 'entry',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
        )",
        [],
    )?;
    
    // Add checklist_type column if it doesn't exist (migration for existing databases)
    let _ = conn.execute(
        "ALTER TABLE strategy_checklists ADD COLUMN checklist_type TEXT NOT NULL DEFAULT 'entry'",
        [],
    );
    
    // Add parent_id column for grouping (migration for existing databases)
    let _ = conn.execute(
        "ALTER TABLE strategy_checklists ADD COLUMN parent_id INTEGER",
        [],
    );
    
    // Add foreign key for parent_id if it doesn't exist
    // Note: SQLite doesn't support adding foreign keys via ALTER TABLE easily,
    // so we'll handle this in the application logic

    // Create index for strategy_checklists
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_strategy_checklists_strategy ON strategy_checklists(strategy_id)",
        [],
    )?;

    // Create journal_entries table for storing trade journal entries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            title TEXT NOT NULL,
            strategy_id INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (strategy_id) REFERENCES strategies(id)
        )",
        [],
    )?;

    // Create journal_trades table for storing individual trades within journal entries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS journal_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_entry_id INTEGER NOT NULL,
            symbol TEXT,
            position TEXT,
            timeframe TEXT,
            entry_type TEXT,
            exit_type TEXT,
            trade TEXT,
            what_went_well TEXT,
            what_could_be_improved TEXT,
            emotional_state TEXT,
            notes TEXT,
            outcome TEXT,
            trade_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
        )",
        [],
    )?;
    
    // Add new columns if they don't exist (migration)
    let _ = conn.execute("ALTER TABLE journal_trades ADD COLUMN position TEXT", []);
    let _ = conn.execute("ALTER TABLE journal_trades ADD COLUMN timeframe TEXT", []);
    let _ = conn.execute("ALTER TABLE journal_trades ADD COLUMN entry_type TEXT", []);
    let _ = conn.execute("ALTER TABLE journal_trades ADD COLUMN exit_type TEXT", []);

    // Create index for journal_entries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_journal_entries_strategy ON journal_entries(strategy_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_journal_trades_entry ON journal_trades(journal_entry_id)",
        [],
    )?;

    // Create journal_checklist_responses table for storing checklist responses for journal entries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS journal_checklist_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_entry_id INTEGER NOT NULL,
            checklist_item_id INTEGER NOT NULL,
            is_checked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
            FOREIGN KEY (checklist_item_id) REFERENCES strategy_checklists(id) ON DELETE CASCADE,
            UNIQUE(journal_entry_id, checklist_item_id)
        )",
        [],
    )?;

    // Create index for journal_checklist_responses
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_journal_checklist_responses_entry ON journal_checklist_responses(journal_entry_id)",
        [],
    )?;

    // Create journal_entry_pairs table for linking trade pairs to journal entries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS journal_entry_pairs (
            journal_entry_id INTEGER NOT NULL,
            entry_trade_id INTEGER NOT NULL,
            exit_trade_id INTEGER NOT NULL,
            PRIMARY KEY (journal_entry_id, entry_trade_id, exit_trade_id),
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_journal_entry_pairs_entry ON journal_entry_pairs(journal_entry_id)",
        [],
    )?;

    // Create emotion_surveys table for storing detailed emotion surveys linked to emotional states
    conn.execute(
        "CREATE TABLE IF NOT EXISTS emotion_surveys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            emotional_state_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            before_calm_clear INTEGER NOT NULL,
            before_urgency_pressure INTEGER NOT NULL,
            before_confidence_vs_validation INTEGER NOT NULL,
            before_fomo INTEGER NOT NULL,
            before_recovering_loss INTEGER NOT NULL,
            before_patient_detached INTEGER NOT NULL,
            before_trust_process INTEGER NOT NULL,
            before_emotional_state INTEGER NOT NULL,
            during_stable INTEGER NOT NULL,
            during_tension_stress INTEGER NOT NULL,
            during_tempted_interfere INTEGER NOT NULL,
            during_need_control INTEGER NOT NULL,
            during_fear_loss INTEGER NOT NULL,
            during_excitement_greed INTEGER NOT NULL,
            during_mentally_present INTEGER NOT NULL,
            after_accept_outcome INTEGER NOT NULL,
            after_emotional_reaction INTEGER NOT NULL,
            after_confidence_affected INTEGER NOT NULL,
            after_tempted_another_trade INTEGER NOT NULL,
            after_proud_discipline INTEGER NOT NULL,
            FOREIGN KEY (emotional_state_id) REFERENCES emotional_states(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index for emotion_surveys
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_emotion_surveys_state ON emotion_surveys(emotional_state_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_emotion_surveys_timestamp ON emotion_surveys(timestamp)",
        [],
    )?;

    Ok(())
}

pub fn get_connection(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path)
}

