mod commands;
mod crypto;
mod db;
mod dpapi;
mod mcp;
mod state;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::state::VaultState;

/// Set right before an intentional "Quit" from the tray menu, so the window
/// close handler knows to let the process actually exit instead of hiding to
/// tray. Process-lifetime flag, no need to route it through app state.
static IS_QUITTING: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    db::init_db().expect("Failed to initialize database");

    // Vault data is plaintext (see crypto.rs/db.rs) — there is no key to
    // unlock. The only thing gating the GUI is an optional local screen-lock
    // PIN; start locked only if one is actually configured.
    let pin_set = db::open()
        .ok()
        .map(|conn| db::get_setting(&conn, "screen_pin_hash").is_some())
        .unwrap_or(false);
    let vault_state = Arc::new(VaultState::new(pin_set));

    mcp::start_mcp_server(Arc::clone(&vault_state));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(vault_state)
        .setup(|app| {
            mcp::set_app_handle(app.handle().clone());

            let show_i = MenuItemBuilder::with_id("show", "Show VaultMate").build(app)?;
            let lock_i = MenuItemBuilder::with_id("lock", "Lock Vault").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_i, &lock_i, &quit_i])
                .build()?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "lock" => {
                        // Inert if no screen-lock PIN is configured — App.tsx
                        // only gates on `pin_set && locked` together, so this
                        // is a safe no-op for the common no-PIN vault.
                        app.state::<Arc<VaultState>>().lock_screen();
                    }
                    "quit" => {
                        IS_QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Window starts hidden (tauri.conf.json `visible: false`) so an
            // autostart launch never flashes on screen. Showing it here in
            // `.setup()` is unreliable on Windows — the async WebView2
            // attachment that happens after `.setup()` returns can silently
            // undo an early `show()` (confirmed live: `show()` returns `Ok`
            // and `is_visible()` reports `true` immediately after, but the
            // real OS window stays hidden moments later). Instead the
            // frontend calls `show_main_window` once it has actually
            // mounted — see `commands::show_main_window` / `was_launched_hidden`.
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !IS_QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Auth / migration / screen lock
            commands::vault_status,
            commands::complete_onboarding,
            commands::replay_onboarding,
            commands::finish_migration,
            commands::set_pin,
            commands::remove_pin,
            commands::verify_pin,
            commands::lock_screen,
            commands::touch_activity,
            commands::idle_seconds,
            // Autostart
            commands::enable_autostart,
            commands::disable_autostart,
            commands::is_autostart_enabled,
            commands::was_launched_hidden,
            commands::show_main_window,
            // Settings
            commands::get_settings,
            commands::update_settings,
            commands::rotate_mcp_token,
            commands::install_claude_skill,
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
