use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::crypto::{decrypt_string, derive_key, random_bytes, totp_code, VaultKey, SALT_LEN, VAULT_KEY_LEN};
use crate::db;
use crate::state::VaultState;

// ── Domain types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CustomField {
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Credential {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub username: String,
    pub secret: String,
    pub url: String,
    pub notes: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub totp_secret: String,
    #[serde(default)]
    pub custom_fields: Vec<CustomField>,
    #[serde(default)]
    pub expiry_date: String,
    #[serde(default)]
    pub last_used_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialWithProject {
    pub id: i64,
    pub project_id: i64,
    pub project_name: String,
    pub title: String,
    pub username: String,
    pub secret: String,
    pub url: String,
    pub notes: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub totp_secret: String,
    #[serde(default)]
    pub custom_fields: Vec<CustomField>,
    #[serde(default)]
    pub expiry_date: String,
    #[serde(default)]
    pub last_used_at: String,
}

/// PAT-only model: `needs_migration` is true only for a vault that predates
/// the removal of at-rest encryption and still has an old master-password
/// (or DPAPI) vault key, or an ancient pre-encryption legacy table. Once
/// `finish_migration` runs, it's false forever and stays false for every
/// fresh install. `pin_set`/`locked` describe the optional, purely local
/// screen-lock PIN — never a factor in MCP access, see `mcp.rs`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultStatus {
    pub needs_migration: bool,
    pub pin_set: bool,
    pub locked: bool,
    pub onboarding_seen: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub auto_lock_minutes: i64,
    pub clipboard_clear_seconds: i64,
    pub mcp_token: String,
}

const CRED_COLS: &str = "id, project_id, title, username, secret, url, notes, category, \
                         tags, favorite, totp_secret, custom_fields, expiry_date, last_used_at, \
                         created_at, updated_at";

// Identical columns but with the `c.` table qualifier — required in JOIN queries where
// both `credentials c` and `projects p` share column names (`id`, `created_at`).
const CRED_COLS_JOIN: &str =
    "c.id, c.project_id, c.title, c.username, c.secret, c.url, c.notes, c.category, \
     c.tags, c.favorite, c.totp_secret, c.custom_fields, c.expiry_date, c.last_used_at, \
     c.created_at, c.updated_at";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn row_to_credential(row: &rusqlite::Row) -> Result<Credential, rusqlite::Error> {
    let tags_json: String = row.get(8).unwrap_or_else(|_| "[]".to_string());
    let custom_json: String = row.get(11).unwrap_or_default();
    let custom: Vec<CustomField> = if custom_json.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&custom_json).unwrap_or_default()
    };
    Ok(Credential {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        username: row.get(3).unwrap_or_default(),
        secret: row.get(4).unwrap_or_default(),
        url: row.get(5).unwrap_or_default(),
        notes: row.get(6).unwrap_or_default(),
        category: row.get(7).unwrap_or_else(|_| "other".to_string()),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        favorite: row.get::<_, i64>(9).unwrap_or(0) != 0,
        totp_secret: row.get(10).unwrap_or_default(),
        custom_fields: custom,
        expiry_date: row.get(12).unwrap_or_default(),
        last_used_at: row.get(13).unwrap_or_default(),
        created_at: row.get(14).unwrap_or_default(),
        updated_at: row.get(15).unwrap_or_default(),
    })
}

/// Single chokepoint blocking all credential/project reads and writes while
/// a vault still has old encrypted data waiting on `finish_migration`.
fn require_migrated(conn: &rusqlite::Connection) -> Result<(), String> {
    if db::needs_migration(conn) {
        return Err(
            "Vault needs a one-time migration — open VaultMate to finish it.".to_string(),
        );
    }
    Ok(())
}

// ── Auth / vault status ───────────────────────────────────────────────────────

#[tauri::command]
pub fn vault_status(state: State<'_, Arc<VaultState>>) -> Result<VaultStatus, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    Ok(VaultStatus {
        needs_migration: db::needs_migration(&conn),
        pin_set: db::get_setting(&conn, "screen_pin_hash").is_some(),
        locked: state.is_locked(),
        onboarding_seen: db::get_setting(&conn, "onboarding_seen")
            .map(|s| s == "true")
            .unwrap_or(false),
    })
}

#[tauri::command]
pub fn complete_onboarding() -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "onboarding_seen", "true").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn replay_onboarding() -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "onboarding_seen", "false").map_err(|e| e.to_string())
}

/// One-time flatten: recovers the vault key (from a master password, quick
/// PIN, or a silently-unwrapped DPAPI blob), decrypts every existing
/// credential field, rewrites it as plaintext, copies over any ancient
/// pre-encryption legacy rows verbatim, and deletes every crypto-related
/// setting. Wrapped in one transaction — a crash mid-migration leaves the DB
/// untouched (transaction never committed) and `needs_migration` still true,
/// so it's always safe to just retry.
#[tauri::command]
pub fn finish_migration(secret: String, is_pin: bool) -> Result<(), String> {
    let mut conn = db::open().map_err(|e| e.to_string())?;

    let vk_bytes: [u8; VAULT_KEY_LEN] = if let Some(blob_hex) =
        db::get_setting(&conn, "dpapi_vault_key_blob")
    {
        let blob = hex::decode(blob_hex).map_err(|_| "Corrupt DPAPI blob".to_string())?;
        let bytes = crate::dpapi::unprotect(&blob)?;
        if bytes.len() != VAULT_KEY_LEN {
            return Err("Corrupt vault key".to_string());
        }
        let mut arr = [0u8; VAULT_KEY_LEN];
        arr.copy_from_slice(&bytes);
        arr
    } else if db::get_setting(&conn, "vault_key_blob").is_none() {
        // No v2 vault key at all — either a brand-new/already-migrated vault
        // (finish_migration shouldn't have been reachable), or a pure
        // ancient-legacy vault with only the pre-encryption table, which
        // needs no key at all (handled by the plaintext copy below).
        [0u8; VAULT_KEY_LEN]
    } else {
        let (salt_key, blob_key) = if is_pin {
            ("quick_pin_salt", "quick_pin_blob")
        } else {
            ("master_salt", "vault_key_blob")
        };
        let salt_hex = db::get_setting(&conn, salt_key)
            .ok_or_else(|| if is_pin { "Quick PIN is not set" } else { "Vault is not initialized" }.to_string())?;
        let blob_hex = db::get_setting(&conn, blob_key).ok_or("Vault is not initialized")?;
        let salt = hex::decode(salt_hex).map_err(|_| "Corrupt salt".to_string())?;
        let blob = hex::decode(blob_hex).map_err(|_| "Corrupt vault key".to_string())?;
        let dk = derive_key(&secret, &salt)?;
        let bytes = crate::crypto::decrypt(&dk, &blob).map_err(|_| {
            if is_pin { "Incorrect PIN".to_string() } else { "Incorrect master password".to_string() }
        })?;
        if bytes.len() != VAULT_KEY_LEN {
            return Err("Corrupt vault key".to_string());
        }
        let mut arr = [0u8; VAULT_KEY_LEN];
        arr.copy_from_slice(&bytes);
        arr
    };
    let vk = VaultKey(vk_bytes);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare("SELECT id, secret, notes, totp_secret, custom_fields FROM credentials")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1).unwrap_or_default(),
                    row.get(2).unwrap_or_default(),
                    row.get(3).unwrap_or_default(),
                    row.get(4).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        // Defensive: if a value doesn't decrypt (not valid hex, or AEAD auth
        // failure), treat it as already-plaintext rather than aborting —
        // cheap insurance against any migration-gating gap.
        let flatten = |v: &str| -> String {
            decrypt_string(vk.as_bytes(), v).unwrap_or_else(|_| v.to_string())
        };

        for (id, secret_v, notes_v, totp_v, custom_v) in rows {
            tx.execute(
                "UPDATE credentials SET secret=?1, notes=?2, totp_secret=?3, custom_fields=?4 WHERE id=?5",
                params![flatten(&secret_v), flatten(&notes_v), flatten(&totp_v), flatten(&custom_v), id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if db::has_legacy_vault(&tx) {
        struct LegacyRow {
            project_id: i64,
            title: String,
            username: String,
            secret: String,
            url: String,
            notes: String,
            category: String,
            created_at: String,
            updated_at: String,
        }
        let mut stmt = tx
            .prepare(
                "SELECT project_id, title, username, secret, url, notes, category, \
                       created_at, updated_at FROM credentials_legacy_v0",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<LegacyRow> = stmt
            .query_map([], |row| {
                Ok(LegacyRow {
                    project_id: row.get(0)?,
                    title: row.get(1)?,
                    username: row.get(2).unwrap_or_default(),
                    secret: row.get(3).unwrap_or_default(),
                    url: row.get(4).unwrap_or_default(),
                    notes: row.get(5).unwrap_or_default(),
                    category: row.get(6).unwrap_or_else(|_| "other".to_string()),
                    created_at: row.get(7).unwrap_or_default(),
                    updated_at: row.get(8).unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        for r in rows {
            tx.execute(
                "INSERT INTO credentials (project_id, title, username, secret, url, notes, \
                                          category, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    r.project_id, r.title, r.username, r.secret, r.url, r.notes, r.category,
                    r.created_at, r.updated_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute("DROP TABLE credentials_legacy_v0", [])
            .map_err(|e| e.to_string())?;
    }

    for key in [
        "master_salt", "vault_key_blob", "dpapi_vault_key_blob",
        "quick_pin_salt", "quick_pin_blob", "pin_hash",
    ] {
        tx.execute("DELETE FROM settings WHERE key=?1", params![key])
            .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Screen-lock PIN (local UI nuisance-gate only; see state.rs / mcp.rs) ──────

#[tauri::command]
pub fn set_pin(pin: String) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN must be at least 4 digits".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    let salt = random_bytes(SALT_LEN);
    let hash = derive_key(&pin, &salt)?;
    db::set_setting(&conn, "screen_pin_salt", &hex::encode(&salt)).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "screen_pin_hash", &hex::encode(hash)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_pin(state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "screen_pin_salt").map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "screen_pin_hash").map_err(|e| e.to_string())?;
    state.record_pin_success(); // clears any lock/cooldown state
    Ok(())
}

#[tauri::command]
pub fn verify_pin(pin: String, state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    state.check_pin_cooldown()?;
    let conn = db::open().map_err(|e| e.to_string())?;
    let salt_hex = db::get_setting(&conn, "screen_pin_salt").ok_or("No PIN set")?;
    let hash_hex = db::get_setting(&conn, "screen_pin_hash").ok_or("No PIN set")?;
    let salt = hex::decode(salt_hex).map_err(|_| "Corrupt PIN salt".to_string())?;
    let expected = hex::decode(hash_hex).map_err(|_| "Corrupt PIN hash".to_string())?;
    let actual = derive_key(&pin, &salt).map_err(|e| e.to_string())?;
    if actual.as_slice() == expected.as_slice() {
        state.record_pin_success();
        Ok(())
    } else {
        state.record_pin_failure();
        Err("Incorrect PIN".to_string())
    }
}

#[tauri::command]
pub fn lock_screen(state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    state.lock_screen();
    Ok(())
}

#[tauri::command]
pub fn touch_activity(state: State<'_, Arc<VaultState>>) -> Result<i64, String> {
    if state.is_locked() {
        return Ok(-1);
    }
    state.touch();
    Ok(state.idle_for().as_secs() as i64)
}

#[tauri::command]
pub fn idle_seconds(state: State<'_, Arc<VaultState>>) -> Result<i64, String> {
    Ok(state.idle_for().as_secs() as i64)
}

// ── Autostart (Windows only; opt-in) ─────────────────────────────────────────

#[tauri::command]
pub fn enable_autostart(app: tauri::AppHandle) -> Result<(), String> {
    // Bypass tauri-plugin-autostart's own enable(): its Windows backend
    // (auto-launch crate) joins app_path and args with a bare space and never
    // quotes app_path, so installs under a path with spaces (e.g. "Program
    // Files") write a Run entry Windows can't parse back into an executable.
    // Quote it ourselves before handing it to the same underlying crate.
    let app_name = app.package_info().name.clone();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let quoted_path = format!("\"{}\"", exe.display());

    auto_launch::AutoLaunch::new(&app_name, &quoted_path, &["--hidden"])
        .enable()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disable_autostart(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().disable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

// ── Window visibility ─────────────────────────────────────────────────────────
//
// The main window starts hidden (`visible: false` in tauri.conf.json) so an
// autostart launch never flashes on screen. Showing it from Rust `.setup()`
// is unreliable on Windows — the async WebView2 attachment that happens
// after `.setup()` returns can silently re-hide it. So the frontend shows it
// itself, once actually mounted, unless this was the `--hidden` launch that
// the autostart plugin injects.

#[tauri::command]
pub fn was_launched_hidden() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app.get_webview_window("main").ok_or("Main window not found")?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ── Settings ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    Ok(AppSettings {
        auto_lock_minutes: db::get_setting(&conn, "auto_lock_minutes")
            .and_then(|s| s.parse().ok())
            .unwrap_or(5),
        clipboard_clear_seconds: db::get_setting(&conn, "clipboard_clear_seconds")
            .and_then(|s| s.parse().ok())
            .unwrap_or(30),
        mcp_token: db::get_setting(&conn, "mcp_token").unwrap_or_default(),
    })
}

#[tauri::command]
pub fn update_settings(
    auto_lock_minutes: i64,
    clipboard_clear_seconds: i64,
) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "auto_lock_minutes", &auto_lock_minutes.max(1).to_string())
        .map_err(|e| e.to_string())?;
    db::set_setting(
        &conn,
        "clipboard_clear_seconds",
        &clipboard_clear_seconds.max(5).to_string(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rotate_mcp_token() -> Result<String, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    use rand::RngCore;
    let mut buf = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut buf);
    let token = hex::encode(buf);
    db::set_setting(&conn, "mcp_token", &token).map_err(|e| e.to_string())?;
    Ok(token)
}

/// The Claude Code setup skill, baked into the binary at compile time so
/// installing it never needs network/GitHub access — genuinely one click,
/// offline, seamless. Source of truth is the repo's own copy; keep them in
/// sync (this file IS that copy, just embedded).
const CLAUDE_SKILL_MD: &str = include_str!("../../.claude/skills/connect-vaultmate.md");

#[tauri::command]
pub fn install_claude_skill() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not determine home directory".to_string())?;
    let skills_dir = std::path::Path::new(&home).join(".claude").join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    let dest = skills_dir.join("connect-vaultmate.md");
    std::fs::write(&dest, CLAUDE_SKILL_MD).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

// ── Projects ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_projects(state: State<'_, Arc<VaultState>>) -> Result<Vec<Project>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, color, created_at FROM projects ORDER BY name")
        .map_err(|e| e.to_string())?;
    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2).unwrap_or_default(),
                color: row.get(3).unwrap_or_else(|_| "indigo".to_string()),
                created_at: row.get(4).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    state.touch();
    Ok(projects)
}

#[tauri::command]
pub fn create_project(
    name: String,
    description: String,
    color: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<Project, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute(
        "INSERT INTO projects (name, description, color) VALUES (?1, ?2, ?3)",
        params![name, description, color],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    state.touch();
    conn.query_row(
        "SELECT id, name, description, color, created_at FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2).unwrap_or_default(),
                color: row.get(3).unwrap_or_else(|_| "indigo".to_string()),
                created_at: row.get(4).unwrap_or_default(),
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(
    id: i64,
    name: String,
    description: String,
    color: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<Project, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute(
        "UPDATE projects SET name=?1, description=?2, color=?3 WHERE id=?4",
        params![name, description, color, id],
    )
    .map_err(|e| e.to_string())?;
    state.touch();
    conn.query_row(
        "SELECT id, name, description, color, created_at FROM projects WHERE id = ?1",
        params![id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2).unwrap_or_default(),
                color: row.get(3).unwrap_or_else(|_| "indigo".to_string()),
                created_at: row.get(4).unwrap_or_default(),
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(id: i64, state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

// ── Credentials ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_credentials(
    project_id: i64,
    state: State<'_, Arc<VaultState>>,
) -> Result<Vec<Credential>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CRED_COLS} FROM credentials WHERE project_id=?1 \
             ORDER BY favorite DESC, title"
        ))
        .map_err(|e| e.to_string())?;
    let creds = stmt
        .query_map(params![project_id], row_to_credential)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    state.touch();
    Ok(creds)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_credential(
    project_id: i64,
    title: String,
    username: String,
    secret: String,
    url: String,
    notes: String,
    category: String,
    tags: Vec<String>,
    favorite: bool,
    totp_secret: String,
    custom_fields: Vec<CustomField>,
    expiry_date: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<Credential, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let custom_json = if custom_fields.is_empty() {
        String::new()
    } else {
        serde_json::to_string(&custom_fields).unwrap_or_default()
    };
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO credentials (project_id, title, username, secret, url, notes, \
                                  category, tags, favorite, totp_secret, custom_fields, expiry_date)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            project_id, title, username, secret, url, notes, category, tags_json,
            if favorite { 1 } else { 0 }, totp_secret, custom_json, expiry_date,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    state.touch();
    conn.query_row(
        &format!("SELECT {CRED_COLS} FROM credentials WHERE id=?1"),
        params![id],
        row_to_credential,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_credential(
    id: i64,
    title: String,
    username: String,
    secret: String,
    url: String,
    notes: String,
    category: String,
    tags: Vec<String>,
    favorite: bool,
    totp_secret: String,
    custom_fields: Vec<CustomField>,
    expiry_date: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<Credential, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let custom_json = if custom_fields.is_empty() {
        String::new()
    } else {
        serde_json::to_string(&custom_fields).unwrap_or_default()
    };
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE credentials SET title=?1, username=?2, secret=?3, url=?4, \
                                notes=?5, category=?6, tags=?7, favorite=?8, \
                                totp_secret=?9, custom_fields=?10, expiry_date=?11, \
                                updated_at=datetime('now') WHERE id=?12",
        params![
            title, username, secret, url, notes, category, tags_json,
            if favorite { 1 } else { 0 }, totp_secret, custom_json, expiry_date, id,
        ],
    )
    .map_err(|e| e.to_string())?;
    state.touch();
    conn.query_row(
        &format!("SELECT {CRED_COLS} FROM credentials WHERE id=?1"),
        params![id],
        row_to_credential,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_credential(id: i64, state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute("DELETE FROM credentials WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

#[tauri::command]
pub fn touch_credential_used(id: i64, state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute(
        "UPDATE credentials SET last_used_at=datetime('now') WHERE id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(id: i64, state: State<'_, Arc<VaultState>>) -> Result<bool, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute(
        "UPDATE credentials SET favorite = 1 - favorite WHERE id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    state.touch();
    let val: i64 = conn
        .query_row(
            "SELECT favorite FROM credentials WHERE id=?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(val != 0)
}

#[tauri::command]
pub fn list_all_credentials(
    state: State<'_, Arc<VaultState>>,
) -> Result<Vec<CredentialWithProject>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CRED_COLS_JOIN}, p.name as project_name FROM credentials c \
             JOIN projects p ON c.project_id=p.id ORDER BY p.name, c.title"
        ))
        .map_err(|e| e.to_string())?;
    let results = stmt
        .query_map([], |row| {
            let cred = row_to_credential(row)?;
            let project_name: String = row.get(16)?;
            Ok(CredentialWithProject {
                id: cred.id,
                project_id: cred.project_id,
                project_name,
                title: cred.title,
                username: cred.username,
                secret: cred.secret,
                url: cred.url,
                notes: cred.notes,
                category: cred.category,
                tags: cred.tags,
                favorite: cred.favorite,
                totp_secret: cred.totp_secret,
                custom_fields: cred.custom_fields,
                expiry_date: cred.expiry_date,
                last_used_at: cred.last_used_at,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    state.touch();
    Ok(results)
}

#[tauri::command]
pub fn search_credentials(
    query: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<Vec<CredentialWithProject>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CRED_COLS_JOIN}, p.name as project_name FROM credentials c \
             JOIN projects p ON c.project_id=p.id ORDER BY p.name, c.title"
        ))
        .map_err(|e| e.to_string())?;
    let q_lower = query.to_lowercase();
    let p_lower = pattern.to_lowercase();
    let results: Vec<CredentialWithProject> = stmt
        .query_map([], |row| {
            let cred = row_to_credential(row)?;
            let project_name: String = row.get(16)?;
            Ok(CredentialWithProject {
                id: cred.id,
                project_id: cred.project_id,
                project_name,
                title: cred.title,
                username: cred.username,
                secret: cred.secret,
                url: cred.url,
                notes: cred.notes,
                category: cred.category,
                tags: cred.tags,
                favorite: cred.favorite,
                totp_secret: cred.totp_secret,
                custom_fields: cred.custom_fields,
                expiry_date: cred.expiry_date,
                last_used_at: cred.last_used_at,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|c| {
            let hay = format!(
                "{} {} {} {} {} {}",
                c.title.to_lowercase(),
                c.username.to_lowercase(),
                c.url.to_lowercase(),
                c.notes.to_lowercase(),
                c.tags.join(" ").to_lowercase(),
                c.category.to_lowercase(),
            );
            hay.contains(&q_lower) || hay.contains(&p_lower.replace('%', ""))
        })
        .collect();
    state.touch();
    Ok(results)
}

// ── TOTP ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TotpResult {
    pub code: String,
    pub remaining_seconds: u64,
}

#[tauri::command]
pub fn totp_for_credential(
    credential_id: i64,
    state: State<'_, Arc<VaultState>>,
) -> Result<TotpResult, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let secret: String = conn
        .query_row(
            "SELECT totp_secret FROM credentials WHERE id=?1",
            params![credential_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if secret.is_empty() {
        return Err("No TOTP secret configured".to_string());
    }
    state.touch();
    let (code, remaining) = totp_code(&secret, 30, 6)?;
    Ok(TotpResult {
        code,
        remaining_seconds: remaining,
    })
}

// ── Password generator ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct GenPwOptions {
    pub length: u32,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    #[serde(default)]
    pub avoid_ambiguous: bool,
}

#[tauri::command]
pub fn generate_password(opts: GenPwOptions) -> Result<String, String> {
    use rand::Rng;
    let mut alphabet = String::new();
    if opts.lowercase {
        alphabet.push_str(if opts.avoid_ambiguous {
            "abcdefghjkmnpqrstuvwxyz"
        } else {
            "abcdefghijklmnopqrstuvwxyz"
        });
    }
    if opts.uppercase {
        alphabet.push_str(if opts.avoid_ambiguous {
            "ABCDEFGHJKMNPQRSTUVWXYZ"
        } else {
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        });
    }
    if opts.digits {
        alphabet.push_str(if opts.avoid_ambiguous {
            "23456789"
        } else {
            "0123456789"
        });
    }
    if opts.symbols {
        alphabet.push_str("!@#$%^&*()-_=+[]{};:,.<>?");
    }
    if alphabet.is_empty() {
        return Err("Select at least one character class".to_string());
    }
    let chars: Vec<char> = alphabet.chars().collect();
    let mut rng = rand::thread_rng();
    let len = opts.length.clamp(4, 128) as usize;
    let pw: String = (0..len)
        .map(|_| chars[rng.gen_range(0..chars.len())])
        .collect();
    Ok(pw)
}

// ── Backup / restore ──────────────────────────────────────────────────────────
//
// Backups stay password-protected even though at-rest storage no longer is —
// a portable backup file is far more likely to be casually emailed/uploaded
// than the live local DB, so this remains real AES-256-GCM encryption.

#[derive(Debug, Serialize, Deserialize)]
struct BackupHeader {
    format: String,
    version: u32,
    salt: String,
    nonce: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupPayload {
    projects: Vec<Project>,
    credentials: Vec<CredentialWithProject>,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupFile {
    header: BackupHeader,
    ciphertext: String,
}

#[tauri::command]
pub fn export_backup(
    password: String,
    state: State<'_, Arc<VaultState>>,
) -> Result<String, String> {
    if password.len() < 8 {
        return Err("Backup password must be at least 8 characters".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, color, created_at FROM projects ORDER BY id")
        .map_err(|e| e.to_string())?;
    let projects: Vec<Project> = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2).unwrap_or_default(),
                color: row.get(3).unwrap_or_else(|_| "indigo".to_string()),
                created_at: row.get(4).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    let credentials = list_all_credentials(state)?;

    let payload = BackupPayload {
        projects,
        credentials,
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let salt = random_bytes(SALT_LEN);
    let dk = derive_key(&password, &salt)?;
    let blob = crate::crypto::encrypt(&dk, &plaintext)?;
    let nonce_hex = hex::encode(&blob[..12]);
    let ciphertext = hex::encode(&blob[12..]);

    let file = BackupFile {
        header: BackupHeader {
            format: "vaultmate-backup".to_string(),
            version: 1,
            salt: hex::encode(&salt),
            nonce: nonce_hex,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        ciphertext,
    };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_backup(
    backup_json: String,
    password: String,
    replace_existing: bool,
    state: State<'_, Arc<VaultState>>,
) -> Result<i64, String> {
    let file: BackupFile =
        serde_json::from_str(&backup_json).map_err(|_| "Invalid backup file".to_string())?;
    if file.header.format != "vaultmate-backup" {
        return Err("Unrecognized backup format".to_string());
    }
    let salt = hex::decode(&file.header.salt).map_err(|_| "Corrupt backup salt".to_string())?;
    let nonce = hex::decode(&file.header.nonce).map_err(|_| "Corrupt backup nonce".to_string())?;
    let ct = hex::decode(&file.ciphertext).map_err(|_| "Corrupt backup ciphertext".to_string())?;
    let mut blob = nonce;
    blob.extend_from_slice(&ct);

    let dk = derive_key(&password, &salt)?;
    let plaintext =
        crate::crypto::decrypt(&dk, &blob).map_err(|_| "Incorrect backup password".to_string())?;
    let payload: BackupPayload = serde_json::from_slice(&plaintext)
        .map_err(|_| "Backup payload is malformed".to_string())?;

    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    if replace_existing {
        conn.execute("DELETE FROM credentials", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM projects", [])
            .map_err(|e| e.to_string())?;
    }

    let mut id_remap: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for p in &payload.projects {
        // Skip if a project with the same name already exists (when not replacing).
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM projects WHERE name=?1",
                params![p.name],
                |row| row.get(0),
            )
            .ok();
        let new_id = if let Some(eid) = existing {
            eid
        } else {
            conn.execute(
                "INSERT INTO projects (name, description, color, created_at) \
                 VALUES (?1, ?2, ?3, COALESCE(?4, datetime('now')))",
                params![p.name, p.description, p.color, p.created_at],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        };
        id_remap.insert(p.id, new_id);
    }

    let mut imported: i64 = 0;
    for c in &payload.credentials {
        let target_pid = match id_remap.get(&c.project_id) {
            Some(id) => *id,
            None => continue,
        };
        let custom_json = if c.custom_fields.is_empty() {
            String::new()
        } else {
            serde_json::to_string(&c.custom_fields).unwrap_or_default()
        };
        let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO credentials (project_id, title, username, secret, url, notes, \
                                      category, tags, favorite, totp_secret, custom_fields, expiry_date)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                target_pid, c.title, c.username, c.secret, c.url, c.notes, c.category,
                tags_json, if c.favorite { 1 } else { 0 }, c.totp_secret, custom_json, c.expiry_date,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported += 1;
    }
    state.touch();
    Ok(imported)
}

// ── File system helpers ───────────────────────────────────────────────────────

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ── Bulk data management ──────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_all_data(state: State<'_, Arc<VaultState>>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    require_migrated(&conn)?;
    conn.execute("DELETE FROM credentials", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects", [])
        .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

// ── Excel import helpers ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExcelFile {
    pub path: String,
    pub filename: String,
    pub project_name: String,
    pub size_kb: u64,
}

#[tauri::command]
pub fn scan_excel_files(root: String) -> Result<Vec<ExcelFile>, String> {
    let mut files = Vec::new();
    scan_dir_for_excel(std::path::Path::new(&root), &mut files, 0);
    Ok(files)
}

fn scan_dir_for_excel(dir: &std::path::Path, files: &mut Vec<ExcelFile>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("System Volume Information") {
            continue;
        }
        if path.is_dir() {
            scan_dir_for_excel(&path, files, depth + 1);
        } else {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(ext.as_str(), "xlsx" | "xls" | "csv") {
                let project_name = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Imported".to_string());
                let size_kb = std::fs::metadata(&path)
                    .map(|m| m.len() / 1024)
                    .unwrap_or(0);
                files.push(ExcelFile {
                    path: path.to_string_lossy().to_string(),
                    filename: name,
                    project_name,
                    size_kb,
                });
            }
        }
    }
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}
