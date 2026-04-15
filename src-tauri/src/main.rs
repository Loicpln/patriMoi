#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands; mod db;
use commands::DbState; use db::{get_db_path, init_db};
use rusqlite::Connection; use std::sync::Mutex; use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = get_db_path(&app.handle());
            if let Some(p) = db_path.parent() { std::fs::create_dir_all(p)?; }
            let conn = Connection::open(&db_path).expect("DB open failed");
            init_db(&conn).expect("DB init failed");
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_depenses, commands::add_depense, commands::update_depense, commands::delete_depense,
            commands::get_salaires, commands::add_salaire, commands::update_salaire, commands::delete_salaire,
            commands::open_pdf, commands::list_pdf_files,
            commands::get_livrets, commands::add_livret, commands::delete_livret,
            commands::get_positions, commands::add_position, commands::delete_position,
            commands::get_ventes, commands::sell_position, commands::delete_vente,
            commands::get_dividendes, commands::add_dividende, commands::delete_dividende,
            commands::get_versements, commands::add_versement, commands::delete_versement,
            commands::get_parametre, commands::set_parametre, commands::choose_folder, commands::choose_export_folder, commands::export_all_csv,
            commands::fetch_url,
            commands::get_scpi_valuations, commands::add_scpi_valuation, commands::delete_scpi_valuation,
            commands::import_depenses, commands::import_salaires, commands::import_livrets,
            commands::import_poche, commands::import_scpi_valuations,
            commands::delete_poche_data,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri error");
}
