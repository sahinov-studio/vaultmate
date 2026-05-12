use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::crypto::{
    decrypt_string, derive_key, encrypt_string, random_bytes, totp_code, VaultKey, SALT_LEN,
    VAULT_KEY_LEN,
};
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub legacy: bool,
    pub locked_until_ms: Option<i64>,
    pub failed_attempts: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub auto_lock_minutes: i64,
    pub clipboard_clear_seconds: i64,
    pub mcp_enabled: bool,
    pub mcp_token: String,
    pub quick_pin_set: bool,
}

const CRED_COLS: &str = "id, project_id, title, username, secret_blob, url, notes_blob, category, \
                         tags, favorite, totp_blob, custom_blob, expiry_date, last_used_at, \
                         created_at, updated_at";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn row_to_credential(
    row: &rusqlite::Row,
    key: &VaultKey,
) -> Result<Credential, rusqlite::Error> {
    let tags_json: String = row.get(8).unwrap_or_else(|_| "[]".to_string());
    let custom_blob: String = row.get(11).unwrap_or_default();
    let custom_decrypted = decrypt_string(key.as_bytes(), &custom_blob).unwrap_or_default();
    let custom: Vec<CustomField> = if custom_decrypted.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(&custom_decrypted).unwrap_or_default()
    };
    Ok(Credential {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        username: row.get(3).unwrap_or_default(),
        secret: decrypt_string(key.as_bytes(), &row.get::<_, String>(4).unwrap_or_default())
            .unwrap_or_default(),
        url: row.get(5).unwrap_or_default(),
        notes: decrypt_string(key.as_bytes(), &row.get::<_, String>(6).unwrap_or_default())
            .unwrap_or_default(),
        category: row.get(7).unwrap_or_else(|_| "other".to_string()),
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        favorite: row.get::<_, i64>(9).unwrap_or(0) != 0,
        totp_secret: decrypt_string(key.as_bytes(), &row.get::<_, String>(10).unwrap_or_default())
            .unwrap_or_default(),
        custom_fields: custom,
        expiry_date: row.get(12).unwrap_or_default(),
        last_used_at: row.get(13).unwrap_or_default(),
        created_at: row.get(14).unwrap_or_default(),
        updated_at: row.get(15).unwrap_or_default(),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn rate_limit_check(conn: &rusqlite::Connection) -> Result<(), String> {
    let locked_until: i64 = db::get_setting(conn, "locked_until_ms")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if locked_until > now_ms() {
        let secs = (locked_until - now_ms()) / 1000;
        return Err(format!(
            "Too many failed attempts. Try again in {secs} seconds."
        ));
    }
    Ok(())
}

fn record_failed_attempt(conn: &rusqlite::Connection) {
    let attempts: i64 = db::get_setting(conn, "failed_attempts")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
        + 1;
    let _ = db::set_setting(conn, "failed_attempts", &attempts.to_string());
    if attempts >= 5 {
        // Exponential backoff capped at 30 minutes.
        let delay_secs = std::cmp::min(2_i64.pow((attempts - 4).min(11) as u32) * 5, 1800);
        let until = now_ms() + delay_secs * 1000;
        let _ = db::set_setting(conn, "locked_until_ms", &until.to_string());
    }
}

fn clear_failed_attempts(conn: &rusqlite::Connection) {
    let _ = db::set_setting(conn, "failed_attempts", "0");
    let _ = db::set_setting(conn, "locked_until_ms", "0");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn vault_status(state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    let initialized = db::get_setting(&conn, "vault_key_blob").is_some();
    let legacy = db::has_legacy_vault(&conn) || db::get_setting(&conn, "pin_hash").is_some();
    let locked_until: i64 = db::get_setting(&conn, "locked_until_ms")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let attempts: i64 = db::get_setting(&conn, "failed_attempts")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Ok(VaultStatus {
        initialized,
        unlocked: state.is_unlocked(),
        legacy: legacy && !initialized,
        locked_until_ms: if locked_until > now_ms() {
            Some(locked_until)
        } else {
            None
        },
        failed_attempts: attempts,
    })
}

#[tauri::command]
pub fn setup_master_password(
    password: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Master password must be at least 8 characters".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    if db::get_setting(&conn, "vault_key_blob").is_some() {
        return Err("Vault is already initialized".to_string());
    }

    let salt = random_bytes(SALT_LEN);
    let dk = derive_key(&password, &salt)?;
    let vk = VaultKey::random();
    let blob = crate::crypto::encrypt(&dk, vk.as_bytes())?;

    db::set_setting(&conn, "master_salt", &hex::encode(&salt)).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "vault_key_blob", &hex::encode(&blob)).map_err(|e| e.to_string())?;

    state.unlock(vk);
    clear_failed_attempts(&conn);
    Ok(())
}

#[tauri::command]
pub fn unlock_vault(password: String, state: State<'_, VaultState>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    rate_limit_check(&conn)?;
    let salt_hex = db::get_setting(&conn, "master_salt").ok_or("Vault is not initialized")?;
    let blob_hex = db::get_setting(&conn, "vault_key_blob").ok_or("Vault is not initialized")?;
    let salt = hex::decode(salt_hex).map_err(|_| "Corrupt salt".to_string())?;
    let blob = hex::decode(blob_hex).map_err(|_| "Corrupt vault key".to_string())?;
    let dk = derive_key(&password, &salt)?;

    match crate::crypto::decrypt(&dk, &blob) {
        Ok(vk_bytes) if vk_bytes.len() == VAULT_KEY_LEN => {
            let mut arr = [0u8; VAULT_KEY_LEN];
            arr.copy_from_slice(&vk_bytes);
            state.unlock(VaultKey(arr));
            clear_failed_attempts(&conn);
            Ok(())
        }
        _ => {
            record_failed_attempt(&conn);
            Err("Incorrect master password".to_string())
        }
    }
}

#[tauri::command]
pub fn unlock_with_pin(pin: String, state: State<'_, VaultState>) -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    rate_limit_check(&conn)?;
    let salt_hex = db::get_setting(&conn, "quick_pin_salt").ok_or("Quick PIN is not set")?;
    let blob_hex = db::get_setting(&conn, "quick_pin_blob").ok_or("Quick PIN is not set")?;
    let salt = hex::decode(salt_hex).map_err(|_| "Corrupt PIN salt".to_string())?;
    let blob = hex::decode(blob_hex).map_err(|_| "Corrupt PIN blob".to_string())?;
    let dk = derive_key(&pin, &salt)?;

    match crate::crypto::decrypt(&dk, &blob) {
        Ok(vk_bytes) if vk_bytes.len() == VAULT_KEY_LEN => {
            let mut arr = [0u8; VAULT_KEY_LEN];
            arr.copy_from_slice(&vk_bytes);
            state.unlock(VaultKey(arr));
            clear_failed_attempts(&conn);
            Ok(())
        }
        _ => {
            record_failed_attempt(&conn);
            Err("Incorrect PIN".to_string())
        }
    }
}

#[tauri::command]
pub fn lock_vault(state: State<'_, VaultState>) -> Result<(), String> {
    state.lock();
    Ok(())
}

#[tauri::command]
pub fn touch_activity(state: State<'_, VaultState>) -> Result<i64, String> {
    if !state.is_unlocked() {
        return Ok(-1);
    }
    state.touch();
    Ok(state.idle_for().as_secs() as i64)
}

#[tauri::command]
pub fn idle_seconds(state: State<'_, VaultState>) -> Result<i64, String> {
    Ok(state.idle_for().as_secs() as i64)
}

// ── Quick PIN management ──────────────────────────────────────────────────────

#[tauri::command]
pub fn enable_quick_pin(pin: String, state: State<'_, VaultState>) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN must be at least 4 digits".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<(), String> {
        let salt = random_bytes(SALT_LEN);
        let dk = derive_key(&pin, &salt)?;
        let blob = crate::crypto::encrypt(&dk, vk.as_bytes())?;
        db::set_setting(&conn, "quick_pin_salt", &hex::encode(&salt)).map_err(|e| e.to_string())?;
        db::set_setting(&conn, "quick_pin_blob", &hex::encode(&blob)).map_err(|e| e.to_string())?;
        Ok(())
    })?
}

#[tauri::command]
pub fn disable_quick_pin() -> Result<(), String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "quick_pin_salt").map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "quick_pin_blob").map_err(|e| e.to_string())?;
    Ok(())
}

// ── Change master password ────────────────────────────────────────────────────

#[tauri::command]
pub fn change_master_password(
    current: String,
    new_password: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("New password must be at least 8 characters".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    let salt_hex = db::get_setting(&conn, "master_salt").ok_or("Vault is not initialized")?;
    let blob_hex = db::get_setting(&conn, "vault_key_blob").ok_or("Vault is not initialized")?;
    let salt = hex::decode(salt_hex).map_err(|_| "Corrupt salt".to_string())?;
    let blob = hex::decode(blob_hex).map_err(|_| "Corrupt vault key".to_string())?;
    let current_dk = derive_key(&current, &salt)?;
    let vk_bytes = crate::crypto::decrypt(&current_dk, &blob)
        .map_err(|_| "Current password is incorrect".to_string())?;

    let new_salt = random_bytes(SALT_LEN);
    let new_dk = derive_key(&new_password, &new_salt)?;
    let new_blob = crate::crypto::encrypt(&new_dk, &vk_bytes)?;
    db::set_setting(&conn, "master_salt", &hex::encode(&new_salt))
        .map_err(|e| e.to_string())?;
    db::set_setting(&conn, "vault_key_blob", &hex::encode(&new_blob))
        .map_err(|e| e.to_string())?;
    // Quick PIN is invalidated when master password changes.
    db::delete_setting(&conn, "quick_pin_salt").map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "quick_pin_blob").map_err(|e| e.to_string())?;

    // Refresh in-memory key — it didn't change but make sure state is correct.
    let mut arr = [0u8; VAULT_KEY_LEN];
    arr.copy_from_slice(&vk_bytes);
    state.unlock(VaultKey(arr));
    Ok(())
}

// ── Legacy migration ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn migrate_legacy_vault(
    old_pin: String,
    new_password: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("New master password must be at least 8 characters".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;

    // Verify old PIN against legacy SHA256 hash.
    use sha2::Digest;
    let old_hash = db::get_setting(&conn, "pin_hash").ok_or("Legacy vault not detected")?;
    let computed: String = sha2::Sha256::digest(old_pin.as_bytes())
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();
    if computed != old_hash {
        return Err("Incorrect legacy PIN".to_string());
    }

    // Set up new master password.
    let salt = random_bytes(SALT_LEN);
    let dk = derive_key(&new_password, &salt)?;
    let vk = VaultKey::random();
    let blob = crate::crypto::encrypt(&dk, vk.as_bytes())?;

    // Re-encrypt every legacy credential into the new schema.
    if db::has_legacy_vault(&conn) {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, title, username, secret, url, notes, category, \
                       created_at, updated_at FROM credentials_legacy_v0",
            )
            .map_err(|e| e.to_string())?;
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
        let rows: Vec<LegacyRow> = stmt
            .query_map([], |row| {
                Ok(LegacyRow {
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    username: row.get(3).unwrap_or_default(),
                    secret: row.get(4).unwrap_or_default(),
                    url: row.get(5).unwrap_or_default(),
                    notes: row.get(6).unwrap_or_default(),
                    category: row.get(7).unwrap_or_else(|_| "other".to_string()),
                    created_at: row.get(8).unwrap_or_default(),
                    updated_at: row.get(9).unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        for r in rows {
            let secret_blob = encrypt_string(vk.as_bytes(), &r.secret)?;
            let notes_blob = encrypt_string(vk.as_bytes(), &r.notes)?;
            conn.execute(
                "INSERT INTO credentials (project_id, title, username, secret_blob, url, \
                                          notes_blob, category, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    r.project_id,
                    r.title,
                    r.username,
                    secret_blob,
                    r.url,
                    notes_blob,
                    r.category,
                    r.created_at,
                    r.updated_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute("DROP TABLE credentials_legacy_v0", [])
            .map_err(|e| e.to_string())?;
    }

    db::set_setting(&conn, "master_salt", &hex::encode(&salt)).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "vault_key_blob", &hex::encode(&blob)).map_err(|e| e.to_string())?;
    db::delete_setting(&conn, "pin_hash").map_err(|e| e.to_string())?;
    state.unlock(vk);
    clear_failed_attempts(&conn);
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
        mcp_enabled: db::get_setting(&conn, "mcp_enabled")
            .map(|s| s == "true")
            .unwrap_or(true),
        mcp_token: db::get_setting(&conn, "mcp_token").unwrap_or_default(),
        quick_pin_set: db::get_setting(&conn, "quick_pin_blob").is_some(),
    })
}

#[tauri::command]
pub fn update_settings(
    auto_lock_minutes: i64,
    clipboard_clear_seconds: i64,
    mcp_enabled: bool,
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
    db::set_setting(&conn, "mcp_enabled", if mcp_enabled { "true" } else { "false" })
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

// ── Projects ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_projects(state: State<'_, VaultState>) -> Result<Vec<Project>, String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
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
    state: State<'_, VaultState>,
) -> Result<Project, String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
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
    state: State<'_, VaultState>,
) -> Result<Project, String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
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
pub fn delete_project(id: i64, state: State<'_, VaultState>) -> Result<(), String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

// ── Credentials ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_credentials(
    project_id: i64,
    state: State<'_, VaultState>,
) -> Result<Vec<Credential>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<Vec<Credential>, String> {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {CRED_COLS} FROM credentials WHERE project_id=?1 \
                 ORDER BY favorite DESC, title"
            ))
            .map_err(|e| e.to_string())?;
        let creds = stmt
            .query_map(params![project_id], |row| row_to_credential(row, vk))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(creds)
    })?
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
    state: State<'_, VaultState>,
) -> Result<Credential, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<Credential, String> {
        let secret_blob = encrypt_string(vk.as_bytes(), &secret)?;
        let notes_blob = encrypt_string(vk.as_bytes(), &notes)?;
        let totp_blob = encrypt_string(vk.as_bytes(), &totp_secret)?;
        let custom_json = if custom_fields.is_empty() {
            String::new()
        } else {
            serde_json::to_string(&custom_fields).unwrap_or_default()
        };
        let custom_blob = encrypt_string(vk.as_bytes(), &custom_json)?;
        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO credentials (project_id, title, username, secret_blob, url, notes_blob, \
                                      category, tags, favorite, totp_blob, custom_blob, expiry_date)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                project_id,
                title,
                username,
                secret_blob,
                url,
                notes_blob,
                category,
                tags_json,
                if favorite { 1 } else { 0 },
                totp_blob,
                custom_blob,
                expiry_date,
            ],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            &format!("SELECT {CRED_COLS} FROM credentials WHERE id=?1"),
            params![id],
            |row| row_to_credential(row, vk),
        )
        .map_err(|e| e.to_string())
    })?
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
    state: State<'_, VaultState>,
) -> Result<Credential, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<Credential, String> {
        let secret_blob = encrypt_string(vk.as_bytes(), &secret)?;
        let notes_blob = encrypt_string(vk.as_bytes(), &notes)?;
        let totp_blob = encrypt_string(vk.as_bytes(), &totp_secret)?;
        let custom_json = if custom_fields.is_empty() {
            String::new()
        } else {
            serde_json::to_string(&custom_fields).unwrap_or_default()
        };
        let custom_blob = encrypt_string(vk.as_bytes(), &custom_json)?;
        let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "UPDATE credentials SET title=?1, username=?2, secret_blob=?3, url=?4, \
                                    notes_blob=?5, category=?6, tags=?7, favorite=?8, \
                                    totp_blob=?9, custom_blob=?10, expiry_date=?11, \
                                    updated_at=datetime('now') WHERE id=?12",
            params![
                title,
                username,
                secret_blob,
                url,
                notes_blob,
                category,
                tags_json,
                if favorite { 1 } else { 0 },
                totp_blob,
                custom_blob,
                expiry_date,
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {CRED_COLS} FROM credentials WHERE id=?1"),
            params![id],
            |row| row_to_credential(row, vk),
        )
        .map_err(|e| e.to_string())
    })?
}

#[tauri::command]
pub fn delete_credential(id: i64, state: State<'_, VaultState>) -> Result<(), String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    state.touch();
    Ok(())
}

#[tauri::command]
pub fn touch_credential_used(id: i64, state: State<'_, VaultState>) -> Result<(), String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE credentials SET last_used_at=datetime('now') WHERE id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_favorite(id: i64, state: State<'_, VaultState>) -> Result<bool, String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
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
    state: State<'_, VaultState>,
) -> Result<Vec<CredentialWithProject>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<Vec<CredentialWithProject>, String> {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {CRED_COLS}, p.name as project_name FROM credentials c \
                 JOIN projects p ON c.project_id=p.id ORDER BY p.name, c.title"
            ))
            .map_err(|e| e.to_string())?;
        let results = stmt
            .query_map([], |row| {
                let cred = row_to_credential(row, vk)?;
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
        Ok(results)
    })?
}

#[tauri::command]
pub fn search_credentials(
    query: String,
    state: State<'_, VaultState>,
) -> Result<Vec<CredentialWithProject>, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query);
    state.with_key(|vk| -> Result<Vec<CredentialWithProject>, String> {
        // Two-stage search: SQL LIKE on plaintext columns (title, username, url),
        // plus a post-decrypt scan over notes/secret/custom fields.
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {CRED_COLS}, p.name as project_name FROM credentials c \
                 JOIN projects p ON c.project_id=p.id ORDER BY p.name, c.title"
            ))
            .map_err(|e| e.to_string())?;
        let q_lower = query.to_lowercase();
        let p_lower = pattern.to_lowercase();
        let results: Vec<CredentialWithProject> = stmt
            .query_map([], |row| {
                let cred = row_to_credential(row, vk)?;
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
        Ok(results)
    })?
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
    state: State<'_, VaultState>,
) -> Result<TotpResult, String> {
    let conn = db::open().map_err(|e| e.to_string())?;
    state.with_key(|vk| -> Result<TotpResult, String> {
        let totp_blob: String = conn
            .query_row(
                "SELECT totp_blob FROM credentials WHERE id=?1",
                params![credential_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let secret = decrypt_string(vk.as_bytes(), &totp_blob)?;
        if secret.is_empty() {
            return Err("No TOTP secret configured".to_string());
        }
        let (code, remaining) = totp_code(&secret, 30, 6)?;
        Ok(TotpResult {
            code,
            remaining_seconds: remaining,
        })
    })?
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
    state: State<'_, VaultState>,
) -> Result<String, String> {
    if password.len() < 8 {
        return Err("Backup password must be at least 8 characters".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    let projects: Vec<Project> = state.with_key(|_vk| -> Result<Vec<Project>, String> {
        let mut stmt = conn
            .prepare("SELECT id, name, description, color, created_at FROM projects ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<Project> = stmt
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
        Ok(rows)
    })??;
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
    state: State<'_, VaultState>,
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
    state.with_key(|vk| -> Result<i64, String> {
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
            let secret_blob = encrypt_string(vk.as_bytes(), &c.secret)?;
            let notes_blob = encrypt_string(vk.as_bytes(), &c.notes)?;
            let totp_blob = encrypt_string(vk.as_bytes(), &c.totp_secret)?;
            let custom_json = if c.custom_fields.is_empty() {
                String::new()
            } else {
                serde_json::to_string(&c.custom_fields).unwrap_or_default()
            };
            let custom_blob = encrypt_string(vk.as_bytes(), &custom_json)?;
            let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "INSERT INTO credentials (project_id, title, username, secret_blob, url, notes_blob, \
                                          category, tags, favorite, totp_blob, custom_blob, expiry_date)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    target_pid,
                    c.title,
                    c.username,
                    secret_blob,
                    c.url,
                    notes_blob,
                    c.category,
                    tags_json,
                    if c.favorite { 1 } else { 0 },
                    totp_blob,
                    custom_blob,
                    c.expiry_date,
                ],
            )
            .map_err(|e| e.to_string())?;
            imported += 1;
        }
        Ok(imported)
    })?
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
pub fn delete_all_data(state: State<'_, VaultState>) -> Result<(), String> {
    if !state.is_unlocked() {
        return Err("Vault is locked".to_string());
    }
    let conn = db::open().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects", [])
        .map_err(|e| e.to_string())?;
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
