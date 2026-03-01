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
            commands::add_trade_manual,
            commands::get_trades,
            commands::get_trades_with_pairing,
            commands::get_position_groups,
            commands::get_metrics,
            commands::get_daily_pnl,
            commands::get_paired_trades,
            commands::get_symbol_pnl,
            commands::add_emotional_state,
            commands::get_emotional_states,
            commands::get_emotional_states_for_journal,
            commands::update_emotional_state,
            commands::delete_emotional_state,
            commands::add_emotion_survey,
            commands::get_emotion_survey,
            commands::get_all_emotion_surveys,
            commands::get_trade_by_id,
            commands::update_trade,
            commands::delete_trade,
            commands::create_strategy,
            commands::get_strategies,
            commands::update_strategy,
            commands::update_strategy_order,
            commands::delete_strategy,
            commands::get_strategy_associated_records,
            commands::update_trade_strategy,
            commands::get_top_symbols,
            commands::get_strategy_performance,
            commands::get_recent_trades,
            commands::get_paired_trades_by_strategy,
            commands::clear_all_trades,
            commands::fetch_chart_data,
            commands::save_pair_notes,
            commands::get_evaluation_metrics,
            commands::get_equity_curve,
            commands::get_distribution_concentration,
            commands::get_tilt_metric,
            commands::fetch_stock_quote,
            commands::get_strategy_checklist,
            commands::save_strategy_checklist_item,
            commands::delete_strategy_checklist_item,
            commands::group_checklist_items,
            commands::ungroup_checklist_items,
            commands::create_journal_entry,
            commands::get_journal_entries,
            commands::get_journal_entry,
            commands::update_journal_entry,
            commands::add_journal_entry_to_emotional_states,
            commands::link_emotional_states_to_journal,
            commands::remove_journal_entry_from_emotional_states,
            commands::delete_journal_entry,
            commands::create_journal_trade,
            commands::get_journal_trades,
            commands::get_all_journal_trades,
            commands::update_journal_trade,
            commands::delete_journal_trade,
            commands::get_journal_trade_actual_trade_ids,
            commands::save_journal_trade_actual_trades,
            commands::save_journal_checklist_responses,
            commands::get_journal_checklist_responses,
            commands::get_journal_entry_pairs,
            commands::set_journal_entry_pairs,
            commands::get_journal_entries_for_pair,
            commands::get_all_symbols,
            commands::clear_all_data,
            commands::export_data,
            commands::import_data,
            commands::check_version,
            commands::download_portable_update,
            commands::download_and_install_update,
            commands::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

