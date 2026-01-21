use crate::database::{get_connection, Trade, EmotionalState, EmotionSurvey, Strategy, JournalEntry, JournalTrade};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use chrono::{Timelike, Datelike};

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
    // Optional fee fields - Webull may have different column names
    #[serde(rename = "Commission")]
    pub commission: Option<String>,
    #[serde(rename = "Fees")]
    pub fees: Option<String>,
    #[serde(rename = "Fee")]
    pub fee: Option<String>,
    #[serde(rename = "Total Fees")]
    pub total_fees: Option<String>,
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
    // Additional metrics
    pub expectancy: f64,
    pub profit_factor: f64,
    pub average_trade: f64,
    pub total_fees: f64,
    pub net_profit: f64,
    pub max_drawdown: f64,
    pub sharpe_ratio: f64,
    pub risk_reward_ratio: f64,
    pub trades_per_day: f64,
    pub best_day: f64,
    pub worst_day: f64,
    pub best_day_date: Option<String>,
    pub worst_day_date: Option<String>,
    pub largest_win_group_id: Option<i64>,
    pub largest_loss_group_id: Option<i64>,
    pub average_holding_time_seconds: f64,
    pub average_gain_pct: f64,
    pub average_loss_pct: f64,
    pub largest_win_pct: f64,
    pub largest_loss_pct: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolStats {
    pub symbol: String,
    pub count: i64,
    pub profit_loss: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PairedTrade {
    pub symbol: String,
    pub entry_trade_id: i64,
    pub exit_trade_id: i64,
    pub quantity: f64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub entry_timestamp: String,
    pub exit_timestamp: String,
    pub gross_profit_loss: f64,
    pub entry_fees: f64,
    pub exit_fees: f64,
    pub net_profit_loss: f64,
    pub strategy_id: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolPnL {
    pub symbol: String,
    pub closed_positions: i64,
    pub open_position_qty: f64,
    pub total_gross_pnl: f64,
    pub total_net_pnl: f64,
    pub total_fees: f64,
    pub winning_trades: i64,
    pub losing_trades: i64,
    pub win_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TradeWithPairing {
    pub trade: Trade,
    pub entry_pairs: Vec<PairedTrade>, // Pairs where this trade is the entry (BUY)
    pub exit_pairs: Vec<PairedTrade>,  // Pairs where this trade is the exit (SELL)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PositionGroup {
    pub entry_trade: Trade,
    pub position_trades: Vec<Trade>, // All trades (BUY and SELL) that make up this position
    pub total_pnl: f64,
    pub final_quantity: f64, // Remaining quantity after all trades (0.0 if fully closed)
}

// Detect if a symbol is an options contract
// Options typically have patterns like: SPY251218C00679000 (underlying + date + C/P + strike)
// Or: ABR251121P00011000
fn is_options_symbol(symbol: &str) -> bool {
    // Options symbols are typically longer and contain:
    // 1. A 6-digit date (YYMMDD format)
    // 2. C (Call) or P (Put) indicator
    // 3. Strike price digits
    // Pattern: Usually 12+ characters, contains C or P followed by numbers
    
    if symbol.len() < 10 {
        return false; // Too short to be an option
    }
    
    // Check for C or P followed by digits (strike price)
    // This is the most reliable indicator - options always have C or P
    let has_call_put = symbol.contains('C') || symbol.contains('P');
    
    if !has_call_put {
        return false; // No C or P means it's not an option
    }
    
    // Check for 6-digit date pattern (YYMMDD) - typically appears before C/P
    let has_date_pattern = symbol.chars()
        .collect::<Vec<_>>()
        .windows(6)
        .any(|w| {
            w.iter().all(|c| c.is_ascii_digit())
        });
    
    // Options symbols are typically much longer than stock symbols
    // If it has C/P and is long enough OR has a date pattern, it's an option
    has_call_put && (has_date_pattern || symbol.len() > 15)
}

// Extract underlying symbol from options contract
// Examples: SPY251218C00679000 -> SPY, ABR251121P00011000 -> ABR
// For regular stocks, returns the symbol as-is
fn get_underlying_symbol(symbol: &str) -> String {
    if symbol.is_empty() {
        return symbol.to_string();
    }
    
    // Option symbols typically have format: BASESYMBOL + 6DIGITDATE + C/P + STRIKE
    // Find the first digit in the symbol - everything before it is the base symbol
    let first_digit_pos = symbol.chars().position(|c| c.is_ascii_digit());
    
    if let Some(pos) = first_digit_pos {
        // Found a digit, extract everything before it as the base symbol
        let base = &symbol[..pos];
        // Only return base if it's not empty and looks like a valid symbol (at least 1 char)
        if !base.is_empty() {
            return base.to_string();
        }
    }
    
    // No digits found or empty base - it's already a base symbol (e.g., "SPY", "ABR")
    symbol.to_string()
}

// Pair trades using FIFO method
fn pair_trades_fifo(trades: Vec<Trade>) -> (Vec<PairedTrade>, Vec<Trade>) {
    pair_trades(trades, true)
}

// Pair trades using LIFO method
fn pair_trades_lifo(trades: Vec<Trade>) -> (Vec<PairedTrade>, Vec<Trade>) {
    pair_trades(trades, false)
}

// Generic pairing function - is_fifo=true for FIFO, false for LIFO
fn pair_trades(trades: Vec<Trade>, is_fifo: bool) -> (Vec<PairedTrade>, Vec<Trade>) {
    use std::collections::HashMap;
    
    let mut paired_trades = Vec::new();
    // Long positions: BUY to open, SELL to close
    let mut long_positions: HashMap<String, Vec<(i64, f64, f64, String, f64, Option<i64>)>> = HashMap::new();
    // Short positions: SELL to open, BUY to close
    let mut short_positions: HashMap<String, Vec<(i64, f64, f64, String, f64, Option<i64>)>> = HashMap::new();
    
    // Sort trades by timestamp
    let mut sorted_trades = trades;
    sorted_trades.sort_by(|a, b| {
        a.timestamp.cmp(&b.timestamp)
    });
    
    for trade in sorted_trades {
        let trade_id = trade.id.unwrap_or(0);
        let symbol = trade.symbol.clone();
        
        if trade.side.to_uppercase() == "BUY" {
            // BUY can either:
            // 1. Open a long position (if no matching short positions)
            // 2. Close a short position (if short positions exist)
            
            // First, try to close short positions
            if let Some(positions) = short_positions.get_mut(&symbol) {
                let mut remaining_buy_qty = trade.quantity;
                let buy_price = trade.price;
                let buy_timestamp = trade.timestamp.clone();
                let total_buy_fees = trade.fees.unwrap_or(0.0);
                let buy_strategy_id = trade.strategy_id;
                let total_buy_qty = trade.quantity;
                
                while remaining_buy_qty > 0.0001 && !positions.is_empty() {
                    let position_index = if is_fifo { 0 } else { positions.len() - 1 };
                    let (sell_id, sell_remaining_qty, sell_price, sell_timestamp, sell_fees, sell_strategy_id) = 
                        positions[position_index].clone();
                    
                    let qty_to_close = remaining_buy_qty.min(sell_remaining_qty);
                    
                    // Prorate fees
                    let sell_fee_ratio = qty_to_close / sell_remaining_qty;
                    let prorated_sell_fees = sell_fees * sell_fee_ratio;
                    let buy_fee_ratio = qty_to_close / total_buy_qty;
                    let prorated_buy_fees = total_buy_fees * buy_fee_ratio;
                    
                    // For short positions: SELL to open (entry), BUY to close (exit)
                    // P&L = entry_price - exit_price (you received premium, paid to close)
                    let gross_pnl = (sell_price - buy_price) * qty_to_close;
                    let net_pnl = gross_pnl - prorated_sell_fees - prorated_buy_fees;
                    
                    // Multiply by 100 for options
                    let options_multiplier = if is_options_symbol(&symbol) { 100.0 } else { 1.0 };
                    let gross_pnl_adjusted = gross_pnl * options_multiplier;
                    let net_pnl_adjusted = net_pnl * options_multiplier;
                    
                    // Create paired trade (SELL is entry, BUY is exit for short positions)
                    paired_trades.push(PairedTrade {
                        symbol: symbol.clone(),
                        entry_trade_id: sell_id,
                        exit_trade_id: trade_id,
                        quantity: qty_to_close,
                        entry_price: sell_price,
                        exit_price: buy_price,
                        entry_timestamp: sell_timestamp,
                        exit_timestamp: buy_timestamp.clone(),
                        gross_profit_loss: gross_pnl_adjusted,
                        entry_fees: prorated_sell_fees,
                        exit_fees: prorated_buy_fees,
                        net_profit_loss: net_pnl_adjusted,
                        strategy_id: sell_strategy_id.or(buy_strategy_id),
                        notes: None,
                    });
                    
                    remaining_buy_qty -= qty_to_close;
                    positions[position_index].1 -= qty_to_close;
                    
                    if positions[position_index].1 < 0.0001 {
                        positions.remove(position_index);
                    }
                }
                
                // If there's remaining quantity, open a long position
                if remaining_buy_qty > 0.0001 {
                    long_positions
                        .entry(symbol.clone())
                        .or_insert_with(Vec::new)
                        .push((
                            trade_id,
                            remaining_buy_qty,
                            buy_price,
                            buy_timestamp,
                            total_buy_fees * (remaining_buy_qty / total_buy_qty),
                            buy_strategy_id,
                        ));
                }
            } else {
                // No short positions to close, open a long position
                long_positions
                    .entry(symbol.clone())
                    .or_insert_with(Vec::new)
                    .push((
                        trade_id,
                        trade.quantity,
                        trade.price,
                        trade.timestamp.clone(),
                        trade.fees.unwrap_or(0.0),
                        trade.strategy_id,
                    ));
            }
        } else if trade.side.to_uppercase() == "SELL" {
            // SELL can either:
            // 1. Open a short position (if no matching long positions)
            // 2. Close a long position (if long positions exist)
            
            // First, try to close long positions
            if let Some(positions) = long_positions.get_mut(&symbol) {
                let mut remaining_sell_qty = trade.quantity;
                let sell_price = trade.price;
                let sell_timestamp = trade.timestamp.clone();
                let total_sell_fees = trade.fees.unwrap_or(0.0);
                let sell_strategy_id = trade.strategy_id;
                let total_sell_qty = trade.quantity;
                
                while remaining_sell_qty > 0.0001 && !positions.is_empty() {
                    let position_index = if is_fifo { 0 } else { positions.len() - 1 };
                    let (buy_id, buy_remaining_qty, buy_price, buy_timestamp, buy_fees, buy_strategy_id) = 
                        positions[position_index].clone();
                    
                    let qty_to_close = remaining_sell_qty.min(buy_remaining_qty);
                    
                    // Prorate fees
                    let buy_fee_ratio = qty_to_close / buy_remaining_qty;
                    let prorated_buy_fees = buy_fees * buy_fee_ratio;
                    let sell_fee_ratio = qty_to_close / total_sell_qty;
                    let prorated_sell_fees = total_sell_fees * sell_fee_ratio;
                    
                    // For long positions: BUY to open (entry), SELL to close (exit)
                    // P&L = exit_price - entry_price
                    let gross_pnl = (sell_price - buy_price) * qty_to_close;
                    let net_pnl = gross_pnl - prorated_buy_fees - prorated_sell_fees;
                    
                    // Multiply by 100 for options
                    let options_multiplier = if is_options_symbol(&symbol) { 100.0 } else { 1.0 };
                    let gross_pnl_adjusted = gross_pnl * options_multiplier;
                    let net_pnl_adjusted = net_pnl * options_multiplier;
                    
                    // Create paired trade (BUY is entry, SELL is exit for long positions)
                    paired_trades.push(PairedTrade {
                        symbol: symbol.clone(),
                        entry_trade_id: buy_id,
                        exit_trade_id: trade_id,
                        quantity: qty_to_close,
                        entry_price: buy_price,
                        exit_price: sell_price,
                        entry_timestamp: buy_timestamp,
                        exit_timestamp: sell_timestamp.clone(),
                        gross_profit_loss: gross_pnl_adjusted,
                        entry_fees: prorated_buy_fees,
                        exit_fees: prorated_sell_fees,
                        net_profit_loss: net_pnl_adjusted,
                        strategy_id: buy_strategy_id.or(sell_strategy_id),
                        notes: None,
                    });
                    
                    remaining_sell_qty -= qty_to_close;
                    positions[position_index].1 -= qty_to_close;
                    
                    if positions[position_index].1 < 0.0001 {
                        positions.remove(position_index);
                    }
                }
                
                // If there's remaining quantity, open a short position
                if remaining_sell_qty > 0.0001 {
                    short_positions
                        .entry(symbol.clone())
                        .or_insert_with(Vec::new)
                        .push((
                            trade_id,
                            remaining_sell_qty,
                            sell_price,
                            sell_timestamp,
                            total_sell_fees * (remaining_sell_qty / total_sell_qty),
                            sell_strategy_id,
                        ));
                }
            } else {
                // No long positions to close, open a short position
                short_positions
                    .entry(symbol.clone())
                    .or_insert_with(Vec::new)
                    .push((
                        trade_id,
                        trade.quantity,
                        trade.price,
                        trade.timestamp.clone(),
                        trade.fees.unwrap_or(0.0),
                        trade.strategy_id,
                    ));
            }
        }
    }
    
    // Return remaining open positions as unpaired trades
    let mut open_trades = Vec::new();
    for (symbol, positions) in long_positions {
        for (id, qty, price, timestamp, fees, strategy_id) in positions {
            if qty > 0.0001 {
                open_trades.push(Trade {
                    id: Some(id),
                    symbol: symbol.clone(),
                    side: "BUY".to_string(),
                    quantity: qty,
                    price,
                    timestamp,
                    order_type: "OPEN".to_string(),
                    status: "OPEN".to_string(),
                    fees: Some(fees),
                    notes: None,
                    strategy_id,
                });
            }
        }
    }
    for (symbol, positions) in short_positions {
        for (id, qty, price, timestamp, fees, strategy_id) in positions {
            if qty > 0.0001 {
                open_trades.push(Trade {
                    id: Some(id),
                    symbol: symbol.clone(),
                    side: "SELL".to_string(),
                    quantity: qty,
                    price,
                    timestamp,
                    order_type: "OPEN".to_string(),
                    status: "OPEN".to_string(),
                    fees: Some(fees),
                    notes: None,
                    strategy_id,
                });
            }
        }
    }
    
    (paired_trades, open_trades)
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
            
            // Parse fees from any available fee field
            let fees = webull_trade.commission
                .or(webull_trade.fees)
                .or(webull_trade.fee)
                .or(webull_trade.total_fees)
                .and_then(|f| {
                    // Remove any currency symbols and parse
                    let cleaned = f.trim().replace("$", "").replace(",", "");
                    cleaned.parse::<f64>().ok()
                });
            
            let trade = Trade {
                id: None,
                symbol: webull_trade.symbol,
                side: webull_trade.side,
                quantity,
                price,
                timestamp,
                order_type: webull_trade.time_in_force.unwrap_or_else(|| "DAY".to_string()),
                status: webull_trade.status,
                fees,
                notes: webull_trade.name,
                strategy_id: None,
            };
            
            // Check for duplicate trade (same symbol, side, quantity, price, and timestamp)
            let existing: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM trades WHERE symbol = ?1 AND side = ?2 AND quantity = ?3 AND price = ?4 AND timestamp = ?5",
                    params![trade.symbol, trade.side, trade.quantity, trade.price, trade.timestamp],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            
            if existing > 0 {
                continue; // Skip duplicate trade
            }
            
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
            
            // Check for duplicate trade (same symbol, side, quantity, price, and timestamp)
            let existing: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM trades WHERE symbol = ?1 AND side = ?2 AND quantity = ?3 AND price = ?4 AND timestamp = ?5",
                    params![trade.symbol, trade.side, trade.quantity, trade.price, trade.timestamp],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            
            if existing > 0 {
                continue; // Skip duplicate trade
            }
            
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
pub fn get_trades_with_pairing(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<TradeWithPairing>, String> {
    use std::collections::HashMap;
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Build date filter clause
    let date_filter = if start_date.is_some() || end_date.is_some() {
        let mut filter = String::from(" WHERE 1=1");
        if let Some(start) = &start_date {
            filter.push_str(&format!(" AND timestamp >= '{}'", start));
        }
        if let Some(end) = &end_date {
            filter.push_str(&format!(" AND timestamp <= '{}'", end));
        }
        filter
    } else {
        String::new()
    };
    
    // Get all trades
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades{} ORDER BY timestamp DESC", date_filter))
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
    
    let mut all_trades = Vec::new();
    for trade in trade_iter {
        all_trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    // Get paired trades
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (mut paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(all_trades.clone())
    } else {
        pair_trades_lifo(all_trades.clone())
    };
    
    // Load notes for paired trades
    load_pair_notes(&conn, &mut paired_trades).map_err(|e| e.to_string())?;
    
    // Create a map of trade_id -> paired trades
    let mut entry_map: HashMap<i64, Vec<PairedTrade>> = HashMap::new();
    let mut exit_map: HashMap<i64, Vec<PairedTrade>> = HashMap::new();
    
    // Filter paired trades by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    for paired in filtered_paired_trades {
        entry_map.entry(paired.entry_trade_id).or_insert_with(Vec::new).push(paired.clone());
        exit_map.entry(paired.exit_trade_id).or_insert_with(Vec::new).push(paired);
    }
    
    // Convert to TradeWithPairing
    let mut result = Vec::new();
    for trade in all_trades {
        let trade_id = trade.id.unwrap_or(0);
        let entry_pairs = entry_map.get(&trade_id).cloned().unwrap_or_default();
        let exit_pairs = exit_map.get(&trade_id).cloned().unwrap_or_default();
        
        result.push(TradeWithPairing {
            trade,
            entry_pairs,
            exit_pairs,
        });
    }
    
    Ok(result)
}

#[tauri::command]
pub fn get_position_groups(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<PositionGroup>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Build date filter clause
    let date_filter = if start_date.is_some() || end_date.is_some() {
        let mut filter = String::from(" AND 1=1");
        if let Some(start) = &start_date {
            filter.push_str(&format!(" AND timestamp >= '{}'", start));
        }
        if let Some(end) = &end_date {
            filter.push_str(&format!(" AND timestamp <= '{}'", end));
        }
        filter
    } else {
        String::new()
    };
    
    // Get all trades ordered by timestamp
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){} ORDER BY timestamp ASC", date_filter))
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
    
    let mut all_trades = Vec::new();
    for trade in trade_iter {
        all_trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    // Get paired trades to calculate P&L
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(all_trades.clone())
    } else {
        pair_trades_lifo(all_trades.clone())
    };
    
    // Group trades by position (entry trade)
    use std::collections::HashMap;
    let mut position_groups: Vec<PositionGroup> = Vec::new();
    let mut processed_trades: HashMap<i64, bool> = HashMap::new();
    
    // Find all entry trades (BUY for long, SELL for short) and build position groups
    for (idx, trade) in all_trades.iter().enumerate() {
        let trade_id = trade.id.unwrap_or(0);
        
        // Skip if already processed
        if processed_trades.contains_key(&trade_id) {
            continue;
        }
        
        // Process both BUY (long entry) and SELL (short entry) trades as potential entry points
        let is_entry = trade.side.to_uppercase() == "BUY" || trade.side.to_uppercase() == "SELL";
        
        if is_entry {
            let mut position_trades = vec![trade.clone()];
            processed_trades.insert(trade_id, true);
            
            // Track position size (positive for long, negative for short)
            // BUY opens long (positive), SELL opens short (negative)
            let mut position_size = if trade.side.to_uppercase() == "BUY" {
                trade.quantity
            } else {
                -trade.quantity
            };
            
            // Find all subsequent trades for this symbol until position returns to 0
            for subsequent_trade in all_trades.iter().skip(idx + 1) {
                if subsequent_trade.symbol != trade.symbol {
                    continue;
                }
                
                let sub_trade_id = subsequent_trade.id.unwrap_or(0);
                
                // If this trade was already used in another position, skip it
                if processed_trades.contains_key(&sub_trade_id) {
                    continue;
                }
                
                // Add trade to position
                position_trades.push(subsequent_trade.clone());
                processed_trades.insert(sub_trade_id, true);
                
                // Update position size
                // BUY increases position (more long or less short)
                // SELL decreases position (less long or more short)
                if subsequent_trade.side.to_uppercase() == "BUY" {
                    position_size += subsequent_trade.quantity;
                } else if subsequent_trade.side.to_uppercase() == "SELL" {
                    position_size -= subsequent_trade.quantity;
                }
                
                // Position is closed when it returns to 0 (or very close to 0)
                if position_size.abs() < 0.0001 {
                    break;
                }
            }
            
            // Calculate P&L for this position from paired trades
            let position_pnl: f64 = paired_trades
                .iter()
                .filter(|p| {
                    // Check if this pair's entry or exit trade is in our position trades
                    position_trades.iter().any(|t| {
                        t.id == Some(p.entry_trade_id) || t.id == Some(p.exit_trade_id)
                    })
                })
                .map(|p| p.net_profit_loss)
                .sum();
            
            position_groups.push(PositionGroup {
                entry_trade: trade.clone(),
                position_trades,
                total_pnl: position_pnl,
                final_quantity: position_size, // Can be positive (long), negative (short), or 0 (closed)
            });
        }
    }
    
    // Sort position trades by timestamp within each group
    for group in position_groups.iter_mut() {
        group.position_trades.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    }
    
    // Sort groups by entry timestamp (newest first)
    position_groups.sort_by(|a, b| b.entry_trade.timestamp.cmp(&a.entry_trade.timestamp));
    
    Ok(position_groups)
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
pub fn get_paired_trades(pairing_method: Option<String>) -> Result<Vec<PairedTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE status = 'Filled' OR status = 'FILLED' ORDER BY timestamp ASC")
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
    
    // Default to FIFO if not specified
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (mut paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    
    // Load notes for paired trades
    load_pair_notes(&conn, &mut paired_trades).map_err(|e| e.to_string())?;
    
    Ok(paired_trades)
}

#[tauri::command]
pub fn get_symbol_pnl(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<SymbolPnL>, String> {
    // Get both paired trades and open trades from pairing logic
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE status = 'Filled' OR status = 'FILLED' ORDER BY timestamp ASC")
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
    
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    
    // Filter paired trades by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    use std::collections::HashMap;
    let mut symbol_map: HashMap<String, SymbolPnL> = HashMap::new();
    
    // Calculate P&L for closed positions, grouped by underlying symbol
    for paired in &filtered_paired_trades {
        let underlying = get_underlying_symbol(&paired.symbol);
        let entry = symbol_map.entry(underlying.clone()).or_insert_with(|| SymbolPnL {
            symbol: underlying.clone(),
            closed_positions: 0,
            open_position_qty: 0.0,
            total_gross_pnl: 0.0,
            total_net_pnl: 0.0,
            total_fees: 0.0,
            winning_trades: 0,
            losing_trades: 0,
            win_rate: 0.0,
        });
        
        entry.closed_positions += 1;
        entry.total_gross_pnl += paired.gross_profit_loss;
        entry.total_net_pnl += paired.net_profit_loss;
        entry.total_fees += paired.entry_fees + paired.exit_fees;
        
        if paired.net_profit_loss > 0.0 {
            entry.winning_trades += 1;
        } else if paired.net_profit_loss < 0.0 {
            entry.losing_trades += 1;
        }
    }
    
    // Calculate open positions from unpaired trades, grouped by underlying symbol
    let mut open_positions: HashMap<String, f64> = HashMap::new();
    for open_trade in &open_trades {
        let underlying = get_underlying_symbol(&open_trade.symbol);
        let current_qty = open_positions.get(&underlying).copied().unwrap_or(0.0);
        if open_trade.side.to_uppercase() == "BUY" {
            open_positions.insert(underlying.clone(), current_qty + open_trade.quantity);
        } else if open_trade.side.to_uppercase() == "SELL" {
            // For short positions, we track negative quantity
            open_positions.insert(underlying.clone(), current_qty - open_trade.quantity);
        }
    }
    
    // Add open positions to results (only positive quantities for long positions)
    for (underlying, qty) in open_positions {
        if qty.abs() > 0.0001 {
            let entry = symbol_map.entry(underlying.clone()).or_insert_with(|| SymbolPnL {
                symbol: underlying.clone(),
                closed_positions: 0,
                open_position_qty: 0.0,
                total_gross_pnl: 0.0,
                total_net_pnl: 0.0,
                total_fees: 0.0,
                winning_trades: 0,
                losing_trades: 0,
                win_rate: 0.0,
            });
            // Only show positive quantities (long positions)
            // Negative quantities represent short positions, but we'll show them as positive for now
            entry.open_position_qty = qty.abs();
        }
    }
    
    // Calculate win rates
    for pnl in symbol_map.values_mut() {
        let total_closed = pnl.winning_trades + pnl.losing_trades;
        if total_closed > 0 {
            pnl.win_rate = pnl.winning_trades as f64 / total_closed as f64;
        }
    }
    
    let mut result: Vec<SymbolPnL> = symbol_map.into_values().collect();
    result.sort_by(|a, b| b.total_net_pnl.partial_cmp(&a.total_net_pnl).unwrap_or(std::cmp::Ordering::Equal));
    
    Ok(result)
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

#[tauri::command]
pub fn clear_all_trades() -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Delete all trades
    conn.execute("DELETE FROM trades", [])
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
    
    // Group trades by date and calculate P&L using paired trades
    // Use strftime for SQLite date extraction
    let mut stmt = conn
        .prepare(
            "SELECT 
                strftime('%Y-%m-%d', timestamp) as trade_date,
                COUNT(*) as trade_count
            FROM trades
            WHERE status = 'Filled' OR status = 'FILLED'
            GROUP BY strftime('%Y-%m-%d', timestamp)
            ORDER BY trade_date DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let daily_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    
    // Get paired trades to calculate accurate daily P&L
    let paired_trades = get_paired_trades(None).map_err(|e| e.to_string())?;
    
    // Group paired trades by date
    use std::collections::HashMap;
    let mut daily_pnl_map: HashMap<String, f64> = HashMap::new();
    let mut daily_count_map: HashMap<String, i64> = HashMap::new();
    
    for day_result in daily_iter {
        let (date, count) = day_result.map_err(|e| e.to_string())?;
        daily_count_map.insert(date.clone(), count);
        daily_pnl_map.insert(date, 0.0);
    }
    
    // Calculate P&L per day from paired trades
    for paired in &paired_trades {
        // Extract date from exit timestamp (when trade was closed)
        if let Some(date_str) = paired.exit_timestamp.split('T').next() {
            if let Some(pnl) = daily_pnl_map.get_mut(date_str) {
                *pnl += paired.net_profit_loss;
            } else {
                // Date not in map, add it
                daily_pnl_map.insert(date_str.to_string(), paired.net_profit_loss);
                daily_count_map.insert(date_str.to_string(), 1);
            }
        }
    }
    
    // Convert to Vec<DailyPnL>
    let mut daily_pnl: Vec<DailyPnL> = daily_pnl_map
        .into_iter()
        .map(|(date, pnl)| {
            let trade_count = daily_count_map.get(&date).copied().unwrap_or(0);
            DailyPnL {
                date,
                profit_loss: pnl,
                trade_count,
            }
        })
        .collect();
    
    // Sort by date descending
    daily_pnl.sort_by(|a, b| b.date.cmp(&a.date));
    
    Ok(daily_pnl)
}

#[tauri::command]
pub fn get_metrics(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Metrics, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Build date filter clause
    let date_filter = if start_date.is_some() || end_date.is_some() {
        let mut filter = String::from(" WHERE 1=1");
        if let Some(start) = &start_date {
            filter.push_str(&format!(" AND timestamp >= '{}'", start));
        }
        if let Some(end) = &end_date {
            filter.push_str(&format!(" AND timestamp <= '{}'", end));
        }
        filter
    } else {
        String::new()
    };
    
    let total_volume: f64 = conn
        .query_row(&format!("SELECT SUM(quantity * price) FROM trades{}", date_filter), [], |row| {
            Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0))
        })
        .map_err(|e| e.to_string())?;
    
    // Get paired trades for accurate metrics
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter paired trades by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Total trades should count pairs, not individual trades
    let total_trades = filtered_paired_trades.len() as i64;
    
    // Get position groups to calculate largest win/loss per position (not per pair)
    let position_groups = get_position_groups(pairing_method, start_date.clone(), end_date.clone()).map_err(|e| e.to_string())?;
    
    let mut winning_trades = 0;
    let mut losing_trades = 0;
    let mut total_profit_loss = 0.0;
    let mut total_profit = 0.0;
    let mut total_loss = 0.0;
    let mut profit_count = 0;
    let mut loss_count = 0;
    let mut largest_win = 0.0;
    let mut largest_loss = f64::NEG_INFINITY; // Start with negative infinity to track the most negative loss
    let mut consecutive_wins = 0;
    let mut consecutive_losses = 0;
    let mut current_win_streak = 0;
    let mut current_loss_streak = 0;
    
    // Calculate largest win/loss from position groups (complete positions, not individual pairs)
    let mut largest_win_group_id: Option<i64> = None;
    let mut largest_loss_group_id: Option<i64> = None;
    
    for group in &position_groups {
        let position_pnl = group.total_pnl;
        
        if position_pnl > 0.0 {
            if position_pnl > largest_win {
                largest_win = position_pnl;
                // Track the entry trade ID to identify this position group
                largest_win_group_id = group.entry_trade.id;
            }
        } else if position_pnl < 0.0 {
            // largest_loss should be the actual loss value (negative) per position
            if largest_loss == f64::NEG_INFINITY || position_pnl < largest_loss {
                largest_loss = position_pnl; // Store as negative value (most negative = largest loss)
                // Track the entry trade ID to identify this position group
                largest_loss_group_id = group.entry_trade.id;
            }
        }
    }
    
    // Calculate other metrics from paired trades
    for paired in &filtered_paired_trades {
        let pnl = paired.net_profit_loss;
        total_profit_loss += pnl;
        
        if pnl > 0.0 {
            winning_trades += 1;
            total_profit += pnl;
            profit_count += 1;
            
            // Update streaks
            current_loss_streak = 0;
            current_win_streak += 1;
            if current_win_streak > consecutive_wins {
                consecutive_wins = current_win_streak;
            }
        } else if pnl < 0.0 {
            losing_trades += 1;
            total_loss += pnl.abs();
            loss_count += 1;
            
            // Update streaks
            current_win_streak = 0;
            current_loss_streak += 1;
            if current_loss_streak > consecutive_losses {
                consecutive_losses = current_loss_streak;
            }
        }
    }
    
    let win_rate = if filtered_paired_trades.len() > 0 {
        winning_trades as f64 / filtered_paired_trades.len() as f64
    } else {
        0.0
    };
    
    let average_profit = if profit_count > 0 {
        total_profit / profit_count as f64
    } else {
        0.0
    };
    
    let average_loss = if loss_count > 0 {
        total_loss / loss_count as f64
    } else {
        0.0
    };
    
    // Strategy metrics (from paired trades with strategies)
    let mut strategy_winning = 0;
    let mut strategy_losing = 0;
    let mut strategy_pnl = 0.0;
    let mut strategy_consecutive_wins = 0;
    let mut strategy_consecutive_losses = 0;
    let mut strategy_current_win = 0;
    let mut strategy_current_loss = 0;
    
    for paired in &filtered_paired_trades {
        if paired.strategy_id.is_some() {
            if paired.net_profit_loss > 0.0 {
                strategy_winning += 1;
                strategy_pnl += paired.net_profit_loss;
                strategy_current_loss = 0;
                strategy_current_win += 1;
                if strategy_current_win > strategy_consecutive_wins {
                    strategy_consecutive_wins = strategy_current_win;
                }
            } else if paired.net_profit_loss < 0.0 {
                strategy_losing += 1;
                strategy_pnl += paired.net_profit_loss;
                strategy_current_win = 0;
                strategy_current_loss += 1;
                if strategy_current_loss > strategy_consecutive_losses {
                    strategy_consecutive_losses = strategy_current_loss;
                }
            }
        }
    }
    
    let strategy_win_rate = if (strategy_winning + strategy_losing) > 0 {
        strategy_winning as f64 / (strategy_winning + strategy_losing) as f64
    } else {
        0.0
    };
    
    // Calculate additional metrics
    // Total fees from paired trades
    let total_fees: f64 = filtered_paired_trades.iter().map(|p| p.entry_fees + p.exit_fees).sum();
    
    // Net profit (after fees) = total_profit_loss (already includes fees in net_profit_loss)
    let net_profit = total_profit_loss;
    
    // Average trade = total_profit_loss / number of trades
    let average_trade = if filtered_paired_trades.len() > 0 {
        total_profit_loss / filtered_paired_trades.len() as f64
    } else {
        0.0
    };
    
    // Expectancy = (Win Rate × Average Win) - (Loss Rate × Average Loss)
    let loss_rate = if filtered_paired_trades.len() > 0 {
        losing_trades as f64 / filtered_paired_trades.len() as f64
    } else {
        0.0
    };
    let expectancy = (win_rate * average_profit) - (loss_rate * average_loss);
    
    // Profit Factor = Total Gross Profit / Total Gross Loss
    let profit_factor = if total_loss > 0.0 {
        total_profit / total_loss
    } else if total_profit > 0.0 {
        f64::INFINITY // All trades are winners
    } else {
        0.0
    };
    
    // Risk/Reward Ratio = Average Win / Average Loss
    let risk_reward_ratio = if average_loss > 0.0 {
        average_profit / average_loss
    } else if average_profit > 0.0 {
        f64::INFINITY // No losses
    } else {
        0.0
    };
    
    // Calculate max drawdown from position groups (equity curve)
    let mut max_drawdown = 0.0;
    let mut peak_equity = 0.0;
    let mut running_equity = 0.0;
    
    // Sort position groups by timestamp to build equity curve
    let mut sorted_groups = position_groups.clone();
    sorted_groups.sort_by(|a, b| a.entry_trade.timestamp.cmp(&b.entry_trade.timestamp));
    
    for group in &sorted_groups {
        running_equity += group.total_pnl;
        if running_equity > peak_equity {
            peak_equity = running_equity;
        }
        let drawdown = peak_equity - running_equity;
        if drawdown > max_drawdown {
            max_drawdown = drawdown;
        }
    }
    
    // Sharpe Ratio (simplified: average return / standard deviation of returns)
    // For now, return 0.0 as it requires more complex calculation with risk-free rate
    let sharpe_ratio = 0.0; // TODO: Implement proper Sharpe ratio calculation
    
    // Get daily P&L for best/worst day and trades per day
    // Filter daily P&L by date range if provided
    let mut daily_pnl = get_daily_pnl().unwrap_or_default();
    
    // Filter by date range if provided
    if start_date.is_some() || end_date.is_some() {
        daily_pnl.retain(|d| {
            let day_date = &d.date;
            let in_range = if let Some(start) = &start_date {
                day_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                day_date <= end
            } else {
                true
            };
            in_range
        });
    }
    
    // Find best day and its date
    let mut best_day_value = 0.0;
    let mut best_day_date: Option<String> = None;
    if let Some(best) = daily_pnl.iter().max_by(|a, b| a.profit_loss.partial_cmp(&b.profit_loss).unwrap_or(std::cmp::Ordering::Equal)) {
        best_day_value = best.profit_loss;
        best_day_date = Some(best.date.clone());
    }
    
    // Find worst day and its date
    let mut worst_day_value = 0.0;
    let mut worst_day_date: Option<String> = None;
    if let Some(worst) = daily_pnl.iter().min_by(|a, b| a.profit_loss.partial_cmp(&b.profit_loss).unwrap_or(std::cmp::Ordering::Equal)) {
        worst_day_value = worst.profit_loss;
        worst_day_date = Some(worst.date.clone());
    }
    
    // Trades per day = total trades (pairs) / number of trading days
    let trading_days = daily_pnl.len() as f64;
    let trades_per_day = if trading_days > 0.0 {
        total_trades as f64 / trading_days
    } else {
        0.0
    };
    
    // Calculate average holding time (in seconds)
    let mut total_holding_time_seconds = 0.0;
    let mut holding_time_count = 0;
    
    for paired in &filtered_paired_trades {
        // Parse timestamps (ISO 8601 format: "2024-01-15T10:30:00" or with timezone)
        // Try to parse as ISO 8601
        let entry_time = paired.entry_timestamp.parse::<chrono::DateTime<chrono::Utc>>()
            .or_else(|_| {
                // Try parsing as naive datetime and assume UTC
                chrono::NaiveDateTime::parse_from_str(&paired.entry_timestamp, "%Y-%m-%dT%H:%M:%S")
                    .map(|dt| dt.and_utc())
            })
            .or_else(|_| {
                // Try parsing with milliseconds
                chrono::NaiveDateTime::parse_from_str(&paired.entry_timestamp, "%Y-%m-%dT%H:%M:%S%.f")
                    .map(|dt| dt.and_utc())
            });
        
        let exit_time = paired.exit_timestamp.parse::<chrono::DateTime<chrono::Utc>>()
            .or_else(|_| {
                chrono::NaiveDateTime::parse_from_str(&paired.exit_timestamp, "%Y-%m-%dT%H:%M:%S")
                    .map(|dt| dt.and_utc())
            })
            .or_else(|_| {
                chrono::NaiveDateTime::parse_from_str(&paired.exit_timestamp, "%Y-%m-%dT%H:%M:%S%.f")
                    .map(|dt| dt.and_utc())
            });
        
        if let (Ok(entry), Ok(exit)) = (entry_time, exit_time) {
            let duration = exit.signed_duration_since(entry);
            if duration.num_seconds() >= 0 {
                total_holding_time_seconds += duration.num_seconds() as f64;
                holding_time_count += 1;
            }
        }
    }
    
    let average_holding_time_seconds = if holding_time_count > 0 {
        total_holding_time_seconds / holding_time_count as f64
    } else {
        0.0
    };
    
    // Calculate percentage-based metrics (based on entry/exit prices, not P&L)
    let mut winning_pct_gains = Vec::new();
    let mut losing_pct_losses = Vec::new();
    let mut largest_win_pct = 0.0;
    let mut largest_loss_pct = 0.0;
    
    for paired in &filtered_paired_trades {
        if paired.entry_price > 0.0 {
            let pct = ((paired.exit_price - paired.entry_price) / paired.entry_price) * 100.0;
            
            if paired.net_profit_loss > 0.0 {
                // Winning trade
                winning_pct_gains.push(pct);
                if pct > largest_win_pct {
                    largest_win_pct = pct;
                }
            } else if paired.net_profit_loss < 0.0 {
                // Losing trade
                losing_pct_losses.push(pct);
                if pct < largest_loss_pct {
                    largest_loss_pct = pct;
                }
            }
        }
    }
    
    let average_gain_pct = if !winning_pct_gains.is_empty() {
        winning_pct_gains.iter().sum::<f64>() / winning_pct_gains.len() as f64
    } else {
        0.0
    };
    
    let average_loss_pct = if !losing_pct_losses.is_empty() {
        losing_pct_losses.iter().sum::<f64>() / losing_pct_losses.len() as f64
    } else {
        0.0
    };
    
    Ok(Metrics {
        total_trades,
        winning_trades,
        losing_trades,
        total_profit_loss,
        win_rate,
        average_profit,
        average_loss,
        largest_win,
        largest_loss: if largest_loss == f64::NEG_INFINITY { 0.0 } else { largest_loss }, // Return 0.0 if no losses found
        total_volume,
        trades_by_symbol: vec![],
        consecutive_wins,
        consecutive_losses,
        current_win_streak,
        current_loss_streak,
        strategy_win_rate,
        strategy_winning_trades: strategy_winning,
        strategy_losing_trades: strategy_losing,
        strategy_profit_loss: strategy_pnl,
        strategy_consecutive_wins,
        strategy_consecutive_losses,
        expectancy,
        profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
        average_trade,
        total_fees,
        net_profit,
        max_drawdown,
        sharpe_ratio,
        risk_reward_ratio: if risk_reward_ratio == f64::INFINITY { 0.0 } else { risk_reward_ratio },
        trades_per_day,
        best_day: best_day_value,
        worst_day: worst_day_value,
        best_day_date,
        worst_day_date,
        largest_win_group_id,
        largest_loss_group_id,
        average_holding_time_seconds,
        average_gain_pct,
        average_loss_pct,
        largest_win_pct,
        largest_loss_pct,
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

#[tauri::command]
pub fn add_emotion_survey(
    emotional_state_id: i64,
    timestamp: String,
    before_calm_clear: i32,
    before_urgency_pressure: i32,
    before_confidence_vs_validation: i32,
    before_fomo: i32,
    before_recovering_loss: i32,
    before_patient_detached: i32,
    before_trust_process: i32,
    before_emotional_state: i32,
    during_stable: i32,
    during_tension_stress: i32,
    during_tempted_interfere: i32,
    during_need_control: i32,
    during_fear_loss: i32,
    during_excitement_greed: i32,
    during_mentally_present: i32,
    after_accept_outcome: i32,
    after_emotional_reaction: i32,
    after_confidence_affected: i32,
    after_tempted_another_trade: i32,
    after_proud_discipline: i32,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO emotion_surveys (
            emotional_state_id, timestamp,
            before_calm_clear, before_urgency_pressure, before_confidence_vs_validation,
            before_fomo, before_recovering_loss, before_patient_detached,
            before_trust_process, before_emotional_state,
            during_stable, during_tension_stress, during_tempted_interfere,
            during_need_control, during_fear_loss, during_excitement_greed,
            during_mentally_present,
            after_accept_outcome, after_emotional_reaction, after_confidence_affected,
            after_tempted_another_trade, after_proud_discipline
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            emotional_state_id, timestamp,
            before_calm_clear, before_urgency_pressure, before_confidence_vs_validation,
            before_fomo, before_recovering_loss, before_patient_detached,
            before_trust_process, before_emotional_state,
            during_stable, during_tension_stress, during_tempted_interfere,
            during_need_control, during_fear_loss, during_excitement_greed,
            during_mentally_present,
            after_accept_outcome, after_emotional_reaction, after_confidence_affected,
            after_tempted_another_trade, after_proud_discipline
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_emotion_survey(emotional_state_id: i64) -> Result<Option<EmotionSurvey>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, emotional_state_id, timestamp,
            before_calm_clear, before_urgency_pressure, before_confidence_vs_validation,
            before_fomo, before_recovering_loss, before_patient_detached,
            before_trust_process, before_emotional_state,
            during_stable, during_tension_stress, during_tempted_interfere,
            during_need_control, during_fear_loss, during_excitement_greed,
            during_mentally_present,
            after_accept_outcome, after_emotional_reaction, after_confidence_affected,
            after_tempted_another_trade, after_proud_discipline
            FROM emotion_surveys WHERE emotional_state_id = ?1"
        )
        .map_err(|e| e.to_string())?;
    
    match stmt.query_row(params![emotional_state_id], |row| {
        Ok(EmotionSurvey {
            id: Some(row.get(0)?),
            emotional_state_id: row.get(1)?,
            timestamp: row.get(2)?,
            before_calm_clear: row.get(3)?,
            before_urgency_pressure: row.get(4)?,
            before_confidence_vs_validation: row.get(5)?,
            before_fomo: row.get(6)?,
            before_recovering_loss: row.get(7)?,
            before_patient_detached: row.get(8)?,
            before_trust_process: row.get(9)?,
            before_emotional_state: row.get(10)?,
            during_stable: row.get(11)?,
            during_tension_stress: row.get(12)?,
            during_tempted_interfere: row.get(13)?,
            during_need_control: row.get(14)?,
            during_fear_loss: row.get(15)?,
            during_excitement_greed: row.get(16)?,
            during_mentally_present: row.get(17)?,
            after_accept_outcome: row.get(18)?,
            after_emotional_reaction: row.get(19)?,
            after_confidence_affected: row.get(20)?,
            after_tempted_another_trade: row.get(21)?,
            after_proud_discipline: row.get(22)?,
        })
    }) {
        Ok(survey) => Ok(Some(survey)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_all_emotion_surveys() -> Result<Vec<EmotionSurvey>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare(
            "SELECT id, emotional_state_id, timestamp,
            before_calm_clear, before_urgency_pressure, before_confidence_vs_validation,
            before_fomo, before_recovering_loss, before_patient_detached,
            before_trust_process, before_emotional_state,
            during_stable, during_tension_stress, during_tempted_interfere,
            during_need_control, during_fear_loss, during_excitement_greed,
            during_mentally_present,
            after_accept_outcome, after_emotional_reaction, after_confidence_affected,
            after_tempted_another_trade, after_proud_discipline
            FROM emotion_surveys ORDER BY timestamp DESC"
        )
        .map_err(|e| e.to_string())?;
    
    let survey_iter = stmt
        .query_map([], |row| {
            Ok(EmotionSurvey {
                id: Some(row.get(0)?),
                emotional_state_id: row.get(1)?,
                timestamp: row.get(2)?,
                before_calm_clear: row.get(3)?,
                before_urgency_pressure: row.get(4)?,
                before_confidence_vs_validation: row.get(5)?,
                before_fomo: row.get(6)?,
                before_recovering_loss: row.get(7)?,
                before_patient_detached: row.get(8)?,
                before_trust_process: row.get(9)?,
                before_emotional_state: row.get(10)?,
                during_stable: row.get(11)?,
                during_tension_stress: row.get(12)?,
                during_tempted_interfere: row.get(13)?,
                during_need_control: row.get(14)?,
                during_fear_loss: row.get(15)?,
                during_excitement_greed: row.get(16)?,
                during_mentally_present: row.get(17)?,
                after_accept_outcome: row.get(18)?,
                after_emotional_reaction: row.get(19)?,
                after_confidence_affected: row.get(20)?,
                after_tempted_another_trade: row.get(21)?,
                after_proud_discipline: row.get(22)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut surveys = Vec::new();
    for survey in survey_iter {
        surveys.push(survey.map_err(|e| e.to_string())?);
    }
    
    Ok(surveys)
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

// Journal Entry Commands
#[tauri::command]
pub fn create_journal_entry(
    date: String,
    title: String,
    strategy_id: Option<i64>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO journal_entries (date, title, strategy_id) VALUES (?1, ?2, ?3)",
        params![date, title, strategy_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_journal_entries() -> Result<Vec<JournalEntry>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, date, title, strategy_id, created_at, updated_at FROM journal_entries ORDER BY date DESC, created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let entry_iter = stmt
        .query_map([], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut entries = Vec::new();
    for entry in entry_iter {
        entries.push(entry.map_err(|e| e.to_string())?);
    }
    
    Ok(entries)
}

#[tauri::command]
pub fn get_journal_entry(id: i64) -> Result<JournalEntry, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, date, title, strategy_id, created_at, updated_at FROM journal_entries WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    
    let entry = stmt
        .query_row(params![id], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    
    Ok(entry)
}

#[tauri::command]
pub fn update_journal_entry(
    id: i64,
    date: String,
    title: String,
    strategy_id: Option<i64>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE journal_entries SET date = ?1, title = ?2, strategy_id = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
        params![date, title, strategy_id, id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_journal_entry(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM journal_entries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JournalChecklistResponse {
    pub id: Option<i64>,
    pub journal_entry_id: i64,
    pub checklist_item_id: i64,
    pub is_checked: bool,
}

#[tauri::command]
pub fn save_journal_checklist_responses(
    journal_entry_id: i64,
    responses: Vec<(i64, bool)>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Delete existing responses for this journal entry
    conn.execute(
        "DELETE FROM journal_checklist_responses WHERE journal_entry_id = ?1",
        params![journal_entry_id],
    ).map_err(|e| e.to_string())?;
    
    // Insert new responses
    for (checklist_item_id, is_checked) in responses {
        conn.execute(
            "INSERT INTO journal_checklist_responses (journal_entry_id, checklist_item_id, is_checked) VALUES (?1, ?2, ?3)",
            params![journal_entry_id, checklist_item_id, if is_checked { 1 } else { 0 }],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn get_journal_checklist_responses(journal_entry_id: i64) -> Result<Vec<JournalChecklistResponse>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, journal_entry_id, checklist_item_id, is_checked FROM journal_checklist_responses WHERE journal_entry_id = ?1")
        .map_err(|e| e.to_string())?;
    
    let response_iter = stmt
        .query_map(params![journal_entry_id], |row| {
            Ok(JournalChecklistResponse {
                id: Some(row.get(0)?),
                journal_entry_id: row.get(1)?,
                checklist_item_id: row.get(2)?,
                is_checked: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    
    let mut responses = Vec::new();
    for response in response_iter {
        responses.push(response.map_err(|e| e.to_string())?);
    }
    
    Ok(responses)
}

// Journal Trade Commands
#[tauri::command]
pub fn create_journal_trade(
    journal_entry_id: i64,
    symbol: Option<String>,
    position: Option<String>,
    entry_type: Option<String>,
    exit_type: Option<String>,
    trade: Option<String>,
    what_went_well: Option<String>,
    what_could_be_improved: Option<String>,
    emotional_state: Option<String>,
    notes: Option<String>,
    outcome: Option<String>,
    trade_order: i64,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO journal_trades (journal_entry_id, symbol, position, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, trade_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![journal_entry_id, symbol, position, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, trade_order],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_journal_trades(journal_entry_id: i64) -> Result<Vec<JournalTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, journal_entry_id, symbol, position, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, trade_order, created_at, updated_at FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order ASC")
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map(params![journal_entry_id], |row| {
            Ok(JournalTrade {
                id: Some(row.get(0)?),
                journal_entry_id: row.get(1)?,
                symbol: row.get(2)?,
                position: row.get(3)?,
                entry_type: row.get(4)?,
                exit_type: row.get(5)?,
                trade: row.get(6)?,
                what_went_well: row.get(7)?,
                what_could_be_improved: row.get(8)?,
                emotional_state: row.get(9)?,
                notes: row.get(10)?,
                outcome: row.get(11)?,
                trade_order: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
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
pub fn update_journal_trade(
    id: i64,
    symbol: Option<String>,
    position: Option<String>,
    entry_type: Option<String>,
    exit_type: Option<String>,
    trade: Option<String>,
    what_went_well: Option<String>,
    what_could_be_improved: Option<String>,
    emotional_state: Option<String>,
    notes: Option<String>,
    outcome: Option<String>,
    trade_order: i64,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE journal_trades SET symbol = ?1, position = ?2, entry_type = ?3, exit_type = ?4, trade = ?5, what_went_well = ?6, what_could_be_improved = ?7, emotional_state = ?8, notes = ?9, outcome = ?10, trade_order = ?11, updated_at = CURRENT_TIMESTAMP WHERE id = ?12",
        params![symbol, position, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, trade_order, id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_journal_trade(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM journal_trades WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn get_all_symbols() -> Result<Vec<String>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Get unique symbols from trades
    let mut stmt = conn
        .prepare("SELECT DISTINCT symbol FROM trades WHERE symbol IS NOT NULL AND symbol != '' ORDER BY symbol")
        .map_err(|e| e.to_string())?;
    
    let trade_symbols_iter = stmt
        .query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })
        .map_err(|e| e.to_string())?;
    
    let mut symbols: std::collections::HashSet<String> = std::collections::HashSet::new();
    for symbol_result in trade_symbols_iter {
        if let Ok(symbol) = symbol_result {
            symbols.insert(symbol);
        }
    }
    
    // Get unique symbols from journal trades
    let mut stmt = conn
        .prepare("SELECT DISTINCT symbol FROM journal_trades WHERE symbol IS NOT NULL AND symbol != '' ORDER BY symbol")
        .map_err(|e| e.to_string())?;
    
    let journal_symbols_iter = stmt
        .query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })
        .map_err(|e| e.to_string())?;
    
    for symbol_result in journal_symbols_iter {
        if let Ok(symbol) = symbol_result {
            symbols.insert(symbol);
        }
    }
    
    let mut symbol_vec: Vec<String> = symbols.into_iter().collect();
    symbol_vec.sort();
    Ok(symbol_vec)
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
pub fn get_strategy_performance(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<StrategyPerformance>, String> {
    use std::collections::HashMap;
    
    // Get paired trades using the pairing method
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter paired trades by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Get position groups to find the original entry trade's strategy_id for positions with additions
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone()).map_err(|e| e.to_string())?;
    
    // Create a map: trade_id -> position_group_entry_trade_strategy_id
    // This maps any trade in a position group to the position group's entry trade's strategy_id
    let mut trade_to_position_strategy: HashMap<i64, Option<i64>> = HashMap::new();
    for group in &position_groups {
        let position_strategy_id = group.entry_trade.strategy_id;
        for trade in &group.position_trades {
            if let Some(trade_id) = trade.id {
                trade_to_position_strategy.insert(trade_id, position_strategy_id);
            }
        }
    }
    
    // Get strategy names from database
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, name FROM strategies")
        .map_err(|e| e.to_string())?;
    
    let strategy_iter = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    
    let mut strategy_names: HashMap<i64, String> = HashMap::new();
    for strategy_result in strategy_iter {
        let (id, name) = strategy_result.map_err(|e| e.to_string())?;
        strategy_names.insert(id, name);
    }
    
    // Get all unique entry trade IDs
    let entry_trade_ids: Vec<i64> = filtered_paired_trades
        .iter()
        .map(|p| p.entry_trade_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    
    // Batch lookup entry trade strategy_ids from database
    let mut entry_trade_strategies: HashMap<i64, Option<i64>> = HashMap::new();
    if !entry_trade_ids.is_empty() {
        // Query each entry trade individually (simple and reliable)
        let mut entry_trade_stmt = conn
            .prepare("SELECT strategy_id FROM trades WHERE id = ?")
            .map_err(|e| e.to_string())?;
        
        for entry_trade_id in &entry_trade_ids {
            if let Ok(strategy_id) = entry_trade_stmt.query_row([entry_trade_id], |row| {
                row.get::<_, Option<i64>>(0)
            }) {
                entry_trade_strategies.insert(*entry_trade_id, strategy_id);
            }
        }
    }
    
    // Group paired trades by strategy_id and calculate performance
    // For positions with additions, use the position group's entry trade strategy_id
    let mut strategy_map: HashMap<Option<i64>, StrategyPerformance> = HashMap::new();
    
    for paired in &filtered_paired_trades {
        // First, try to get strategy_id from position group (for positions with additions)
        // This ensures we use the original entry trade's strategy_id, not a later add's strategy_id
        let strategy_id = trade_to_position_strategy
            .get(&paired.entry_trade_id)
            .copied()
            .flatten()
            // Fallback to direct entry trade lookup
            .or_else(|| {
                entry_trade_strategies
                    .get(&paired.entry_trade_id)
                    .copied()
                    .flatten()
            })
            // Final fallback to paired trade's strategy_id
            .or(paired.strategy_id);
        
        let entry = strategy_map.entry(strategy_id).or_insert_with(|| {
            let strategy_name = if let Some(id) = strategy_id {
                strategy_names.get(&id).cloned().unwrap_or_else(|| "Unknown".to_string())
            } else {
                "Unassigned".to_string()
            };
            
            StrategyPerformance {
                strategy_id,
                strategy_name,
                trade_count: 0,
                total_volume: 0.0,
                estimated_pnl: 0.0,
            }
        });
        
        // Count closed positions (pairs), not individual trades
        entry.trade_count += 1;
        // Calculate volume from the paired trade
        entry.total_volume += paired.quantity * paired.entry_price;
        // Use actual net_profit_loss from paired trades
        entry.estimated_pnl += paired.net_profit_loss;
    }
    
    // Convert to vector and sort by trade count descending
    let mut performance: Vec<StrategyPerformance> = strategy_map.into_values().collect();
    performance.sort_by(|a, b| b.trade_count.cmp(&a.trade_count));
    
    Ok(performance)
}

#[tauri::command]
pub fn get_paired_trades_by_strategy(
    strategy_id: Option<i64>,
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<PairedTrade>, String> {
    // Get all paired trades
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter by date range if provided
    let mut filtered = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect::<Vec<_>>()
    } else {
        paired_trades
    };
    
    // Get position groups to find the original entry trade's strategy_id for positions with additions
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone()).map_err(|e| e.to_string())?;
    
    // Create a map: trade_id -> position_group_entry_trade_strategy_id
    use std::collections::HashMap;
    let mut trade_to_position_strategy: HashMap<i64, Option<i64>> = HashMap::new();
    for group in &position_groups {
        let position_strategy_id = group.entry_trade.strategy_id;
        for trade in &group.position_trades {
            if let Some(trade_id) = trade.id {
                trade_to_position_strategy.insert(trade_id, position_strategy_id);
            }
        }
    }
    
    // Get entry trade strategy_ids from database
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let entry_trade_ids: Vec<i64> = filtered
        .iter()
        .map(|p| p.entry_trade_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    
    let mut entry_trade_strategies: HashMap<i64, Option<i64>> = HashMap::new();
    if !entry_trade_ids.is_empty() {
        let mut entry_trade_stmt = conn
            .prepare("SELECT strategy_id FROM trades WHERE id = ?")
            .map_err(|e| e.to_string())?;
        
        for entry_trade_id in &entry_trade_ids {
            if let Ok(strategy_id) = entry_trade_stmt.query_row([entry_trade_id], |row| {
                row.get::<_, Option<i64>>(0)
            }) {
                entry_trade_strategies.insert(*entry_trade_id, strategy_id);
            }
        }
    }
    
    // Filter by strategy_id
    if let Some(strategy_id) = strategy_id {
        filtered = filtered.into_iter().filter(|paired| {
            // First, try to get strategy_id from position group (for positions with additions)
            let pair_strategy_id = trade_to_position_strategy
                .get(&paired.entry_trade_id)
                .copied()
                .flatten()
                // Fallback to direct entry trade lookup
                .or_else(|| {
                    entry_trade_strategies
                        .get(&paired.entry_trade_id)
                        .copied()
                        .flatten()
                })
                // Final fallback to paired trade's strategy_id
                .or(paired.strategy_id);
            
            pair_strategy_id == Some(strategy_id)
        }).collect();
    } else {
        // Filter for unassigned (strategy_id is None)
        filtered = filtered.into_iter().filter(|paired| {
            let pair_strategy_id = trade_to_position_strategy
                .get(&paired.entry_trade_id)
                .copied()
                .flatten()
                .or_else(|| {
                    entry_trade_strategies
                        .get(&paired.entry_trade_id)
                        .copied()
                        .flatten()
                })
                .or(paired.strategy_id);
            
            pair_strategy_id.is_none()
        }).collect();
    }
    
    Ok(filtered)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentTrade {
    pub symbol: String,
    pub entry_timestamp: String,
    pub exit_timestamp: String,
    pub quantity: f64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub net_profit_loss: f64,
    pub strategy_name: Option<String>,
}

#[tauri::command]
pub fn get_recent_trades(limit: Option<i64>, pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<Vec<RecentTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(5);
    
    // Build date filter clause
    let date_filter = if start_date.is_some() || end_date.is_some() {
        let mut filter = String::from(" AND 1=1");
        if let Some(start) = &start_date {
            filter.push_str(&format!(" AND timestamp >= '{}'", start));
        }
        if let Some(end) = &end_date {
            filter.push_str(&format!(" AND timestamp <= '{}'", end));
        }
        filter
    } else {
        String::new()
    };
    
    // Get all filled trades
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){} ORDER BY timestamp ASC", date_filter))
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
    
    // Get paired trades
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    
    // Filter paired trades by date range if provided (filter by exit timestamp)
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Sort by exit timestamp (most recent first) and limit
    let mut sorted_pairs = filtered_paired_trades;
    sorted_pairs.sort_by(|a, b| b.exit_timestamp.cmp(&a.exit_timestamp));
    sorted_pairs.truncate(limit as usize);
    
    // Convert to RecentTrade format with strategy names
    let mut recent_trades = Vec::new();
    for pair in sorted_pairs {
        // Get strategy name for the pair (use entry trade's strategy)
        let strategy_name = if let Some(strategy_id) = pair.strategy_id {
            let mut stmt = conn
                .prepare("SELECT name FROM strategies WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            stmt.query_row(params![strategy_id], |row| {
                Ok(row.get::<_, Option<String>>(0)?)
            })
            .ok()
            .flatten()
        } else {
            None
        };
        
        recent_trades.push(RecentTrade {
            symbol: pair.symbol,
            entry_timestamp: pair.entry_timestamp,
            exit_timestamp: pair.exit_timestamp,
            quantity: pair.quantity,
            entry_price: pair.entry_price,
            exit_price: pair.exit_price,
            net_profit_loss: pair.net_profit_loss,
            strategy_name,
        });
    }
    
    Ok(recent_trades)
}

#[tauri::command]
pub async fn fetch_chart_data(symbol: String, period1: i64, period2: i64, interval: String) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval={}",
        symbol, period1, period2, interval
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Retry logic with exponential backoff for rate limiting
    let max_retries = 3;
    let mut last_error = None;
    
    for attempt in 0..=max_retries {
        let response = client
            .get(&url)
            .header("Accept", "application/json")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Referer", "https://finance.yahoo.com/")
            .send()
            .await;
        
        match response {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    let data: serde_json::Value = resp.json().await
                        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
                    return Ok(data);
                } else if status.as_u16() == 429 && attempt < max_retries {
                    // Rate limited - wait with exponential backoff
                    let delay_ms = 1000 * (2_u64.pow(attempt)); // 1s, 2s, 4s
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    last_error = Some(format!("Rate limited (429), retrying... (attempt {}/{})", attempt + 1, max_retries + 1));
                    continue;
                } else {
                    return Err(format!("Failed to fetch chart data: {} {}", status, status.canonical_reason().unwrap_or("Unknown")));
                }
            }
            Err(e) => {
                if attempt < max_retries {
                    let delay_ms = 1000 * (2_u64.pow(attempt));
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    last_error = Some(format!("Network error: {}, retrying... (attempt {}/{})", e, attempt + 1, max_retries + 1));
                    continue;
                } else {
                    return Err(format!("Network error after {} attempts: {}", max_retries + 1, e));
                }
            }
        }
    }
    
    Err(last_error.unwrap_or_else(|| "Failed to fetch chart data after retries".to_string()))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StockQuote {
    pub symbol: String,
    pub current_price: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub dividend_rate: Option<f64>,
    pub dividend_frequency: Option<String>,
    pub trailing_annual_dividend_rate: Option<f64>,
    pub trailing_annual_dividend_yield: Option<f64>,
}

#[tauri::command]
pub async fn fetch_stock_quote(symbol: String) -> Result<StockQuote, String> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d",
        symbol
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://finance.yahoo.com/")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to fetch stock data: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    // Extract quote data from Yahoo Finance response
    let result = data.get("chart")
        .and_then(|c| c.get("result"))
        .and_then(|r| r.get(0))
        .ok_or_else(|| "Invalid response format".to_string())?;
    
    let meta = result.get("meta")
        .ok_or_else(|| "Missing meta data".to_string())?;
    
    let current_price = meta.get("regularMarketPrice")
        .and_then(|p| p.as_f64())
        .or_else(|| meta.get("previousClose").and_then(|p| p.as_f64()));
    
    // Try to get dividend data from various fields
    let dividend_yield = meta.get("dividendYield")
        .and_then(|d| d.as_f64())
        .or_else(|| meta.get("trailingAnnualDividendYield").and_then(|d| d.as_f64()));
    
    let dividend_rate = meta.get("dividendRate")
        .and_then(|d| d.as_f64())
        .or_else(|| meta.get("trailingAnnualDividendRate").and_then(|d| d.as_f64()));
    
    let trailing_annual_dividend_rate = meta.get("trailingAnnualDividendRate")
        .and_then(|d| d.as_f64());
    
    let trailing_annual_dividend_yield = meta.get("trailingAnnualDividendYield")
        .and_then(|d| d.as_f64());
    
    // Determine dividend frequency (Yahoo Finance doesn't always provide this directly)
    // We'll try to infer from available data or default to Quarterly
    let dividend_frequency = if dividend_rate.is_some() || dividend_yield.is_some() {
        // Most US stocks pay quarterly, but we can't be 100% sure
        Some("Quarterly".to_string())
    } else {
        None
    };
    
    Ok(StockQuote {
        symbol: symbol.to_uppercase(),
        current_price,
        dividend_yield,
        dividend_rate,
        dividend_frequency,
        trailing_annual_dividend_rate,
        trailing_annual_dividend_yield,
    })
}

// Helper function to load notes for paired trades
fn load_pair_notes(conn: &Connection, paired_trades: &mut Vec<PairedTrade>) -> Result<(), String> {
    use std::collections::HashMap;
    
    // Create a map of (entry_trade_id, exit_trade_id) -> notes
    let mut notes_map: HashMap<(i64, i64), String> = HashMap::new();
    
    let mut stmt = conn
        .prepare("SELECT entry_trade_id, exit_trade_id, notes FROM pair_notes")
        .map_err(|e: rusqlite::Error| e.to_string())?;
    
    let notes_iter = stmt
        .query_map([], |row: &Row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e: rusqlite::Error| e.to_string())?;
    
    for note_result in notes_iter {
        let (entry_id, exit_id, notes): (i64, i64, Option<String>) = note_result.map_err(|e: rusqlite::Error| e.to_string())?;
        if let Some(notes_str) = notes {
            notes_map.insert((entry_id, exit_id), notes_str);
        }
    }
    
    // Update paired trades with notes
    for pair in paired_trades.iter_mut() {
        if let Some(notes) = notes_map.get(&(pair.entry_trade_id, pair.exit_trade_id)) {
            pair.notes = Some(notes.clone());
        }
    }
    
    Ok(())
}

#[tauri::command]
pub fn save_pair_notes(entry_trade_id: i64, exit_trade_id: i64, notes: Option<String>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Use INSERT OR REPLACE to update if exists
    conn.execute(
        "INSERT OR REPLACE INTO pair_notes (entry_trade_id, exit_trade_id, notes, updated_at) 
         VALUES (?1, ?2, ?3, datetime('now'))",
        params![entry_trade_id, exit_trade_id, notes],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

// Strategy Checklist Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct StrategyChecklistItem {
    pub id: Option<i64>,
    pub strategy_id: i64,
    pub item_text: String,
    pub is_checked: bool,
    pub item_order: i64,
    pub checklist_type: String,
    pub parent_id: Option<i64>,
}

#[tauri::command]
pub fn get_strategy_checklist(strategy_id: i64, checklist_type: Option<String>) -> Result<Vec<StrategyChecklistItem>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut items = Vec::new();
    
    if let Some(ct) = checklist_type {
        let mut stmt = conn
            .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2 ORDER BY item_order ASC, id ASC")
            .map_err(|e| e.to_string())?;
        
        let items_iter = stmt
            .query_map(params![strategy_id, ct], |row| {
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                })
            })
            .map_err(|e| e.to_string())?;
        
        for item_result in items_iter {
            items.push(item_result.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY item_order ASC, id ASC")
            .map_err(|e| e.to_string())?;
        
        let items_iter = stmt
            .query_map(params![strategy_id], |row| {
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                })
            })
            .map_err(|e| e.to_string())?;
        
        for item_result in items_iter {
            items.push(item_result.map_err(|e| e.to_string())?);
        }
    }
    
    Ok(items)
}

#[tauri::command]
pub fn save_strategy_checklist_item(
    id: Option<i64>,
    strategy_id: i64,
    item_text: String,
    is_checked: bool,
    item_order: i64,
    checklist_type: String,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let checked_int = if is_checked { 1 } else { 0 };
    
    if let Some(item_id) = id {
        // Update existing item
        conn.execute(
            "UPDATE strategy_checklists SET item_text = ?1, is_checked = ?2, item_order = ?3, checklist_type = ?4, parent_id = ?5, updated_at = datetime('now') WHERE id = ?6",
            params![item_text, checked_int, item_order, checklist_type, parent_id, item_id],
        ).map_err(|e| e.to_string())?;
        Ok(item_id)
    } else {
        // Insert new item
        conn.execute(
            "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, created_at, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))",
            params![strategy_id, item_text, checked_int, item_order, checklist_type, parent_id],
        ).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn group_checklist_items(
    item_ids: Vec<i64>,
    group_name: String,
    strategy_id: i64,
    checklist_type: String,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Create a group item (parent)
    let group_order = conn
        .query_row::<i64, _, _>(
            "SELECT COALESCE(MAX(item_order), -1) + 1 FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2",
            params![strategy_id, checklist_type],
            |row| row.get(0),
        )
        .unwrap_or(0);
    
    // Insert group item
    conn.execute(
        "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, created_at, updated_at) 
         VALUES (?1, ?2, 0, ?3, ?4, NULL, datetime('now'), datetime('now'))",
        params![strategy_id, group_name, group_order, checklist_type],
    ).map_err(|e| e.to_string())?;
    
    let group_id = conn.last_insert_rowid();
    
    // Update all selected items to have this group as parent
    for item_id in item_ids {
        conn.execute(
            "UPDATE strategy_checklists SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![group_id, item_id],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(group_id)
}

#[tauri::command]
pub fn ungroup_checklist_items(item_ids: Vec<i64>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Remove parent_id from selected items
    for item_id in item_ids {
        conn.execute(
            "UPDATE strategy_checklists SET parent_id = NULL, updated_at = datetime('now') WHERE id = ?1",
            params![item_id],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn delete_strategy_checklist_item(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "DELETE FROM strategy_checklists WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

// Evaluation Metrics Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct WeekdayPerformance {
    pub weekday: i32, // 0=Monday, 6=Sunday
    pub weekday_name: String,
    pub total_pnl: f64,
    pub trade_count: i64,
    pub win_rate: f64,
    pub average_win: f64,
    pub average_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DayOfMonthPerformance {
    pub day: i32, // 1-31
    pub total_pnl: f64,
    pub trade_count: i64,
    pub win_rate: f64,
    pub average_win: f64,
    pub average_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeOfDayPerformance {
    pub hour: i32, // 0-23 (represents hour bucket, e.g., 9 = 9:00-9:59)
    pub hour_label: String, // e.g., "9:00-9:59"
    pub total_pnl: f64,
    pub trade_count: i64,
    pub win_rate: f64,
    pub average_win: f64,
    pub average_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolPerformance {
    pub symbol: String,
    pub trade_count: i64,
    pub win_rate: f64,
    pub total_pnl: f64,
    pub average_pnl: f64,
    pub average_win: f64,
    pub average_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StrategyPerformanceDetail {
    pub strategy_id: Option<i64>,
    pub strategy_name: String,
    pub trade_count: i64,
    pub win_rate: f64,
    pub total_pnl: f64,
    pub average_pnl: f64,
    pub average_win: f64,
    pub average_loss: f64,
    pub payoff_ratio: f64,
    pub profit_factor: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EvaluationMetrics {
    pub weekday_performance: Vec<WeekdayPerformance>,
    pub day_of_month_performance: Vec<DayOfMonthPerformance>,
    pub time_of_day_performance: Vec<TimeOfDayPerformance>,
    pub symbol_performance: Vec<SymbolPerformance>,
    pub strategy_performance: Vec<StrategyPerformanceDetail>,
}

#[tauri::command]
pub fn get_evaluation_metrics(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<EvaluationMetrics, String> {
    use std::collections::HashMap;
    
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Get position groups to find strategy_id for positions with additions
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone()).map_err(|e| e.to_string())?;
    
    // Create a map: trade_id -> position_group_entry_trade_strategy_id
    let mut trade_to_position_strategy: HashMap<i64, Option<i64>> = HashMap::new();
    for group in &position_groups {
        let position_strategy_id = group.entry_trade.strategy_id;
        for trade in &group.position_trades {
            if let Some(trade_id) = trade.id {
                trade_to_position_strategy.insert(trade_id, position_strategy_id);
            }
        }
    }
    
    // Get entry trade strategy_ids from database
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let entry_trade_ids: Vec<i64> = filtered_paired_trades
        .iter()
        .map(|p| p.entry_trade_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    
    let mut entry_trade_strategies: HashMap<i64, Option<i64>> = HashMap::new();
    if !entry_trade_ids.is_empty() {
        let mut entry_trade_stmt = conn
            .prepare("SELECT strategy_id FROM trades WHERE id = ?")
            .map_err(|e| e.to_string())?;
        
        for entry_trade_id in &entry_trade_ids {
            if let Ok(strategy_id) = entry_trade_stmt.query_row([entry_trade_id], |row| {
                row.get::<_, Option<i64>>(0)
            }) {
                entry_trade_strategies.insert(*entry_trade_id, strategy_id);
            }
        }
    }
    
    // Get strategy names
    let mut stmt = conn
        .prepare("SELECT id, name FROM strategies")
        .map_err(|e| e.to_string())?;
    
    let strategy_iter = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    
    let mut strategy_names: HashMap<i64, String> = HashMap::new();
    for strategy_result in strategy_iter {
        let (id, name) = strategy_result.map_err(|e| e.to_string())?;
        strategy_names.insert(id, name);
    }
    
    // Helper function to calculate risk metrics
    fn calculate_risk_metrics(trades: &[&PairedTrade]) -> (f64, f64, f64, f64, f64, f64, f64) {
        let mut wins = Vec::new();
        let mut losses = Vec::new();
        let mut gross_profit = 0.0;
        let mut gross_loss = 0.0;
        
        for trade in trades {
            let pnl = trade.net_profit_loss;
            if pnl > 0.0 {
                wins.push(pnl);
                gross_profit += pnl;
            } else if pnl < 0.0 {
                losses.push(pnl.abs());
                gross_loss += pnl.abs();
            }
        }
        
        let trade_count = trades.len() as i64;
        let win_count = wins.len() as i64;
        let win_rate = if trade_count > 0 {
            win_count as f64 / trade_count as f64
        } else {
            0.0
        };
        
        let average_win = if !wins.is_empty() {
            wins.iter().sum::<f64>() / wins.len() as f64
        } else {
            0.0
        };
        
        let average_loss = if !losses.is_empty() {
            losses.iter().sum::<f64>() / losses.len() as f64
        } else {
            0.0
        };
        
        let payoff_ratio = if average_loss > 0.0 {
            average_win / average_loss
        } else if average_win > 0.0 {
            f64::INFINITY
        } else {
            0.0
        };
        
        let profit_factor = if gross_loss > 0.0 {
            gross_profit / gross_loss
        } else if gross_profit > 0.0 {
            f64::INFINITY
        } else {
            0.0
        };
        
        (win_rate, average_win, average_loss, payoff_ratio, profit_factor, gross_profit, gross_loss)
    }
    
    // Weekday Performance
    let mut weekday_map: HashMap<i32, Vec<&PairedTrade>> = HashMap::new();
    for pair in &filtered_paired_trades {
        // Parse exit timestamp to get weekday
        if let Ok(exit_time) = pair.exit_timestamp.parse::<chrono::DateTime<chrono::Utc>>() {
            let weekday = exit_time.weekday().num_days_from_monday() as i32; // 0=Monday, 6=Sunday
            weekday_map.entry(weekday).or_insert_with(Vec::new).push(pair);
        } else if let Ok(naive_dt) = chrono::NaiveDateTime::parse_from_str(&pair.exit_timestamp, "%Y-%m-%dT%H:%M:%S") {
            let dt = naive_dt.and_utc();
            let weekday = dt.weekday().num_days_from_monday() as i32;
            weekday_map.entry(weekday).or_insert_with(Vec::new).push(pair);
        }
    }
    
    let mut weekday_performance = Vec::new();
    let weekday_names = vec!["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for weekday in 0..7 {
        if let Some(trades) = weekday_map.get(&weekday) {
            let (win_rate, avg_win, avg_loss, payoff, profit_factor, gross_profit, gross_loss) = calculate_risk_metrics(trades);
            let total_pnl: f64 = trades.iter().map(|t| t.net_profit_loss).sum();
            weekday_performance.push(WeekdayPerformance {
                weekday,
                weekday_name: weekday_names[weekday as usize].to_string(),
                total_pnl,
                trade_count: trades.len() as i64,
                win_rate,
                average_win: avg_win,
                average_loss: avg_loss,
                payoff_ratio: if payoff == f64::INFINITY { 0.0 } else { payoff },
                profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
                gross_profit,
                gross_loss,
            });
        } else {
            weekday_performance.push(WeekdayPerformance {
                weekday,
                weekday_name: weekday_names[weekday as usize].to_string(),
                total_pnl: 0.0,
                trade_count: 0,
                win_rate: 0.0,
                average_win: 0.0,
                average_loss: 0.0,
                payoff_ratio: 0.0,
                profit_factor: 0.0,
                gross_profit: 0.0,
                gross_loss: 0.0,
            });
        }
    }
    
    // Day of Month Performance
    let mut day_of_month_map: HashMap<i32, Vec<&PairedTrade>> = HashMap::new();
    for pair in &filtered_paired_trades {
        if let Ok(exit_time) = pair.exit_timestamp.parse::<chrono::DateTime<chrono::Utc>>() {
            let day = exit_time.day() as i32;
            day_of_month_map.entry(day).or_insert_with(Vec::new).push(pair);
        } else if let Ok(naive_dt) = chrono::NaiveDateTime::parse_from_str(&pair.exit_timestamp, "%Y-%m-%dT%H:%M:%S") {
            let dt = naive_dt.and_utc();
            let day = dt.day() as i32;
            day_of_month_map.entry(day).or_insert_with(Vec::new).push(pair);
        }
    }
    
    let mut day_of_month_performance = Vec::new();
    for day in 1..=31 {
        if let Some(trades) = day_of_month_map.get(&day) {
            let (win_rate, avg_win, avg_loss, payoff, profit_factor, gross_profit, gross_loss) = calculate_risk_metrics(trades);
            let total_pnl: f64 = trades.iter().map(|t| t.net_profit_loss).sum();
            day_of_month_performance.push(DayOfMonthPerformance {
                day,
                total_pnl,
                trade_count: trades.len() as i64,
                win_rate,
                average_win: avg_win,
                average_loss: avg_loss,
                payoff_ratio: if payoff == f64::INFINITY { 0.0 } else { payoff },
                profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
                gross_profit,
                gross_loss,
            });
        } else {
            day_of_month_performance.push(DayOfMonthPerformance {
                day,
                total_pnl: 0.0,
                trade_count: 0,
                win_rate: 0.0,
                average_win: 0.0,
                average_loss: 0.0,
                payoff_ratio: 0.0,
                profit_factor: 0.0,
                gross_profit: 0.0,
                gross_loss: 0.0,
            });
        }
    }
    
    // Time of Day Performance (hour buckets)
    let mut time_of_day_map: HashMap<i32, Vec<&PairedTrade>> = HashMap::new();
    for pair in &filtered_paired_trades {
        if let Ok(exit_time) = pair.exit_timestamp.parse::<chrono::DateTime<chrono::Utc>>() {
            let hour = exit_time.hour() as i32;
            time_of_day_map.entry(hour).or_insert_with(Vec::new).push(pair);
        } else if let Ok(naive_dt) = chrono::NaiveDateTime::parse_from_str(&pair.exit_timestamp, "%Y-%m-%dT%H:%M:%S") {
            let dt = naive_dt.and_utc();
            let hour = dt.hour() as i32;
            time_of_day_map.entry(hour).or_insert_with(Vec::new).push(pair);
        }
    }
    
    let mut time_of_day_performance = Vec::new();
    for hour in 0..24 {
        if let Some(trades) = time_of_day_map.get(&hour) {
            let (win_rate, avg_win, avg_loss, payoff, profit_factor, gross_profit, gross_loss) = calculate_risk_metrics(trades);
            let total_pnl: f64 = trades.iter().map(|t| t.net_profit_loss).sum();
            time_of_day_performance.push(TimeOfDayPerformance {
                hour,
                hour_label: format!("{:02}:00-{:02}:59", hour, hour),
                total_pnl,
                trade_count: trades.len() as i64,
                win_rate,
                average_win: avg_win,
                average_loss: avg_loss,
                payoff_ratio: if payoff == f64::INFINITY { 0.0 } else { payoff },
                profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
                gross_profit,
                gross_loss,
            });
        } else {
            time_of_day_performance.push(TimeOfDayPerformance {
                hour,
                hour_label: format!("{:02}:00-{:02}:59", hour, hour),
                total_pnl: 0.0,
                trade_count: 0,
                win_rate: 0.0,
                average_win: 0.0,
                average_loss: 0.0,
                payoff_ratio: 0.0,
                profit_factor: 0.0,
                gross_profit: 0.0,
                gross_loss: 0.0,
            });
        }
    }
    
    // Symbol Performance
    let mut symbol_map: HashMap<String, Vec<&PairedTrade>> = HashMap::new();
    for pair in &filtered_paired_trades {
        let base_symbol = get_underlying_symbol(&pair.symbol);
        symbol_map.entry(base_symbol).or_insert_with(Vec::new).push(pair);
    }
    
    let mut symbol_performance = Vec::new();
    for (symbol, trades) in symbol_map {
        let (win_rate, avg_win, avg_loss, payoff, profit_factor, gross_profit, gross_loss) = calculate_risk_metrics(&trades);
        let total_pnl: f64 = trades.iter().map(|t| t.net_profit_loss).sum();
        let average_pnl = if !trades.is_empty() {
            total_pnl / trades.len() as f64
        } else {
            0.0
        };
        symbol_performance.push(SymbolPerformance {
            symbol,
            trade_count: trades.len() as i64,
            win_rate,
            total_pnl,
            average_pnl,
            average_win: avg_win,
            average_loss: avg_loss,
            payoff_ratio: if payoff == f64::INFINITY { 0.0 } else { payoff },
            profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
            gross_profit,
            gross_loss,
        });
    }
    symbol_performance.sort_by(|a, b| b.total_pnl.partial_cmp(&a.total_pnl).unwrap_or(std::cmp::Ordering::Equal));
    
    // Strategy Performance
    let mut strategy_map: HashMap<Option<i64>, Vec<&PairedTrade>> = HashMap::new();
    for pair in &filtered_paired_trades {
        // Get strategy_id from position group first, then entry trade, then pair
        let strategy_id = trade_to_position_strategy
            .get(&pair.entry_trade_id)
            .copied()
            .flatten()
            .or_else(|| {
                entry_trade_strategies
                    .get(&pair.entry_trade_id)
                    .copied()
                    .flatten()
            })
            .or(pair.strategy_id);
        
        strategy_map.entry(strategy_id).or_insert_with(Vec::new).push(pair);
    }
    
    let mut strategy_performance = Vec::new();
    for (strategy_id, trades) in strategy_map {
        let (win_rate, avg_win, avg_loss, payoff, profit_factor, gross_profit, gross_loss) = calculate_risk_metrics(&trades);
        let total_pnl: f64 = trades.iter().map(|t| t.net_profit_loss).sum();
        let average_pnl = if !trades.is_empty() {
            total_pnl / trades.len() as f64
        } else {
            0.0
        };
        
        let strategy_name = if let Some(id) = strategy_id {
            strategy_names.get(&id).cloned().unwrap_or_else(|| "Unknown".to_string())
        } else {
            "Unassigned".to_string()
        };
        
        strategy_performance.push(StrategyPerformanceDetail {
            strategy_id,
            strategy_name,
            trade_count: trades.len() as i64,
            win_rate,
            total_pnl,
            average_pnl,
            average_win: avg_win,
            average_loss: avg_loss,
            payoff_ratio: if payoff == f64::INFINITY { 0.0 } else { payoff },
            profit_factor: if profit_factor == f64::INFINITY { 0.0 } else { profit_factor },
            gross_profit,
            gross_loss,
        });
    }
    strategy_performance.sort_by(|a, b| b.total_pnl.partial_cmp(&a.total_pnl).unwrap_or(std::cmp::Ordering::Equal));
    
    Ok(EvaluationMetrics {
        weekday_performance,
        day_of_month_performance,
        time_of_day_performance,
        symbol_performance,
        strategy_performance,
    })
}

// Equity Curve Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct EquityPoint {
    pub date: String,
    pub cumulative_pnl: f64,
    pub daily_pnl: f64,
    pub peak_equity: f64,
    pub drawdown: f64,
    pub drawdown_pct: f64,
    pub is_winning_streak: bool,
    pub is_losing_streak: bool,
    pub is_max_drawdown: bool,
    pub is_best_surge: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DrawdownMetrics {
    pub max_drawdown: f64,
    pub max_drawdown_pct: f64,
    pub max_drawdown_start: Option<String>,
    pub max_drawdown_end: Option<String>,
    pub avg_drawdown: f64,
    pub longest_drawdown_days: i64,
    pub longest_drawdown_start: Option<String>,
    pub longest_drawdown_end: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EquityCurveData {
    pub equity_points: Vec<EquityPoint>,
    pub drawdown_metrics: DrawdownMetrics,
    pub best_surge_start: Option<String>,
    pub best_surge_end: Option<String>,
    pub best_surge_value: f64,
}

#[tauri::command]
pub fn get_equity_curve(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>) -> Result<EquityCurveData, String> {
    use std::collections::HashMap;
    
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter by date range if provided
    let mut filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Sort by exit timestamp (chronological order)
    filtered_paired_trades.sort_by(|a, b| a.exit_timestamp.cmp(&b.exit_timestamp));
    
    // Group by date and calculate daily P&L
    let mut daily_pnl_map: HashMap<String, f64> = HashMap::new();
    for pair in &filtered_paired_trades {
        if let Some(date_str) = pair.exit_timestamp.split('T').next() {
            *daily_pnl_map.entry(date_str.to_string()).or_insert(0.0) += pair.net_profit_loss;
        }
    }
    
    // Convert to sorted vector of dates
    let mut dates: Vec<String> = daily_pnl_map.keys().cloned().collect();
    dates.sort();
    
    // Build equity curve
    let mut equity_points = Vec::new();
    let mut cumulative_pnl = 0.0;
    let mut peak_equity = 0.0;
    let mut max_drawdown = 0.0;
    let mut max_drawdown_start: Option<String> = None;
    let mut max_drawdown_end: Option<String> = None;
    let mut current_drawdown_start: Option<String> = None;
    let mut longest_drawdown_days = 0;
    let mut longest_drawdown_start: Option<String> = None;
    let mut longest_drawdown_end: Option<String> = None;
    let mut current_drawdown_days = 0;
    let mut current_drawdown_start_date: Option<String> = None;
    let mut drawdown_sum = 0.0;
    let mut drawdown_count = 0;
    
    // Track streaks
    let mut current_streak_type: Option<bool> = None; // true = winning, false = losing
    let mut current_streak_start: Option<String> = None;
    let mut winning_streaks: Vec<(String, String)> = Vec::new(); // (start, end)
    let mut losing_streaks: Vec<(String, String)> = Vec::new();
    
    // Track best equity surge
    let mut best_surge_start: Option<String> = None;
    let mut best_surge_end: Option<String> = None;
    let mut best_surge_value = 0.0;
    let mut surge_start_date: Option<String> = None;
    let mut surge_start_equity = 0.0;
    
    for date in &dates {
        let daily_pnl = daily_pnl_map.get(date).copied().unwrap_or(0.0);
        cumulative_pnl += daily_pnl;
        
        // Update peak equity
        if cumulative_pnl > peak_equity {
            peak_equity = cumulative_pnl;
            // Reset surge tracking when we hit a new peak
            surge_start_date = Some(date.clone());
            surge_start_equity = cumulative_pnl;
        }
        
        // Calculate drawdown
        let drawdown = peak_equity - cumulative_pnl;
        let drawdown_pct = if peak_equity > 0.0 {
            (drawdown / peak_equity) * 100.0
        } else if peak_equity < 0.0 {
            (drawdown / peak_equity.abs()) * 100.0
        } else {
            0.0
        };
        
        // Track max drawdown
        if drawdown > max_drawdown {
            max_drawdown = drawdown;
            if current_drawdown_start.is_none() {
                current_drawdown_start = Some(date.clone());
            }
            max_drawdown_start = current_drawdown_start.clone();
            max_drawdown_end = Some(date.clone());
        }
        
        // Track drawdown periods
        if drawdown > 0.0 {
            if current_drawdown_start_date.is_none() {
                current_drawdown_start_date = Some(date.clone());
            }
            current_drawdown_days += 1;
            drawdown_sum += drawdown;
            drawdown_count += 1;
        } else {
            // Drawdown ended
            if current_drawdown_days > longest_drawdown_days {
                longest_drawdown_days = current_drawdown_days;
                longest_drawdown_start = current_drawdown_start_date.clone();
                longest_drawdown_end = Some(date.clone());
            }
            current_drawdown_days = 0;
            current_drawdown_start_date = None;
            current_drawdown_start = None;
        }
        
        // Track best equity surge (from a low to a new peak)
        if let Some(ref surge_start) = surge_start_date {
            if cumulative_pnl > surge_start_equity {
                let surge_value = cumulative_pnl - surge_start_equity;
                if surge_value > best_surge_value {
                    best_surge_value = surge_value;
                    best_surge_start = Some(surge_start.clone());
                    best_surge_end = Some(date.clone());
                }
            }
        }
        
        // Track streaks
        let is_win = daily_pnl > 0.0;
        let is_loss = daily_pnl < 0.0;
        
        if is_win {
            if current_streak_type == Some(false) {
                // End losing streak
                if let Some(start) = current_streak_start.take() {
                    losing_streaks.push((start, date.clone()));
                }
            }
            if current_streak_type != Some(true) {
                current_streak_type = Some(true);
                current_streak_start = Some(date.clone());
            }
        } else if is_loss {
            if current_streak_type == Some(true) {
                // End winning streak
                if let Some(start) = current_streak_start.take() {
                    winning_streaks.push((start, date.clone()));
                }
            }
            if current_streak_type != Some(false) {
                current_streak_type = Some(false);
                current_streak_start = Some(date.clone());
            }
        }
        
        // Check if this date is in max drawdown period
        let is_max_drawdown = max_drawdown_start.as_ref().map_or(false, |start| {
            date >= start && max_drawdown_end.as_ref().map_or(false, |end| date <= end)
        });
        
        // Check if this date is in best surge period
        let is_best_surge = best_surge_start.as_ref().map_or(false, |start| {
            date >= start && best_surge_end.as_ref().map_or(false, |end| date <= end)
        });
        
        // Check if this date is in a winning/losing streak
        let is_winning_streak = winning_streaks.iter().any(|(s, e)| date >= s && date <= e) ||
            (current_streak_type == Some(true) && current_streak_start.as_ref().map_or(false, |s| date >= s));
        let is_losing_streak = losing_streaks.iter().any(|(s, e)| date >= s && date <= e) ||
            (current_streak_type == Some(false) && current_streak_start.as_ref().map_or(false, |s| date >= s));
        
        equity_points.push(EquityPoint {
            date: date.clone(),
            cumulative_pnl,
            daily_pnl,
            peak_equity,
            drawdown,
            drawdown_pct,
            is_winning_streak: is_winning_streak || (current_streak_type == Some(true) && current_streak_start.as_ref().map_or(false, |s| date >= s)),
            is_losing_streak: is_losing_streak || (current_streak_type == Some(false) && current_streak_start.as_ref().map_or(false, |s| date >= s)),
            is_max_drawdown,
            is_best_surge,
        });
    }
    
    // Calculate average drawdown
    let avg_drawdown = if drawdown_count > 0 {
        drawdown_sum / drawdown_count as f64
    } else {
        0.0
    };
    
    // Calculate max drawdown percentage
    let max_drawdown_pct = if peak_equity > 0.0 {
        (max_drawdown / peak_equity) * 100.0
    } else if peak_equity < 0.0 {
        (max_drawdown / peak_equity.abs()) * 100.0
    } else {
        0.0
    };
    
    Ok(EquityCurveData {
        equity_points,
        drawdown_metrics: DrawdownMetrics {
            max_drawdown,
            max_drawdown_pct,
            max_drawdown_start,
            max_drawdown_end,
            avg_drawdown,
            longest_drawdown_days,
            longest_drawdown_start,
            longest_drawdown_end,
        },
        best_surge_start,
        best_surge_end,
        best_surge_value,
    })
}

// Distribution & Concentration Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct HistogramBin {
    pub bin_start: f64,
    pub bin_end: f64,
    pub count: i64,
    pub total_pnl: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConcentrationStats {
    pub total_trades: i64,
    pub profitable_trades_count: i64,
    pub losing_trades_count: i64,
    pub top_k: i64,
    pub profit_share_top: f64,
    pub loss_share_top: f64,
    pub mean_return: f64,
    pub median_return: f64,
    pub stability_score: f64,
    pub insights: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DistributionConcentrationData {
    pub histogram: Vec<HistogramBin>,
    pub concentration: ConcentrationStats,
}

#[tauri::command]
pub fn get_distribution_concentration(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    concentration_percent: Option<f64>,
) -> Result<DistributionConcentrationData, String> {
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    if filtered_paired_trades.is_empty() {
        return Ok(DistributionConcentrationData {
            histogram: Vec::new(),
            concentration: ConcentrationStats {
                total_trades: 0,
                profitable_trades_count: 0,
                losing_trades_count: 0,
                top_k: 0,
                profit_share_top: 0.0,
                loss_share_top: 0.0,
                mean_return: 0.0,
                median_return: 0.0,
                stability_score: 100.0,
                insights: vec!["No trades in the selected timeframe.".to_string()],
            },
        });
    }
    
    // Extract PnL values
    let pnl_values: Vec<f64> = filtered_paired_trades.iter().map(|p| p.net_profit_loss).collect();
    
    // Calculate mean and median
    let total_pnl: f64 = pnl_values.iter().sum();
    let mean_return = total_pnl / pnl_values.len() as f64;
    
    let mut sorted_pnl = pnl_values.clone();
    sorted_pnl.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_return = if sorted_pnl.is_empty() {
        0.0
    } else if sorted_pnl.len() % 2 == 0 {
        (sorted_pnl[sorted_pnl.len() / 2 - 1] + sorted_pnl[sorted_pnl.len() / 2]) / 2.0
    } else {
        sorted_pnl[sorted_pnl.len() / 2]
    };
    
    // Build histogram
    let min_pnl = sorted_pnl.first().copied().unwrap_or(0.0);
    let max_pnl = sorted_pnl.last().copied().unwrap_or(0.0);
    let range = max_pnl - min_pnl;
    
    // Use 20 bins, or fewer if range is small
    let num_bins = if range > 0.0 {
        (20.0_f64.min(range / 10.0).max(1.0)) as usize
    } else {
        1
    };
    
    let bin_width = if range > 0.0 && num_bins > 1 {
        range / num_bins as f64
    } else {
        1.0
    };
    
    // Create bins centered around 0
    let mut histogram = Vec::new();
    if num_bins > 1 {
        // Find the bin that contains 0
        let zero_bin_index = ((-min_pnl) / bin_width).floor() as i32;
        let start_bin = zero_bin_index - (num_bins as i32 / 2);
        
        for i in 0..num_bins {
            let bin_start = min_pnl + (start_bin + i as i32) as f64 * bin_width;
            let bin_end = bin_start + bin_width;
            
            let count = pnl_values.iter()
                .filter(|&&pnl| pnl >= bin_start && (i == num_bins - 1 || pnl < bin_end))
                .count() as i64;
            
            let total_pnl_in_bin: f64 = pnl_values.iter()
                .filter(|&&pnl| pnl >= bin_start && (i == num_bins - 1 || pnl < bin_end))
                .sum();
            
            histogram.push(HistogramBin {
                bin_start,
                bin_end,
                count,
                total_pnl: total_pnl_in_bin,
            });
        }
    } else {
        // Single bin
        histogram.push(HistogramBin {
            bin_start: min_pnl,
            bin_end: max_pnl,
            count: pnl_values.len() as i64,
            total_pnl,
        });
    }
    
    // Calculate concentration
    let concentration_percent = concentration_percent.unwrap_or(10.0).max(5.0).min(30.0);
    let top_fraction = concentration_percent / 100.0;
    let n = filtered_paired_trades.len();
    let min_absolute = if n < 30 { 3 } else { 5 };
    let k = (n as f64 * top_fraction).round() as i64;
    let k = k.max(min_absolute).min(n as i64);
    
    // Separate profitable and losing trades
    let mut profitable_trades: Vec<f64> = pnl_values.iter().filter(|&&pnl| pnl > 0.0).copied().collect();
    let mut losing_trades: Vec<f64> = pnl_values.iter().filter(|&&pnl| pnl < 0.0).copied().collect();
    
    profitable_trades.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    losing_trades.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    
    let total_profit_all: f64 = profitable_trades.iter().sum();
    let total_loss_all: f64 = losing_trades.iter().map(|x| x.abs()).sum();
    
    let k_profit = k.min(profitable_trades.len() as i64);
    let k_loss = k.min(losing_trades.len() as i64);
    
    let top_profit_trades: f64 = profitable_trades.iter().take(k_profit as usize).sum();
    let top_loss_trades: f64 = losing_trades.iter().take(k_loss as usize).map(|x| x.abs()).sum();
    
    let profit_share_top = if total_profit_all > 0.0 {
        top_profit_trades / total_profit_all
    } else {
        0.0
    };
    
    let loss_share_top = if total_loss_all > 0.0 {
        top_loss_trades / total_loss_all
    } else {
        0.0
    };
    
    // Calculate stability score
    const PROFIT_THRESHOLD: f64 = 0.4;
    const LOSS_THRESHOLD: f64 = 0.4;
    
    let profit_penalty = if profit_share_top <= PROFIT_THRESHOLD {
        0.0
    } else {
        ((profit_share_top - PROFIT_THRESHOLD) / (1.0 - PROFIT_THRESHOLD)).min(1.0)
    };
    
    let loss_penalty = if loss_share_top <= LOSS_THRESHOLD {
        0.0
    } else {
        ((loss_share_top - LOSS_THRESHOLD) / (1.0 - LOSS_THRESHOLD)).min(1.0)
    };
    
    let mean_median_gap = (mean_return - median_return).abs();
    let gap_scale = if mean_return != 0.0 {
        mean_return.abs()
    } else {
        1.0
    };
    let gap_penalty = (mean_median_gap / gap_scale.max(1.0)).min(1.0);
    
    let instability_score = profit_penalty * 0.5 + loss_penalty * 0.3 + gap_penalty * 0.2;
    let stability_score = (1.0 - instability_score) * 100.0;
    
    // Generate insights
    let mut insights = Vec::new();
    
    if n < 30 {
        insights.push("Limited data: results may be noisy with fewer than 30 trades.".to_string());
    }
    
    // Profit concentration insights
    if profit_share_top < 0.2 {
        insights.push(format!(
            "Your profits are well distributed. The top {}% of trades account for {:.1}% of total profit, indicating good consistency.",
            concentration_percent, profit_share_top * 100.0
        ));
    } else if profit_share_top <= 0.4 {
        insights.push(format!(
            "Your profits show moderate concentration. The top {}% of trades generate {:.1}% of total profit.",
            concentration_percent, profit_share_top * 100.0
        ));
    } else if profit_share_top <= 0.7 {
        insights.push(format!(
            "A small percentage of your trades generates a large share of profits. The top {}% of trades produce {:.1}% of your total profit. Consider systematizing the conditions of your best trades.",
            concentration_percent, profit_share_top * 100.0
        ));
    } else {
        insights.push(format!(
            "Severe profit concentration: the top {}% of trades generate {:.1}% of total profit. Your winners are doing the heavy lifting. Without them, your equity curve would be much flatter.",
            concentration_percent, profit_share_top * 100.0
        ));
    }
    
    // Loss concentration insights
    if loss_share_top < 0.2 {
        insights.push(format!(
            "Your losses are well distributed. The worst {}% of trades account for {:.1}% of total loss.",
            concentration_percent, loss_share_top * 100.0
        ));
    } else if loss_share_top <= 0.5 {
        insights.push(format!(
            "Your losses show moderate concentration. The worst {}% of trades account for {:.1}% of total loss.",
            concentration_percent, loss_share_top * 100.0
        ));
    } else if loss_share_top <= 0.7 {
        insights.push(format!(
            "A relatively small group of bad trades is responsible for most of your drawdowns. The worst {}% of losing trades account for {:.1}% of total loss. Tightening risk controls could significantly stabilize your equity.",
            concentration_percent, loss_share_top * 100.0
        ));
    } else {
        insights.push(format!(
            "Severe loss concentration: the worst {}% of trades cause {:.1}% of total loss. Consider hard stop rules, daily loss limits, or reducing position size on lower conviction trades.",
            concentration_percent, loss_share_top * 100.0
        ));
    }
    
    // Mean vs median insights
    if mean_return != 0.0 && (mean_return.abs() / median_return.abs().max(0.01)) >= 1.5 {
        insights.push("Median and average returns differ significantly, suggesting performance is skewed by a small set of large winners or losers.".to_string());
    } else if (mean_return - median_return).abs() < (mean_return.abs() * 0.1) {
        insights.push("Median and average returns are closely aligned, indicating consistent returns rather than rare outlier events.".to_string());
    }
    
    // Overall stability insight
    if stability_score >= 80.0 {
        insights.push("Your performance is broadly supported by many trades rather than a few outliers. This is a sign of a robust and repeatable process.".to_string());
    } else if stability_score < 50.0 {
        insights.push("Your results show high variance and instability. Focus on replicating your best setups while strictly capping downside on worst trades.".to_string());
    }
    
    Ok(DistributionConcentrationData {
        histogram,
        concentration: ConcentrationStats {
            total_trades: n as i64,
            profitable_trades_count: profitable_trades.len() as i64,
            losing_trades_count: losing_trades.len() as i64,
            top_k: k,
            profit_share_top,
            loss_share_top,
            mean_return,
            median_return,
            stability_score,
            insights,
        },
    })
}

// Tilt-A-Metric Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct StreakStats {
    pub k: i32,
    pub sample_size: i64,
    pub win_rate_after_k_losses: f64,
    pub avg_pnl_after_k_losses: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TiltStats {
    pub baseline_win_rate: f64,
    pub win_rate_after_loss: f64,
    pub win_rate_after_win: f64,
    pub win_rate_after_2_losses: f64,
    pub avg_loss_normally: f64,
    pub avg_loss_after_loss: f64,
    pub prob_loss_after_loss: f64,
    pub tilt_score: f64,
    pub recommended_streak: Option<i32>,
    pub streak_stats: Vec<StreakStats>,
    pub coaching_lines: Vec<String>,
    pub tilt_category: String,
}

#[tauri::command]
pub fn get_tilt_metric(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<TiltStats, String> {
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Filter by date range if provided
    let filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades.into_iter().filter(|pair| {
            let exit_date = &pair.exit_timestamp;
            let in_range = if let Some(start) = &start_date {
                exit_date >= start
            } else {
                true
            } && if let Some(end) = &end_date {
                exit_date <= end
            } else {
                true
            };
            in_range
        }).collect()
    } else {
        paired_trades
    };
    
    // Sort by exit timestamp to ensure chronological order
    let mut sorted_trades = filtered_paired_trades;
    sorted_trades.sort_by(|a, b| a.exit_timestamp.cmp(&b.exit_timestamp));
    
    if sorted_trades.len() < 10 {
        return Ok(TiltStats {
            baseline_win_rate: 0.0,
            win_rate_after_loss: 0.0,
            win_rate_after_win: 0.0,
            win_rate_after_2_losses: 0.0,
            avg_loss_normally: 0.0,
            avg_loss_after_loss: 0.0,
            prob_loss_after_loss: 0.0,
            tilt_score: 0.0,
            recommended_streak: None,
            streak_stats: Vec::new(),
            coaching_lines: vec!["Not enough trade history to evaluate tilt yet. Need at least 10 trades.".to_string()],
            tilt_category: "Insufficient Data".to_string(),
        });
    }
    
    // Extract PnL values
    let pnl_values: Vec<f64> = sorted_trades.iter().map(|p| p.net_profit_loss).collect();
    
    // Calculate baseline stats
    let total_trades = pnl_values.len();
    let wins: Vec<f64> = pnl_values.iter().filter(|&&pnl| pnl > 0.0).copied().collect();
    let losses: Vec<f64> = pnl_values.iter().filter(|&&pnl| pnl < 0.0).copied().collect();
    
    let wins_count = wins.len();
    let losses_count = losses.len();
    let baseline_win_rate = if total_trades > 0 {
        wins_count as f64 / total_trades as f64
    } else {
        0.0
    };
    
    let avg_loss_normally = if losses_count > 0 {
        losses.iter().sum::<f64>() / losses_count as f64
    } else {
        0.0
    };
    
    // Calculate win rate after a loss
    let mut after_loss_wins = 0;
    let mut after_loss_total = 0;
    let mut after_loss_losses: Vec<f64> = Vec::new();
    
    for i in 1..pnl_values.len() {
        if pnl_values[i - 1] < 0.0 && pnl_values[i] != 0.0 {
            after_loss_total += 1;
            if pnl_values[i] > 0.0 {
                after_loss_wins += 1;
            } else if pnl_values[i] < 0.0 {
                after_loss_losses.push(pnl_values[i]);
            }
        }
    }
    
    let win_rate_after_loss = if after_loss_total > 0 {
        after_loss_wins as f64 / after_loss_total as f64
    } else {
        baseline_win_rate
    };
    
    let avg_loss_after_loss = if !after_loss_losses.is_empty() {
        after_loss_losses.iter().sum::<f64>() / after_loss_losses.len() as f64
    } else {
        avg_loss_normally
    };
    
    let prob_loss_after_loss = if after_loss_total > 0 {
        after_loss_losses.len() as f64 / after_loss_total as f64
    } else {
        0.0
    };
    
    // Calculate win rate after a win
    let mut after_win_wins = 0;
    let mut after_win_total = 0;
    
    for i in 1..pnl_values.len() {
        if pnl_values[i - 1] > 0.0 && pnl_values[i] != 0.0 {
            after_win_total += 1;
            if pnl_values[i] > 0.0 {
                after_win_wins += 1;
            }
        }
    }
    
    let win_rate_after_win = if after_win_total > 0 {
        after_win_wins as f64 / after_win_total as f64
    } else {
        baseline_win_rate
    };
    
    // Calculate win rate after 2 losses
    let mut after_2_losses_wins = 0;
    let mut after_2_losses_total = 0;
    
    for i in 2..pnl_values.len() {
        if pnl_values[i - 2] < 0.0 && pnl_values[i - 1] < 0.0 && pnl_values[i] != 0.0 {
            after_2_losses_total += 1;
            if pnl_values[i] > 0.0 {
                after_2_losses_wins += 1;
            }
        }
    }
    
    let win_rate_after_2_losses = if after_2_losses_total > 0 {
        after_2_losses_wins as f64 / after_2_losses_total as f64
    } else {
        baseline_win_rate
    };
    
    // Calculate streak stats for k in {1, 2, 3, 4}
    let mut streak_stats = Vec::new();
    
    for k in 1..=4 {
        let mut after_k_losses_wins = 0;
        let mut after_k_losses_total = 0;
        let mut after_k_losses_pnl: Vec<f64> = Vec::new();
        
        for i in k..pnl_values.len() {
            let mut all_losses = true;
            for j in (i - k)..i {
                if pnl_values[j] >= 0.0 {
                    all_losses = false;
                    break;
                }
            }
            
            if all_losses && pnl_values[i] != 0.0 {
                after_k_losses_total += 1;
                after_k_losses_pnl.push(pnl_values[i]);
                if pnl_values[i] > 0.0 {
                    after_k_losses_wins += 1;
                }
            }
        }
        
        let win_rate_after_k = if after_k_losses_total > 0 {
            after_k_losses_wins as f64 / after_k_losses_total as f64
        } else {
            0.0
        };
        
        let avg_pnl_after_k = if !after_k_losses_pnl.is_empty() {
            after_k_losses_pnl.iter().sum::<f64>() / after_k_losses_pnl.len() as f64
        } else {
            0.0
        };
        
        streak_stats.push(StreakStats {
            k: k as i32,
            sample_size: after_k_losses_total as i64,
            win_rate_after_k_losses: win_rate_after_k,
            avg_pnl_after_k_losses: avg_pnl_after_k,
        });
    }
    
    // Find recommended stop loss streak
    const MIN_SAMPLE: i64 = 20;
    const WIN_DROP_THRESHOLD: f64 = 0.15;
    
    let mut recommended_streak: Option<i32> = None;
    
    for stat in &streak_stats {
        if stat.sample_size >= MIN_SAMPLE {
            let win_drop = baseline_win_rate - stat.win_rate_after_k_losses;
            let ev_bad = stat.avg_pnl_after_k_losses < 0.0;
            
            if win_drop >= WIN_DROP_THRESHOLD && ev_bad {
                recommended_streak = Some(stat.k);
                break;
            }
        }
    }
    
    // Calculate tilt score
    const MAX_DROP: f64 = 0.5;
    
    let drop_after_loss = (baseline_win_rate - win_rate_after_loss).max(0.0);
    let severity_after_loss = (drop_after_loss / MAX_DROP).min(1.0).max(0.0);
    let score1 = severity_after_loss * 3.0;
    
    let drop_after_2_losses = (baseline_win_rate - win_rate_after_2_losses).max(0.0);
    let severity_after_2_losses = (drop_after_2_losses / MAX_DROP).min(1.0).max(0.0);
    let score2 = severity_after_2_losses * 3.0;
    
    let mut score3 = 0.0;
    if avg_loss_normally < 0.0 && avg_loss_after_loss < 0.0 {
        let normal_mag = avg_loss_normally.abs();
        let after_mag = avg_loss_after_loss.abs();
        if after_mag > normal_mag {
            let ratio = after_mag / normal_mag;
            let severity = ((ratio - 1.0) / 1.0).min(1.0).max(0.0);
            score3 = severity * 2.0;
        }
    }
    
    let severity_loss_chain = prob_loss_after_loss.min(1.0).max(0.0);
    let score4 = severity_loss_chain * 2.0;
    
    let tilt_raw = score1 + score2 + score3 + score4;
    let tilt_score = tilt_raw.min(10.0).max(0.0);
    
    // Determine tilt category
    let tilt_category = if tilt_score <= 3.0 {
        "Calm & Disciplined"
    } else if tilt_score <= 7.0 {
        "Moderate Tilt Risk"
    } else {
        "High Tilt / Severe Tilt"
    }.to_string();
    
    // Generate coaching lines
    let mut coaching_lines = Vec::new();
    
    if tilt_score <= 3.0 && recommended_streak.is_none() {
        coaching_lines.push("Your performance after losing trades is similar to your baseline. There is no strong evidence of emotional tilt.".to_string());
        coaching_lines.push(format!(
            "You win approximately {:.1}% overall and {:.1}% after a loss. Loss severity does not increase meaningfully after losing.",
            baseline_win_rate * 100.0,
            win_rate_after_loss * 100.0
        ));
        coaching_lines.push("A fixed 'stop after N losses' rule is optional for you. A standard daily loss cap is likely sufficient.".to_string());
    } else if tilt_score > 3.0 && tilt_score <= 7.0 {
        coaching_lines.push("Your performance degrades after losing trades, but not catastrophically.".to_string());
        coaching_lines.push(format!(
            "Your win rate drops from {:.1}% to {:.1}% after a loss, and the chance of another loss after losing is {:.1}%.",
            baseline_win_rate * 100.0,
            win_rate_after_loss * 100.0,
            prob_loss_after_loss * 100.0
        ));
        if let Some(streak) = recommended_streak {
            coaching_lines.push(format!(
                "Based on your history, you should strongly consider stopping for the day after {} losing trades in a row. Beyond this streak, your expected PnL is consistently negative.",
                streak
            ));
        } else {
            coaching_lines.push("There is no single streak length that stands out as a clear cutoff, but you should pay attention to your behavior after losses and enforce a daily loss cap.".to_string());
        }
    } else {
        coaching_lines.push("Your trading shows strong signs of emotional tilt after losses.".to_string());
        coaching_lines.push(format!(
            "Your win rate falls from {:.1}% to {:.1}% after a loss, and to {:.1}% after two losses in a row.",
            baseline_win_rate * 100.0,
            win_rate_after_loss * 100.0,
            win_rate_after_2_losses * 100.0
        ));
        coaching_lines.push("Your average loss becomes larger after losing, which suggests revenge trading or loss of discipline.".to_string());
        if let Some(streak) = recommended_streak {
            coaching_lines.push(format!(
                "Recommendation: set a hard rule to stop trading for the day after {} consecutive losing trades.",
                streak
            ));
        }
        coaching_lines.push("Also consider using a fixed maximum daily loss and reducing position size immediately after a loss.".to_string());
    }
    
    Ok(TiltStats {
        baseline_win_rate,
        win_rate_after_loss,
        win_rate_after_win,
        win_rate_after_2_losses,
        avg_loss_normally,
        avg_loss_after_loss,
        prob_loss_after_loss,
        tilt_score,
        recommended_streak,
        streak_stats,
        coaching_lines,
        tilt_category,
    })
}

