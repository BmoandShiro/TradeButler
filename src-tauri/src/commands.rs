use crate::database::{get_connection, Trade, EmotionalState};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct CsvTrade {
    pub symbol: String,
    pub side: String,
    pub quantity: f64,
    pub price: f64,
    pub timestamp: String,
    pub order_type: Option<String>,
    pub status: Option<String>,
    pub fees: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Metrics {
    pub total_trades: i64,
    pub winning_trades: i64,
    pub losing_trades: i64,
    pub total_profit_loss: f64,
    pub win_rate: f64,
    pub average_profit: f64,
    pub average_loss: f64,
    pub largest_win: f64,
    pub largest_loss: f64,
    pub total_volume: f64,
    pub trades_by_symbol: Vec<SymbolStats>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolStats {
    pub symbol: String,
    pub count: i64,
    pub profit_loss: f64,
}

fn get_db_path() -> PathBuf {
    // Use the same path calculation as in main.rs
    // Tauri's app_data_dir uses %APPDATA% on Windows (roaming), not %LOCALAPPDATA%
    // So we use data_dir() instead of data_local_dir()
    let db_dir = dirs::data_dir()
        .expect("Failed to get app data directory")
        .join("com.tradebutler.app");
    
    // Ensure directory exists
    std::fs::create_dir_all(&db_dir).expect("Failed to create app data directory");
    
    db_dir.join("tradebutler.db")
}

#[tauri::command]
pub fn import_trades_csv(csv_data: String) -> Result<Vec<i64>, String> {
    use csv::ReaderBuilder;
    
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .from_reader(csv_data.as_bytes());
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut inserted_ids = Vec::new();
    
    for result in reader.deserialize() {
        let csv_trade: CsvTrade = result.map_err(|e| e.to_string())?;
        
        let trade = Trade {
            id: None,
            symbol: csv_trade.symbol,
            side: csv_trade.side,
            quantity: csv_trade.quantity,
            price: csv_trade.price,
            timestamp: csv_trade.timestamp,
            order_type: csv_trade.order_type.unwrap_or_else(|| "MARKET".to_string()),
            status: csv_trade.status.unwrap_or_else(|| "FILLED".to_string()),
            fees: csv_trade.fees,
            notes: csv_trade.notes,
        };
        
        let _id = conn.execute(
            "INSERT INTO trades (symbol, side, quantity, price, timestamp, order_type, status, fees, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                trade.symbol,
                trade.side,
                trade.quantity,
                trade.price,
                trade.timestamp,
                trade.order_type,
                trade.status,
                trade.fees,
                trade.notes
            ],
        ).map_err(|e| e.to_string())?;
        
        inserted_ids.push(conn.last_insert_rowid());
    }
    
    Ok(inserted_ids)
}

#[tauri::command]
pub fn get_trades() -> Result<Vec<Trade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes FROM trades ORDER BY timestamp DESC")
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map([], |row| {
            Ok(Trade {
                id: Some(row.get(0)?),
                symbol: row.get(1)?,
                side: row.get(2)?,
                quantity: row.get(3)?,
                price: row.get(4)?,
                timestamp: row.get(5)?,
                order_type: row.get(6)?,
                status: row.get(7)?,
                fees: row.get(8)?,
                notes: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut trades = Vec::new();
    for trade in trade_iter {
        trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    Ok(trades)
}

#[tauri::command]
pub fn get_trade_by_id(id: i64) -> Result<Option<Trade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes FROM trades WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    
    let trade_result = stmt
        .query_row(params![id], |row| {
            Ok(Trade {
                id: Some(row.get(0)?),
                symbol: row.get(1)?,
                side: row.get(2)?,
                quantity: row.get(3)?,
                price: row.get(4)?,
                timestamp: row.get(5)?,
                order_type: row.get(6)?,
                status: row.get(7)?,
                fees: row.get(8)?,
                notes: row.get(9)?,
            })
        });
    
    match trade_result {
        Ok(trade) => Ok(Some(trade)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn update_trade(id: i64, trade: Trade) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE trades SET symbol = ?1, side = ?2, quantity = ?3, price = ?4, timestamp = ?5, order_type = ?6, status = ?7, fees = ?8, notes = ?9 WHERE id = ?10",
        params![
            trade.symbol,
            trade.side,
            trade.quantity,
            trade.price,
            trade.timestamp,
            trade.order_type,
            trade.status,
            trade.fees,
            trade.notes,
            id
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_trade(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM trades WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyPnL {
    pub date: String,
    pub profit_loss: f64,
    pub trade_count: i64,
}

#[tauri::command]
pub fn get_daily_pnl() -> Result<Vec<DailyPnL>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Group trades by date and calculate P&L
    // For now, we'll use a simple calculation: SELL - BUY per symbol per day
    // This is simplified - a full implementation would match buy/sell pairs
    // SQLite uses date() function, and we need to handle the date format
    let mut stmt = conn
        .prepare(
            "SELECT 
                date(timestamp) as trade_date,
                COUNT(*) as trade_count,
                SUM(CASE WHEN side = 'SELL' THEN quantity * price ELSE -(quantity * price) END) as daily_pnl
            FROM trades
            GROUP BY date(timestamp)
            ORDER BY trade_date DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let daily_iter = stmt
        .query_map([], |row| {
            Ok(DailyPnL {
                date: row.get::<_, String>(0)?,
                profit_loss: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                trade_count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut daily_pnl = Vec::new();
    for day in daily_iter {
        daily_pnl.push(day.map_err(|e| e.to_string())?);
    }
    
    Ok(daily_pnl)
}

#[tauri::command]
pub fn get_metrics() -> Result<Metrics, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // This is a simplified metrics calculation
    // In a real app, you'd need to match buy/sell pairs to calculate P&L
    let total_trades: i64 = conn
        .query_row("SELECT COUNT(*) FROM trades", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    
    // For now, we'll calculate basic metrics
    // A full implementation would need to pair trades
    let total_volume: f64 = conn
        .query_row("SELECT SUM(quantity * price) FROM trades", [], |row| {
            Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0))
        })
        .map_err(|e| e.to_string())?;
    
    Ok(Metrics {
        total_trades,
        winning_trades: 0,
        losing_trades: 0,
        total_profit_loss: 0.0,
        win_rate: 0.0,
        average_profit: 0.0,
        average_loss: 0.0,
        largest_win: 0.0,
        largest_loss: 0.0,
        total_volume,
        trades_by_symbol: vec![],
    })
}

#[tauri::command]
pub fn add_emotional_state(
    timestamp: String,
    emotion: String,
    intensity: i32,
    notes: Option<String>,
    trade_id: Option<i64>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![timestamp, emotion, intensity, notes, trade_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_emotional_states() -> Result<Vec<EmotionalState>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, timestamp, emotion, intensity, notes, trade_id FROM emotional_states ORDER BY timestamp DESC")
        .map_err(|e| e.to_string())?;
    
    let state_iter = stmt
        .query_map([], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut states = Vec::new();
    for state in state_iter {
        states.push(state.map_err(|e| e.to_string())?);
    }
    
    Ok(states)
}

