mod commands;
mod crypto;
mod db;
mod mcp;
mod state;

use std::sync::Arc;

use crate::state::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    db::init_db().expect("Failed to initialize database");

    let vault_state = Arc::new(VaultState::new());
    mcp::start_mcp_server(Arc::clone(&vault_state));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(vault_state)
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::vault_status,
            commands::setup_master_password,
            commands::unlock_vault,
            commands::unlock_with_pin,
            commands::lock_vault,
            commands::touch_activity,
            commands::idle_seconds,
            commands::change_master_password,
            commands::migrate_legacy_vault,
            commands::enable_quick_pin,
            commands::disable_quick_pin,
            // Settings
            commands::get_settings,
            commands::update_settings,
            commands::rotate_mcp_token,
            // Projects
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            // Credentials
            commands::list_credentials,
            commands::create_credential,
            commands::update_credential,
            commands::delete_credential,
            commands::touch_credential_used,
            commands::toggle_favorite,
            commands::list_all_credentials,
            commands::search_credentials,
            commands::totp_for_credential,
            commands::generate_password,
            // Backup
            commands::export_backup,
            commands::import_backup,
            // Files
            commands::write_text_file,
            commands::read_text_file,
            commands::scan_excel_files,
            commands::read_file_bytes,
            commands::delete_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VaultMate");
}
