use crate::database::{get_connection, Trade, EmotionalState, EmotionSurvey, Strategy, JournalEntry, JournalTrade, NewsItem, CalendarEvent, EconomicEvent};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use chrono::{Timelike, Datelike};
use std::fs;
use std::process::Command;
use evalexpr::{eval_float_with_context, HashMapContext, Value, ContextWithMutableVariables, DefaultNumericTypes};
use reqwest::cookie::CookieStore;
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
    pub filled: f64,
    #[serde(rename = "Total Qty")]
    pub total_qty: f64,
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

/// SQL fragment to filter to paper trades only (notes contain [PAPER]). Use when appending to an existing WHERE clause.
fn paper_only_and_clause(paper_only: Option<bool>) -> &'static str {
    if paper_only == Some(true) {
        " AND (UPPER(COALESCE(notes,'')) LIKE '%[PAPER]%')"
    } else {
        ""
    }
}

/// SQL fragment for WHERE when table has no other conditions. Use for queries that only need paper filter.
fn paper_only_where_clause(paper_only: Option<bool>) -> &'static str {
    if paper_only == Some(true) {
        " WHERE (UPPER(COALESCE(notes,'')) LIKE '%[PAPER]%')"
    } else {
        ""
    }
}

#[tauri::command]
pub fn import_trades_csv(csv_data: String, mark_as_paper: Option<bool>) -> Result<Vec<i64>, String> {
    use csv::ReaderBuilder;
    
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .from_reader(csv_data.as_bytes());
    
    // Detect format by reading headers
    let headers = reader.headers().map_err(|e| e.to_string())?;
    let is_webull = headers.iter().any(|h| h == "Filled" || h == "Placed Time" || h == "Filled Time");
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mark_paper = mark_as_paper == Some(true);
    let mut inserted_ids = Vec::new();
    
    if is_webull {
        // Webull format
        for result in reader.deserialize() {
            let webull_trade: WebullCsvTrade = result.map_err(|e| e.to_string())?;
            
            // Skip only when there is no filled quantity. Webull sometimes marks orders as
            // "Cancelled" even when they have a filled quantity (partial fill then cancel);
            // we import any row with filled > 0 so those trades are not lost.
            if webull_trade.filled <= 0.0 {
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
            
            // Quantity is the filled amount (may be fractional for fractional shares)
            let quantity = webull_trade.filled;
            
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
            
            // Store as Filled so pairing/PnL include this trade (they filter on Filled/FILLED)
            let status = "Filled".to_string();
            let trade = Trade {
                id: None,
                symbol: webull_trade.symbol,
                side: webull_trade.side,
                quantity,
                price,
                timestamp,
                order_type: webull_trade.time_in_force.unwrap_or_else(|| "DAY".to_string()),
                status,
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
            
            conn.execute(
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
            
            let row_id = conn.last_insert_rowid();
            if mark_paper {
                let existing_notes: Option<String> = conn.query_row(
                    "SELECT notes FROM trades WHERE id = ?1",
                    params![row_id],
                    |row| row.get(0),
                ).ok().flatten();
                let new_notes = match &existing_notes {
                    Some(s) if !s.is_empty() => format!("{} [PAPER]", s.trim()),
                    _ => "[PAPER]".to_string(),
                };
                conn.execute("UPDATE trades SET notes = ?1 WHERE id = ?2", params![new_notes, row_id]).map_err(|e| e.to_string())?;
            }
            inserted_ids.push(row_id);
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
            
            conn.execute(
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
            
            let row_id = conn.last_insert_rowid();
            if mark_paper {
                let existing_notes: Option<String> = conn.query_row(
                    "SELECT notes FROM trades WHERE id = ?1",
                    params![row_id],
                    |row| row.get(0),
                ).ok().flatten();
                let new_notes = match &existing_notes {
                    Some(s) if !s.is_empty() => format!("{} [PAPER]", s.trim()),
                    _ => "[PAPER]".to_string(),
                };
                conn.execute("UPDATE trades SET notes = ?1 WHERE id = ?2", params![new_notes, row_id]).map_err(|e| e.to_string())?;
            }
            inserted_ids.push(row_id);
        }
    }
    
    Ok(inserted_ids)
}

#[tauri::command]
pub fn add_trade_manual(
    symbol: String,
    side: String,
    quantity: f64,
    price: f64,
    timestamp: String,
    order_type: Option<String>,
    fees: Option<f64>,
    notes: Option<String>,
    strategy_id: Option<i64>,
) -> Result<i64, String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("Symbol is required".to_string());
    }
    let side_upper = side.trim().to_uppercase();
    if side_upper != "BUY" && side_upper != "SELL" {
        return Err("Side must be BUY or SELL".to_string());
    }
    if quantity <= 0.0 {
        return Err("Quantity must be positive".to_string());
    }
    if price < 0.0 {
        return Err("Price cannot be negative".to_string());
    }
    if timestamp.trim().is_empty() {
        return Err("Timestamp is required".to_string());
    }

    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let order_type = order_type
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "MARKET".to_string());
    let status = "FILLED".to_string();

    conn.execute(
        "INSERT INTO trades (symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            symbol,
            side_upper,
            quantity,
            price,
            timestamp.trim(),
            order_type,
            status,
            fees,
            notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            strategy_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_trades_with_pairing(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>, paper_only: Option<bool>) -> Result<Vec<TradeWithPairing>, String> {
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
    let where_clause = if date_filter.is_empty() {
        paper_only_where_clause(paper_only).to_string()
    } else {
        format!("{}{}", date_filter, paper_only_and_clause(paper_only))
    };
    
    // Get all trades
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades{} ORDER BY timestamp DESC", where_clause))
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
pub fn get_position_groups(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>, paper_only: Option<bool>) -> Result<Vec<PositionGroup>, String> {
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
    let paper_clause = paper_only_and_clause(paper_only);
    
    // Get all trades ordered by timestamp
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){}{} ORDER BY timestamp ASC", date_filter, paper_clause))
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
pub fn get_trades(paper_only: Option<bool>) -> Result<Vec<Trade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let where_clause = paper_only_where_clause(paper_only);
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades{} ORDER BY timestamp DESC", where_clause))
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
pub fn get_paired_trades(pairing_method: Option<String>, paper_only: Option<bool>) -> Result<Vec<PairedTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let paper_clause = paper_only_and_clause(paper_only);
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){} ORDER BY timestamp ASC", paper_clause))
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
pub fn get_symbol_pnl(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
    filters: Option<EquityCurveFilters>,
    strategy_id: Option<i64>,
) -> Result<Vec<SymbolPnL>, String> {
    use std::collections::HashMap;
    // Get both paired trades and open trades from pairing logic
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let paper_clause = paper_only_and_clause(paper_only);
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){} ORDER BY timestamp ASC", paper_clause))
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
    let (paired_trades, mut open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    
    // Filter paired trades by date range if provided
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

    if let Some(sid) = strategy_id {
        filtered_paired_trades = filter_paired_trades_by_resolved_strategy(
            filtered_paired_trades,
            Some(sid),
            pairing_method.clone(),
            start_date.clone(),
            end_date.clone(),
            paper_only,
        )?;
        open_trades = open_trades
            .into_iter()
            .filter(|t| t.strategy_id == Some(sid))
            .collect();
    }
    
    // Apply strategy/symbol/side/order_type/position_size filters (same as get_equity_curve; multi-select + position size USD)
    if let Some(ref f) = filters {
        let has_multi = f.strategy_ids.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.symbols.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.sides.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.order_types.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
        let has_single = f.strategy_id.is_some() || f.symbol.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
            || f.side.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
            || f.order_type.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        let has_pos = f.position_size_min.is_some() || f.position_size_max.is_some()
            || f.position_size_min_usd.is_some() || f.position_size_max_usd.is_some();
        let has_filter = has_multi || has_single || has_pos;
        if has_filter {
            let entry_ids: Vec<i64> = filtered_paired_trades.iter().map(|p| p.entry_trade_id).collect();
            let entry_trades = get_trades_by_ids(&entry_ids).map_err(|e| e.to_string())?;
            filtered_paired_trades = filtered_paired_trades
                .into_iter()
                .filter(|pair| {
                    if let Some(entry) = entry_trades.get(&pair.entry_trade_id) {
                        if let Some(ref ids) = f.strategy_ids {
                            if !ids.is_empty() {
                                let ok = pair.strategy_id.map_or(false, |id| ids.contains(&id));
                                if !ok {
                                    return false;
                                }
                            }
                        } else if let Some(sid) = f.strategy_id {
                            if pair.strategy_id != Some(sid) {
                                return false;
                            }
                        }
                        if let Some(ref syms) = f.symbols {
                            if !syms.is_empty() {
                                let pair_underlying = get_underlying_symbol(&pair.symbol);
                                let match_ = syms.iter().any(|s| {
                                    pair.symbol == *s || pair_underlying == get_underlying_symbol(s)
                                });
                                if !match_ {
                                    return false;
                                }
                            }
                        } else if let Some(ref sym) = f.symbol {
                            if !sym.is_empty() {
                                let pair_underlying = get_underlying_symbol(&pair.symbol);
                                let filter_underlying = get_underlying_symbol(sym);
                                if pair.symbol != *sym && pair_underlying != filter_underlying {
                                    return false;
                                }
                            }
                        }
                        if let Some(ref sides) = f.sides {
                            if !sides.is_empty() && !sides.iter().any(|s| entry.side.eq_ignore_ascii_case(s)) {
                                return false;
                            }
                        } else if let Some(ref side) = f.side {
                            if !side.is_empty() && !entry.side.eq_ignore_ascii_case(side) {
                                return false;
                            }
                        }
                        if let Some(ref ots) = f.order_types {
                            if !ots.is_empty() && !ots.iter().any(|o| entry.order_type.eq_ignore_ascii_case(o)) {
                                return false;
                            }
                        } else if let Some(ref ot) = f.order_type {
                            if !ot.is_empty() && !entry.order_type.eq_ignore_ascii_case(ot) {
                                return false;
                            }
                        }
                        if f.position_size_min_usd.is_some() || f.position_size_max_usd.is_some() {
                            let pos_usd = pair.quantity * pair.entry_price;
                            if let Some(min_u) = f.position_size_min_usd {
                                if pos_usd < min_u {
                                    return false;
                                }
                            }
                            if let Some(max_u) = f.position_size_max_usd {
                                if pos_usd > max_u {
                                    return false;
                                }
                            }
                        } else {
                            if let Some(min_q) = f.position_size_min {
                                if pair.quantity < min_q {
                                    return false;
                                }
                            }
                            if let Some(max_q) = f.position_size_max {
                                if pair.quantity > max_q {
                                    return false;
                                }
                            }
                        }
                        true
                    } else {
                        false
                    }
                })
                .collect();
            // Filter open_trades by same criteria (use quantity*price for USD when position_size_*_usd set)
            open_trades = open_trades
                .into_iter()
                .filter(|t| {
                    if let Some(ref ids) = f.strategy_ids {
                        if !ids.is_empty() {
                            let ok = t.strategy_id.map_or(false, |id| ids.contains(&id));
                            if !ok {
                                return false;
                            }
                        }
                    } else if let Some(sid) = f.strategy_id {
                        if t.strategy_id != Some(sid) {
                            return false;
                        }
                    }
                    if let Some(ref syms) = f.symbols {
                        if !syms.is_empty() {
                            let t_underlying = get_underlying_symbol(&t.symbol);
                            let match_ = syms.iter().any(|s| {
                                t.symbol == *s || t_underlying == get_underlying_symbol(s)
                            });
                            if !match_ {
                                return false;
                            }
                        }
                    } else if let Some(ref sym) = f.symbol {
                        if !sym.is_empty() {
                            let t_underlying = get_underlying_symbol(&t.symbol);
                            let filter_underlying = get_underlying_symbol(sym);
                            if t.symbol != *sym && t_underlying != filter_underlying {
                                return false;
                            }
                        }
                    }
                    if let Some(ref sides) = f.sides {
                        if !sides.is_empty() && !sides.iter().any(|s| t.side.eq_ignore_ascii_case(s)) {
                            return false;
                        }
                    } else if let Some(ref side) = f.side {
                        if !side.is_empty() && !t.side.eq_ignore_ascii_case(side) {
                            return false;
                        }
                    }
                    if let Some(ref ots) = f.order_types {
                        if !ots.is_empty() && !ots.iter().any(|o| t.order_type.eq_ignore_ascii_case(o)) {
                            return false;
                        }
                    } else if let Some(ref ot) = f.order_type {
                        if !ot.is_empty() && !t.order_type.eq_ignore_ascii_case(ot) {
                            return false;
                        }
                    }
                    if f.position_size_min_usd.is_some() || f.position_size_max_usd.is_some() {
                        let pos_usd = t.quantity * t.price;
                        if let Some(min_u) = f.position_size_min_usd {
                            if pos_usd < min_u {
                                return false;
                            }
                        }
                        if let Some(max_u) = f.position_size_max_usd {
                            if pos_usd > max_u {
                                return false;
                            }
                        }
                    } else {
                        if let Some(min_q) = f.position_size_min {
                            if t.quantity < min_q {
                                return false;
                            }
                        }
                        if let Some(max_q) = f.position_size_max {
                            if t.quantity > max_q {
                                return false;
                            }
                        }
                    }
                    true
                })
                .collect();
        }
    }
    
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

/// Fetch multiple trades by id. Used for filtering equity curve by entry-trade fields (side, order_type).
fn get_trades_by_ids(ids: &[i64]) -> Result<std::collections::HashMap<i64, Trade>, String> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE id IN ({})", placeholders);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt.query(rusqlite::params_from_iter(ids.iter())).map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let trade = Trade {
            id: Some(row.get(0).map_err(|e| e.to_string())?),
            symbol: row.get(1).map_err(|e| e.to_string())?,
            side: row.get(2).map_err(|e| e.to_string())?,
            quantity: row.get(3).map_err(|e| e.to_string())?,
            price: row.get(4).map_err(|e| e.to_string())?,
            timestamp: row.get(5).map_err(|e| e.to_string())?,
            order_type: row.get(6).map_err(|e| e.to_string())?,
            status: row.get(7).map_err(|e| e.to_string())?,
            fees: row.get(8).map_err(|e| e.to_string())?,
            notes: row.get(9).map_err(|e| e.to_string())?,
            strategy_id: row.get(10).map_err(|e| e.to_string())?,
        };
        if let Some(id) = trade.id {
            map.insert(id, trade);
        }
    }
    Ok(map)
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
pub fn get_daily_pnl(paper_only: Option<bool>) -> Result<Vec<DailyPnL>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let paper_clause = paper_only_and_clause(paper_only);
    // Group trades by date and calculate P&L using paired trades
    // Use strftime for SQLite date extraction
    let mut stmt = conn
        .prepare(&format!(
            "SELECT 
                strftime('%Y-%m-%d', timestamp) as trade_date,
                COUNT(*) as trade_count
            FROM trades
            WHERE (status = 'Filled' OR status = 'FILLED'){}
            GROUP BY strftime('%Y-%m-%d', timestamp)
            ORDER BY trade_date DESC",
            paper_clause
        ))
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
    let paired_trades = get_paired_trades(None, paper_only).map_err(|e| e.to_string())?;
    
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
pub fn get_metrics(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
    strategy_id: Option<i64>,
) -> Result<Metrics, String> {
    // Get paired trades for accurate metrics
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;

    // Filter paired trades by date range if provided
    let mut filtered_paired_trades: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades
            .into_iter()
            .filter(|pair| {
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
            })
            .collect()
    } else {
        paired_trades
    };

    if let Some(sid) = strategy_id {
        filtered_paired_trades = filter_paired_trades_by_resolved_strategy(
            filtered_paired_trades,
            Some(sid),
            pairing_method.clone(),
            start_date.clone(),
            end_date.clone(),
            paper_only,
        )?;
    }

    let total_volume: f64 = if strategy_id.is_some() {
        filtered_paired_trades
            .iter()
            .map(|p| p.quantity * p.entry_price)
            .sum()
    } else {
        let db_path = get_db_path();
        let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
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
        let where_volume = if date_filter.is_empty() {
            paper_only_where_clause(paper_only).to_string()
        } else {
            format!("{}{}", date_filter, paper_only_and_clause(paper_only))
        };
        conn
            .query_row(
                &format!("SELECT SUM(quantity * price) FROM trades{}", where_volume),
                [],
                |row| Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0)),
            )
            .map_err(|e| e.to_string())?
    };

    // Total trades should count pairs, not individual trades
    let total_trades = filtered_paired_trades.len() as i64;

    // Get position groups to calculate largest win/loss per position (not per pair)
    let mut position_groups =
        get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone(), paper_only).map_err(|e| e.to_string())?;
    if strategy_id.is_some() {
        let entry_ids: std::collections::HashSet<i64> =
            filtered_paired_trades.iter().map(|p| p.entry_trade_id).collect();
        position_groups.retain(|g| {
            g.entry_trade
                .id
                .map(|id| entry_ids.contains(&id))
                .unwrap_or(false)
        });
    }
    
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

    if strategy_id.is_some() {
        strategy_winning = winning_trades;
        strategy_losing = losing_trades;
        strategy_pnl = total_profit_loss;
        strategy_consecutive_wins = consecutive_wins;
        strategy_consecutive_losses = consecutive_losses;
    } else {
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
    }

    let strategy_win_rate = if strategy_id.is_some() {
        win_rate
    } else if (strategy_winning + strategy_losing) > 0 {
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
    let mut daily_pnl = if strategy_id.is_some() {
        use std::collections::HashMap;
        let mut m: HashMap<String, (f64, i64)> = HashMap::new();
        for pair in &filtered_paired_trades {
            if let Some(date_str) = pair.exit_timestamp.split('T').next() {
                let e = m.entry(date_str.to_string()).or_insert((0.0, 0));
                e.0 += pair.net_profit_loss;
                e.1 += 1;
            }
        }
        let mut v: Vec<DailyPnL> = m
            .into_iter()
            .map(|(date, (profit_loss, trade_count))| DailyPnL {
                date,
                profit_loss,
                trade_count,
            })
            .collect();
        if start_date.is_some() || end_date.is_some() {
            v.retain(|d| {
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
        v.sort_by(|a, b| b.date.cmp(&a.date));
        v
    } else {
        let mut d = get_daily_pnl(paper_only).unwrap_or_default();
        if start_date.is_some() || end_date.is_some() {
            d.retain(|day| {
                let day_date = &day.date;
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
        d
    };
    
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
    journal_entry_id: Option<i64>,
    journal_trade_id: Option<i64>,
    journal_entry_ids: Option<String>,
    trade_ids: Option<String>,
    is_paper: Option<bool>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_multi = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let has_is_paper = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='is_paper'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let paper = is_paper.unwrap_or(false) as i32;

    if has_multi && has_is_paper {
        conn.execute(
            "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids, is_paper) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids, paper],
        ).map_err(|e| e.to_string())?;
    } else if has_multi {
        conn.execute(
            "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids],
        ).map_err(|e| e.to_string())?;
    } else if has_is_paper {
        conn.execute(
            "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, is_paper) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, paper],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(conn.last_insert_rowid())
}

fn emotional_states_paper_clause(conn: &rusqlite::Connection, paper_only: Option<bool>) -> String {
    let has_is_paper: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='is_paper'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if !has_is_paper {
        return String::new();
    }
    match paper_only {
        Some(true) => " WHERE is_paper = 1".to_string(),
        Some(false) | None => " WHERE is_paper = 0".to_string(),
    }
}

fn get_emotional_states_query(conn: &rusqlite::Connection, has_je_jt: bool, has_multi_ids: bool, paper_only: Option<bool>) -> Result<Vec<EmotionalState>, String> {
    let paper_clause = emotional_states_paper_clause(conn, paper_only);
    if !has_je_jt {
        let mut stmt = conn.prepare(&format!("SELECT id, timestamp, emotion, intensity, notes, trade_id FROM emotional_states{} ORDER BY timestamp DESC", paper_clause))
            .map_err(|e| e.to_string())?;
        let rows: Vec<EmotionalState> = stmt.query_map([], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: None,
                journal_trade_id: None,
                journal_entry_ids: None,
                trade_ids: None,
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        return Ok(rows);
    }
    if has_multi_ids {
        let mut stmt = conn.prepare(&format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids FROM emotional_states{} ORDER BY timestamp DESC", paper_clause))
            .map_err(|e| e.to_string())?;
        let rows: Vec<EmotionalState> = stmt.query_map([], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: row.get(6).ok(),
                journal_trade_id: row.get(7).ok(),
                journal_entry_ids: row.get(8).ok(),
                trade_ids: row.get(9).ok(),
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        return Ok(rows);
    }
    let mut stmt = conn.prepare(&format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id FROM emotional_states{} ORDER BY timestamp DESC", paper_clause))
        .map_err(|e| e.to_string())?;
    let rows: Vec<EmotionalState> = stmt.query_map([], |row| {
        Ok(EmotionalState {
            id: Some(row.get(0)?),
            timestamp: row.get(1)?,
            emotion: row.get(2)?,
            intensity: row.get(3)?,
            notes: row.get(4)?,
            trade_id: row.get(5)?,
            journal_entry_id: row.get(6).ok(),
            journal_trade_id: row.get(7).ok(),
            journal_entry_ids: None,
            trade_ids: None,
        })
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

#[tauri::command]
pub fn get_emotional_states(paper_only: Option<bool>) -> Result<Vec<EmotionalState>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let has_je = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_jt = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_trade_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_multi_ids = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    get_emotional_states_query(&conn, has_je && has_jt, has_multi_ids, paper_only)
}

#[tauri::command]
pub fn get_emotional_states_for_journal(
    journal_entry_id: i64,
    journal_trade_id: Option<i64>,
    paper_only: Option<bool>,
) -> Result<Vec<EmotionalState>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let has_je = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_jt = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_trade_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_multi_ids = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if !has_je || !has_jt {
        return Ok(vec![]);
    }

    let has_is_paper = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='is_paper'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let and_paper = if has_is_paper {
        match paper_only {
            Some(true) => " AND is_paper = 1",
            Some(false) | None => " AND is_paper = 0",
        }
    } else {
        ""
    };

    let rows: Vec<EmotionalState> = if has_multi_ids {
        if let Some(jt) = journal_trade_id {
            let sql = format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids FROM emotional_states WHERE (journal_entry_id = ?1 OR id IN (SELECT e2.id FROM emotional_states e2, json_each(e2.journal_entry_ids) WHERE json_type(e2.journal_entry_ids) = 'array' AND (json_each.value = ?2 OR CAST(json_each.value AS INTEGER) = ?2))) AND (journal_trade_id = ?3 OR journal_trade_id IS NULL){} ORDER BY timestamp DESC", and_paper);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let collected: Vec<EmotionalState> = stmt.query_map(params![journal_entry_id, journal_entry_id, jt], |row| {
                Ok(EmotionalState {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    emotion: row.get(2)?,
                    intensity: row.get(3)?,
                    notes: row.get(4)?,
                    trade_id: row.get(5)?,
                    journal_entry_id: row.get(6).ok(),
                    journal_trade_id: row.get(7).ok(),
                    journal_entry_ids: row.get(8).ok(),
                    trade_ids: row.get(9).ok(),
                })
            }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            collected
        } else {
            let sql = format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids FROM emotional_states WHERE journal_entry_id = ?1 OR id IN (SELECT e2.id FROM emotional_states e2, json_each(e2.journal_entry_ids) WHERE json_type(e2.journal_entry_ids) = 'array' AND (json_each.value = ?2 OR CAST(json_each.value AS INTEGER) = ?2)){} ORDER BY timestamp DESC", and_paper);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let collected: Vec<EmotionalState> = stmt.query_map(params![journal_entry_id, journal_entry_id], |row| {
                Ok(EmotionalState {
                    id: Some(row.get(0)?),
                    timestamp: row.get(1)?,
                    emotion: row.get(2)?,
                    intensity: row.get(3)?,
                    notes: row.get(4)?,
                    trade_id: row.get(5)?,
                    journal_entry_id: row.get(6).ok(),
                    journal_trade_id: row.get(7).ok(),
                    journal_entry_ids: row.get(8).ok(),
                    trade_ids: row.get(9).ok(),
                })
            }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            collected
        }
    } else if let Some(jt) = journal_trade_id {
        let sql = format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id FROM emotional_states WHERE journal_entry_id = ?1 AND (journal_trade_id = ?2 OR journal_trade_id IS NULL){} ORDER BY timestamp DESC", and_paper);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let collected: Vec<EmotionalState> = stmt.query_map(params![journal_entry_id, jt], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: row.get(6).ok(),
                journal_trade_id: row.get(7).ok(),
                journal_entry_ids: None,
                trade_ids: None,
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    } else {
        let sql = format!("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id FROM emotional_states WHERE journal_entry_id = ?1{} ORDER BY timestamp DESC", and_paper);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let collected: Vec<EmotionalState> = stmt.query_map(params![journal_entry_id], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: row.get(6).ok(),
                journal_trade_id: row.get(7).ok(),
                journal_entry_ids: None,
                trade_ids: None,
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    };
    Ok(rows)
}

#[tauri::command]
pub fn update_emotional_state(
    id: i64,
    emotion: String,
    intensity: i32,
    notes: Option<String>,
    journal_entry_id: Option<i64>,
    journal_trade_id: Option<i64>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let has_je = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_jt = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_trade_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    
    if has_je && has_jt {
        conn.execute(
            "UPDATE emotional_states SET emotion = ?1, intensity = ?2, notes = ?3, journal_entry_id = ?4, journal_trade_id = ?5 WHERE id = ?6",
            params![emotion, intensity, notes, journal_entry_id, journal_trade_id, id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE emotional_states SET emotion = ?1, intensity = ?2, notes = ?3 WHERE id = ?4",
            params![emotion, intensity, notes, id],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn update_emotional_state_links(
    id: i64,
    journal_entry_ids: Option<String>,
    trade_ids: Option<String>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_multi_ids = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !has_multi_ids {
        return Ok(());
    }

    conn.execute(
        "UPDATE emotional_states SET journal_entry_ids = ?1, trade_ids = ?2 WHERE id = ?3",
        params![journal_entry_ids, trade_ids, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_emotional_state(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Delete associated survey if exists
    conn.execute("DELETE FROM emotion_surveys WHERE emotional_state_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    // Delete the emotional state
    conn.execute("DELETE FROM emotional_states WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
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
pub fn create_strategy(name: String, description: Option<String>, notes: Option<String>, color: Option<String>, author: Option<String>) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO strategies (name, description, notes, color, author) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, description, notes, color, author],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_strategies() -> Result<Vec<Strategy>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, name, description, notes, created_at, color, COALESCE(display_order, id), author FROM strategies ORDER BY COALESCE(display_order, id)")
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
                display_order: row.get(6)?,
                author: row.get(7)?,
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
pub fn update_strategy(id: i64, name: String, description: Option<String>, notes: Option<String>, color: Option<String>, author: Option<String>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE strategies SET name = ?1, description = ?2, notes = ?3, color = ?4, author = ?5 WHERE id = ?6",
        params![name, description, notes, color, author, id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn update_strategy_order(strategy_orders: Vec<(i64, i64)>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    for (id, order) in strategy_orders {
        conn.execute(
            "UPDATE strategies SET display_order = ?1 WHERE id = ?2",
            params![order, id],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn delete_strategy(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Set strategy_id to NULL for trades using this strategy
    conn.execute("UPDATE trades SET strategy_id = NULL WHERE strategy_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    // Set strategy_id to NULL for journal entries using this strategy
    // (Foreign key constraint prevents deletion if journal entries reference it)
    conn.execute("UPDATE journal_entries SET strategy_id = NULL WHERE strategy_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    // Delete strategy checklist items (should cascade, but being explicit)
    conn.execute("DELETE FROM strategy_checklists WHERE strategy_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    // Now delete the strategy
    conn.execute("DELETE FROM strategies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StrategyAssociatedRecords {
    pub trade_count: i64,
    pub journal_entry_count: i64,
    pub checklist_item_count: i64,
    pub sample_trades: Vec<(i64, String, String, String)>, // (id, symbol, side, timestamp)
    pub sample_journal_entries: Vec<(i64, String, String)>, // (id, date, title)
}

#[tauri::command]
pub fn get_strategy_associated_records(strategy_id: i64) -> Result<StrategyAssociatedRecords, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Count trades
    let trade_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM trades WHERE strategy_id = ?1",
            params![strategy_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    
    // Count journal entries (using DISTINCT to avoid duplicates)
    let journal_entry_count: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT id) FROM journal_entries WHERE strategy_id = ?1",
            params![strategy_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    
    // Count checklist items
    let checklist_item_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM strategy_checklists WHERE strategy_id = ?1",
            params![strategy_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    
    // Get sample trades (up to 5 most recent)
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, timestamp FROM trades WHERE strategy_id = ?1 ORDER BY timestamp DESC LIMIT 5")
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map(params![strategy_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    
    let mut sample_trades = Vec::new();
    for trade in trade_iter {
        sample_trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    // Get sample journal entries (up to 5 most recent, ensuring uniqueness by id)
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title FROM journal_entries 
             WHERE strategy_id = ?1 
             ORDER BY date DESC, created_at DESC 
             LIMIT 10"
        )
        .map_err(|e| e.to_string())?;
    
    let journal_iter = stmt
        .query_map(params![strategy_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    
    // Use a HashSet to deduplicate by id in case of any remaining duplicates
    use std::collections::HashSet;
    let mut seen_ids = HashSet::new();
    let mut sample_journal_entries = Vec::new();
    for entry in journal_iter {
        let entry_result = entry.map_err(|e| e.to_string())?;
        let entry_id: i64 = entry_result.0;
        if !seen_ids.contains(&entry_id) {
            seen_ids.insert(entry_id);
            sample_journal_entries.push(entry_result);
        }
    }
    
    Ok(StrategyAssociatedRecords {
        trade_count,
        journal_entry_count,
        checklist_item_count,
        sample_trades,
        sample_journal_entries,
    })
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
    is_paper: Option<bool>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let has_is_paper: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name='is_paper'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if has_is_paper {
        let paper = is_paper.unwrap_or(false) as i32;
        conn.execute(
            "INSERT INTO journal_entries (date, title, strategy_id, is_paper) VALUES (?1, ?2, ?3, ?4)",
            params![date, title, strategy_id, paper],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO journal_entries (date, title, strategy_id) VALUES (?1, ?2, ?3)",
            params![date, title, strategy_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_journal_entries(paper_only: Option<bool>) -> Result<Vec<JournalEntry>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_linked = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name='linked_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let has_is_paper = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name='is_paper'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let paper_filter = if has_is_paper {
        match paper_only {
            Some(true) => " WHERE is_paper = 1",
            Some(false) => " WHERE is_paper = 0",
            None => " WHERE is_paper = 0",
        }
    } else {
        ""
    };

    let entries: Vec<JournalEntry> = if has_linked {
        let mut stmt = conn
            .prepare(&format!("SELECT id, date, title, strategy_id, created_at, updated_at, linked_trade_ids FROM journal_entries{} ORDER BY date DESC, created_at DESC", paper_filter))
            .map_err(|e| e.to_string())?;
        let collected: Vec<JournalEntry> = stmt.query_map([], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                linked_trade_ids: row.get(6).ok(),
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    } else {
        let mut stmt = conn
            .prepare(&format!("SELECT id, date, title, strategy_id, created_at, updated_at FROM journal_entries{} ORDER BY date DESC, created_at DESC", paper_filter))
            .map_err(|e| e.to_string())?;
        let collected: Vec<JournalEntry> = stmt.query_map([], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                linked_trade_ids: None,
            })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    };

    Ok(entries)
}

#[tauri::command]
pub fn get_journal_entry(id: i64) -> Result<JournalEntry, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_linked = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name='linked_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let entry = if has_linked {
        let mut stmt = conn
            .prepare("SELECT id, date, title, strategy_id, created_at, updated_at, linked_trade_ids FROM journal_entries WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                linked_trade_ids: row.get(6).ok(),
            })
        }).map_err(|e| e.to_string())?
    } else {
        let mut stmt = conn
            .prepare("SELECT id, date, title, strategy_id, created_at, updated_at FROM journal_entries WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |row| {
            Ok(JournalEntry {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                strategy_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                linked_trade_ids: None,
            })
        }).map_err(|e| e.to_string())?
    };

    Ok(entry)
}

#[tauri::command]
pub fn update_journal_entry(
    id: i64,
    date: String,
    title: String,
    strategy_id: Option<i64>,
    linked_trade_ids: Option<String>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_linked = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name='linked_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if has_linked {
        conn.execute(
            "UPDATE journal_entries SET date = ?1, title = ?2, strategy_id = ?3, linked_trade_ids = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
            params![date, title, strategy_id, linked_trade_ids, id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE journal_entries SET date = ?1, title = ?2, strategy_id = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
            params![date, title, strategy_id, id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Add a journal entry to the journal_entry_ids of the given emotional state(s).
/// For each state id, all rows sharing the same timestamp are updated so the group stays in sync.
#[tauri::command]
pub fn add_journal_entry_to_emotional_states(
    journal_entry_id: i64,
    emotional_state_ids: Vec<i64>,
) -> Result<(), String> {
    use std::collections::HashSet;
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_multi = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if !has_multi {
        return Ok(());
    }

    let mut timestamps_done: HashSet<String> = HashSet::new();
    for state_id in emotional_state_ids {
        let (timestamp, current_json): (String, Option<String>) = conn.query_row(
            "SELECT timestamp, journal_entry_ids FROM emotional_states WHERE id = ?1",
            params![state_id],
            |row| Ok((row.get(0)?, row.get(1).ok())),
        ).map_err(|e| e.to_string())?;

        if timestamps_done.contains(&timestamp) {
            continue;
        }
        timestamps_done.insert(timestamp.clone());

        let mut ids: Vec<i64> = if let Some(ref s) = current_json {
            serde_json::from_str(s).unwrap_or_default()
        } else {
            Vec::new()
        };
        if !ids.contains(&journal_entry_id) {
            ids.push(journal_entry_id);
            ids.sort_unstable();
        }
        let new_json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE emotional_states SET journal_entry_ids = ?1 WHERE timestamp = ?2",
            params![new_json, timestamp],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Set journal entry and optional trade link on emotional state(s). All rows sharing the same timestamp are updated.
#[tauri::command]
pub fn link_emotional_states_to_journal(
    emotional_state_ids: Vec<i64>,
    journal_entry_id: i64,
    journal_trade_id: Option<i64>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_je = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_jt = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_trade_id'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if !has_je || !has_jt {
        return Ok(());
    }

    use std::collections::HashSet;
    let mut timestamps_done: HashSet<String> = HashSet::new();
    for state_id in emotional_state_ids {
        let timestamp: String = conn.query_row(
            "SELECT timestamp FROM emotional_states WHERE id = ?1",
            params![state_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if timestamps_done.contains(&timestamp) {
            continue;
        }
        timestamps_done.insert(timestamp.clone());
        conn.execute(
            "UPDATE emotional_states SET journal_entry_id = ?1, journal_trade_id = ?2 WHERE timestamp = ?3",
            params![journal_entry_id, journal_trade_id, timestamp],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Remove a journal entry from the journal_entry_ids of the given emotional state(s).
#[tauri::command]
pub fn remove_journal_entry_from_emotional_states(
    journal_entry_id: i64,
    emotional_state_ids: Vec<i64>,
) -> Result<(), String> {
    use std::collections::HashSet;
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_multi = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if !has_multi {
        return Ok(());
    }

    let mut timestamps_done: HashSet<String> = HashSet::new();
    for state_id in emotional_state_ids {
        let (timestamp, current_json): (String, Option<String>) = conn.query_row(
            "SELECT timestamp, journal_entry_ids FROM emotional_states WHERE id = ?1",
            params![state_id],
            |row| Ok((row.get(0)?, row.get(1).ok())),
        ).map_err(|e| e.to_string())?;

        if timestamps_done.contains(&timestamp) {
            continue;
        }
        timestamps_done.insert(timestamp.clone());

        let mut ids: Vec<i64> = if let Some(ref s) = current_json {
            serde_json::from_str(s).unwrap_or_default()
        } else {
            Vec::new()
        };
        ids.retain(|&x| x != journal_entry_id);
        let new_json = if ids.is_empty() {
            None as Option<String>
        } else {
            Some(serde_json::to_string(&ids).map_err(|e| e.to_string())?)
        };

        conn.execute(
            "UPDATE emotional_states SET journal_entry_ids = ?1 WHERE timestamp = ?2",
            params![new_json, timestamp],
        ).map_err(|e| e.to_string())?;
    }

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
    /// JSON array of journal_trade IDs when associated with specific trades, e.g. "[1,2,3]". Null/empty = entry-level (whole journal).
    pub journal_trade_ids: Option<String>,
    /// For survey items: 1-10 scale value. Null = use is_checked for Yes/No.
    pub response_value: Option<i32>,
}

#[tauri::command]
pub fn save_journal_checklist_responses(
    journal_entry_id: i64,
    responses: Vec<(i64, bool, Option<String>, Option<i32>)>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_response_value = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='response_value'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);

    conn.execute(
        "DELETE FROM journal_checklist_responses WHERE journal_entry_id = ?1",
        params![journal_entry_id],
    ).map_err(|e| e.to_string())?;

    for (checklist_item_id, is_checked, journal_trade_ids, response_value) in responses {
        if has_response_value {
            conn.execute(
                "INSERT INTO journal_checklist_responses (journal_entry_id, checklist_item_id, is_checked, journal_trade_ids, response_value) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![journal_entry_id, checklist_item_id, if is_checked { 1 } else { 0 }, journal_trade_ids, response_value],
            ).map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "INSERT INTO journal_checklist_responses (journal_entry_id, checklist_item_id, is_checked, journal_trade_ids) VALUES (?1, ?2, ?3, ?4)",
                params![journal_entry_id, checklist_item_id, if is_checked { 1 } else { 0 }, journal_trade_ids],
            ).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_journal_checklist_responses(journal_entry_id: i64) -> Result<Vec<JournalChecklistResponse>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_trade_ids_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='journal_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);

    let has_response_value_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='response_value'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);

    let sql = match (has_trade_ids_col, has_response_value_col) {
        (true, true) => "SELECT id, journal_entry_id, checklist_item_id, is_checked, journal_trade_ids, response_value FROM journal_checklist_responses WHERE journal_entry_id = ?1",
        (true, false) => "SELECT id, journal_entry_id, checklist_item_id, is_checked, journal_trade_ids FROM journal_checklist_responses WHERE journal_entry_id = ?1",
        (false, true) => "SELECT id, journal_entry_id, checklist_item_id, is_checked, response_value FROM journal_checklist_responses WHERE journal_entry_id = ?1",
        (false, false) => "SELECT id, journal_entry_id, checklist_item_id, is_checked FROM journal_checklist_responses WHERE journal_entry_id = ?1",
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let response_iter = stmt.query_map(params![journal_entry_id], move |row| {
        let journal_trade_ids = if has_trade_ids_col { row.get(4).ok() } else { None };
        let response_value = if has_response_value_col {
            if has_trade_ids_col { row.get::<_, Option<i32>>(5).ok().flatten() } else { row.get::<_, Option<i32>>(4).ok().flatten() }
        } else {
            None
        };
        Ok(JournalChecklistResponse {
            id: Some(row.get(0)?),
            journal_entry_id: row.get(1)?,
            checklist_item_id: row.get(2)?,
            is_checked: row.get::<_, i64>(3)? != 0,
            journal_trade_ids,
            response_value,
        })
    }).map_err(|e| e.to_string())?;

    let mut responses = Vec::new();
    for response in response_iter {
        responses.push(response.map_err(|e| e.to_string())?);
    }
    Ok(responses)
}

#[tauri::command]
pub fn get_journal_entry_pairs(journal_entry_id: i64) -> Result<Vec<PairedTrade>, String> {
    let linked = get_journal_entry_pair_ids(journal_entry_id)?;
    if linked.is_empty() {
        return Ok(Vec::new());
    }
    let all_pairs = get_paired_trades(None, None).map_err(|e| e.to_string())?;
    let linked_set: std::collections::HashSet<(i64, i64)> = linked.into_iter().collect();
    let pairs: Vec<PairedTrade> = all_pairs
        .into_iter()
        .filter(|p| linked_set.contains(&(p.entry_trade_id, p.exit_trade_id)))
        .collect();
    Ok(pairs)
}

fn get_journal_entry_pair_ids(journal_entry_id: i64) -> Result<Vec<(i64, i64)>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT entry_trade_id, exit_trade_id FROM journal_entry_pairs WHERE journal_entry_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![journal_entry_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct JournalEntryPairLink {
    pub entry_trade_id: i64,
    pub exit_trade_id: i64,
}

#[tauri::command]
pub fn set_journal_entry_pairs(
    journal_entry_id: i64,
    pairs: Vec<JournalEntryPairLink>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM journal_entry_pairs WHERE journal_entry_id = ?1", params![journal_entry_id])
        .map_err(|e| e.to_string())?;
    for link in pairs {
        conn.execute(
            "INSERT INTO journal_entry_pairs (journal_entry_id, entry_trade_id, exit_trade_id) VALUES (?1, ?2, ?3)",
            params![journal_entry_id, link.entry_trade_id, link.exit_trade_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct JournalEntrySummary {
    pub id: i64,
    pub date: String,
    pub title: String,
}

#[tauri::command]
pub fn get_journal_entries_for_pair(entry_trade_id: i64, exit_trade_id: i64) -> Result<Vec<JournalEntrySummary>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT je.id, je.date, je.title FROM journal_entries je
             INNER JOIN journal_entry_pairs jep ON je.id = jep.journal_entry_id
             WHERE jep.entry_trade_id = ?1 AND jep.exit_trade_id = ?2
             ORDER BY je.date DESC, je.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![entry_trade_id, exit_trade_id], |row| {
            Ok(JournalEntrySummary {
                id: row.get(0)?,
                date: row.get(1)?,
                title: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// Journal Trade Commands
#[tauri::command]
pub fn create_journal_trade(
    journal_entry_id: i64,
    symbol: Option<String>,
    position: Option<String>,
    timeframe: Option<String>,
    entry_type: Option<String>,
    exit_type: Option<String>,
    trade: Option<String>,
    what_went_well: Option<String>,
    what_could_be_improved: Option<String>,
    emotional_state: Option<String>,
    notes: Option<String>,
    outcome: Option<String>,
    r_multiple: Option<f64>,
    trade_order: i64,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT INTO journal_trades (journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_journal_trades(journal_entry_id: i64) -> Result<Vec<JournalTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT id, journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order, created_at, updated_at FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order ASC")
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map(params![journal_entry_id], |row| {
            Ok(JournalTrade {
                id: Some(row.get(0)?),
                journal_entry_id: row.get(1)?,
                symbol: row.get(2)?,
                position: row.get(3)?,
                timeframe: row.get(4)?,
                entry_type: row.get(5)?,
                exit_type: row.get(6)?,
                trade: row.get(7)?,
                what_went_well: row.get(8)?,
                what_could_be_improved: row.get(9)?,
                emotional_state: row.get(10)?,
                notes: row.get(11)?,
                outcome: row.get(12)?,
                r_multiple: row.get(13).ok(),
                trade_order: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
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
pub fn get_all_journal_trades() -> Result<Vec<JournalTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order, created_at, updated_at FROM journal_trades ORDER BY journal_entry_id ASC, trade_order ASC")
        .map_err(|e| e.to_string())?;

    let trade_iter = stmt
        .query_map([], |row| {
            Ok(JournalTrade {
                id: Some(row.get(0)?),
                journal_entry_id: row.get(1)?,
                symbol: row.get(2)?,
                position: row.get(3)?,
                timeframe: row.get(4)?,
                entry_type: row.get(5)?,
                exit_type: row.get(6)?,
                trade: row.get(7)?,
                what_went_well: row.get(8)?,
                what_could_be_improved: row.get(9)?,
                emotional_state: row.get(10)?,
                notes: row.get(11)?,
                outcome: row.get(12)?,
                r_multiple: row.get(13).ok(),
                trade_order: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
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
    timeframe: Option<String>,
    entry_type: Option<String>,
    exit_type: Option<String>,
    trade: Option<String>,
    what_went_well: Option<String>,
    what_could_be_improved: Option<String>,
    emotional_state: Option<String>,
    notes: Option<String>,
    outcome: Option<String>,
    r_multiple: Option<f64>,
    trade_order: i64,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE journal_trades SET symbol = ?1, position = ?2, timeframe = ?3, entry_type = ?4, exit_type = ?5, trade = ?6, what_went_well = ?7, what_could_be_improved = ?8, emotional_state = ?9, notes = ?10, outcome = ?11, r_multiple = ?12, trade_order = ?13, updated_at = CURRENT_TIMESTAMP WHERE id = ?14",
        params![symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order, id],
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

/// Performance of a journal trade: prefer R-multiple, else % return from linked pairs, else net P&L (price).
fn get_journal_trade_performance_raw(conn: &rusqlite::Connection, journal_trade_id: i64) -> Result<(Option<f64>, String), String> {
    let (r_multiple, journal_entry_id): (Option<f64>, i64) = conn.query_row(
        "SELECT r_multiple, journal_entry_id FROM journal_trades WHERE id = ?1",
        params![journal_trade_id],
        |row| Ok((row.get(0).ok(), row.get(1)?)),
    ).map_err(|e| e.to_string())?;
    if let Some(r) = r_multiple {
        return Ok((Some(r), "r".to_string()));
    }
    let linked_ids: Vec<i64> = conn.prepare("SELECT trade_id FROM journal_trade_actual_trades WHERE journal_trade_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map(params![journal_trade_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if linked_ids.is_empty() {
        return Ok((None, "none".to_string()));
    }
    let linked_set: std::collections::HashSet<i64> = linked_ids.into_iter().collect();
    let pair_ids: Vec<(i64, i64)> = conn.prepare("SELECT entry_trade_id, exit_trade_id FROM journal_entry_pairs WHERE journal_entry_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map(params![journal_entry_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if pair_ids.is_empty() {
        return Ok((None, "none".to_string()));
    }
    let all_pairs = get_paired_trades(None, None).map_err(|e| e.to_string())?;
    let mut total_pnl = 0.0_f64;
    let mut total_cost = 0.0_f64;
    for p in &all_pairs {
        if !linked_set.contains(&p.entry_trade_id) && !linked_set.contains(&p.exit_trade_id) {
            continue;
        }
        if !pair_ids.iter().any(|(e, x)| *e == p.entry_trade_id && *x == p.exit_trade_id) {
            continue;
        }
        total_pnl += p.net_profit_loss;
        let cost = p.entry_price * p.quantity;
        if cost > 0.0 {
            total_cost += cost;
        }
    }
    if total_cost > 0.0 {
        let pct = 100.0 * total_pnl / total_cost;
        return Ok((Some(pct), "pct".to_string()));
    }
    Ok((Some(total_pnl), "price".to_string()))
}

#[tauri::command]
pub fn get_journal_trade_performance(journal_trade_id: i64) -> Result<serde_json::Value, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let (value, kind) = get_journal_trade_performance_raw(&conn, journal_trade_id)?;
    Ok(serde_json::json!({ "value": value, "kind": kind }))
}

#[tauri::command]
pub fn get_journal_trade_actual_trade_ids(journal_trade_id: i64) -> Result<Vec<i64>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT trade_id FROM journal_trade_actual_trades WHERE journal_trade_id = ?1 ORDER BY trade_id")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt
        .query_map(params![journal_trade_id], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    
    let mut ids = Vec::new();
    for id in rows {
        ids.push(id.map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

#[tauri::command]
pub fn save_journal_trade_actual_trades(journal_trade_id: i64, trade_ids: Vec<i64>) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    conn.execute("DELETE FROM journal_trade_actual_trades WHERE journal_trade_id = ?1", params![journal_trade_id])
        .map_err(|e| e.to_string())?;
    
    for trade_id in trade_ids {
        conn.execute(
            "INSERT INTO journal_trade_actual_trades (journal_trade_id, trade_id) VALUES (?1, ?2)",
            params![journal_trade_id, trade_id],
        )
        .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ChecklistItemMetricRow {
    pub checklist_item_id: i64,
    pub item_text: String,
    pub checklist_type: String,
    pub times_checked: i64,
    pub avg_performance: Option<f64>,
    pub performance_kind: String,
}

#[tauri::command]
pub fn get_strategy_checklist_item_metrics(strategy_id: i64) -> Result<Vec<ChecklistItemMetricRow>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let has_jt_ids = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='journal_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let items: Vec<(i64, String, String)> = conn.prepare(
        "SELECT id, item_text, checklist_type FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY checklist_type, item_order, id"
    ).map_err(|e| e.to_string())?
        .query_map(params![strategy_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let mut out = Vec::new();
    for (item_id, item_text, checklist_type) in items {
        let sql = if has_jt_ids {
            "SELECT jcr.journal_entry_id, jcr.journal_trade_ids FROM journal_checklist_responses jcr
             INNER JOIN journal_entries je ON je.id = jcr.journal_entry_id AND je.strategy_id = ?1
             WHERE jcr.checklist_item_id = ?2 AND jcr.is_checked = 1"
        } else {
            "SELECT jcr.journal_entry_id, NULL FROM journal_checklist_responses jcr
             INNER JOIN journal_entries je ON je.id = jcr.journal_entry_id AND je.strategy_id = ?1
             WHERE jcr.checklist_item_id = ?2 AND jcr.is_checked = 1"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, Option<String>)> = stmt.query_map(params![strategy_id, item_id], |row| {
            Ok((row.get(0)?, row.get(1).ok()))
        }).map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let times_checked = rows.len() as i64;
        let mut values: Vec<f64> = Vec::new();
        let mut kinds: Vec<String> = Vec::new();
        for (journal_entry_id, journal_trade_ids) in rows {
            let jt_ids: Vec<i64> = if let Some(ref s) = journal_trade_ids {
                serde_json::from_str(s.as_str()).unwrap_or_default()
            } else {
                conn.prepare("SELECT id FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order")
                    .map_err(|e| e.to_string())?
                    .query_map(params![journal_entry_id], |row| row.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect()
            };
            if jt_ids.is_empty() {
                continue;
            }
            let mut sum = 0.0_f64;
            let mut n = 0;
            let mut kind = String::from("none");
            for jt_id in jt_ids {
                if let Ok((v, k)) = get_journal_trade_performance_raw(&conn, jt_id) {
                    if let Some(val) = v {
                        sum += val;
                        n += 1;
                        kind = k;
                    }
                }
            }
            if n > 0 {
                values.push(sum / n as f64);
                kinds.push(kind);
            }
        }
        let (avg_performance, performance_kind) = if values.is_empty() {
            (None, "none".to_string())
        } else {
            let avg = values.iter().sum::<f64>() / values.len() as f64;
            let kind = if kinds.iter().any(|k| k == "r") { "r" } else if kinds.iter().any(|k| k == "pct") { "pct" } else if kinds.iter().any(|k| k == "price") { "price" } else { "none" };
            (Some(avg), kind.to_string())
        };
        out.push(ChecklistItemMetricRow {
            checklist_item_id: item_id,
            item_text,
            checklist_type,
            times_checked,
            avg_performance,
            performance_kind,
        });
    }
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct ChecklistItemMetricByOutcomeRow {
    pub checklist_item_id: i64,
    pub item_text: String,
    pub checklist_type: String,
    pub times_checked_good: i64,
    pub times_checked_bad: i64,
    /// Count of losing journal entries (avg trade performance <= 0) where this checklist item was not checked.
    pub times_not_checked_bad: i64,
}

#[tauri::command]
pub fn get_strategy_checklist_item_metrics_by_outcome(strategy_id: i64) -> Result<Vec<ChecklistItemMetricByOutcomeRow>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let has_jt_ids = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='journal_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_response_value = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='response_value'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_high_is_good = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='high_is_good'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let items: Vec<(i64, String, String, Option<bool>)> = if has_high_is_good {
        conn.prepare(
            "SELECT id, item_text, checklist_type, high_is_good FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY checklist_type, item_order, id"
        ).map_err(|e| e.to_string())?
            .query_map(params![strategy_id], |row| Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, Option<i64>>(3).ok().flatten().map(|v| v != 0),
            )))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        conn.prepare(
            "SELECT id, item_text, checklist_type FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY checklist_type, item_order, id"
        ).map_err(|e| e.to_string())?
            .query_map(params![strategy_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, None)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };
    // Journal entry IDs for this strategy that are "losing" (avg trade performance <= 0).
    let losing_entry_ids: std::collections::HashSet<i64> = {
        let entry_ids: Vec<i64> = conn.prepare(
            "SELECT id FROM journal_entries WHERE strategy_id = ?1"
        ).map_err(|e| e.to_string())?
            .query_map(params![strategy_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut losing = std::collections::HashSet::new();
        for journal_entry_id in entry_ids {
            let jt_ids: Vec<i64> = conn.prepare("SELECT id FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order")
                .map_err(|e| e.to_string())?
                .query_map(params![journal_entry_id], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            if jt_ids.is_empty() {
                losing.insert(journal_entry_id);
                continue;
            }
            let mut sum = 0.0_f64;
            let mut n = 0_i32;
            for jt_id in &jt_ids {
                if let Ok((v, _)) = get_journal_trade_performance_raw(&conn, *jt_id) {
                    if let Some(val) = v {
                        sum += val;
                        n += 1;
                    }
                }
            }
            if n == 0 || (sum / n as f64) <= 0.0 {
                losing.insert(journal_entry_id);
            }
        }
        losing
    };
    let mut out = Vec::new();
    for (item_id, item_text, checklist_type, high_is_good) in items {
        let is_survey_value_based = checklist_type == "survey" && high_is_good.is_some() && has_response_value;
        let (times_good, times_bad, times_not_checked_bad) = if is_survey_value_based {
            let high_ok = high_is_good.unwrap_or(true);
            let sql = "SELECT jcr.journal_entry_id, jcr.response_value FROM journal_checklist_responses jcr
                 INNER JOIN journal_entries je ON je.id = jcr.journal_entry_id AND je.strategy_id = ?1
                 WHERE jcr.checklist_item_id = ?2 AND jcr.response_value IS NOT NULL";
            let rows: Vec<(i64, i64)> = conn.prepare(sql).map_err(|e| e.to_string())?
                .query_map(params![strategy_id, item_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            let mut times_good = 0_i64;
            let mut times_bad = 0_i64;
            let mut losing_with_bad_value = 0_i64;
            let entry_values: std::collections::HashMap<i64, i64> = rows.iter().map(|(eid, v)| (*eid, *v)).collect();
            for (journal_entry_id, value) in &rows {
                let jt_ids: Vec<i64> = conn.prepare("SELECT id FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order")
                    .map_err(|e| e.to_string())?
                    .query_map(params![journal_entry_id], |row| row.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                if jt_ids.is_empty() {
                    continue;
                }
                let mut sum = 0.0_f64;
                let mut n = 0;
                for jt_id in &jt_ids {
                    if let Ok((v, _)) = get_journal_trade_performance_raw(&conn, *jt_id) {
                        if let Some(val) = v {
                            sum += val;
                            n += 1;
                        }
                    }
                }
                if n == 0 {
                    continue;
                }
                let avg = sum / n as f64;
                let winning = avg > 0.0;
                let good_value = if high_ok { *value >= 4 } else { *value <= 2 };
                let bad_value = if high_ok { *value <= 2 } else { *value >= 4 };
                if winning && good_value {
                    times_good += 1;
                } else if winning && bad_value {
                    times_bad += 1;
                } else if !winning && bad_value {
                    losing_with_bad_value += 1;
                }
            }
            let losing_no_response = losing_entry_ids.iter().filter(|eid| !entry_values.contains_key(eid)).count() as i64;
            let times_not_checked_bad = losing_no_response + losing_with_bad_value;
            (times_good, times_bad, times_not_checked_bad)
        } else {
            let sql = if has_jt_ids {
                "SELECT jcr.journal_entry_id, jcr.journal_trade_ids FROM journal_checklist_responses jcr
                 INNER JOIN journal_entries je ON je.id = jcr.journal_entry_id AND je.strategy_id = ?1
                 WHERE jcr.checklist_item_id = ?2 AND jcr.is_checked = 1"
            } else {
                "SELECT jcr.journal_entry_id, NULL FROM journal_checklist_responses jcr
                 INNER JOIN journal_entries je ON je.id = jcr.journal_entry_id AND je.strategy_id = ?1
                 WHERE jcr.checklist_item_id = ?2 AND jcr.is_checked = 1"
            };
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows: Vec<(i64, Option<String>)> = stmt.query_map(params![strategy_id, item_id], |row| {
                Ok((row.get(0)?, row.get(1).ok()))
            }).map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            let mut times_good = 0_i64;
            let mut times_bad = 0_i64;
            for (journal_entry_id, journal_trade_ids) in &rows {
                let jt_ids: Vec<i64> = if let Some(ref s) = journal_trade_ids {
                    serde_json::from_str(s.as_str()).unwrap_or_default()
                } else {
                    conn.prepare("SELECT id FROM journal_trades WHERE journal_entry_id = ?1 ORDER BY trade_order")
                        .map_err(|e| e.to_string())?
                        .query_map(params![journal_entry_id], |row| row.get(0))
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect()
                };
                if jt_ids.is_empty() {
                    times_bad += 1;
                    continue;
                }
                let mut sum = 0.0_f64;
                let mut n = 0;
                for jt_id in &jt_ids {
                    if let Ok((v, _)) = get_journal_trade_performance_raw(&conn, *jt_id) {
                        if let Some(val) = v {
                            sum += val;
                            n += 1;
                        }
                    }
                }
                if n > 0 {
                    let avg = sum / n as f64;
                    if avg > 0.0 {
                        times_good += 1;
                    } else {
                        times_bad += 1;
                    }
                } else {
                    times_bad += 1;
                }
            }
            let checked_entry_ids: std::collections::HashSet<i64> = rows.iter().map(|(eid, _)| *eid).collect();
            let times_not_checked_bad = losing_entry_ids.iter().filter(|eid| !checked_entry_ids.contains(eid)).count() as i64;
            (times_good, times_bad, times_not_checked_bad)
        };
        out.push(ChecklistItemMetricByOutcomeRow {
            checklist_item_id: item_id,
            item_text: item_text.clone(),
            checklist_type: checklist_type.clone(),
            times_checked_good: times_good,
            times_checked_bad: times_bad,
            times_not_checked_bad,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn clear_all_data() -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Delete all data from all tables
    conn.execute("DELETE FROM journal_trade_actual_trades", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM journal_checklist_responses", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM journal_trades", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM journal_entries", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM emotion_surveys", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM emotional_states", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM strategy_survey_metrics", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM strategy_checklists", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM strategies", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM trades", [])
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
    pub winning_trades: i64,
    pub total_volume: f64,
    pub estimated_pnl: f64,
}

#[tauri::command]
pub fn get_strategy_performance(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
    strategy_id: Option<i64>,
) -> Result<Vec<StrategyPerformance>, String> {
    use std::collections::HashMap;
    
    // Get paired trades using the pairing method
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;
    
    // Filter paired trades by date range if provided
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

    if let Some(sid) = strategy_id {
        filtered_paired_trades = filter_paired_trades_by_resolved_strategy(
            filtered_paired_trades,
            Some(sid),
            pairing_method.clone(),
            start_date.clone(),
            end_date.clone(),
            paper_only,
        )?;
    }
    
    // Get position groups to find the original entry trade's strategy_id for positions with additions
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone(), paper_only).map_err(|e| e.to_string())?;
    
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
                winning_trades: 0,
                total_volume: 0.0,
                estimated_pnl: 0.0,
            }
        });
        
        // Count closed positions (pairs), not individual trades
        entry.trade_count += 1;
        if paired.net_profit_loss > 0.0 {
            entry.winning_trades += 1;
        }
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

/// Filter paired trades by resolved strategy (position-group entry, entry trade, or pair).
/// `strategy_id` = Some(id) keeps pairs for that strategy; None keeps only unassigned pairs.
pub(crate) fn filter_paired_trades_by_resolved_strategy(
    mut filtered: Vec<PairedTrade>,
    strategy_id: Option<i64>,
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
) -> Result<Vec<PairedTrade>, String> {
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone(), paper_only).map_err(|e| e.to_string())?;

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
            if let Ok(sid) = entry_trade_stmt.query_row([entry_trade_id], |row| {
                row.get::<_, Option<i64>>(0)
            }) {
                entry_trade_strategies.insert(*entry_trade_id, sid);
            }
        }
    }

    if let Some(target_id) = strategy_id {
        filtered = filtered
            .into_iter()
            .filter(|paired| {
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

                pair_strategy_id == Some(target_id)
            })
            .collect();
    } else {
        filtered = filtered
            .into_iter()
            .filter(|paired| {
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
            })
            .collect();
    }

    Ok(filtered)
}

#[tauri::command]
pub fn get_paired_trades_by_strategy(
    strategy_id: Option<i64>,
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
) -> Result<Vec<PairedTrade>, String> {
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;

    let filtered = if start_date.is_some() || end_date.is_some() {
        paired_trades
            .into_iter()
            .filter(|pair| {
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
            })
            .collect::<Vec<_>>()
    } else {
        paired_trades
    };

    filter_paired_trades_by_resolved_strategy(filtered, strategy_id, pairing_method, start_date, end_date, paper_only)
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
pub fn get_recent_trades(
    limit: Option<i64>,
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
    strategy_id: Option<i64>,
) -> Result<Vec<RecentTrade>, String> {
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
    let paper_clause = paper_only_and_clause(paper_only);
    
    // Get all filled trades
    let mut stmt = conn
        .prepare(&format!("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades WHERE (status = 'Filled' OR status = 'FILLED'){}{} ORDER BY timestamp ASC", date_filter, paper_clause))
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

    if let Some(sid) = strategy_id {
        filtered_paired_trades = filter_paired_trades_by_resolved_strategy(
            filtered_paired_trades,
            Some(sid),
            pairing_method.clone(),
            start_date.clone(),
            end_date.clone(),
            paper_only,
        )?;
    }
    
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
    /// Regular session open (Yahoo `regularMarketOpen`); used for vs-open coloring in UI.
    pub regular_market_open: Option<f64>,
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

    // Day/session open: Yahoo often omits meta.regularMarketOpen; use first OHLC open bar as fallback.
    let open_from_meta = meta
        .get("regularMarketOpen")
        .and_then(|p| p.as_f64())
        .filter(|&o| o.is_finite() && o > 0.0);
    let open_from_quote = result
        .get("indicators")
        .and_then(|i| i.get("quote"))
        .and_then(|q| q.as_array())
        .and_then(|quotes| quotes.first())
        .and_then(|quote| quote.get("open"))
        .and_then(|o| o.as_array())
        .and_then(|arr| {
            arr.iter()
                .rev()
                .find_map(|v| v.as_f64().filter(|&x| x.is_finite() && x > 0.0))
        });
    let regular_market_open = open_from_meta.or(open_from_quote);
    
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
        regular_market_open,
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
    /// For survey items: true = high (e.g. 5) is good, false = low (e.g. 1) is good. Mirrors emotional survey.
    pub high_is_good: Option<bool>,
    /// Optional description for this checklist item (kept for backward compatibility; currently we show
    /// one description per checklist section instead).
    pub description: Option<String>,
}

#[tauri::command]
pub fn get_strategy_checklist(strategy_id: i64, checklist_type: Option<String>) -> Result<Vec<StrategyChecklistItem>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut items = Vec::new();
    
    let has_high_is_good_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='high_is_good'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_description_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='description'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    let map_row = |row: &rusqlite::Row| -> Result<StrategyChecklistItem, rusqlite::Error> {
        let high_is_good = if has_high_is_good_col {
            row.get::<_, Option<i64>>(7).ok().flatten().map(|v| v != 0)
        } else {
            None
        };
        let description = if has_description_col {
            let idx = if has_high_is_good_col { 8 } else { 7 };
            row.get::<_, Option<String>>(idx).ok().flatten()
        } else {
            None
        };
        Ok(StrategyChecklistItem {
            id: Some(row.get(0)?),
            strategy_id: row.get(1)?,
            item_text: row.get(2)?,
            is_checked: row.get::<_, i64>(3)? != 0,
            item_order: row.get(4)?,
            checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
            parent_id: row.get(6).ok(),
            high_is_good,
            description,
        })
    };

    if let Some(ct) = checklist_type {
        let sql = match (has_high_is_good_col, has_description_col) {
            (true, true) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good, description FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2 ORDER BY item_order ASC, id ASC",
            (true, false) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2 ORDER BY item_order ASC, id ASC",
            (false, true) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, description FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2 ORDER BY item_order ASC, id ASC",
            (false, false) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2 ORDER BY item_order ASC, id ASC",
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let items_iter = stmt.query_map(params![strategy_id, ct], map_row).map_err(|e| e.to_string())?;
        for item_result in items_iter {
            items.push(item_result.map_err(|e| e.to_string())?);
        }
    } else {
        let sql = match (has_high_is_good_col, has_description_col) {
            (true, true) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good, description FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY item_order ASC, id ASC",
            (true, false) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY item_order ASC, id ASC",
            (false, true) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, description FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY item_order ASC, id ASC",
            (false, false) => "SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id FROM strategy_checklists WHERE strategy_id = ?1 ORDER BY item_order ASC, id ASC",
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let items_iter = stmt.query_map(params![strategy_id], map_row).map_err(|e| e.to_string())?;
        for item_result in items_iter {
            items.push(item_result.map_err(|e| e.to_string())?);
        }
    }
    
    Ok(items)
}

#[derive(serde::Serialize)]
pub struct ChecklistSectionDescription {
    pub checklist_type: String,
    pub description: Option<String>,
}

#[tauri::command]
pub fn get_strategy_checklist_section_descriptions(strategy_id: i64) -> Result<Vec<ChecklistSectionDescription>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT checklist_type, description FROM strategy_checklist_section_descriptions WHERE strategy_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([strategy_id], |row| {
            Ok(ChecklistSectionDescription {
                checklist_type: row.get(0)?,
                description: row.get(1).ok().flatten(),
            })
        })
        .map_err(|e| e.to_string())?;
    let out: Vec<ChecklistSectionDescription> = rows.filter_map(|r| r.ok()).collect();
    Ok(out)
}

#[tauri::command]
pub fn save_strategy_checklist_section_description(
    strategy_id: i64,
    checklist_type: String,
    description: Option<String>,
) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO strategy_checklist_section_descriptions (strategy_id, checklist_type, description) VALUES (?1, ?2, ?3)
         ON CONFLICT(strategy_id, checklist_type) DO UPDATE SET description = excluded.description",
        rusqlite::params![strategy_id, checklist_type, description.as_deref()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct CustomSurveyMetric {
    pub checklist_item_id: i64,
    pub item_text: String,
    pub response_count: i64,
    pub avg_value: Option<f64>,
}

#[tauri::command]
pub fn get_custom_survey_metrics(strategy_id: i64) -> Result<Vec<CustomSurveyMetric>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    let has_response_value = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='response_value'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);

    if !has_response_value {
        let mut stmt = conn
            .prepare("SELECT id, item_text FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = 'survey' ORDER BY item_order ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![strategy_id], |row| {
            Ok(CustomSurveyMetric {
                checklist_item_id: row.get(0)?,
                item_text: row.get(1)?,
                response_count: 0,
                avg_value: None,
            })
        }).map_err(|e| e.to_string())?;
        return Ok(rows.filter_map(|r| r.ok()).collect());
    }

    let sql = "SELECT sc.id, sc.item_text,
        (SELECT COUNT(*) FROM journal_checklist_responses jcr WHERE jcr.checklist_item_id = sc.id AND jcr.response_value IS NOT NULL) AS response_count,
        (SELECT AVG(jcr.response_value) FROM journal_checklist_responses jcr WHERE jcr.checklist_item_id = sc.id AND jcr.response_value IS NOT NULL) AS avg_value
        FROM strategy_checklists sc
        WHERE sc.strategy_id = ?1 AND sc.checklist_type = 'survey'
        ORDER BY sc.item_order ASC, sc.id ASC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![strategy_id], |row| {
        Ok(CustomSurveyMetric {
            checklist_item_id: row.get(0)?,
            item_text: row.get(1)?,
            response_count: row.get(2)?,
            avg_value: row.get(3).ok().flatten(),
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// —— Custom survey metrics (user-defined metrics with editable name, description, formula, and which survey items)
#[derive(serde::Serialize)]
pub struct StrategySurveyMetric {
    pub id: i64,
    pub strategy_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub formula_type: String,
    pub item_ids: String,
    pub display_order: i64,
    pub color_scale: Option<String>,
}

#[derive(serde::Serialize)]
pub struct StrategySurveyMetricWithValue {
    pub id: i64,
    pub strategy_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub formula_type: String,
    pub item_ids: String,
    pub display_order: i64,
    pub computed_value: Option<f64>,
    pub color_scale: Option<String>,
}

#[tauri::command]
pub fn get_strategy_survey_metrics(strategy_id: i64) -> Result<Vec<StrategySurveyMetric>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, strategy_id, name, description, formula_type, item_ids, display_order, color_scale FROM strategy_survey_metrics WHERE strategy_id = ?1 ORDER BY display_order ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![strategy_id], |row| {
        Ok(StrategySurveyMetric {
            id: row.get(0)?,
            strategy_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3).ok(),
            formula_type: row.get(4).unwrap_or_else(|_| "avg".to_string()),
            item_ids: row.get(5).unwrap_or_else(|_| "[]".to_string()),
            display_order: row.get(6).unwrap_or(0),
            color_scale: row.get(7).ok(),
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Evaluate a custom formula string with v1, v2, v3, ... bound to the given values (survey item responses in order).
fn evaluate_custom_formula(values: &[f64], formula: &str) -> Result<f64, String> {
    let formula = formula.trim();
    if formula.is_empty() {
        return Err("Empty formula".to_string());
    }
    let mut context: HashMapContext<DefaultNumericTypes> = HashMapContext::new();
    for (i, &v) in values.iter().enumerate() {
        if i >= 20 {
            break;
        }
        let key = format!("v{}", i + 1);
        context.set_value(key.into(), Value::from_float(v)).map_err(|e| format!("{:?}", e))?;
    }
    let result = eval_float_with_context(formula, &context).map_err(|e| e.to_string())?;
    Ok(result)
}

fn get_preset_formula(conn: &rusqlite::Connection, preset_id: i64) -> Result<(String, Option<String>), String> {
    let (formula_type, formula_expression): (String, Option<String>) = conn.query_row(
        "SELECT formula_type, formula_expression FROM strategy_calculation_presets WHERE id = ?1",
        params![preset_id],
        |row| {
            let expr: Option<String> = row.get(1).ok();
            Ok((row.get(0).unwrap_or_else(|_| "avg".to_string()), expr))
        },
    ).map_err(|e| e.to_string())?;
    let expr = formula_expression.and_then(|s| if s.is_empty() { None } else { Some(s) });
    Ok((formula_type, expr))
}

fn compute_custom_metric_value(conn: &rusqlite::Connection, item_ids: &[i64], formula_type: &str) -> Result<Option<f64>, String> {
    let has_response_value = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='response_value'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);
    if !has_response_value || item_ids.is_empty() {
        return Ok(None);
    }
    let mut values = Vec::new();
    for &item_id in item_ids {
        let mut stmt = conn.prepare("SELECT response_value FROM journal_checklist_responses WHERE checklist_item_id = ?1 AND response_value IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows: Vec<i64> = stmt.query_map(params![item_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        values.extend(rows);
    }
    if values.is_empty() {
        return Ok(None);
    }
    let values_f: Vec<f64> = values.iter().map(|&v| v as f64).collect();

    let effective_type: String = if formula_type.starts_with("preset:") {
        let preset_id: i64 = formula_type["preset:".len()..].trim().parse().unwrap_or(0);
        if preset_id == 0 {
            "avg".to_string()
        } else {
            match get_preset_formula(conn, preset_id) {
                Ok((_, Some(expr))) => {
                    let result = evaluate_custom_formula(&values_f, &expr)?;
                    return Ok(Some(result));
                }
                Ok((ft, None)) => ft,
                Err(_) => "avg".to_string(),
            }
        }
    } else {
        formula_type.to_string()
    };

    let result = match effective_type.as_str() {
        "invert" => {
            let avg = values_f.iter().sum::<f64>() / values_f.len() as f64;
            11.0 - avg
        }
        "min" => values_f.iter().cloned().fold(f64::INFINITY, f64::min),
        "max" => values_f.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        _ => values_f.iter().sum::<f64>() / values_f.len() as f64, // avg
    };
    Ok(Some(result))
}

#[tauri::command]
pub fn get_strategy_survey_metrics_with_values(strategy_id: i64) -> Result<Vec<StrategySurveyMetricWithValue>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let metrics = get_strategy_survey_metrics(strategy_id)?;
    let mut out = Vec::with_capacity(metrics.len());
    for m in metrics {
        let item_ids: Vec<i64> = serde_json::from_str(&m.item_ids).unwrap_or_default();
        let computed_value = compute_custom_metric_value(&conn, &item_ids, &m.formula_type)?;
        out.push(StrategySurveyMetricWithValue {
            id: m.id,
            strategy_id: m.strategy_id,
            name: m.name,
            description: m.description,
            formula_type: m.formula_type.clone(),
            item_ids: m.item_ids.clone(),
            display_order: m.display_order,
            computed_value,
            color_scale: m.color_scale.clone(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn save_strategy_survey_metric(
    id: Option<i64>,
    strategy_id: i64,
    name: String,
    description: Option<String>,
    formula_type: String,
    item_ids: String,
    display_order: i64,
    color_scale: Option<String>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let formula = normalize_formula_type(&formula_type);
    if let Some(pk) = id {
        conn.execute(
            "UPDATE strategy_survey_metrics SET name = ?1, description = ?2, formula_type = ?3, item_ids = ?4, display_order = ?5, color_scale = ?6, updated_at = datetime('now') WHERE id = ?7",
            params![name, description, formula, item_ids, display_order, color_scale, pk],
        ).map_err(|e| e.to_string())?;
        Ok(pk)
    } else {
        conn.execute(
            "INSERT INTO strategy_survey_metrics (strategy_id, name, description, formula_type, item_ids, display_order, color_scale, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))",
            params![strategy_id, name, description, formula, item_ids, display_order, color_scale],
        ).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn delete_strategy_survey_metric(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM strategy_survey_metrics WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// —— Calculation presets (saved custom formulas: v1, v2, … = survey item values in order)
#[derive(serde::Serialize)]
pub struct StrategyCalculationPreset {
    pub id: i64,
    pub strategy_id: i64,
    pub name: String,
    pub formula_type: String,
    pub formula_expression: Option<String>,
    pub display_order: i64,
}

#[tauri::command]
pub fn get_strategy_calculation_presets(strategy_id: i64) -> Result<Vec<StrategyCalculationPreset>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, strategy_id, name, formula_type, display_order, formula_expression FROM strategy_calculation_presets WHERE strategy_id = ?1 ORDER BY display_order ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![strategy_id], |row| {
        Ok(StrategyCalculationPreset {
            id: row.get(0)?,
            strategy_id: row.get(1)?,
            name: row.get(2)?,
            formula_type: row.get(3).unwrap_or_else(|_| "avg".to_string()),
            display_order: row.get(4).unwrap_or(0),
            formula_expression: row.get(5).ok().and_then(|s: String| if s.is_empty() { None } else { Some(s) }),
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_strategy_calculation_preset(
    id: Option<i64>,
    strategy_id: i64,
    name: String,
    formula_type: String,
    formula_expression: Option<String>,
    display_order: i64,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let formula = if formula_expression.as_deref().map_or(true, |s| s.is_empty()) {
        normalize_formula_type(&formula_type).to_string()
    } else {
        "custom".to_string()
    };
    let expr = formula_expression.unwrap_or_default();
    if let Some(pk) = id {
        conn.execute(
            "UPDATE strategy_calculation_presets SET name = ?1, formula_type = ?2, formula_expression = ?3, display_order = ?4, updated_at = datetime('now') WHERE id = ?5",
            params![name, formula, expr, display_order, pk],
        ).map_err(|e| e.to_string())?;
        Ok(pk)
    } else {
        conn.execute(
            "INSERT INTO strategy_calculation_presets (strategy_id, name, formula_type, formula_expression, display_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))",
            params![strategy_id, name, formula, expr, display_order],
        ).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn delete_strategy_calculation_preset(id: i64) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM strategy_calculation_presets WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn normalize_formula_type(s: &str) -> &str {
    match s {
        "invert" => "invert",
        "min" => "min",
        "max" => "max",
        _ => "avg",
    }
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
    high_is_good: Option<bool>,
    description: Option<String>,
) -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let checked_int = if is_checked { 1 } else { 0 };
    let high_is_good_int: Option<i64> = high_is_good.map(|b| if b { 1 } else { 0 });

    let has_high_is_good_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='high_is_good'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_description_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='description'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    
    if let Some(item_id) = id {
        match (has_high_is_good_col, has_description_col) {
            (true, true) => {
                conn.execute(
                    "UPDATE strategy_checklists SET item_text = ?1, is_checked = ?2, item_order = ?3, checklist_type = ?4, parent_id = ?5, high_is_good = ?6, description = ?7, updated_at = datetime('now') WHERE id = ?8",
                    params![item_text, checked_int, item_order, checklist_type, parent_id, high_is_good_int, description, item_id],
                ).map_err(|e| e.to_string())?;
            }
            (true, false) => {
                conn.execute(
                    "UPDATE strategy_checklists SET item_text = ?1, is_checked = ?2, item_order = ?3, checklist_type = ?4, parent_id = ?5, high_is_good = ?6, updated_at = datetime('now') WHERE id = ?7",
                    params![item_text, checked_int, item_order, checklist_type, parent_id, high_is_good_int, item_id],
                ).map_err(|e| e.to_string())?;
            }
            (false, true) => {
                conn.execute(
                    "UPDATE strategy_checklists SET item_text = ?1, is_checked = ?2, item_order = ?3, checklist_type = ?4, parent_id = ?5, description = ?6, updated_at = datetime('now') WHERE id = ?7",
                    params![item_text, checked_int, item_order, checklist_type, parent_id, description, item_id],
                ).map_err(|e| e.to_string())?;
            }
            (false, false) => {
                conn.execute(
                    "UPDATE strategy_checklists SET item_text = ?1, is_checked = ?2, item_order = ?3, checklist_type = ?4, parent_id = ?5, updated_at = datetime('now') WHERE id = ?6",
                    params![item_text, checked_int, item_order, checklist_type, parent_id, item_id],
                ).map_err(|e| e.to_string())?;
            }
        }
        Ok(item_id)
    } else {
        match (has_high_is_good_col, has_description_col) {
            (true, true) => {
                conn.execute(
                    "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good, description, created_at, updated_at) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'))",
                    params![strategy_id, item_text, checked_int, item_order, checklist_type, parent_id, high_is_good_int, description],
                ).map_err(|e| e.to_string())?;
            }
            (true, false) => {
                conn.execute(
                    "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good, created_at, updated_at) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))",
                    params![strategy_id, item_text, checked_int, item_order, checklist_type, parent_id, high_is_good_int],
                ).map_err(|e| e.to_string())?;
            }
            (false, true) => {
                conn.execute(
                    "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, description, created_at, updated_at) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))",
                    params![strategy_id, item_text, checked_int, item_order, checklist_type, parent_id, description],
                ).map_err(|e| e.to_string())?;
            }
            (false, false) => {
                conn.execute(
                    "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, created_at, updated_at) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))",
                    params![strategy_id, item_text, checked_int, item_order, checklist_type, parent_id],
                ).map_err(|e| e.to_string())?;
            }
        }
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

#[tauri::command]
pub fn delete_strategy_checklist_type(strategy_id: i64, checklist_type: String) -> Result<(), String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    // Delete all checklist rows (including any placeholder row used to persist empty custom types).
    conn.execute(
        "DELETE FROM strategy_checklists WHERE strategy_id = ?1 AND checklist_type = ?2",
        params![strategy_id, checklist_type],
    )
    .map_err(|e| e.to_string())?;

    // Also remove any section description so deleted custom sections don't reappear.
    conn.execute(
        "DELETE FROM strategy_checklist_section_descriptions WHERE strategy_id = ?1 AND checklist_type = ?2",
        params![strategy_id, checklist_type],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Removes duplicate checklist rows.
///
/// Edits can sometimes create a new row instead of updating the existing one. When that happens,
/// we want to keep the *newest* row for a given slot in the checklist.
///
/// We scope the "slot" by (strategy_id, checklist_type, parent_id, item_order) so regrouping and
/// item_text edits don't leave stale duplicates behind.
/// Returns the number of rows deleted.
#[tauri::command]
pub fn remove_duplicate_checklist_items() -> Result<i64, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;

    // Delete all rows whose id is not the maximum id for its (strategy_id, checklist_type, parent_id, item_order) group.
    let deleted = conn.execute(
        "DELETE FROM strategy_checklists WHERE id NOT IN (
            SELECT MAX(id) FROM strategy_checklists
            GROUP BY strategy_id, checklist_type, parent_id, item_order
        )",
        [],
    ).map_err(|e| e.to_string())?;

    Ok(deleted as i64)
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
pub fn get_evaluation_metrics(pairing_method: Option<String>, start_date: Option<String>, end_date: Option<String>, paper_only: Option<bool>) -> Result<EvaluationMetrics, String> {
    use std::collections::HashMap;
    
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;
    
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
    let position_groups = get_position_groups(pairing_method.clone(), start_date.clone(), end_date.clone(), paper_only).map_err(|e| e.to_string())?;
    
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

#[derive(Debug, Deserialize)]
pub struct EquityCurveFilters {
    /// Single-value (legacy) or use strategy_ids for multi-select
    pub strategy_id: Option<i64>,
    pub strategy_ids: Option<Vec<i64>>,
    pub symbol: Option<String>,
    pub symbols: Option<Vec<String>>,
    pub side: Option<String>,
    pub sides: Option<Vec<String>>,
    pub order_type: Option<String>,
    pub order_types: Option<Vec<String>>,
    pub position_size_min: Option<f64>,
    pub position_size_max: Option<f64>,
    /// Position size in USD (quantity * entry_price) — matches Trades page
    pub position_size_min_usd: Option<f64>,
    pub position_size_max_usd: Option<f64>,
}

/// Build equity curve and drawdown metrics from a list of paired trades (sorted by exit timestamp).
fn build_equity_curve_from_pairs(mut pairs: Vec<PairedTrade>) -> EquityCurveData {
    use std::collections::HashMap;
    pairs.sort_by(|a, b| a.exit_timestamp.cmp(&b.exit_timestamp));
    let mut daily_pnl_map: HashMap<String, f64> = HashMap::new();
    for pair in &pairs {
        if let Some(date_str) = pair.exit_timestamp.split('T').next() {
            *daily_pnl_map.entry(date_str.to_string()).or_insert(0.0) += pair.net_profit_loss;
        }
    }
    let mut dates: Vec<String> = daily_pnl_map.keys().cloned().collect();
    dates.sort();
    let mut equity_points = Vec::new();
    let mut cumulative_pnl = 0.0;
    let mut peak_equity = 0.0;
    let mut max_drawdown = 0.0;
    let mut max_drawdown_start: Option<String> = None;
    let mut max_drawdown_end: Option<String> = None;
    let mut current_drawdown_start: Option<String> = None;
    let mut longest_drawdown_days: i64 = 0;
    let mut longest_drawdown_start: Option<String> = None;
    let mut longest_drawdown_end: Option<String> = None;
    let mut current_drawdown_days = 0;
    let mut current_drawdown_start_date: Option<String> = None;
    let mut drawdown_sum = 0.0;
    let mut drawdown_count = 0;
    let mut current_streak_type: Option<bool> = None;
    let mut current_streak_start: Option<String> = None;
    let mut winning_streaks: Vec<(String, String)> = Vec::new();
    let mut losing_streaks: Vec<(String, String)> = Vec::new();
    let mut best_surge_start: Option<String> = None;
    let mut best_surge_end: Option<String> = None;
    let mut best_surge_value = 0.0;
    let mut surge_start_date: Option<String> = None;
    let mut surge_start_equity = 0.0;
    for date in &dates {
        let daily_pnl = daily_pnl_map.get(date).copied().unwrap_or(0.0);
        cumulative_pnl += daily_pnl;
        if cumulative_pnl > peak_equity {
            peak_equity = cumulative_pnl;
            surge_start_date = Some(date.clone());
            surge_start_equity = cumulative_pnl;
        }
        let drawdown = peak_equity - cumulative_pnl;
        let drawdown_pct = if peak_equity > 0.0 {
            (drawdown / peak_equity) * 100.0
        } else if peak_equity < 0.0 {
            (drawdown / peak_equity.abs()) * 100.0
        } else {
            0.0
        };
        if drawdown > max_drawdown {
            max_drawdown = drawdown;
            if current_drawdown_start.is_none() {
                current_drawdown_start = Some(date.clone());
            }
            max_drawdown_start = current_drawdown_start.clone();
            max_drawdown_end = Some(date.clone());
        }
        if drawdown > 0.0 {
            if current_drawdown_start_date.is_none() {
                current_drawdown_start_date = Some(date.clone());
            }
            current_drawdown_days += 1;
            drawdown_sum += drawdown;
            drawdown_count += 1;
        } else {
            if current_drawdown_days > longest_drawdown_days {
                longest_drawdown_days = current_drawdown_days as i64;
                longest_drawdown_start = current_drawdown_start_date.clone();
                longest_drawdown_end = Some(date.clone());
            }
            current_drawdown_days = 0;
            current_drawdown_start_date = None;
            current_drawdown_start = None;
        }
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
        let is_win = daily_pnl > 0.0;
        let is_loss = daily_pnl < 0.0;
        if is_win {
            if current_streak_type == Some(false) {
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
                if let Some(start) = current_streak_start.take() {
                    winning_streaks.push((start, date.clone()));
                }
            }
            if current_streak_type != Some(false) {
                current_streak_type = Some(false);
                current_streak_start = Some(date.clone());
            }
        }
        let is_max_drawdown = max_drawdown_start.as_ref().map_or(false, |start| {
            date >= start && max_drawdown_end.as_ref().map_or(false, |end| date <= end)
        });
        let is_best_surge = best_surge_start.as_ref().map_or(false, |start| {
            date >= start && best_surge_end.as_ref().map_or(false, |end| date <= end)
        });
        let is_winning_streak = winning_streaks.iter().any(|(s, e)| date >= s && date <= e)
            || (current_streak_type == Some(true) && current_streak_start.as_ref().map_or(false, |s| date >= s));
        let is_losing_streak = losing_streaks.iter().any(|(s, e)| date >= s && date <= e)
            || (current_streak_type == Some(false) && current_streak_start.as_ref().map_or(false, |s| date >= s));
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
    if current_drawdown_days > longest_drawdown_days {
        longest_drawdown_days = current_drawdown_days as i64;
        longest_drawdown_start = current_drawdown_start_date.clone();
        longest_drawdown_end = dates.last().cloned();
    }
    let avg_drawdown = if drawdown_count > 0 {
        drawdown_sum / drawdown_count as f64
    } else {
        0.0
    };
    let max_drawdown_pct = if peak_equity > 0.0 {
        (max_drawdown / peak_equity) * 100.0
    } else if peak_equity < 0.0 {
        (max_drawdown / peak_equity.abs()) * 100.0
    } else {
        0.0
    };
    EquityCurveData {
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
    }
}

#[tauri::command]
pub fn get_equity_curve(
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    paper_only: Option<bool>,
    filters: Option<EquityCurveFilters>,
) -> Result<EquityCurveData, String> {
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;
    
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
    
    // Apply strategy/symbol/side/order_type/position_size filters via entry-trade lookup (multi-select + position size USD)
    if let Some(ref f) = filters {
        let has_multi = f.strategy_ids.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.symbols.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.sides.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
            || f.order_types.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
        let has_single = f.strategy_id.is_some() || f.symbol.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
            || f.side.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
            || f.order_type.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
        let has_pos = f.position_size_min.is_some() || f.position_size_max.is_some()
            || f.position_size_min_usd.is_some() || f.position_size_max_usd.is_some();
        let has_filter = has_multi || has_single || has_pos;
        if has_filter {
            let entry_ids: Vec<i64> = filtered_paired_trades.iter().map(|p| p.entry_trade_id).collect();
            let entry_trades = get_trades_by_ids(&entry_ids).map_err(|e| e.to_string())?;
            filtered_paired_trades = filtered_paired_trades
                .into_iter()
                .filter(|pair| {
                    if let Some(entry) = entry_trades.get(&pair.entry_trade_id) {
                        if let Some(ref ids) = f.strategy_ids {
                            if !ids.is_empty() {
                                let ok = pair.strategy_id.map_or(false, |id| ids.contains(&id));
                                if !ok {
                                    return false;
                                }
                            }
                        } else if let Some(sid) = f.strategy_id {
                            if pair.strategy_id != Some(sid) {
                                return false;
                            }
                        }
                        if let Some(ref syms) = f.symbols {
                            if !syms.is_empty() {
                                let pair_underlying = get_underlying_symbol(&pair.symbol);
                                let match_ = syms.iter().any(|s| {
                                    pair.symbol == *s || pair_underlying == get_underlying_symbol(s)
                                });
                                if !match_ {
                                    return false;
                                }
                            }
                        }
                        if f.symbols.as_ref().map(|v| v.is_empty()).unwrap_or(true) {
                            if let Some(ref sym) = f.symbol {
                                if !sym.is_empty() {
                                    let pair_underlying = get_underlying_symbol(&pair.symbol);
                                    let filter_underlying = get_underlying_symbol(sym);
                                    if pair.symbol != *sym && pair_underlying != filter_underlying {
                                        return false;
                                    }
                                }
                            }
                        }
                        if let Some(ref sides) = f.sides {
                            if !sides.is_empty() && !sides.iter().any(|s| entry.side.eq_ignore_ascii_case(s)) {
                                return false;
                            }
                        }
                        if f.sides.as_ref().map(|v| v.is_empty()).unwrap_or(true) {
                            if let Some(ref side) = f.side {
                                if !side.is_empty() && !entry.side.eq_ignore_ascii_case(side) {
                                    return false;
                                }
                            }
                        }
                        if let Some(ref ots) = f.order_types {
                            if !ots.is_empty() && !ots.iter().any(|o| entry.order_type.eq_ignore_ascii_case(o)) {
                                return false;
                            }
                        }
                        if f.order_types.as_ref().map(|v| v.is_empty()).unwrap_or(true) {
                            if let Some(ref ot) = f.order_type {
                                if !ot.is_empty() && !entry.order_type.eq_ignore_ascii_case(ot) {
                                    return false;
                                }
                            }
                        }
                        if f.position_size_min_usd.is_some() || f.position_size_max_usd.is_some() {
                            let pos_usd = pair.quantity * pair.entry_price;
                            if let Some(min_u) = f.position_size_min_usd {
                                if pos_usd < min_u {
                                    return false;
                                }
                            }
                            if let Some(max_u) = f.position_size_max_usd {
                                if pos_usd > max_u {
                                    return false;
                                }
                            }
                        } else {
                            if let Some(min_q) = f.position_size_min {
                                if pair.quantity < min_q {
                                    return false;
                                }
                            }
                            if let Some(max_q) = f.position_size_max {
                                if pair.quantity > max_q {
                                    return false;
                                }
                            }
                        }
                        true
                    } else {
                        false
                    }
                })
                .collect();
        }
    }
    
    Ok(build_equity_curve_from_pairs(filtered_paired_trades))
}

/// Build equity curve from an in-memory list of trades (for Demo mode with strategy/symbol filters).
#[tauri::command]
pub fn get_equity_curve_from_trades(
    trades: Vec<Trade>,
    pairing_method: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<EquityCurveData, String> {
    let filled: Vec<Trade> = trades
        .into_iter()
        .filter(|t| t.status.eq_ignore_ascii_case("Filled") || t.status.eq_ignore_ascii_case("FILLED"))
        .collect();
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(filled)
    } else {
        pair_trades_lifo(filled)
    };
    let filtered: Vec<PairedTrade> = if start_date.is_some() || end_date.is_some() {
        paired_trades
            .into_iter()
            .filter(|pair| {
                let exit = &pair.exit_timestamp;
                (start_date.as_ref().map_or(true, |s| exit >= s))
                    && (end_date.as_ref().map_or(true, |e| exit <= e))
            })
            .collect()
    } else {
        paired_trades
    };
    Ok(build_equity_curve_from_pairs(filtered))
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
    paper_only: Option<bool>,
) -> Result<DistributionConcentrationData, String> {
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;
    
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
    paper_only: Option<bool>,
) -> Result<TiltStats, String> {
    // Get paired trades
    let paired_trades = get_paired_trades(pairing_method.clone(), paper_only).map_err(|e| e.to_string())?;
    
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

// Export/Import Data Structures
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub version: String,
    pub export_date: String,
    pub trades: Vec<Trade>,
    pub strategies: Vec<Strategy>,
    pub emotional_states: Vec<EmotionalState>,
    pub journal_entries: Vec<JournalEntry>,
    pub journal_trades: Vec<JournalTrade>,
    pub strategy_checklists: Vec<StrategyChecklistItem>,
    pub journal_checklist_responses: Vec<JournalChecklistResponse>,
    pub pair_notes: Vec<PairNote>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PairNote {
    pub entry_trade_id: i64,
    pub exit_trade_id: i64,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn export_data() -> Result<String, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Export trades
    let mut stmt = conn
        .prepare("SELECT id, symbol, side, quantity, price, timestamp, order_type, status, fees, notes, strategy_id FROM trades ORDER BY timestamp")
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
    
    // Export strategies
    let mut stmt = conn
        .prepare("SELECT id, name, description, notes, created_at, color, COALESCE(display_order, id), author FROM strategies ORDER BY COALESCE(display_order, id)")
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
                display_order: row.get(6)?,
                author: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut strategies = Vec::new();
    for strategy in strategy_iter {
        strategies.push(strategy.map_err(|e| e.to_string())?);
    }
    
    // Export emotional states
    let has_multi_export = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('emotional_states') WHERE name='journal_entry_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let emotional_states: Vec<EmotionalState> = if has_multi_export {
        let mut stmt = conn
            .prepare("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id, journal_entry_ids, trade_ids FROM emotional_states ORDER BY timestamp")
            .map_err(|e| e.to_string())?;
        let collected: Vec<EmotionalState> = stmt.query_map([], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: row.get(6).ok(),
                journal_trade_id: row.get(7).ok(),
                journal_entry_ids: row.get(8).ok(),
                trade_ids: row.get(9).ok(),
            })
        })
        .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    } else {
        let mut stmt = conn
            .prepare("SELECT id, timestamp, emotion, intensity, notes, trade_id, journal_entry_id, journal_trade_id FROM emotional_states ORDER BY timestamp")
            .map_err(|e| e.to_string())?;
        let collected: Vec<EmotionalState> = stmt.query_map([], |row| {
            Ok(EmotionalState {
                id: Some(row.get(0)?),
                timestamp: row.get(1)?,
                emotion: row.get(2)?,
                intensity: row.get(3)?,
                notes: row.get(4)?,
                trade_id: row.get(5)?,
                journal_entry_id: row.get(6).ok(),
                journal_trade_id: row.get(7).ok(),
                journal_entry_ids: None,
                trade_ids: None,
            })
        })
        .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        collected
    };
    
    // Export journal entries
    let mut stmt = conn
        .prepare("SELECT id, date, title, strategy_id, created_at, updated_at FROM journal_entries ORDER BY date DESC")
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
                linked_trade_ids: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut journal_entries = Vec::new();
    for entry in entry_iter {
        journal_entries.push(entry.map_err(|e| e.to_string())?);
    }
    
    // Export journal trades
    let mut stmt = conn
        .prepare("SELECT id, journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, r_multiple, trade_order, created_at, updated_at FROM journal_trades ORDER BY journal_entry_id, trade_order")
        .map_err(|e| e.to_string())?;
    let journal_trade_iter = stmt
        .query_map([], |row| {
            Ok(JournalTrade {
                id: Some(row.get(0)?),
                journal_entry_id: row.get(1)?,
                symbol: row.get(2)?,
                position: row.get(3)?,
                timeframe: row.get(4)?,
                entry_type: row.get(5)?,
                exit_type: row.get(6)?,
                trade: row.get(7)?,
                what_went_well: row.get(8)?,
                what_could_be_improved: row.get(9)?,
                emotional_state: row.get(10)?,
                notes: row.get(11)?,
                outcome: row.get(12)?,
                r_multiple: row.get(13).ok(),
                trade_order: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut journal_trades = Vec::new();
    for trade in journal_trade_iter {
        journal_trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    // Export strategy checklists
    let has_high_is_good_export = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='high_is_good'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let has_description_export = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('strategy_checklists') WHERE name='description'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    let mut strategy_checklists = Vec::new();
    if has_high_is_good_export {
        // high_is_good column exists
        if has_description_export {
            // Both high_is_good and description
            let mut stmt = conn
                .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good, description FROM strategy_checklists ORDER BY strategy_id, checklist_type, item_order")
                .map_err(|e| e.to_string())?;
            let checklist_iter = stmt.query_map([], |row| {
                let high_is_good = row.get::<_, Option<i64>>(7).ok().flatten().map(|v| v != 0);
                let description = row.get::<_, Option<String>>(8).ok().flatten();
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                    high_is_good,
                    description,
                })
            }).map_err(|e| e.to_string())?;
            for item in checklist_iter {
                strategy_checklists.push(item.map_err(|e| e.to_string())?);
            }
        } else {
            // Only high_is_good
            let mut stmt = conn
                .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, high_is_good FROM strategy_checklists ORDER BY strategy_id, checklist_type, item_order")
                .map_err(|e| e.to_string())?;
            let checklist_iter = stmt.query_map([], |row| {
                let high_is_good = row.get::<_, Option<i64>>(7).ok().flatten().map(|v| v != 0);
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                    high_is_good,
                    description: None,
                })
            }).map_err(|e| e.to_string())?;
            for item in checklist_iter {
                strategy_checklists.push(item.map_err(|e| e.to_string())?);
            }
        }
    } else {
        // No high_is_good column
        if has_description_export {
            let mut stmt = conn
                .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id, description FROM strategy_checklists ORDER BY strategy_id, checklist_type, item_order")
                .map_err(|e| e.to_string())?;
            let checklist_iter = stmt.query_map([], |row| {
                let description = row.get::<_, Option<String>>(7).ok().flatten();
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                    high_is_good: None,
                    description,
                })
            }).map_err(|e| e.to_string())?;
            for item in checklist_iter {
                strategy_checklists.push(item.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn
                .prepare("SELECT id, strategy_id, item_text, is_checked, item_order, checklist_type, parent_id FROM strategy_checklists ORDER BY strategy_id, checklist_type, item_order")
                .map_err(|e| e.to_string())?;
            let checklist_iter = stmt.query_map([], |row| {
                Ok(StrategyChecklistItem {
                    id: Some(row.get(0)?),
                    strategy_id: row.get(1)?,
                    item_text: row.get(2)?,
                    is_checked: row.get::<_, i64>(3)? != 0,
                    item_order: row.get(4)?,
                    checklist_type: row.get(5).unwrap_or_else(|_| "entry".to_string()),
                    parent_id: row.get(6).ok(),
                    high_is_good: None,
                    description: None,
                })
            }).map_err(|e| e.to_string())?;
            for item in checklist_iter {
                strategy_checklists.push(item.map_err(|e| e.to_string())?);
            }
        }
    }
    
    // Export journal checklist responses
    let has_trade_ids_col = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='journal_trade_ids'",
        [],
        |row| row.get::<_, i64>(0),
    ).map(|c| c > 0).unwrap_or(false);
    let journal_checklist_responses: Vec<JournalChecklistResponse> = if has_trade_ids_col {
        let mut stmt = conn.prepare("SELECT journal_entry_id, checklist_item_id, is_checked, journal_trade_ids FROM journal_checklist_responses")
            .map_err(|e| e.to_string())?;
        let rows: Vec<JournalChecklistResponse> = stmt
            .query_map([], |row| {
                Ok(JournalChecklistResponse {
                    id: None,
                    journal_entry_id: row.get(0)?,
                    checklist_item_id: row.get(1)?,
                    is_checked: row.get::<_, i64>(2)? != 0,
                    journal_trade_ids: row.get(3).ok(),
                    response_value: None,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    } else {
        let mut stmt = conn.prepare("SELECT journal_entry_id, checklist_item_id, is_checked FROM journal_checklist_responses")
            .map_err(|e| e.to_string())?;
        let rows: Vec<JournalChecklistResponse> = stmt
            .query_map([], |row| {
                Ok(JournalChecklistResponse {
                    id: None,
                    journal_entry_id: row.get(0)?,
                    checklist_item_id: row.get(1)?,
                    is_checked: row.get::<_, i64>(2)? != 0,
                    journal_trade_ids: None,
                    response_value: None,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    
    // Export pair notes
    let mut stmt = conn
        .prepare("SELECT entry_trade_id, exit_trade_id, notes FROM pair_notes")
        .map_err(|e| e.to_string())?;
    let note_iter = stmt
        .query_map([], |row| {
            Ok(PairNote {
                entry_trade_id: row.get(0)?,
                exit_trade_id: row.get(1)?,
                notes: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut pair_notes = Vec::new();
    for note in note_iter {
        pair_notes.push(note.map_err(|e| e.to_string())?);
    }
    
    let export_data = ExportData {
        version: "1.0".to_string(),
        export_date: chrono::Utc::now().to_rfc3339(),
        trades,
        strategies,
        emotional_states,
        journal_entries,
        journal_trades,
        strategy_checklists,
        journal_checklist_responses,
        pair_notes,
    };
    
    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_data(json_data: String) -> Result<ImportResult, String> {
    let export_data: ExportData = serde_json::from_str(&json_data)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut result = ImportResult {
        trades_imported: 0,
        trades_skipped: 0,
        strategies_imported: 0,
        strategies_skipped: 0,
        emotional_states_imported: 0,
        emotional_states_skipped: 0,
        journal_entries_imported: 0,
        journal_entries_skipped: 0,
        journal_trades_imported: 0,
        journal_trades_skipped: 0,
        checklists_imported: 0,
        checklists_skipped: 0,
        checklist_responses_imported: 0,
        checklist_responses_skipped: 0,
        pair_notes_imported: 0,
        pair_notes_skipped: 0,
    };
    
    // Create a map to track old strategy IDs to new strategy IDs
    let mut strategy_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    
    // Import strategies first (they're referenced by other data)
    for strategy in export_data.strategies {
        // Check for duplicate by name
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM strategies WHERE name = ?1",
                params![strategy.name],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            // Strategy exists, get its ID
            let existing_id: i64 = conn
                .query_row(
                    "SELECT id FROM strategies WHERE name = ?1",
                    params![strategy.name],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            
            if let Some(old_id) = strategy.id {
                strategy_id_map.insert(old_id, existing_id);
            }
            result.strategies_skipped += 1;
        } else {
            // Insert new strategy
            conn.execute(
                "INSERT INTO strategies (name, description, notes, color, author) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![strategy.name, strategy.description, strategy.notes, strategy.color, strategy.author],
            ).map_err(|e| e.to_string())?;
            
            let new_id = conn.last_insert_rowid();
            if let Some(old_id) = strategy.id {
                strategy_id_map.insert(old_id, new_id);
            }
            result.strategies_imported += 1;
        }
    }
    
    // Import trades with duplication check
    for trade in export_data.trades {
        // Check for duplicate trade (same symbol, side, quantity, price, and timestamp)
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM trades WHERE symbol = ?1 AND side = ?2 AND quantity = ?3 AND price = ?4 AND timestamp = ?5",
                params![trade.symbol, trade.side, trade.quantity, trade.price, trade.timestamp],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            result.trades_skipped += 1;
            continue;
        }
        
        // Map strategy_id if it exists
        let mapped_strategy_id = trade.strategy_id.and_then(|id| strategy_id_map.get(&id).copied());
        
        conn.execute(
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
                mapped_strategy_id
            ],
        ).map_err(|e| e.to_string())?;
        
        result.trades_imported += 1;
    }
    
    // Import emotional states
    for emotion in export_data.emotional_states {
        // Check for duplicate (same timestamp, emotion, intensity, trade_id)
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM emotional_states WHERE timestamp = ?1 AND emotion = ?2 AND intensity = ?3 AND (trade_id = ?4 OR (trade_id IS NULL AND ?4 IS NULL))",
                params![emotion.timestamp, emotion.emotion, emotion.intensity, emotion.trade_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            result.emotional_states_skipped += 1;
            continue;
        }
        
        conn.execute(
            "INSERT INTO emotional_states (timestamp, emotion, intensity, notes, trade_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![emotion.timestamp, emotion.emotion, emotion.intensity, emotion.notes, emotion.trade_id],
        ).map_err(|e| e.to_string())?;
        
        result.emotional_states_imported += 1;
    }
    
    // Create a map to track old journal entry IDs to new journal entry IDs
    let mut journal_entry_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    
    // Import journal entries
    for entry in export_data.journal_entries {
        // Check for duplicate by date and title
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM journal_entries WHERE date = ?1 AND title = ?2",
                params![entry.date, entry.title],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            // Get existing ID
            let existing_id: i64 = conn
                .query_row(
                    "SELECT id FROM journal_entries WHERE date = ?1 AND title = ?2",
                    params![entry.date, entry.title],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            
            if let Some(old_id) = entry.id {
                journal_entry_id_map.insert(old_id, existing_id);
            }
            result.journal_entries_skipped += 1;
            continue;
        }
        
        // Map strategy_id if it exists
        let mapped_strategy_id = entry.strategy_id.and_then(|id| strategy_id_map.get(&id).copied());
        
        conn.execute(
            "INSERT INTO journal_entries (date, title, strategy_id) VALUES (?1, ?2, ?3)",
            params![entry.date, entry.title, mapped_strategy_id],
        ).map_err(|e| e.to_string())?;
        
        let new_id = conn.last_insert_rowid();
        if let Some(old_id) = entry.id {
            journal_entry_id_map.insert(old_id, new_id);
        }
        result.journal_entries_imported += 1;
    }
    
    // Import journal trades (build journal_trade_id_map for checklist response trade associations)
    let mut journal_trade_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for trade in export_data.journal_trades {
        // Map journal_entry_id
        let mapped_entry_id = journal_entry_id_map.get(&trade.journal_entry_id).copied();
        
        if mapped_entry_id.is_none() {
            result.journal_trades_skipped += 1;
            continue;
        }
        
        // Check for duplicate (same journal_entry_id, symbol, trade_order)
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM journal_trades WHERE journal_entry_id = ?1 AND symbol = ?2 AND trade_order = ?3",
                params![mapped_entry_id, trade.symbol, trade.trade_order],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            if let (Some(old_id), Some(entry_id)) = (trade.id, mapped_entry_id) {
                if let Ok(existing_id) = conn.query_row(
                    "SELECT id FROM journal_trades WHERE journal_entry_id = ?1 AND symbol = ?2 AND trade_order = ?3",
                    params![entry_id, trade.symbol, trade.trade_order],
                    |row| row.get(0),
                ) {
                    journal_trade_id_map.insert(old_id, existing_id);
                }
            }
            result.journal_trades_skipped += 1;
            continue;
        }
        
        conn.execute(
            "INSERT INTO journal_trades (journal_entry_id, symbol, position, timeframe, entry_type, exit_type, trade, what_went_well, what_could_be_improved, emotional_state, notes, outcome, trade_order) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                mapped_entry_id,
                trade.symbol,
                trade.position,
                trade.timeframe,
                trade.entry_type,
                trade.exit_type,
                trade.trade,
                trade.what_went_well,
                trade.what_could_be_improved,
                trade.emotional_state,
                trade.notes,
                trade.outcome,
                trade.trade_order
            ],
        ).map_err(|e| e.to_string())?;
        
        let new_id = conn.last_insert_rowid();
        if let Some(old_id) = trade.id {
            journal_trade_id_map.insert(old_id, new_id);
        }
        result.journal_trades_imported += 1;
    }
    
    // Create a map to track old checklist item IDs to new checklist item IDs
    let mut checklist_id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    
    // Import strategy checklists
    for checklist in export_data.strategy_checklists {
        // Map strategy_id
        let mapped_strategy_id = strategy_id_map.get(&checklist.strategy_id).copied();
        
        if mapped_strategy_id.is_none() {
            result.checklists_skipped += 1;
            continue;
        }
        
        // Check for duplicate (same strategy_id, item_text, checklist_type, item_order)
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM strategy_checklists WHERE strategy_id = ?1 AND item_text = ?2 AND checklist_type = ?3 AND item_order = ?4",
                params![mapped_strategy_id, checklist.item_text, checklist.checklist_type, checklist.item_order],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            // Get existing ID
            let existing_id: i64 = conn
                .query_row(
                    "SELECT id FROM strategy_checklists WHERE strategy_id = ?1 AND item_text = ?2 AND checklist_type = ?3 AND item_order = ?4",
                    params![mapped_strategy_id, checklist.item_text, checklist.checklist_type, checklist.item_order],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            
            if let Some(old_id) = checklist.id {
                checklist_id_map.insert(old_id, existing_id);
            }
            result.checklists_skipped += 1;
            continue;
        }
        
        // Map parent_id if it exists
        let mapped_parent_id = checklist.parent_id.and_then(|id| checklist_id_map.get(&id).copied());
        
        let checked_int = if checklist.is_checked { 1 } else { 0 };
        conn.execute(
            "INSERT INTO strategy_checklists (strategy_id, item_text, is_checked, item_order, checklist_type, parent_id) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![mapped_strategy_id, checklist.item_text, checked_int, checklist.item_order, checklist.checklist_type, mapped_parent_id],
        ).map_err(|e| e.to_string())?;
        
        let new_id = conn.last_insert_rowid();
        if let Some(old_id) = checklist.id {
            checklist_id_map.insert(old_id, new_id);
        }
        result.checklists_imported += 1;
    }
    
    // Import journal checklist responses
    for response in export_data.journal_checklist_responses {
        // Map journal_entry_id and checklist_item_id
        let mapped_entry_id = journal_entry_id_map.get(&response.journal_entry_id).copied();
        let mapped_checklist_id = checklist_id_map.get(&response.checklist_item_id).copied();
        
        if mapped_entry_id.is_none() || mapped_checklist_id.is_none() {
            result.checklist_responses_skipped += 1;
            continue;
        }
        
        // Check for duplicate
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM journal_checklist_responses WHERE journal_entry_id = ?1 AND checklist_item_id = ?2",
                params![mapped_entry_id, mapped_checklist_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            result.checklist_responses_skipped += 1;
            continue;
        }
        
        let checked_int = if response.is_checked { 1 } else { 0 };
        // Map journal_trade_ids if present (for Analysis/Mantra trade associations)
        let mapped_trade_ids: Option<String> = response.journal_trade_ids.as_ref().and_then(|ids_json| {
            serde_json::from_str::<Vec<i64>>(ids_json).ok().map(|old_ids| {
                let new_ids: Vec<i64> = old_ids.iter()
                    .filter_map(|old_id| journal_trade_id_map.get(old_id).copied())
                    .collect();
                serde_json::to_string(&new_ids).unwrap_or_else(|_| "[]".to_string())
            }).filter(|s| s != "[]")
        });
        let has_trade_ids_col = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('journal_checklist_responses') WHERE name='journal_trade_ids'",
            [],
            |row| row.get::<_, i64>(0),
        ).map(|c| c > 0).unwrap_or(false);
        if has_trade_ids_col {
            conn.execute(
                "INSERT INTO journal_checklist_responses (journal_entry_id, checklist_item_id, is_checked, journal_trade_ids) VALUES (?1, ?2, ?3, ?4)",
                params![mapped_entry_id, mapped_checklist_id, checked_int, mapped_trade_ids],
            ).map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "INSERT INTO journal_checklist_responses (journal_entry_id, checklist_item_id, is_checked) VALUES (?1, ?2, ?3)",
                params![mapped_entry_id, mapped_checklist_id, checked_int],
            ).map_err(|e| e.to_string())?;
        }
        
        result.checklist_responses_imported += 1;
    }
    
    // Import pair notes
    for note in export_data.pair_notes {
        // Check for duplicate
        let existing: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pair_notes WHERE entry_trade_id = ?1 AND exit_trade_id = ?2",
                params![note.entry_trade_id, note.exit_trade_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        
        if existing > 0 {
            result.pair_notes_skipped += 1;
            continue;
        }
        
        conn.execute(
            "INSERT INTO pair_notes (entry_trade_id, exit_trade_id, notes) VALUES (?1, ?2, ?3)",
            params![note.entry_trade_id, note.exit_trade_id, note.notes],
        ).map_err(|e| e.to_string())?;
        
        result.pair_notes_imported += 1;
    }
    
    Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub trades_imported: i32,
    pub trades_skipped: i32,
    pub strategies_imported: i32,
    pub strategies_skipped: i32,
    pub emotional_states_imported: i32,
    pub emotional_states_skipped: i32,
    pub journal_entries_imported: i32,
    pub journal_entries_skipped: i32,
    pub journal_trades_imported: i32,
    pub journal_trades_skipped: i32,
    pub checklists_imported: i32,
    pub checklists_skipped: i32,
    pub checklist_responses_imported: i32,
    pub checklist_responses_skipped: i32,
    pub pair_notes_imported: i32,
    pub pair_notes_skipped: i32,
}

// Version checking and update functionality

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current: String,
    pub latest: String,
    pub is_up_to_date: bool,
    pub download_url: Option<String>,
    /// Asset filename (e.g. TradeButler-1.4.1.msi) for installer temp file; API URL does not contain it.
    pub download_filename: Option<String>,
    pub release_notes: Option<String>,
    pub is_installer: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[allow(dead_code)]
    name: String,
    body: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize, Clone)]
struct GitHubAsset {
    name: String,
    #[allow(dead_code)]
    url: String,
    /// Direct download link (used for reliable downloads; no API redirects)
    browser_download_url: String,
    #[allow(dead_code)]
    content_type: String,
}

// Get current version from package info
fn get_current_version() -> String {
    // Get version from Cargo.toml at compile time
    env!("CARGO_PKG_VERSION").to_string()
}

/// Returns the app version (from Cargo.toml at build time). Used by the UI footer and as single source of truth.
#[tauri::command]
pub fn get_app_version() -> String {
    get_current_version()
}

/// Installer type for Windows: NSIS (*-setup.exe) or MSI (.msi). Used to offer the same type on update.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsInstallerType {
    Nsis,
    Msi,
    Unknown,
}

// Detect if running as installer or portable
fn is_installer_version() -> bool {
    // On Windows, check if running from Program Files or AppData (installer) vs portable
    #[cfg(windows)]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let exe_str = exe_path.to_string_lossy().to_lowercase();
            // Program Files (any variant), or AppData\Local (common for NSIS current-user installs)
            if exe_str.contains("program files") || exe_str.contains("programfiles") {
                return true;
            }
            if exe_str.contains("\\appdata\\local\\") || exe_str.contains("/appdata/local/") {
                return true;
            }
        }
    }
    
    #[cfg(not(windows))]
    {
        // On macOS/Linux, check if in /Applications or /usr/local (installer) vs current dir (portable)
        if let Ok(exe_path) = std::env::current_exe() {
            let exe_str = exe_path.to_string_lossy();
            return exe_str.contains("/Applications/") || exe_str.contains("/usr/local/");
        }
    }
    
    false
}

/// On Windows, detect whether the current install is NSIS or MSI so we can offer the same installer type on update.
/// NSIS leaves an Uninstall*.exe in the app directory; MSI does not.
#[cfg(windows)]
fn windows_installer_type() -> WindowsInstallerType {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.starts_with("uninstall") && name.ends_with(".exe") {
                        return WindowsInstallerType::Nsis;
                    }
                }
            }
        }
    }
    // If we're in Program Files and there's no Uninstall exe, assume MSI (or default to MSI for "unknown").
    if is_installer_version() {
        WindowsInstallerType::Msi
    } else {
        WindowsInstallerType::Unknown
    }
}

#[cfg(not(windows))]
fn windows_installer_type() -> WindowsInstallerType {
    WindowsInstallerType::Unknown
}

// Compare version strings (simple semantic version comparison)
fn compare_versions(current: &str, latest: &str) -> std::cmp::Ordering {
    let current_parts: Vec<u32> = current
        .trim_start_matches('v')
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    
    let latest_parts: Vec<u32> = latest
        .trim_start_matches('v')
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    
    for (c, l) in current_parts.iter().zip(latest_parts.iter()) {
        match c.cmp(l) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    
    current_parts.len().cmp(&latest_parts.len())
}

#[tauri::command]
pub async fn check_version() -> Result<VersionInfo, String> {
    let current_version = get_current_version();
    // On Windows: treat as installer if in Program Files OR if NSIS (Uninstall exe in same dir), so custom install paths still get installer updates
    let is_installer = {
        let base = is_installer_version();
        #[cfg(windows)]
        {
            base || (windows_installer_type() == WindowsInstallerType::Nsis)
        }
        #[cfg(not(windows))]
        {
            base
        }
    };
    
    // GitHub repository - update this to your actual repo
    // For now, using a placeholder - you'll need to replace with your actual GitHub repo
    let repo_owner = "BMOandShiro"; // Update this
    let repo_name = "TradeButler"; // Update this
    let api_url = format!("https://api.github.com/repos/{}/{}/releases/latest", repo_owner, repo_name);
    
    eprintln!("[Version Check] Starting version check...");
    eprintln!("[Version Check] Current version: {}", current_version);
    eprintln!("[Version Check] Is installer: {}", is_installer);
    #[cfg(windows)]
    eprintln!("[Version Check] Windows installer type: {:?}", windows_installer_type());
    eprintln!("[Version Check] API URL: {}", api_url);
    
    let client = reqwest::Client::builder()
        .user_agent("TradeButler-Updater/1.0")
        .build()
        .map_err(|e| {
            let err_msg = format!("Failed to create HTTP client: {}", e);
            eprintln!("[Version Check] Error: {}", err_msg);
            err_msg
        })?;
    
    eprintln!("[Version Check] HTTP client created, sending request...");
    
    let response = client
        .get(&api_url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| {
            let err_msg = format!("Failed to fetch release info: {}", e);
            eprintln!("[Version Check] Network error: {}", err_msg);
            err_msg
        })?;
    
    eprintln!("[Version Check] Response status: {}", response.status());
    
    // Handle 404 by trying the releases list endpoint
    let release: GitHubRelease = if response.status().is_success() {
        // Successfully got latest release
        eprintln!("[Version Check] Got latest release, parsing JSON...");
        response.json().await.map_err(|e| {
            let err_msg = format!("Failed to parse release info: {}", e);
            eprintln!("[Version Check] Parse error: {}", err_msg);
            err_msg
        })?
    } else if response.status() == 404 {
        // Latest release endpoint returned 404, try getting the releases list instead
        eprintln!("[Version Check] Latest release endpoint returned 404, trying releases list...");
        let releases_url = format!("https://api.github.com/repos/{}/{}/releases", repo_owner, repo_name);
        
        let releases_response = client
            .get(&releases_url)
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| {
                let err_msg = format!("Failed to fetch releases list: {}", e);
                eprintln!("[Version Check] Network error: {}", err_msg);
                err_msg
            })?;
        
        eprintln!("[Version Check] Releases list response status: {}", releases_response.status());
        
        if !releases_response.status().is_success() {
            let status = releases_response.status();
            let error_text = releases_response.text().await.unwrap_or_else(|_| "Unable to read error response".to_string());
            let err_msg = format!("Repository not found or has no releases. GitHub API returned status {}: {}\n\nPlease verify:\n1. The repository {}/{} exists on GitHub\n2. The repository has at least one release published\n3. The repository is public (or you have access if it's private)", status, error_text, repo_owner, repo_name);
            eprintln!("[Version Check] API error: {}", err_msg);
            return Err(err_msg);
        }
        
        #[derive(Debug, Deserialize)]
        struct GitHubReleaseListItem {
            tag_name: String,
            name: String,
            body: Option<String>,
            assets: Vec<GitHubAsset>,
            draft: bool,
            prerelease: bool,
        }
        
        let releases_list: Vec<GitHubReleaseListItem> = releases_response.json().await.map_err(|e| {
            let err_msg = format!("Failed to parse releases list: {}", e);
            eprintln!("[Version Check] Parse error: {}", err_msg);
            err_msg
        })?;
        
        eprintln!("[Version Check] Found {} releases", releases_list.len());
        
        if releases_list.is_empty() {
            return Err(format!("Repository {}/{} exists but has no releases published yet.", repo_owner, repo_name));
        }
        
        // Find the first non-draft, non-prerelease release, or just the first one
        let latest_release = releases_list.iter()
            .find(|r| !r.draft && !r.prerelease)
            .or_else(|| releases_list.first())
            .ok_or_else(|| "No valid releases found".to_string())?;
        
        eprintln!("[Version Check] Using release: {}", latest_release.tag_name);
        
        // Convert to GitHubRelease format
        GitHubRelease {
            tag_name: latest_release.tag_name.clone(),
            name: latest_release.name.clone(),
            body: latest_release.body.clone(),
            assets: latest_release.assets.clone(),
        }
    } else {
        // Other error status
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unable to read error response".to_string());
        let err_msg = format!("GitHub API returned status {}: {}", status, error_text);
        eprintln!("[Version Check] API error: {}", err_msg);
        return Err(err_msg);
    };
    
    eprintln!("[Version Check] Release tag: {}", release.tag_name);
    
    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let is_up_to_date = compare_versions(&current_version, &latest_version) != std::cmp::Ordering::Less;
    
    eprintln!("[Version Check] Latest version: {}", latest_version);
    eprintln!("[Version Check] Is up to date: {}", is_up_to_date);
    
    // Find appropriate download asset (use API url for reliable binary download)
    let mut download_url: Option<String> = None;
    let mut download_filename: Option<String> = None;
    
    // Use browser_download_url for downloads: direct link, no API redirects or Accept header needed (more reliable for public repos)
    #[cfg(windows)]
    {
        let installer_type = windows_installer_type();
        if is_installer {
            // Prefer the same installer type as current install so update installs in place (NSIS->NSIS, MSI->MSI).
            // NSIS bundles are *-setup.exe or *installer*.exe; MSI is *.msi. Portable .exe has no "setup"/"installer".
            let is_nsis_asset = |name: &str| {
                name.ends_with(".exe") && (name.to_lowercase().contains("setup") || name.to_lowercase().contains("installer"))
            };
            let is_msi_asset = |name: &str| name.to_lowercase().ends_with(".msi");
            let mut nsis_url: Option<(String, String)> = None;
            let mut msi_url: Option<(String, String)> = None;
            for asset in &release.assets {
                let name = asset.name.as_str();
                if is_nsis_asset(name) {
                    nsis_url.get_or_insert_with(|| (asset.browser_download_url.clone(), asset.name.clone()));
                } else if is_msi_asset(name) {
                    msi_url.get_or_insert_with(|| (asset.browser_download_url.clone(), asset.name.clone()));
                }
            }
            match installer_type {
                WindowsInstallerType::Nsis => {
                    if let Some((url, filename)) = nsis_url {
                        download_url = Some(url);
                        download_filename = Some(filename);
                    } else if let Some((url, filename)) = msi_url {
                        download_url = Some(url);
                        download_filename = Some(filename);
                    }
                }
                WindowsInstallerType::Msi | WindowsInstallerType::Unknown => {
                    if let Some((url, filename)) = msi_url {
                        download_url = Some(url);
                        download_filename = Some(filename);
                    } else if let Some((url, filename)) = nsis_url {
                        download_url = Some(url);
                        download_filename = Some(filename);
                    }
                }
            }
            eprintln!("[Version Check] Installer branch: chosen asset = {:?}", download_filename);
        } else {
            // Portable: only the single .exe that is NOT an installer (no "setup", no "installer", not .msi)
            for asset in &release.assets {
                let name = asset.name.to_lowercase();
                if name.ends_with(".exe") && !name.contains("setup") && !name.contains("installer") {
                    download_url = Some(asset.browser_download_url.clone());
                    download_filename = Some(asset.name.clone());
                    break;
                }
            }
            eprintln!("[Version Check] Portable branch: chosen asset = {:?}", download_filename);
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        if is_installer {
            // Look for .dmg
            for asset in &release.assets {
                if asset.name.ends_with(".dmg") {
                    download_url = Some(asset.browser_download_url.clone());
                    download_filename = Some(asset.name.clone());
                    break;
                }
            }
        } else {
            // Look for .app bundle
            for asset in &release.assets {
                if asset.name.ends_with(".app") || asset.name.ends_with(".app.tar.gz") {
                    download_url = Some(asset.browser_download_url.clone());
                    download_filename = Some(asset.name.clone());
                    break;
                }
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        if is_installer {
            // Look for .deb
            for asset in &release.assets {
                if asset.name.ends_with(".deb") {
                    download_url = Some(asset.browser_download_url.clone());
                    download_filename = Some(asset.name.clone());
                    break;
                }
            }
        } else {
            // Look for AppImage
            for asset in &release.assets {
                if asset.name.ends_with(".AppImage") {
                    download_url = Some(asset.browser_download_url.clone());
                    download_filename = Some(asset.name.clone());
                    break;
                }
            }
        }
    }
    
    Ok(VersionInfo {
        current: current_version,
        latest: latest_version,
        is_up_to_date,
        download_url,
        download_filename,
        release_notes: release.body,
        is_installer,
    })
}

#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
pub async fn download_portable_update(download_url: String, file_path: String) -> Result<(), String> {
    let file_path = file_path.trim().to_string();
    if file_path.is_empty() {
        return Err("Save path is empty".to_string());
    }
    eprintln!("[Update] Downloading from: {}...", &download_url[..download_url.len().min(80)]);
    eprintln!("[Update] Saving to: {}", file_path);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::default())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client.get(&download_url);
    if download_url.contains("api.github.com/repos/") && download_url.contains("/assets/") {
        request = request.header("Accept", "application/octet-stream");
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Network error: {}. Check your connection and try again.", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| String::new());
        let detail = body.trim();
        let detail = if detail.len() > 300 { &detail[..300] } else { detail };
        let msg = if status.as_u16() == 403 {
            format!("Download blocked (403). {} If this keeps happening, download the update from the GitHub release page.", detail)
        } else {
            format!("Download failed ({}): {}", status, if detail.is_empty() { "no details" } else { detail })
        };
        return Err(msg);
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    let path = std::path::Path::new(&file_path);
    fs::write(path, bytes.as_ref())
        .map_err(|e| format!("Failed to save file to {}: {}. Try a different folder (e.g. Desktop or Downloads).", file_path, e))?;
    
    // On Unix systems, make the file executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755); // rwxr-xr-x
        fs::set_permissions(path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn download_and_install_update(download_url: String, download_filename: Option<String>) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::default())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client.get(&download_url);
    if download_url.contains("api.github.com/repos/") && download_url.contains("/assets/") {
        request = request.header("Accept", "application/octet-stream");
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Network error: {}. Check your connection and try again.", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| String::new());
        let detail = body.trim();
        let detail = if detail.len() > 300 { &detail[..300] } else { detail };
        let msg = if status.as_u16() == 403 {
            format!("Download blocked (403). {} If this keeps happening, download the update from the GitHub release page.", detail)
        } else {
            format!("Download failed ({}): {}", status, if detail.is_empty() { "no details" } else { detail })
        };
        return Err(msg);
    }
    
    // Get filename (API URL has no extension; use provided name when available)
    let filename = download_filename
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| download_url.split('/').last().unwrap_or("TradeButler-update.msi").to_string());
    
    // Get temp directory
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&filename);
    
    // Download file
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;
    
    fs::write(&file_path, bytes)
        .map_err(|e| format!("Failed to save file: {}", e))?;
    
    // Launch installer: MSI via msiexec (updates in place); NSIS by running the .exe (updates in place in same location)
    #[cfg(windows)]
    {
        let path_str = file_path.to_string_lossy();
        if filename.to_lowercase().ends_with(".msi") {
            Command::new("msiexec")
                .args(&["/i", path_str.as_ref()])
                .spawn()
                .map_err(|e| format!("Failed to launch MSI installer: {}", e))?;
        } else if filename.to_lowercase().ends_with(".exe") {
            Command::new(path_str.as_ref())
                .spawn()
                .map_err(|e| format!("Failed to launch NSIS installer: {}", e))?;
        } else {
            return Err("Unsupported installer format. Expected .msi or .exe.".to_string());
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        // For macOS, open the DMG
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open DMG: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        // For Linux, use appropriate package manager
        if filename.ends_with(".deb") {
            Command::new("sudo")
                .args(&["dpkg", "-i", file_path.to_string_lossy().as_ref()])
                .spawn()
                .map_err(|e| format!("Failed to install package: {}", e))?;
        }
    }
    
    Ok(())
}

// ============================================================================
// NEWS SYSTEM COMMANDS
// ============================================================================

/// Fetch news for a single symbol from Yahoo Finance RSS feed
#[tauri::command]
pub async fn fetch_news(symbol: String) -> Result<Vec<NewsItem>, String> {
    let url = format!(
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US",
        symbol.to_uppercase()
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .header("Accept", "application/rss+xml, application/xml, text/xml")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to fetch news: {}", response.status()));
    }
    
    let xml_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    // Parse RSS XML manually (simple parsing for Yahoo Finance RSS format)
    let mut news_items = Vec::new();
    
    // Split by <item> tags
    for item in xml_text.split("<item>").skip(1) {
        if let Some(end_idx) = item.find("</item>") {
            let item_xml = &item[..end_idx];
            
            // Extract fields with helper function
            let title = extract_xml_field(item_xml, "title").unwrap_or_default();
            let link = extract_xml_field(item_xml, "link").unwrap_or_default();
            let guid = extract_xml_field(item_xml, "guid").unwrap_or_else(|| link.clone());
            let pub_date = extract_xml_field(item_xml, "pubDate").unwrap_or_default();
            let source = extract_xml_field(item_xml, "source").unwrap_or_else(|| "Yahoo Finance".to_string());
            
            if !title.is_empty() && !link.is_empty() {
                // Convert pub_date to ISO format
                let iso_date = parse_rss_date(&pub_date).unwrap_or(pub_date);
                
                news_items.push(NewsItem {
                    id: guid,
                    symbol: symbol.to_uppercase(),
                    title: decode_html_entities(&title),
                    link,
                    pub_date: iso_date,
                    source: decode_html_entities(&source),
                });
            }
        }
    }
    
    Ok(news_items)
}

/// Fetch news for multiple symbols
#[tauri::command]
pub async fn fetch_news_batch(symbols: Vec<String>) -> Result<Vec<NewsItem>, String> {
    let mut all_news = Vec::new();
    
    for symbol in symbols {
        match fetch_news(symbol).await {
            Ok(news) => all_news.extend(news),
            Err(e) => eprintln!("Failed to fetch news for symbol: {}", e),
        }
    }
    
    // Sort by date descending
    all_news.sort_by(|a, b| b.pub_date.cmp(&a.pub_date));
    
    // Remove duplicates by ID
    let mut seen_ids = std::collections::HashSet::new();
    all_news.retain(|item| seen_ids.insert(item.id.clone()));
    
    Ok(all_news)
}

/// Helper function to get Yahoo Finance crumb and cookie for authenticated requests
async fn get_yahoo_auth() -> Result<(String, String), String> {
    // Build a cookie-storing client
    let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
    let client: reqwest::Client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .cookie_store(true)
        .cookie_provider(jar.clone())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Step 1: Visit Yahoo Finance to establish session cookies
    let consent_response: reqwest::Response = client
        .get("https://finance.yahoo.com/")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Yahoo Finance: {}", e))?;
    
    if !consent_response.status().is_success() && consent_response.status() != reqwest::StatusCode::FOUND {
        return Err(format!("Yahoo Finance returned: {}", consent_response.status()));
    }
    
    // Step 2: Fetch the crumb from the dedicated crumb endpoint
    let crumb_response: reqwest::Response = client
        .get("https://query1.finance.yahoo.com/v1/test/getcrumb")
        .header("Accept", "*/*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://finance.yahoo.com/")
        .send()
        .await
        .map_err(|e| format!("Failed to get crumb: {}", e))?;
    
    if !crumb_response.status().is_success() {
        return Err(format!("Crumb request returned: {}", crumb_response.status()));
    }
    
    let crumb: String = crumb_response.text().await
        .map_err(|e| format!("Failed to read crumb: {}", e))?;
    
    // Extract cookies from jar
    let url = reqwest::Url::parse("https://finance.yahoo.com/").unwrap();
    let cookie_str: String = jar.cookies(&url)
        .map(|header| header.to_str().unwrap_or("").to_string())
        .unwrap_or_default();
    
    if crumb.is_empty() {
        return Err("Empty crumb received".to_string());
    }
    
    Ok((cookie_str, crumb))
}

/// Fetch calendar events (earnings, dividends) for a symbol from Yahoo Finance
#[tauri::command]
pub async fn fetch_calendar_events(symbol: String) -> Result<Vec<CalendarEvent>, String> {
    let symbol_upper = symbol.to_uppercase();
    
    // Try to get authenticated session first
    let (cookie, crumb) = match get_yahoo_auth().await {
        Ok((c, cr)) => (Some(c), Some(cr)),
        Err(e) => {
            eprintln!("Failed to get Yahoo auth (will try without): {}", e);
            (None, None)
        }
    };
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // Build URL with crumb if available
    let url = if let Some(ref cr) = crumb {
        format!(
            "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=calendarEvents,summaryDetail&crumb={}",
            symbol_upper, cr
        )
    } else {
        format!(
            "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=calendarEvents,summaryDetail",
            symbol_upper
        )
    };
    
    let mut request = client
        .get(&url)
        .header("Accept", "application/json")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://finance.yahoo.com/")
        .header("Origin", "https://finance.yahoo.com");
    
    // Add cookie header if available
    if let Some(ref c) = cookie {
        request = request.header("Cookie", c.as_str());
    }
    
    let response = request.send().await;
    
    // If quoteSummary fails (401, etc), return empty events gracefully
    // News feed will still work, just without calendar events
    let response = match response {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            eprintln!("Yahoo quoteSummary returned {} for {}", r.status(), symbol_upper);
            return Ok(Vec::new());
        }
        Err(e) => {
            eprintln!("Network error fetching calendar for {}: {}", symbol_upper, e);
            return Ok(Vec::new());
        }
    };
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    let mut events = Vec::new();
    let symbol_upper = symbol.to_uppercase();
    
    // Extract calendar events from response
    if let Some(result) = data.get("quoteSummary")
        .and_then(|q| q.get("result"))
        .and_then(|r| r.get(0)) 
    {
        // Earnings dates
        if let Some(calendar) = result.get("calendarEvents") {
            // Earnings date
            if let Some(earnings) = calendar.get("earnings") {
                if let Some(earnings_date) = earnings.get("earningsDate")
                    .and_then(|d| d.get(0))
                    .and_then(|d| d.get("fmt"))
                    .and_then(|d| d.as_str())
                {
                    let eps_estimate = earnings.get("earningsAverage")
                        .and_then(|e| e.get("fmt"))
                        .and_then(|e| e.as_str())
                        .map(|e| format!("EPS Est: {}", e));
                    
                    events.push(CalendarEvent {
                        date: earnings_date.to_string(),
                        symbol: Some(symbol_upper.clone()),
                        event_type: "earnings".to_string(),
                        title: format!("{} Earnings", symbol_upper),
                        details: eps_estimate,
                    });
                }
            }
            
            // Ex-dividend date
            if let Some(ex_div) = calendar.get("exDividendDate")
                .and_then(|d| d.get("fmt"))
                .and_then(|d| d.as_str())
            {
                let div_rate = calendar.get("dividendDate")
                    .and_then(|d| d.get("fmt"))
                    .and_then(|d| d.as_str())
                    .map(|d| format!("Pay date: {}", d));
                
                events.push(CalendarEvent {
                    date: ex_div.to_string(),
                    symbol: Some(symbol_upper.clone()),
                    event_type: "dividend_ex".to_string(),
                    title: format!("{} Ex-Dividend", symbol_upper),
                    details: div_rate,
                });
            }
        }
        
        // Dividend info from summaryDetail
        if let Some(summary) = result.get("summaryDetail") {
            if let Some(div_date) = summary.get("exDividendDate")
                .and_then(|d| d.get("fmt"))
                .and_then(|d| d.as_str())
            {
                // Only add if not already added from calendarEvents
                let already_has = events.iter().any(|e| 
                    e.event_type == "dividend_ex" && 
                    e.symbol.as_ref() == Some(&symbol_upper) &&
                    e.date == div_date
                );
                
                if !already_has {
                    let div_rate = summary.get("dividendRate")
                        .and_then(|r| r.get("fmt"))
                        .and_then(|r| r.as_str())
                        .map(|r| format!("Dividend: {}", r));
                    
                    events.push(CalendarEvent {
                        date: div_date.to_string(),
                        symbol: Some(symbol_upper.clone()),
                        event_type: "dividend_ex".to_string(),
                        title: format!("{} Ex-Dividend", symbol_upper),
                        details: div_rate,
                    });
                }
            }
        }
    }
    
    Ok(events)
}

/// Fetch calendar events for multiple symbols
#[tauri::command]
pub async fn fetch_calendar_events_batch(symbols: Vec<String>) -> Result<Vec<CalendarEvent>, String> {
    let mut all_events = Vec::new();
    
    for symbol in symbols {
        match fetch_calendar_events(symbol).await {
            Ok(events) => all_events.extend(events),
            Err(e) => eprintln!("Failed to fetch calendar events: {}", e),
        }
    }
    
    // Sort by date
    all_events.sort_by(|a, b| a.date.cmp(&b.date));
    
    Ok(all_events)
}

/// Get economic calendar events for a given year/month
/// Returns major economic events like FOMC, CPI, GDP, Jobs reports
#[tauri::command]
pub fn get_economic_calendar(year: i32, month: u32) -> Result<Vec<EconomicEvent>, String> {
    // Static economic calendar data
    // In a production app, this could be fetched from an API or updated periodically
    let events = get_economic_events_for_month(year, month);
    Ok(events)
}

/// Get all economic events for a date range
#[tauri::command]
pub fn get_economic_calendar_range(start_date: String, end_date: String) -> Result<Vec<EconomicEvent>, String> {
    // Parse dates
    let start = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid start date: {}", e))?;
    let end = chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid end date: {}", e))?;
    
    let mut all_events = Vec::new();
    let mut current = start;
    
    while current <= end {
        let events = get_economic_events_for_month(current.year(), current.month());
        for event in events {
            if let Ok(event_date) = chrono::NaiveDate::parse_from_str(&event.date, "%Y-%m-%d") {
                if event_date >= start && event_date <= end {
                    all_events.push(event);
                }
            }
        }
        // Move to next month
        current = if current.month() == 12 {
            chrono::NaiveDate::from_ymd_opt(current.year() + 1, 1, 1).unwrap_or(current)
        } else {
            chrono::NaiveDate::from_ymd_opt(current.year(), current.month() + 1, 1).unwrap_or(current)
        };
    }
    
    // Sort and deduplicate
    all_events.sort_by(|a, b| a.date.cmp(&b.date));
    all_events.dedup_by(|a, b| a.date == b.date && a.event_type == b.event_type);
    
    Ok(all_events)
}

// Helper function to extract XML field content
fn extract_xml_field(xml: &str, field: &str) -> Option<String> {
    let start_tag = format!("<{}>", field);
    let end_tag = format!("</{}>", field);
    
    // Try CDATA first
    let cdata_start = format!("<{}><![CDATA[", field);
    if let Some(start_idx) = xml.find(&cdata_start) {
        let content_start = start_idx + cdata_start.len();
        if let Some(end_idx) = xml[content_start..].find("]]>") {
            return Some(xml[content_start..content_start + end_idx].to_string());
        }
    }
    
    // Regular tag
    if let Some(start_idx) = xml.find(&start_tag) {
        let content_start = start_idx + start_tag.len();
        if let Some(end_idx) = xml[content_start..].find(&end_tag) {
            return Some(xml[content_start..content_start + end_idx].to_string());
        }
    }
    
    None
}

// Helper function to decode common HTML entities
fn decode_html_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

// Helper function to parse RSS date format to ISO
fn parse_rss_date(date_str: &str) -> Option<String> {
    // RSS date format: "Mon, 10 Mar 2025 14:30:00 +0000"
    // Convert to ISO format: "2025-03-10T14:30:00Z"
    
    use chrono::DateTime;
    
    // Try parsing RFC 2822 format (common RSS date format)
    if let Ok(dt) = DateTime::parse_from_rfc2822(date_str) {
        return Some(dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
    }
    
    // Try parsing RFC 3339 (ISO 8601)
    if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
        return Some(dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
    }
    
    None
}

// Static economic calendar data generator
fn get_economic_events_for_month(year: i32, month: u32) -> Vec<EconomicEvent> {
    let mut events = Vec::new();
    
    // FOMC Meeting Dates (8 meetings per year, typically 2-day meetings ending on Wednesday)
    // 2025 FOMC dates
    let fomc_dates_2025 = vec![
        ("2025-01-29", "FOMC Meeting"),
        ("2025-03-19", "FOMC Meeting"),
        ("2025-05-07", "FOMC Meeting"),
        ("2025-06-18", "FOMC Meeting"),
        ("2025-07-30", "FOMC Meeting"),
        ("2025-09-17", "FOMC Meeting"),
        ("2025-11-05", "FOMC Meeting"),
        ("2025-12-17", "FOMC Meeting"),
    ];
    
    // 2026 FOMC dates (projected)
    let fomc_dates_2026 = vec![
        ("2026-01-28", "FOMC Meeting"),
        ("2026-03-18", "FOMC Meeting"),
        ("2026-05-06", "FOMC Meeting"),
        ("2026-06-17", "FOMC Meeting"),
        ("2026-07-29", "FOMC Meeting"),
        ("2026-09-16", "FOMC Meeting"),
        ("2026-11-04", "FOMC Meeting"),
        ("2026-12-16", "FOMC Meeting"),
    ];
    
    let fomc_dates = if year == 2025 { &fomc_dates_2025 } else { &fomc_dates_2026 };
    
    for (date, title) in fomc_dates {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
            if d.year() == year && d.month() == month {
                events.push(EconomicEvent {
                    date: date.to_string(),
                    event_type: "fomc".to_string(),
                    title: title.to_string(),
                    description: Some("Federal Reserve interest rate decision and policy statement".to_string()),
                    importance: "high".to_string(),
                });
            }
        }
    }
    
    // CPI (Consumer Price Index) - Usually released around 10th-14th of month
    // Approximate dates based on typical release schedule
    let cpi_day = match month {
        1 => 15, 2 => 12, 3 => 12, 4 => 10, 5 => 13, 6 => 11,
        7 => 11, 8 => 14, 9 => 11, 10 => 10, 11 => 13, 12 => 11,
        _ => 12,
    };
    
    if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, cpi_day) {
        events.push(EconomicEvent {
            date: date.format("%Y-%m-%d").to_string(),
            event_type: "cpi".to_string(),
            title: "CPI Report".to_string(),
            description: Some("Consumer Price Index - measures inflation".to_string()),
            importance: "high".to_string(),
        });
    }
    
    // Jobs Report (Non-Farm Payrolls) - First Friday of month
    if let Some(first_day) = chrono::NaiveDate::from_ymd_opt(year, month, 1) {
        let weekday = first_day.weekday();
        let days_to_friday = match weekday {
            chrono::Weekday::Sat => 6,
            chrono::Weekday::Sun => 5,
            chrono::Weekday::Mon => 4,
            chrono::Weekday::Tue => 3,
            chrono::Weekday::Wed => 2,
            chrono::Weekday::Thu => 1,
            chrono::Weekday::Fri => 0,
        };
        let first_friday = first_day + chrono::Duration::days(days_to_friday);
        
        events.push(EconomicEvent {
            date: first_friday.format("%Y-%m-%d").to_string(),
            event_type: "jobs".to_string(),
            title: "Jobs Report (NFP)".to_string(),
            description: Some("Non-Farm Payrolls - employment situation report".to_string()),
            importance: "high".to_string(),
        });
    }
    
    // GDP (Quarterly, released end of month following quarter end)
    // Q1 GDP in late April, Q2 in late July, Q3 in late October, Q4 in late January
    let gdp_month = match month {
        1 => Some(("Q4 GDP (Advance)", 30)),
        4 => Some(("Q1 GDP (Advance)", 25)),
        7 => Some(("Q2 GDP (Advance)", 25)),
        10 => Some(("Q3 GDP (Advance)", 25)),
        _ => None,
    };
    
    if let Some((title, day)) = gdp_month {
        if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
            events.push(EconomicEvent {
                date: date.format("%Y-%m-%d").to_string(),
                event_type: "gdp".to_string(),
                title: title.to_string(),
                description: Some("Gross Domestic Product growth rate".to_string()),
                importance: "high".to_string(),
            });
        }
    }
    
    // PPI (Producer Price Index) - Usually day after or same week as CPI
    let ppi_day = cpi_day + 1;
    if ppi_day <= 28 {
        if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, ppi_day) {
            events.push(EconomicEvent {
                date: date.format("%Y-%m-%d").to_string(),
                event_type: "ppi".to_string(),
                title: "PPI Report".to_string(),
                description: Some("Producer Price Index - wholesale inflation".to_string()),
                importance: "medium".to_string(),
            });
        }
    }
    
    // Retail Sales - Usually mid-month
    if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, 16) {
        events.push(EconomicEvent {
            date: date.format("%Y-%m-%d").to_string(),
            event_type: "retail_sales".to_string(),
            title: "Retail Sales".to_string(),
            description: Some("Monthly retail sales data".to_string()),
            importance: "medium".to_string(),
        });
    }
    
    events
}

// ============================================================================
// Finnhub API Integration
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubEarning {
    pub date: String,
    pub symbol: String,
    pub eps_estimate: Option<f64>,
    pub eps_actual: Option<f64>,
    pub revenue_estimate: Option<f64>,
    pub revenue_actual: Option<f64>,
    pub hour: Option<String>, // "bmo" (before market open), "amc" (after market close)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubNews {
    pub id: i64,
    pub headline: String,
    pub summary: String,
    pub source: String,
    pub url: String,
    pub datetime: i64, // Unix timestamp
    pub related: String, // Symbol
    pub category: String,
    pub sentiment: Option<f64>, // -1 to 1 sentiment score
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubBasicFinancials {
    pub symbol: String,
    pub pe_ratio: Option<f64>,
    pub eps: Option<f64>,
    pub market_cap: Option<f64>,
    pub week_52_high: Option<f64>,
    pub week_52_low: Option<f64>,
    pub beta: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub price_to_book: Option<f64>,
    pub debt_to_equity: Option<f64>,
    pub revenue_per_share: Option<f64>,
    pub return_on_equity: Option<f64>,
    // Additional metrics
    pub gross_margin: Option<f64>,
    pub operating_margin: Option<f64>,
    pub profit_margin: Option<f64>,
    pub current_ratio: Option<f64>,
    pub quick_ratio: Option<f64>,
    pub peg_ratio: Option<f64>,
    pub price_to_sales: Option<f64>,
    pub free_cash_flow_per_share: Option<f64>,
    pub revenue_growth_3y: Option<f64>,
    pub revenue_growth_5y: Option<f64>,
    pub eps_growth_3y: Option<f64>,
    pub eps_growth_5y: Option<f64>,
    pub dividend_growth_5y: Option<f64>,
    pub payout_ratio: Option<f64>,
    pub book_value_per_share: Option<f64>,
    pub tangible_book_value_per_share: Option<f64>,
    pub enterprise_value: Option<f64>,
    pub ev_to_ebitda: Option<f64>,
    pub forward_pe: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubCompanyProfile {
    pub symbol: String,
    pub name: Option<String>,
    pub country: Option<String>,
    pub currency: Option<String>,
    pub exchange: Option<String>,
    pub industry: Option<String>,
    pub sector: Option<String>,
    pub ipo: Option<String>,
    pub market_cap: Option<f64>,
    pub shares_outstanding: Option<f64>,
    pub logo: Option<String>,
    pub phone: Option<String>,
    pub weburl: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubEarningsSurprise {
    pub symbol: String,
    pub period: String,
    pub actual: Option<f64>,
    pub estimate: Option<f64>,
    pub surprise: Option<f64>,
    pub surprise_percent: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DividendInfo {
    pub symbol: String,
    pub ex_date: Option<String>,
    pub payment_date: Option<String>,
    pub record_date: Option<String>,
    pub declaration_date: Option<String>,
    pub amount: Option<f64>,
    pub frequency: Option<String>,
    pub dividend_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InsiderTransaction {
    pub symbol: String,
    pub name: Option<String>,
    pub share: Option<i64>,
    pub change: Option<i64>,
    pub filing_date: Option<String>,
    pub transaction_date: Option<String>,
    pub transaction_code: Option<String>,
    pub transaction_price: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecFiling {
    pub symbol: String,
    pub access_number: Option<String>,
    pub form: Option<String>,
    pub filed_date: Option<String>,
    pub accepted_date: Option<String>,
    pub report_url: Option<String>,
    pub filing_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpoEvent {
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub date: Option<String>,
    pub exchange: Option<String>,
    pub price: Option<String>,
    pub shares: Option<f64>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PricePerformance {
    pub symbol: String,
    pub current_price: Option<f64>,
    pub change_1d: Option<f64>,
    pub change_1d_percent: Option<f64>,
    pub change_1w: Option<f64>,
    pub change_1w_percent: Option<f64>,
    pub change_1m: Option<f64>,
    pub change_1m_percent: Option<f64>,
    pub change_3m: Option<f64>,
    pub change_3m_percent: Option<f64>,
    pub change_ytd: Option<f64>,
    pub change_ytd_percent: Option<f64>,
    pub change_1y: Option<f64>,
    pub change_1y_percent: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShortInterest {
    pub symbol: String,
    pub short_interest: Option<i64>,
    pub short_ratio: Option<f64>,
    pub short_percent_of_float: Option<f64>,
    pub shares_short_prior_month: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubPriceTarget {
    pub symbol: String,
    pub target_high: Option<f64>,
    pub target_low: Option<f64>,
    pub target_mean: Option<f64>,
    pub target_median: Option<f64>,
    pub last_updated: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubRecommendation {
    pub symbol: String,
    pub period: String,
    pub strong_buy: i32,
    pub buy: i32,
    pub hold: i32,
    pub sell: i32,
    pub strong_sell: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinnhubEconomicEvent {
    pub date: String,
    pub country: String,
    pub event: String,
    pub impact: String,
    pub actual: Option<f64>,
    pub estimate: Option<f64>,
    pub prev: Option<f64>,
    pub unit: Option<String>,
}

/// Test Finnhub API connection
#[tauri::command]
pub async fn test_finnhub_connection(api_key: String) -> Result<bool, String> {
    let url = format!(
        "https://finnhub.io/api/v1/quote?symbol=AAPL&token={}",
        api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if response.status().is_success() {
        let data: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        
        // Check if we got valid data (not an error response)
        if data.get("error").is_some() {
            return Ok(false);
        }
        
        // If we got a current price, the API key is valid
        if data.get("c").is_some() {
            return Ok(true);
        }
    }
    
    Ok(false)
}

/// Fetch earnings calendar from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_earnings(
    api_key: String,
    from_date: String,
    to_date: String,
    symbol: Option<String>,
) -> Result<Vec<FinnhubEarning>, String> {
    let mut url = format!(
        "https://finnhub.io/api/v1/calendar/earnings?from={}&to={}&token={}",
        from_date, to_date, api_key
    );
    
    if let Some(sym) = &symbol {
        url = format!("{}&symbol={}", url, sym.to_uppercase());
    }
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let mut earnings = Vec::new();
    
    if let Some(earnings_calendar) = data.get("earningsCalendar").and_then(|e| e.as_array()) {
        for item in earnings_calendar {
            let earning = FinnhubEarning {
                date: item.get("date").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                symbol: item.get("symbol").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                eps_estimate: item.get("epsEstimate").and_then(|e| e.as_f64()),
                eps_actual: item.get("epsActual").and_then(|e| e.as_f64()),
                revenue_estimate: item.get("revenueEstimate").and_then(|r| r.as_f64()),
                revenue_actual: item.get("revenueActual").and_then(|r| r.as_f64()),
                hour: item.get("hour").and_then(|h| h.as_str()).map(|s| s.to_string()),
            };
            
            // Filter by symbol if provided
            if symbol.is_none() || earning.symbol.eq_ignore_ascii_case(symbol.as_ref().unwrap()) {
                earnings.push(earning);
            }
        }
    }
    
    Ok(earnings)
}

/// Fetch company news from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_news(
    api_key: String,
    symbol: String,
    from_date: String,
    to_date: String,
) -> Result<Vec<FinnhubNews>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/company-news?symbol={}&from={}&to={}&token={}",
        symbol.to_uppercase(), from_date, to_date, api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let mut news = Vec::new();
    
    if let Some(news_array) = data.as_array() {
        for item in news_array.iter().take(50) { // Limit to 50 news items
            let news_item = FinnhubNews {
                id: item.get("id").and_then(|i| i.as_i64()).unwrap_or(0),
                headline: item.get("headline").and_then(|h| h.as_str()).unwrap_or("").to_string(),
                summary: item.get("summary").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                source: item.get("source").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                url: item.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
                datetime: item.get("datetime").and_then(|d| d.as_i64()).unwrap_or(0),
                related: symbol.to_uppercase(),
                category: item.get("category").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                sentiment: None, // Sentiment requires separate API call
            };
            news.push(news_item);
        }
    }
    
    Ok(news)
}

/// Fetch news for multiple symbols from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_news_batch(
    api_key: String,
    symbols: Vec<String>,
    from_date: String,
    to_date: String,
) -> Result<Vec<FinnhubNews>, String> {
    let mut all_news = Vec::new();
    
    for symbol in symbols {
        match fetch_finnhub_news(api_key.clone(), symbol, from_date.clone(), to_date.clone()).await {
            Ok(news) => all_news.extend(news),
            Err(e) => eprintln!("Failed to fetch news for symbol: {}", e),
        }
    }
    
    // Sort by datetime descending (most recent first)
    all_news.sort_by(|a, b| b.datetime.cmp(&a.datetime));
    
    // Deduplicate by id
    all_news.dedup_by(|a, b| a.id == b.id);
    
    // Limit total news items
    all_news.truncate(100);
    
    Ok(all_news)
}

/// Fetch basic financials from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_basic_financials(
    api_key: String,
    symbol: String,
) -> Result<FinnhubBasicFinancials, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/metric?symbol={}&metric=all&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let metric = data.get("metric").unwrap_or(&serde_json::Value::Null);
    
    Ok(FinnhubBasicFinancials {
        symbol: symbol.to_uppercase(),
        pe_ratio: metric.get("peBasicExclExtraTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("peTTM").and_then(|v| v.as_f64())),
        eps: metric.get("epsBasicExclExtraItemsTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("epsTTM").and_then(|v| v.as_f64())),
        market_cap: metric.get("marketCapitalization").and_then(|v| v.as_f64()),
        week_52_high: metric.get("52WeekHigh").and_then(|v| v.as_f64()),
        week_52_low: metric.get("52WeekLow").and_then(|v| v.as_f64()),
        beta: metric.get("beta").and_then(|v| v.as_f64()),
        dividend_yield: metric.get("dividendYieldIndicatedAnnual").and_then(|v| v.as_f64()),
        price_to_book: metric.get("pbQuarterly").and_then(|v| v.as_f64())
            .or_else(|| metric.get("pbAnnual").and_then(|v| v.as_f64())),
        debt_to_equity: metric.get("totalDebt/totalEquityQuarterly").and_then(|v| v.as_f64()),
        revenue_per_share: metric.get("revenuePerShareTTM").and_then(|v| v.as_f64()),
        return_on_equity: metric.get("roeTTM").and_then(|v| v.as_f64()),
        // Additional metrics
        gross_margin: metric.get("grossMarginTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("grossMarginAnnual").and_then(|v| v.as_f64())),
        operating_margin: metric.get("operatingMarginTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("operatingMarginAnnual").and_then(|v| v.as_f64())),
        profit_margin: metric.get("netProfitMarginTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("netProfitMarginAnnual").and_then(|v| v.as_f64())),
        current_ratio: metric.get("currentRatioQuarterly").and_then(|v| v.as_f64())
            .or_else(|| metric.get("currentRatioAnnual").and_then(|v| v.as_f64())),
        quick_ratio: metric.get("quickRatioQuarterly").and_then(|v| v.as_f64())
            .or_else(|| metric.get("quickRatioAnnual").and_then(|v| v.as_f64())),
        peg_ratio: metric.get("pegRatio").and_then(|v| v.as_f64()),
        price_to_sales: metric.get("psTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("psAnnual").and_then(|v| v.as_f64())),
        free_cash_flow_per_share: metric.get("freeCashFlowPerShareTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("freeCashFlowPerShareAnnual").and_then(|v| v.as_f64())),
        revenue_growth_3y: metric.get("revenueGrowth3Y").and_then(|v| v.as_f64()),
        revenue_growth_5y: metric.get("revenueGrowth5Y").and_then(|v| v.as_f64()),
        eps_growth_3y: metric.get("epsGrowth3Y").and_then(|v| v.as_f64()),
        eps_growth_5y: metric.get("epsGrowth5Y").and_then(|v| v.as_f64()),
        dividend_growth_5y: metric.get("dividendGrowthRate5Y").and_then(|v| v.as_f64()),
        payout_ratio: metric.get("payoutRatioTTM").and_then(|v| v.as_f64())
            .or_else(|| metric.get("payoutRatioAnnual").and_then(|v| v.as_f64())),
        book_value_per_share: metric.get("bookValuePerShareQuarterly").and_then(|v| v.as_f64())
            .or_else(|| metric.get("bookValuePerShareAnnual").and_then(|v| v.as_f64())),
        tangible_book_value_per_share: metric.get("tangibleBookValuePerShareQuarterly").and_then(|v| v.as_f64())
            .or_else(|| metric.get("tangibleBookValuePerShareAnnual").and_then(|v| v.as_f64())),
        enterprise_value: metric.get("enterpriseValue").and_then(|v| v.as_f64()),
        ev_to_ebitda: metric.get("evToEBITDA").and_then(|v| v.as_f64()),
        forward_pe: metric.get("forwardPE").and_then(|v| v.as_f64())
            .or_else(|| metric.get("peNTM").and_then(|v| v.as_f64())),
    })
}

/// Fetch price target from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_price_target(
    api_key: String,
    symbol: String,
) -> Result<FinnhubPriceTarget, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/price-target?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(FinnhubPriceTarget {
        symbol: symbol.to_uppercase(),
        target_high: data.get("targetHigh").and_then(|v| v.as_f64()),
        target_low: data.get("targetLow").and_then(|v| v.as_f64()),
        target_mean: data.get("targetMean").and_then(|v| v.as_f64()),
        target_median: data.get("targetMedian").and_then(|v| v.as_f64()),
        last_updated: data.get("lastUpdated").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

/// Fetch analyst recommendations from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_recommendations(
    api_key: String,
    symbol: String,
) -> Result<Vec<FinnhubRecommendation>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/recommendation?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let mut recommendations = Vec::new();
    
    if let Some(recs_array) = data.as_array() {
        for item in recs_array.iter().take(12) { // Last 12 months of recommendations
            let rec = FinnhubRecommendation {
                symbol: symbol.to_uppercase(),
                period: item.get("period").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                strong_buy: item.get("strongBuy").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                buy: item.get("buy").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                hold: item.get("hold").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                sell: item.get("sell").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                strong_sell: item.get("strongSell").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            };
            recommendations.push(rec);
        }
    }
    
    Ok(recommendations)
}

/// Fetch economic calendar from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_economic_calendar(
    api_key: String,
    from_date: String,
    to_date: String,
) -> Result<Vec<FinnhubEconomicEvent>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/calendar/economic?from={}&to={}&token={}",
        from_date, to_date, api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let mut events = Vec::new();
    
    if let Some(calendar) = data.get("economicCalendar").and_then(|c| c.as_array()) {
        for item in calendar {
            // Filter for US events primarily
            let country = item.get("country").and_then(|c| c.as_str()).unwrap_or("");
            if country != "US" && country != "United States" {
                continue;
            }
            
            let event = FinnhubEconomicEvent {
                date: item.get("time").and_then(|t| t.as_str())
                    .map(|t| t.split('T').next().unwrap_or(t).to_string())
                    .unwrap_or_default(),
                country: country.to_string(),
                event: item.get("event").and_then(|e| e.as_str()).unwrap_or("").to_string(),
                impact: item.get("impact").and_then(|i| i.as_str()).unwrap_or("medium").to_string(),
                actual: item.get("actual").and_then(|a| a.as_f64()),
                estimate: item.get("estimate").and_then(|e| e.as_f64()),
                prev: item.get("prev").and_then(|p| p.as_f64()),
                unit: item.get("unit").and_then(|u| u.as_str()).map(|s| s.to_string()),
            };
            events.push(event);
        }
    }
    
    Ok(events)
}

/// Fetch earnings for multiple symbols from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_earnings_batch(
    api_key: String,
    symbols: Vec<String>,
    from_date: String,
    to_date: String,
) -> Result<Vec<FinnhubEarning>, String> {
    // Fetch all earnings for the date range
    let all_earnings = fetch_finnhub_earnings(api_key, from_date, to_date, None).await?;
    
    // Filter to only include requested symbols
    let symbol_set: std::collections::HashSet<String> = symbols
        .iter()
        .map(|s| s.to_uppercase())
        .collect();
    
    let filtered: Vec<FinnhubEarning> = all_earnings
        .into_iter()
        .filter(|e| symbol_set.contains(&e.symbol.to_uppercase()))
        .collect();
    
    Ok(filtered)
}

/// Fetch company profile from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_company_profile(
    api_key: String,
    symbol: String,
) -> Result<FinnhubCompanyProfile, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/profile2?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    Ok(FinnhubCompanyProfile {
        symbol: symbol.to_uppercase(),
        name: data.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        country: data.get("country").and_then(|v| v.as_str()).map(|s| s.to_string()),
        currency: data.get("currency").and_then(|v| v.as_str()).map(|s| s.to_string()),
        exchange: data.get("exchange").and_then(|v| v.as_str()).map(|s| s.to_string()),
        industry: data.get("finnhubIndustry").and_then(|v| v.as_str()).map(|s| s.to_string()),
        sector: data.get("gsector").and_then(|v| v.as_str()).map(|s| s.to_string()),
        ipo: data.get("ipo").and_then(|v| v.as_str()).map(|s| s.to_string()),
        market_cap: data.get("marketCapitalization").and_then(|v| v.as_f64()),
        shares_outstanding: data.get("shareOutstanding").and_then(|v| v.as_f64()),
        logo: data.get("logo").and_then(|v| v.as_str()).map(|s| s.to_string()),
        phone: data.get("phone").and_then(|v| v.as_str()).map(|s| s.to_string()),
        weburl: data.get("weburl").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

/// Fetch company peers from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_peers(
    api_key: String,
    symbol: String,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/peers?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let peers: Vec<String> = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    // Filter out the original symbol and limit to first 10
    let filtered: Vec<String> = peers
        .into_iter()
        .filter(|p| p.to_uppercase() != symbol.to_uppercase())
        .take(10)
        .collect();
    
    Ok(filtered)
}

/// Fetch earnings surprises from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_earnings_surprises(
    api_key: String,
    symbol: String,
) -> Result<Vec<FinnhubEarningsSurprise>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/earnings?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let earnings = data.as_array()
        .map(|arr| {
            arr.iter()
                .take(8) // Last 8 quarters
                .map(|item| {
                    FinnhubEarningsSurprise {
                        symbol: symbol.to_uppercase(),
                        period: item.get("period").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        actual: item.get("actual").and_then(|v| v.as_f64()),
                        estimate: item.get("estimate").and_then(|v| v.as_f64()),
                        surprise: item.get("surprise").and_then(|v| v.as_f64()),
                        surprise_percent: item.get("surprisePercent").and_then(|v| v.as_f64()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(earnings)
}

/// Fetch dividend calendar/history - tries Finnhub first, then Yahoo Finance as fallback
#[tauri::command]
pub async fn fetch_finnhub_dividends(
    api_key: String,
    symbol: String,
) -> Result<Vec<DividendInfo>, String> {
    // Try Finnhub first
    let finnhub_result = fetch_finnhub_dividends_internal(&api_key, &symbol).await;
    
    if let Ok(dividends) = finnhub_result {
        if !dividends.is_empty() {
            return Ok(dividends);
        }
    }
    
    // Fallback to Yahoo Finance
    fetch_yahoo_dividends(&symbol).await
}

async fn fetch_finnhub_dividends_internal(
    api_key: &str,
    symbol: &str,
) -> Result<Vec<DividendInfo>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/dividend?symbol={}&from=2020-01-01&to=2030-12-31&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let dividends = data.as_array()
        .map(|arr| {
            arr.iter()
                .take(20)
                .map(|item| {
                    DividendInfo {
                        symbol: symbol.to_uppercase(),
                        ex_date: item.get("exDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        payment_date: item.get("payDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        record_date: item.get("recordDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        declaration_date: item.get("declarationDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        amount: item.get("amount").and_then(|v| v.as_f64()),
                        frequency: item.get("freq").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        dividend_type: item.get("type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(dividends)
}

/// Fetch dividend history from Yahoo Finance
async fn fetch_yahoo_dividends(symbol: &str) -> Result<Vec<DividendInfo>, String> {
    // Yahoo Finance dividend endpoint
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let five_years_ago = now - (5 * 365 * 24 * 60 * 60);
    
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval=1mo&events=div",
        symbol.to_uppercase(), five_years_ago, now
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let mut dividends: Vec<DividendInfo> = Vec::new();
    
    // Parse dividend events from Yahoo Finance response
    if let Some(events) = data
        .get("chart")
        .and_then(|c| c.get("result"))
        .and_then(|r| r.get(0))
        .and_then(|r| r.get("events"))
        .and_then(|e| e.get("dividends"))
    {
        if let Some(div_map) = events.as_object() {
            let mut div_entries: Vec<_> = div_map.iter().collect();
            // Sort by date descending (most recent first)
            div_entries.sort_by(|a, b| {
                let ts_a = a.1.get("date").and_then(|d| d.as_i64()).unwrap_or(0);
                let ts_b = b.1.get("date").and_then(|d| d.as_i64()).unwrap_or(0);
                ts_b.cmp(&ts_a)
            });
            
            for (_, div) in div_entries.iter().take(20) {
                let timestamp = div.get("date").and_then(|d| d.as_i64()).unwrap_or(0);
                let amount = div.get("amount").and_then(|a| a.as_f64());
                
                // Convert timestamp to date string
                let date_str = if timestamp > 0 {
                    let dt = chrono::DateTime::from_timestamp(timestamp, 0)
                        .map(|d| d.format("%Y-%m-%d").to_string());
                    dt
                } else {
                    None
                };
                
                dividends.push(DividendInfo {
                    symbol: symbol.to_uppercase(),
                    ex_date: date_str,
                    payment_date: None, // Yahoo doesn't provide this in chart data
                    record_date: None,
                    declaration_date: None,
                    amount,
                    frequency: None,
                    dividend_type: Some("Cash".to_string()),
                });
            }
        }
    }
    
    Ok(dividends)
}

/// Fetch insider transactions from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_insider_transactions(
    api_key: String,
    symbol: String,
) -> Result<Vec<InsiderTransaction>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/insider-transactions?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let transactions = data.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .take(20)
                .map(|item| {
                    InsiderTransaction {
                        symbol: symbol.to_uppercase(),
                        name: item.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        share: item.get("share").and_then(|v| v.as_i64()),
                        change: item.get("change").and_then(|v| v.as_i64()),
                        filing_date: item.get("filingDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        transaction_date: item.get("transactionDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        transaction_code: item.get("transactionCode").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        transaction_price: item.get("transactionPrice").and_then(|v| v.as_f64()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(transactions)
}

/// Fetch SEC filings from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_sec_filings(
    api_key: String,
    symbol: String,
) -> Result<Vec<SecFiling>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/stock/filings?symbol={}&token={}",
        symbol.to_uppercase(), api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let filings = data.as_array()
        .map(|arr| {
            arr.iter()
                .take(20)
                .map(|item| {
                    SecFiling {
                        symbol: symbol.to_uppercase(),
                        access_number: item.get("accessNumber").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        form: item.get("form").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        filed_date: item.get("filedDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        accepted_date: item.get("acceptedDate").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        report_url: item.get("reportUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        filing_url: item.get("filingUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(filings)
}

/// Fetch IPO calendar from Finnhub
#[tauri::command]
pub async fn fetch_finnhub_ipo_calendar(
    api_key: String,
    from_date: String,
    to_date: String,
) -> Result<Vec<IpoEvent>, String> {
    let url = format!(
        "https://finnhub.io/api/v1/calendar/ipo?from={}&to={}&token={}",
        from_date, to_date, api_key
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let ipos = data.get("ipoCalendar")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| {
                    IpoEvent {
                        symbol: item.get("symbol").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        name: item.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        date: item.get("date").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        exchange: item.get("exchange").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        price: item.get("price").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        shares: item.get("numberOfShares").and_then(|v| v.as_f64()),
                        status: item.get("status").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    
    Ok(ipos)
}

/// Fetch price performance from Yahoo Finance
#[tauri::command]
pub async fn fetch_price_performance(symbol: String) -> Result<PricePerformance, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let one_year_ago = now - (366 * 24 * 60 * 60);
    
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval=1d",
        symbol.to_uppercase(), one_year_ago, now
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let result = data.get("chart")
        .and_then(|c| c.get("result"))
        .and_then(|r| r.get(0))
        .ok_or_else(|| "Invalid response format".to_string())?;
    
    let timestamps = result.get("timestamp")
        .and_then(|t| t.as_array())
        .ok_or_else(|| "No timestamp data".to_string())?;
    
    let closes = result.get("indicators")
        .and_then(|i| i.get("quote"))
        .and_then(|q| q.get(0))
        .and_then(|q| q.get("close"))
        .and_then(|c| c.as_array())
        .ok_or_else(|| "No close data".to_string())?;
    
    if closes.is_empty() {
        return Err("No price data available".to_string());
    }
    
    // Get current price (last close)
    let current_price = closes.iter().rev()
        .find_map(|v| v.as_f64());
    
    let current = current_price.unwrap_or(0.0);
    let now_ts = now as i64;
    
    // Helper to find price at a specific time ago
    let find_price_at = |seconds_ago: i64| -> Option<f64> {
        let target_ts = now_ts - seconds_ago;
        for (i, ts) in timestamps.iter().enumerate() {
            if let Some(t) = ts.as_i64() {
                if t >= target_ts {
                    return closes.get(i).and_then(|v| v.as_f64());
                }
            }
        }
        None
    };
    
    // Calculate YTD (from Jan 1 of current year)
    let current_year = chrono::Utc::now().year();
    let jan1 = chrono::NaiveDate::from_ymd_opt(current_year, 1, 1)
        .map(|d| d.and_hms_opt(0, 0, 0))
        .flatten()
        .map(|dt| dt.and_utc().timestamp());
    
    let ytd_price = jan1.and_then(|jan1_ts| {
        for (i, ts) in timestamps.iter().enumerate() {
            if let Some(t) = ts.as_i64() {
                if t >= jan1_ts {
                    return closes.get(i).and_then(|v| v.as_f64());
                }
            }
        }
        None
    });
    
    let day_price = find_price_at(24 * 60 * 60);
    let week_price = find_price_at(7 * 24 * 60 * 60);
    let month_price = find_price_at(30 * 24 * 60 * 60);
    let three_month_price = find_price_at(90 * 24 * 60 * 60);
    let year_price = closes.first().and_then(|v| v.as_f64());
    
    let calc_change = |old: Option<f64>| -> (Option<f64>, Option<f64>) {
        match old {
            Some(o) if o > 0.0 => {
                let change = current - o;
                let percent = (change / o) * 100.0;
                (Some(change), Some(percent))
            }
            _ => (None, None)
        }
    };
    
    let (change_1d, change_1d_percent) = calc_change(day_price);
    let (change_1w, change_1w_percent) = calc_change(week_price);
    let (change_1m, change_1m_percent) = calc_change(month_price);
    let (change_3m, change_3m_percent) = calc_change(three_month_price);
    let (change_ytd, change_ytd_percent) = calc_change(ytd_price);
    let (change_1y, change_1y_percent) = calc_change(year_price);
    
    Ok(PricePerformance {
        symbol: symbol.to_uppercase(),
        current_price,
        change_1d,
        change_1d_percent,
        change_1w,
        change_1w_percent,
        change_1m,
        change_1m_percent,
        change_3m,
        change_3m_percent,
        change_ytd,
        change_ytd_percent,
        change_1y,
        change_1y_percent,
    })
}

/// Fetch short interest data from Yahoo Finance
#[tauri::command]
pub async fn fetch_short_interest(symbol: String) -> Result<ShortInterest, String> {
    // Use Yahoo Finance quoteSummary for short interest data
    let url = format!(
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=defaultKeyStatistics",
        symbol.to_uppercase()
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let stats = data.get("quoteSummary")
        .and_then(|q| q.get("result"))
        .and_then(|r| r.get(0))
        .and_then(|r| r.get("defaultKeyStatistics"));
    
    let get_raw_value = |obj: Option<&serde_json::Value>, key: &str| -> Option<f64> {
        obj.and_then(|o| o.get(key))
            .and_then(|v| v.get("raw"))
            .and_then(|r| r.as_f64())
    };
    
    let get_raw_int = |obj: Option<&serde_json::Value>, key: &str| -> Option<i64> {
        obj.and_then(|o| o.get(key))
            .and_then(|v| v.get("raw"))
            .and_then(|r| r.as_i64())
    };
    
    Ok(ShortInterest {
        symbol: symbol.to_uppercase(),
        short_interest: get_raw_int(stats, "sharesShort"),
        short_ratio: get_raw_value(stats, "shortRatio"),
        short_percent_of_float: get_raw_value(stats, "shortPercentOfFloat"),
        shares_short_prior_month: get_raw_int(stats, "sharesShortPriorMonth"),
    })
}

/// Fetch upcoming earnings date
#[tauri::command]
pub async fn fetch_earnings_date(symbol: String) -> Result<Option<String>, String> {
    let url = format!(
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=calendarEvents",
        symbol.to_uppercase()
    );
    
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }
    
    let data: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    let earnings_date = data.get("quoteSummary")
        .and_then(|q| q.get("result"))
        .and_then(|r| r.get(0))
        .and_then(|r| r.get("calendarEvents"))
        .and_then(|c| c.get("earnings"))
        .and_then(|e| e.get("earningsDate"))
        .and_then(|d| d.get(0))
        .and_then(|d| d.get("fmt"))
        .and_then(|f| f.as_str())
        .map(|s| s.to_string());
    
    Ok(earnings_date)
}

/// Fetch SEC filing content (bypasses CORS)
#[tauri::command]
pub async fn fetch_sec_filing_content(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    // SEC.gov requires a User-Agent with contact info per their fair access policy
    // https://www.sec.gov/os/webmaster-faq#developers
    let response = client
        .get(&url)
        .header("User-Agent", "TradeButler/1.0 (Desktop Trading Journal App)")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.5")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to fetch filing: {} - URL: {}", response.status(), url));
    }
    
    let content = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    Ok(content)
}
