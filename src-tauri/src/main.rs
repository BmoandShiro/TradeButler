// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod commands;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize database on app startup
            let app_handle = app.handle();
            let db_dir = app_handle
                .path_resolver()
                .app_data_dir()
                .expect("Failed to get app data directory");
            
            // Create directory if it doesn't exist
            std::fs::create_dir_all(&db_dir).expect("Failed to create app data directory");
            
            let db_path = db_dir.join("tradebutler.db");
            database::init_database(&db_path).expect("Failed to initialize database");
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_trades_csv,
            commands::get_trades,
            commands::get_trades_with_pairing,
            commands::get_position_groups,
            commands::get_metrics,
            commands::get_daily_pnl,
            commands::get_paired_trades,
            commands::get_symbol_pnl,
            commands::add_emotional_state,
            commands::get_emotional_states,
            commands::get_trade_by_id,
            commands::update_trade,
            commands::delete_trade,
            commands::create_strategy,
            commands::get_strategies,
            commands::update_strategy,
            commands::delete_strategy,
            commands::update_trade_strategy,
            commands::get_top_symbols,
            commands::get_strategy_performance,
            commands::get_recent_trades,
            commands::get_paired_trades_by_strategy,
            commands::clear_all_trades,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

