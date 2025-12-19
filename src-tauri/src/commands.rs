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
    if !is_options_symbol(symbol) {
        return symbol.to_string(); // Not an option, return as-is
    }
    
    // Find the position of C or P (call/put indicator)
    let cp_pos = symbol.find('C').or_else(|| symbol.find('P'));
    
    if let Some(cp_pos) = cp_pos {
        // Look backwards from C/P to find 6 consecutive digits (the date)
        // The underlying symbol is everything before those 6 digits
        let before_cp = &symbol[..cp_pos];
        
        // Find the last occurrence of 6 consecutive digits
        let mut date_start = None;
        let mut consecutive_digits = 0;
        
        for (i, ch) in before_cp.char_indices().rev() {
            if ch.is_ascii_digit() {
                consecutive_digits += 1;
                if consecutive_digits == 6 {
                    date_start = Some(i);
                    break;
                }
            } else {
                consecutive_digits = 0;
            }
        }
        
        if let Some(start) = date_start {
            return symbol[..start].to_string();
        }
    }
    
    // Fallback: if we can't parse it, return as-is
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
pub fn get_trades_with_pairing(pairing_method: Option<String>) -> Result<Vec<TradeWithPairing>, String> {
    use std::collections::HashMap;
    
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Get all trades
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
    
    let mut all_trades = Vec::new();
    for trade in trade_iter {
        all_trades.push(trade.map_err(|e| e.to_string())?);
    }
    
    // Get paired trades
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(all_trades.clone())
    } else {
        pair_trades_lifo(all_trades.clone())
    };
    
    // Create a map of trade_id -> paired trades
    let mut entry_map: HashMap<i64, Vec<PairedTrade>> = HashMap::new();
    let mut exit_map: HashMap<i64, Vec<PairedTrade>> = HashMap::new();
    
    for paired in paired_trades {
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
pub fn get_position_groups(pairing_method: Option<String>) -> Result<Vec<PositionGroup>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    // Get all trades ordered by timestamp
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
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    Ok(paired_trades)
}

#[tauri::command]
pub fn get_symbol_pnl(pairing_method: Option<String>) -> Result<Vec<SymbolPnL>, String> {
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    use std::collections::HashMap;
    let mut symbol_map: HashMap<String, SymbolPnL> = HashMap::new();
    
    // Calculate P&L for closed positions, grouped by underlying symbol
    for paired in &paired_trades {
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
    
    // Calculate open positions, grouped by underlying symbol
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let mut stmt = conn
        .prepare("SELECT symbol, side, quantity FROM trades WHERE status = 'Filled' OR status = 'FILLED' ORDER BY timestamp ASC")
        .map_err(|e| e.to_string())?;
    
    let trade_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    
    let mut open_positions: HashMap<String, f64> = HashMap::new();
    for trade_result in trade_iter {
        let (symbol, side, qty) = trade_result.map_err(|e| e.to_string())?;
        let underlying = get_underlying_symbol(&symbol);
        let current_qty = open_positions.get(&underlying).copied().unwrap_or(0.0);
        if side.to_uppercase() == "BUY" {
            open_positions.insert(underlying.clone(), current_qty + qty);
        } else if side.to_uppercase() == "SELL" {
            open_positions.insert(underlying.clone(), (current_qty - qty).max(0.0));
        }
    }
    
    // Add open positions to results
    for (underlying, qty) in open_positions {
        if qty > 0.0001 {
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
            entry.open_position_qty = qty;
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
pub fn get_metrics(pairing_method: Option<String>) -> Result<Metrics, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    
    let total_trades: i64 = conn
        .query_row("SELECT COUNT(*) FROM trades", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    
    let total_volume: f64 = conn
        .query_row("SELECT SUM(quantity * price) FROM trades", [], |row| {
            Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0))
        })
        .map_err(|e| e.to_string())?;
    
    // Get paired trades for accurate metrics
    let paired_trades = get_paired_trades(pairing_method.clone()).map_err(|e| e.to_string())?;
    
    // Get position groups to calculate largest win/loss per position (not per pair)
    let position_groups = get_position_groups(pairing_method).map_err(|e| e.to_string())?;
    
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
    for group in &position_groups {
        let position_pnl = group.total_pnl;
        
        if position_pnl > 0.0 {
            if position_pnl > largest_win {
                largest_win = position_pnl;
            }
        } else if position_pnl < 0.0 {
            // largest_loss should be the actual loss value (negative) per position
            if largest_loss == f64::NEG_INFINITY || position_pnl < largest_loss {
                largest_loss = position_pnl; // Store as negative value (most negative = largest loss)
            }
        }
    }
    
    // Calculate other metrics from paired trades
    for paired in &paired_trades {
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
    
    let win_rate = if paired_trades.len() > 0 {
        winning_trades as f64 / paired_trades.len() as f64
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
    
    for paired in &paired_trades {
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
    let total_fees: f64 = paired_trades.iter().map(|p| p.entry_fees + p.exit_fees).sum();
    
    // Net profit (after fees) = total_profit_loss (already includes fees in net_profit_loss)
    let net_profit = total_profit_loss;
    
    // Average trade = total_profit_loss / number of trades
    let average_trade = if paired_trades.len() > 0 {
        total_profit_loss / paired_trades.len() as f64
    } else {
        0.0
    };
    
    // Expectancy = (Win Rate × Average Win) - (Loss Rate × Average Loss)
    let loss_rate = if paired_trades.len() > 0 {
        losing_trades as f64 / paired_trades.len() as f64
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
    let daily_pnl = get_daily_pnl().unwrap_or_default();
    
    let best_day = daily_pnl.iter()
        .map(|d| d.profit_loss)
        .fold(f64::NEG_INFINITY, |a, b| a.max(b));
    let best_day_value = if best_day == f64::NEG_INFINITY { 0.0 } else { best_day };
    
    let worst_day = daily_pnl.iter()
        .map(|d| d.profit_loss)
        .fold(f64::INFINITY, |a, b| a.min(b));
    let worst_day_value = if worst_day == f64::INFINITY { 0.0 } else { worst_day };
    
    // Trades per day = total trades / number of trading days
    let trading_days = daily_pnl.len() as f64;
    let trades_per_day = if trading_days > 0.0 {
        total_trades as f64 / trading_days
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
pub fn get_recent_trades(limit: Option<i64>, pairing_method: Option<String>) -> Result<Vec<RecentTrade>, String> {
    let db_path = get_db_path();
    let conn = get_connection(&db_path).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(5);
    
    // Get all filled trades
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
    
    // Get paired trades
    let use_fifo = pairing_method.as_deref().unwrap_or("FIFO") == "FIFO";
    let (paired_trades, _open_trades) = if use_fifo {
        pair_trades_fifo(trades)
    } else {
        pair_trades_lifo(trades)
    };
    
    // Sort by exit timestamp (most recent first) and limit
    let mut sorted_pairs = paired_trades;
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

