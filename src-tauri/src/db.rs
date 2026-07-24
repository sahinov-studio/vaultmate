use rusqlite::{params, Connection, Result};

#[allow(dead_code)]
pub const SCHEMA_VERSION: i64 = 3;

pub fn get_db_path() -> String {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    let dir = format!("{}/vaultmate", app_data);
    std::fs::create_dir_all(&dir).ok();
    format!("{}/vaultmate.db", dir)
}

pub fn open() -> Result<Connection> {
    let conn = Connection::open(get_db_path())?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

pub fn init_db() -> Result<()> {
    let conn = open()?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS projects (
             id          INTEGER PRIMARY KEY AUTOINCREMENT,
             name        TEXT NOT NULL,
             description TEXT NOT NULL DEFAULT '',
             color       TEXT NOT NULL DEFAULT 'indigo',
             created_at  TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;
    run_migrations(&conn)?;
    Ok(())
}

fn current_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT value FROM settings WHERE key='schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(0)
}

fn set_version(conn: &Connection, v: i64) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?1)",
        params![v.to_string()],
    )?;
    Ok(())
}

/// Run migrations from the current version up to [`SCHEMA_VERSION`].
///
/// Important: migration v0 → v1 only creates the new credentials table when
/// no credentials exist yet. If the user has v0.1.0 data with plaintext
/// secrets, the actual data migration (re-encryption) is gated behind the
/// `migrate_legacy_vault` command which requires the old PIN + a new
/// master password.
fn run_migrations(conn: &Connection) -> Result<()> {
    let v = current_version(conn);

    if v < 1 {
        // v1: introduce master password / vault key + new credentials table.
        // Detect a v0.1.0 install by looking for the old `credentials` table
        // with the legacy `secret` column.
        let has_old_creds = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='credentials'",
                [],
                |_| Ok(()),
            )
            .is_ok();
        let has_old_secret_col = if has_old_creds {
            let mut stmt = conn.prepare("PRAGMA table_info(credentials)")?;
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .filter_map(|r| r.ok())
                .collect();
            cols.iter().any(|c| c == "secret")
        } else {
            false
        };

        if has_old_creds && has_old_secret_col {
            // Rename old table to be re-keyed by `migrate_legacy_vault`.
            conn.execute("ALTER TABLE credentials RENAME TO credentials_legacy_v0", [])?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS credentials (
                 id           INTEGER PRIMARY KEY AUTOINCREMENT,
                 project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 title        TEXT NOT NULL,
                 username     TEXT NOT NULL DEFAULT '',
                 secret_blob  TEXT NOT NULL DEFAULT '',
                 url          TEXT NOT NULL DEFAULT '',
                 notes_blob   TEXT NOT NULL DEFAULT '',
                 category     TEXT NOT NULL DEFAULT 'other',
                 tags         TEXT NOT NULL DEFAULT '[]',
                 favorite     INTEGER NOT NULL DEFAULT 0,
                 totp_blob    TEXT NOT NULL DEFAULT '',
                 custom_blob  TEXT NOT NULL DEFAULT '',
                 expiry_date  TEXT NOT NULL DEFAULT '',
                 last_used_at TEXT NOT NULL DEFAULT '',
                 created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE INDEX IF NOT EXISTS idx_cred_project  ON credentials(project_id);
             CREATE INDEX IF NOT EXISTS idx_cred_category ON credentials(category);
             CREATE INDEX IF NOT EXISTS idx_cred_favorite ON credentials(favorite);",
        )?;

        set_version(conn, 1)?;
    }

    if v < 2 {
        // v2: ensure default settings exist (auto-lock, clipboard, MCP token).
        let defaults = [
            ("auto_lock_minutes", "5"),
            ("clipboard_clear_seconds", "30"),
            ("mcp_enabled", "true"),
        ];
        for (k, def) in defaults {
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM settings WHERE key=?1",
                    params![k],
                    |_| Ok(()),
                )
                .is_ok();
            if !exists {
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                    params![k, def],
                )?;
            }
        }

        // Generate MCP token if missing.
        let token_exists: bool = conn
            .query_row(
                "SELECT 1 FROM settings WHERE key='mcp_token'",
                [],
                |_| Ok(()),
            )
            .is_ok();
        if !token_exists {
            use rand::RngCore;
            let mut buf = [0u8; 24];
            rand::thread_rng().fill_bytes(&mut buf);
            let token = hex::encode(buf);
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('mcp_token', ?1)",
                params![token],
            )?;
        }
        set_version(conn, 2)?;
    }

    if v < 3 {
        // v3: drop at-rest encryption. Column rename only — content may still
        // be ciphertext at this point for vaults that haven't run the
        // interactive `finish_migration` command yet; `needs_migration()`
        // gates all reads/writes until that happens.
        conn.execute_batch(
            "ALTER TABLE credentials RENAME COLUMN secret_blob TO secret;
             ALTER TABLE credentials RENAME COLUMN notes_blob TO notes;
             ALTER TABLE credentials RENAME COLUMN totp_blob TO totp_secret;
             ALTER TABLE credentials RENAME COLUMN custom_blob TO custom_fields;",
        )?;
        set_version(conn, 3)?;
    }

    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn delete_setting(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key=?1", params![key])?;
    Ok(())
}

pub fn has_legacy_vault(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='credentials_legacy_v0'",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

/// True until the one-time `finish_migration` command has flattened this
/// vault to plaintext — any of these being present means some data may still
/// be ciphertext (or, for the ancient legacy table, in a separate schema
/// entirely) and reads/writes must be blocked until migration completes.
pub fn needs_migration(conn: &Connection) -> bool {
    get_setting(conn, "vault_key_blob").is_some()
        || get_setting(conn, "dpapi_vault_key_blob").is_some()
        || has_legacy_vault(conn)
}
