use crate::database::{get_connection, Trade, EmotionalState, Strategy};
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

// Webull CSV format
#[derive(Debug, Serialize, Deserialize)]
pub struct WebullCsvTrade {
    #[serde(rename = "Name")]
    pub name: Option<String>,
    #[serde(rename = "Symbol")]
    pub symbol: String,
    #[serde(rename = "Side")]
    pub side: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Filled")]
    pub filled: i64,
    #[serde(rename = "Total Qty")]
    pub total_qty: i64,
    #[serde(rename = "Price")]
    pub price: String, // Can have "@" prefix
    #[serde(rename = "Avg Price")]
    pub avg_price: String, // Can have "@" prefix
    #[serde(rename = "Time-in-Force")]
    pub time_in_force: Option<String>,
    #[serde(rename = "Placed Time")]
    pub placed_time: String,
    #[serde(rename = "Filled Time")]
    pub filled_time: String,
}

fn parse_price(price_str: &str) -> Result<f64, String> {
    // Remove "@" prefix and parse
    let cleaned = price_str.trim_start_matches('@').trim();
    cleaned.parse::<f64>().map_err(|e| format!("Invalid price: {}", e))
}

fn parse_webull_timestamp(time_str: &str) -> Result<String, String> {
    // Webull format: "12/18/2025 13:25:11 EST" or "12/18/2025 13:25:11 EDT"
    // Convert to ISO 8601 format: "2025-12-18T13:25:11Z"
    if time_str.is_empty() {
        return Err("Empty timestamp".to_string());
    }
    
    // Parse format: MM/DD/YYYY HH:MM:SS TZ
    let parts: Vec<&str> = time_str.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(format!("Invalid timestamp format: {}", time_str));
    }
    
    // Parse date: MM/DD/YYYY
    let date_parts: Vec<&str> = parts[0].split('/').collect();
    if date_parts.len() != 3 {
        return Err(format!("Invalid date format: {}", parts[0]));
    }
    
    let month = date_parts[0].parse::<u32>().map_err(|_| "Invalid month")?;
    let day = date_parts[1].parse::<u32>().map_err(|_| "Invalid day")?;
    let year = date_parts[2].parse::<u32>().map_err(|_| "Invalid year")?;
    
    // Parse time: HH:MM:SS
    let time_parts: Vec<&str> = parts[1].split(':').collect();
    if time_parts.len() != 3 {
        return Err(format!("Invalid time format: {}", parts[1]));
    }
    
    let hour = time_parts[0].parse::<u32>().map_err(|_| "Invalid hour")?;
    let minute = time_parts[1].parse::<u32>().map_err(|_| "Invalid minute")?;
    let second = time_parts[2].parse::<u32>().map_err(|_| "Invalid second")?;
    
    // Format as ISO 8601
    // Note: We're not handling timezone conversion properly, just using the time as-is
    // For a production app, you'd want to convert EST/EDT to UTC
    Ok(format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, hour, minute, second))
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
    pub consecutive_wins: i64,
    pub consecutive_losses: i64,
    pub current_win_streak: i64,
    pub current_loss_streak: i64,
    pub strategy_win_rate: f64,
    pub strategy_winning_trades: i64,
    pub strategy_losing_trades: i64,
    pub strategy_profit_loss: f64,
    pub strategy_consecutive_wins: i64,
    pub strategy_consecutive_losses: i64,
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
    
    // Detect format by reading headers
    let headers = reader.headers().map_err(|e| e.to_string())?;
    let is_webull = headers.iter().any(|h| h == "Filled" || h == "Placed Time" || h == "Filled Time");
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut inserted_ids = Vec::new();
    
    if is_webull {
        // Webull format
        for result in reader.deserialize() {
            let webull_trade: WebullCsvTrade = result.map_err(|e| e.to_string())?;
            
            // Skip cancelled or unfilled trades
            if webull_trade.status == "Cancelled" || webull_trade.filled == 0 {
                continue;
            }
            
            // Use filled time if available and not empty, otherwise placed time
            let timestamp = if !webull_trade.filled_time.trim().is_empty() {
                parse_webull_timestamp(&webull_trade.filled_time).unwrap_or_else(|_| {
                    parse_webull_timestamp(&webull_trade.placed_time).unwrap_or_else(|_| webull_trade.placed_time.clone())
                })
            } else {
                parse_webull_timestamp(&webull_trade.placed_time).unwrap_or_else(|_| webull_trade.placed_time.clone())
            };
            
            // Use avg price if available and not empty, otherwise price
            let price = if !webull_trade.avg_price.trim().is_empty() {
                parse_price(&webull_trade.avg_price).unwrap_or_else(|_| {
                    parse_price(&webull_trade.price).unwrap_or(0.0)
                })
            } else {
                parse_price(&webull_trade.price).unwrap_or(0.0)
            };
            
            if price == 0.0 {
                continue; // Skip trades with invalid prices
            }
            
            // Quantity is the filled amount
            let quantity = webull_trade.filled as f64;
            
            let trade = Trade {
                id: None,
                symbol: webull_trade.symbol,
                side: webull_trade.side,
                quantity,
                price,
                timestamp,
                order_type: webull_trade.time_in_force.unwrap_or_else(|| "DAY".to_string()),
                status: webull_trade.status,
                fees: None,
                notes: webull_trade.name,
                strategy_id: None,
            };
            
            let _id = conn.execute(
                "INSERT INTO trades (symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                    trade.strategy_id
                ],
            ).map_err(|e| e.to_string())?;
            
            inserted_ids.push(conn.last_insert_rowid());
        }
    } else {
        // Standard format
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
                strategy_id: None,
            };
            
            let _id = conn.execute(
                "INSERT INTO trades (symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                    trade.strategy_id
                ],
            ).map_err(|e| e.to_string())?;
            
            inserted_ids.push(conn.last_insert_rowid());
        }
    }
    
    Ok(inserted_ids)
}

#[tauri::command]
pub fn get_trades() -> Result<Vec<Trade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades ORDER BY timestamp DESC")
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
                strategy_id: row.get(10)?,
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
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE id = ?1")
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
                strategy_id: row.get(10)?,
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
        "UPDATE trades SET symbol = ?1, side = ?2, quantity = ?3, price = ?4, timestamp = ?5, order_type = ?6, status = ?7, fees = ?8, notes = ?9, strategy_id = ?10 WHERE id = ?11",
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
            trade.strategy_id,
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
    
    // Calculate streaks (simplified - would need proper trade pairing for accurate streaks)
    let consecutive_wins: i64 = 0; // TODO: Calculate from paired trades
    let consecutive_losses: i64 = 0; // TODO: Calculate from paired trades
    let current_win_streak: i64 = 0; // TODO: Calculate from paired trades
    let current_loss_streak: i64 = 0; // TODO: Calculate from paired trades
    
    // Strategy metrics (for trades with strategies assigned)
    let strategy_stats: (i64, i64, f64) = conn
        .query_row(
            "SELECT 
                COUNT(*) as count,
                SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as sells,
                SUM(CASE WHEN side = 'SELL' THEN quantity * price ELSE -(quantity * price) END) as pnl
            FROM trades 
            WHERE strategy_id IS NOT NULL",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                ))
            },
        )
        .unwrap_or((0, 0, 0.0));
    
    let strategy_winning_trades = strategy_stats.1; // Simplified
    let strategy_losing_trades = strategy_stats.0 - strategy_stats.1; // Simplified
    let strategy_win_rate = if strategy_stats.0 > 0 {
        strategy_winning_trades as f64 / strategy_stats.0 as f64
    } else {
        0.0
    };
    
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
        consecutive_wins,
        consecutive_losses,
        current_win_streak,
        current_loss_streak,
        strategy_win_rate,
        strategy_winning_trades,
        strategy_losing_trades,
        strategy_profit_loss: strategy_stats.2,
        strategy_consecutive_wins: 0, // TODO: Calculate from strategy trades
        strategy_consecutive_losses: 0, // TODO: Calculate from strategy trades
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

// Strategy Management Commands
#[tauri::command]
pub fn create_strategy(name: String, description: Option<String>, notes: Option<String>, color: Option<String>) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO strategies (name, description, notes, color) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, notes, color],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_strategies() -> Result<Vec<Strategy>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, name, description, notes, created_at, color FROM strategies ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let strategy_iter = stmt
        .query_map([], |row| {
            Ok(Strategy {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                description: row.get(2)?,
                notes: row.get(3)?,
                created_at: row.get(4)?,
                color: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut strategies = Vec::new();
    for strategy in strategy_iter {
        strategies.push(strategy.map_err(|e| e.to_string())?);
    }
    
    Ok(strategies)
}

#[tauri::command]
pub fn update_strategy(id: i64, name: String, description: Option<String>, notes: Option<String>, color: Option<String>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE strategies SET name = ?1, description = ?2, notes = ?3, color = ?4 WHERE id = ?5",
        params![name, description, notes, color, id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_strategy(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Set strategy_id to NULL for trades using this strategy
    conn.execute("UPDATE trades SET strategy_id = NULL WHERE strategy_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM strategies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn update_trade_strategy(trade_id: i64, strategy_id: Option<i64>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE trades SET strategy_id = ?1 WHERE id = ?2",
        params![strategy_id, trade_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

// Dashboard Stats Commands
#[derive(Debug, Serialize, Deserialize)]
pub struct TopSymbol {
    pub symbol: String,
    pub trade_count: i64,
    pub total_volume: f64,
    pub estimated_pnl: f64,
}

#[tauri::command]
pub fn get_top_symbols(limit: Option<i64>) -> Result<Vec<TopSymbol>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(5);
    
    let mut stmt = conn
        .prepare(
            "SELECT 
                symbol,
                COUNT(*) as trade_count,
                SUM(quantity * price) as total_volume,
                SUM(CASE WHEN side = 'SELL' THEN quantity * price ELSE -(quantity * price) END) as estimated_pnl
            FROM trades
            GROUP BY symbol
            ORDER BY trade_count DESC
            LIMIT ?1"
        )
        .map_err(|e| e.to_string())?;
    
    let symbol_iter = stmt
        .query_map(params![limit], |row| {
            Ok(TopSymbol {
                symbol: row.get(0)?,
                trade_count: row.get(1)?,
                total_volume: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                estimated_pnl: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut symbols = Vec::new();
    for symbol in symbol_iter {
        symbols.push(symbol.map_err(|e| e.to_string())?);
    }
    
    Ok(symbols)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StrategyPerformance {
    pub strategy_id: Option<i64>,
    pub strategy_name: String,
    pub trade_count: i64,
    pub total_volume: f64,
    pub estimated_pnl: f64,
}

#[tauri::command]
pub fn get_strategy_performance() -> Result<Vec<StrategyPerformance>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare(
            "SELECT 
                t.strategy_id,
                COALESCE(s.name, 'Unassigned') as strategy_name,
                COUNT(*) as trade_count,
                SUM(t.quantity * t.price) as total_volume,
                SUM(CASE WHEN t.side = 'SELL' THEN t.quantity * t.price ELSE -(t.quantity * t.price) END) as estimated_pnl
            FROM trades t
            LEFT JOIN strategies s ON t.strategy_id = s.id
            GROUP BY t.strategy_id, strategy_name
            ORDER BY trade_count DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let perf_iter = stmt
        .query_map([], |row| {
            Ok(StrategyPerformance {
                strategy_id: row.get(0)?,
                strategy_name: row.get(1)?,
                trade_count: row.get(2)?,
                total_volume: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                estimated_pnl: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut performance = Vec::new();
    for perf in perf_iter {
        performance.push(perf.map_err(|e| e.to_string())?);
    }
    
    Ok(performance)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentTrade {
    pub id: i64,
    pub symbol: String,
    pub side: String,
    pub quantity: f64,
    pub price: f64,
    pub timestamp: String,
    pub strategy_name: Option<String>,
}

#[tauri::command]
pub fn get_recent_trades(limit: Option<i64>) -> Result<Vec<RecentTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(5);
    
    let mut stmt = conn
        .prepare(
            "SELECT 
                t.id,
                t.symbol,
                t.side,
                t.quantity,
                t.price,
                t.timestamp,
                s.name as strategy_name
            FROM trades t
            LEFT JOIN strategies s ON t.strategy_id = s.id
            ORDER BY t.timestamp DESC
            LIMIT ?1"
        )
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map(params![limit], |row| {
            Ok(RecentTrade {
                id: row.get(0)?,
                symbol: row.get(1)?,
                side: row.get(2)?,
                quantity: row.get(3)?,
                price: row.get(4)?,
                timestamp: row.get(5)?,
                strategy_name: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut trades = Vec::new();
    for trade in trade_iter {
        trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    Ok(trades)
}

