use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;

use serde_json::Value;

use crate::crypto::{decrypt_string, encrypt_string};
use crate::db;
use crate::state::VaultState;

const MCP_PORT: u16 = 43218;

pub fn start_mcp_server(state: Arc<VaultState>) {
    std::thread::spawn(move || {
        let listener =
            match std::net::TcpListener::bind(format!("127.0.0.1:{MCP_PORT}")) {
                Ok(l) => l,
                Err(_) => return,
            };
        for stream in listener.incoming() {
            let state = Arc::clone(&state);
            if let Ok(mut s) = stream {
                std::thread::spawn(move || handle_connection(&mut s, state));
            }
        }
    });
}

fn handle_connection(stream: &mut TcpStream, state: Arc<VaultState>) {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();

    let Some((first_line, headers, body)) = read_http_request(stream) else {
        return;
    };

    let method = first_line.split_whitespace().next().unwrap_or("");

    if method == "OPTIONS" {
        let _ = stream.write_all(
            b"HTTP/1.1 204 No Content\r\n\
              Access-Control-Allow-Origin: *\r\n\
              Access-Control-Allow-Methods: POST, OPTIONS\r\n\
              Access-Control-Allow-Headers: Content-Type, Authorization\r\n\r\n",
        );
        return;
    }

    let conn = match db::open() {
        Ok(c) => c,
        Err(_) => {
            send_status(stream, 500, r#"{"error":"Database unavailable"}"#);
            return;
        }
    };

    let mcp_enabled = db::get_setting(&conn, "mcp_enabled")
        .map(|s| s == "true")
        .unwrap_or(true);
    if !mcp_enabled {
        send_status(stream, 403, r#"{"error":"MCP server is disabled"}"#);
        return;
    }

    // Bearer-token auth.
    let stored_token = db::get_setting(&conn, "mcp_token").unwrap_or_default();
    let auth = headers.get("authorization").map(|s| s.as_str()).unwrap_or("");
    let provided = auth.strip_prefix("Bearer ").unwrap_or("");
    if stored_token.is_empty() || provided != stored_token {
        send_status(stream, 401, r#"{"error":"Unauthorized: invalid MCP token"}"#);
        return;
    }

    if !state.is_unlocked() {
        send_status(
            stream,
            423,
            r#"{"error":"Vault is locked. Unlock VaultMate to use MCP."}"#,
        );
        return;
    }

    let response_body = handle_mcp_request(&body, &state);

    if response_body.is_empty() {
        let _ = stream.write_all(
            b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        );
        return;
    }

    let _ = stream.write_all(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
            response_body.len(),
            response_body
        )
        .as_bytes(),
    );
}

fn send_status(stream: &mut TcpStream, code: u16, body: &str) {
    let reason = match code {
        401 => "Unauthorized",
        403 => "Forbidden",
        423 => "Locked",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{body}",
            body.len()
        )
        .as_bytes(),
    );
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Option<(String, HashMap<String, String>, String)> {
    let mut data: Vec<u8> = Vec::new();
    let mut buf = [0u8; 4096];

    loop {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                data.extend_from_slice(&buf[..n]);
                if let Some(hdr_end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                    let hdr_str = String::from_utf8_lossy(&data[..hdr_end]);
                    let cl = extract_content_length(&hdr_str);
                    if data.len() >= hdr_end + 4 + cl {
                        break;
                    }
                }
                if n < buf.len() {
                    break;
                }
            }
        }
    }

    let hdr_end = data.windows(4).position(|w| w == b"\r\n\r\n")?;
    let hdr_str = String::from_utf8_lossy(&data[..hdr_end]).to_string();
    let first_line = hdr_str.lines().next()?.to_string();

    let mut headers = HashMap::new();
    for line in hdr_str.lines().skip(1) {
        if let Some(pos) = line.find(':') {
            headers.insert(
                line[..pos].trim().to_lowercase(),
                line[pos + 1..].trim().to_string(),
            );
        }
    }

    let cl: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let body_start = hdr_end + 4;
    let body_end = (body_start + cl).min(data.len());
    let body = String::from_utf8_lossy(&data[body_start..body_end]).to_string();

    Some((first_line, headers, body))
}

fn extract_content_length(headers: &str) -> usize {
    for line in headers.lines() {
        if line.to_lowercase().starts_with("content-length:") {
            if let Ok(n) = line[15..].trim().parse::<usize>() {
                return n;
            }
        }
    }
    0
}

// ── MCP Protocol ─────────────────────────────────────────────────────────────

fn handle_mcp_request(body: &str, state: &VaultState) -> String {
    let Ok(req) = serde_json::from_str::<Value>(body) else {
        return json_rpc_error(None, -32700, "Parse error");
    };

    let id = req.get("id").cloned();
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = req
        .get("params")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    match method {
        "initialize" => json_rpc_ok(
            id,
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "vaultmate", "version": env!("CARGO_PKG_VERSION") }
            }),
        ),
        "notifications/initialized" | "notifications/cancelled" => String::new(),
        "ping" => json_rpc_ok(id, serde_json::json!({})),
        "tools/list" => json_rpc_ok(id, serde_json::json!({ "tools": tool_list() })),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            match call_tool(name, &args, state) {
                Ok(text) => json_rpc_ok(
                    id,
                    serde_json::json!({ "content": [{ "type": "text", "text": text }] }),
                ),
                Err(e) => json_rpc_error(id, -32603, &e),
            }
        }
        _ => {
            if id.is_some() {
                json_rpc_error(id, -32601, "Method not found")
            } else {
                String::new()
            }
        }
    }
}

fn json_rpc_ok(id: Option<Value>, result: Value) -> String {
    serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0", "id": id, "result": result
    }))
    .unwrap_or_default()
}

fn json_rpc_error(id: Option<Value>, code: i32, message: &str) -> String {
    serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0", "id": id,
        "error": { "code": code, "message": message }
    }))
    .unwrap_or_default()
}

fn tool_list() -> Value {
    serde_json::json!([
        {
            "name": "list_projects",
            "description": "List all projects stored in VaultMate",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        },
        {
            "name": "list_credentials",
            "description": "List all credentials (including secrets) for a project",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name" }
                },
                "required": ["project_name"]
            }
        },
        {
            "name": "get_credential",
            "description": "Get a specific credential by project name and credential title",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name" },
                    "title": { "type": "string", "description": "Credential title" }
                },
                "required": ["project_name", "title"]
            }
        },
        {
            "name": "search_credentials",
            "description": "Search credentials across all projects by keyword",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search keyword" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "create_project",
            "description": "Create a new project in VaultMate. No-op with a friendly message if a project with this name already exists.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Project name" },
                    "description": { "type": "string", "description": "Optional short description" },
                    "color": { "type": "string", "description": "Optional color, e.g. 'indigo', 'blue', 'green' (default: indigo)" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "update_project",
            "description": "Update a project's name, description, or color. Only fields provided are changed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Current project name" },
                    "new_name": { "type": "string", "description": "New project name (optional)" },
                    "description": { "type": "string", "description": "New description (optional)" },
                    "color": { "type": "string", "description": "New color (optional)" }
                },
                "required": ["project_name"]
            }
        },
        {
            "name": "delete_project",
            "description": "Delete a project and all of its credentials. This cannot be undone.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name to delete" }
                },
                "required": ["project_name"]
            }
        },
        {
            "name": "create_credential",
            "description": "Create a new credential under a project. The project is created automatically if it doesn't already exist.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name (created if missing)" },
                    "title": { "type": "string", "description": "Credential title" },
                    "secret": { "type": "string", "description": "The secret value (password, API key, token, etc.)" },
                    "username": { "type": "string", "description": "Optional username/email" },
                    "url": { "type": "string", "description": "Optional URL" },
                    "notes": { "type": "string", "description": "Optional notes" },
                    "category": { "type": "string", "description": "Optional category (default: other)" },
                    "favorite": { "type": "boolean", "description": "Optional favorite flag (default: false)" }
                },
                "required": ["project_name", "title", "secret"]
            }
        },
        {
            "name": "update_credential",
            "description": "Update an existing credential, found by project name + title. Only fields provided are changed — omitted fields keep their current value.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name" },
                    "title": { "type": "string", "description": "Credential title to find" },
                    "new_title": { "type": "string", "description": "New title (optional)" },
                    "secret": { "type": "string", "description": "New secret value (optional)" },
                    "username": { "type": "string", "description": "New username (optional)" },
                    "url": { "type": "string", "description": "New URL (optional)" },
                    "notes": { "type": "string", "description": "New notes (optional)" },
                    "category": { "type": "string", "description": "New category (optional)" },
                    "favorite": { "type": "boolean", "description": "New favorite flag (optional)" }
                },
                "required": ["project_name", "title"]
            }
        },
        {
            "name": "delete_credential",
            "description": "Delete a credential, found by project name + title. This cannot be undone.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": { "type": "string", "description": "Project name" },
                    "title": { "type": "string", "description": "Credential title to delete" }
                },
                "required": ["project_name", "title"]
            }
        }
    ])
}

fn call_tool(name: &str, args: &Value, state: &VaultState) -> Result<String, String> {
    let conn = rusqlite::Connection::open(db::get_db_path()).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;").ok();

    match name {
        "list_projects" => {
            let mut stmt = conn
                .prepare("SELECT name, description FROM projects ORDER BY name")
                .map_err(|e| e.to_string())?;
            let rows: Vec<String> = stmt
                .query_map([], |row| {
                    let n: String = row.get(0)?;
                    let d: String = row.get(1).unwrap_or_default();
                    Ok(if d.is_empty() {
                        format!("- {n}")
                    } else {
                        format!("- {n} - {d}")
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(if rows.is_empty() {
                "No projects found.".into()
            } else {
                format!("Projects:\n{}", rows.join("\n"))
            })
        }

        "list_credentials" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            state.with_key(|vk| {
                let mut stmt = conn
                    .prepare(
                        "SELECT c.title, c.username, c.secret_blob, c.url, c.category \
                         FROM credentials c JOIN projects p ON c.project_id=p.id \
                         WHERE p.name=?1 ORDER BY c.title",
                    )
                    .map_err(|e| e.to_string())?;
                let rows: Vec<String> = stmt
                    .query_map(rusqlite::params![project_name], |row| {
                        let title: String = row.get(0)?;
                        let user: String = row.get(1).unwrap_or_default();
                        let secret_blob: String = row.get(2).unwrap_or_default();
                        let url: String = row.get(3).unwrap_or_default();
                        let cat: String = row.get(4).unwrap_or_default();
                        let secret =
                            decrypt_string(vk.as_bytes(), &secret_blob).unwrap_or_default();
                        Ok(format!(
                            "[{cat}] {title}\n  username: {user}\n  secret: {secret}\n  url: {url}"
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok::<String, String>(if rows.is_empty() {
                    format!("No credentials found for project '{project_name}'.")
                } else {
                    format!("Credentials for '{project_name}':\n\n{}", rows.join("\n\n"))
                })
            })?
        }

        "get_credential" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            state.with_key(|vk| {
                let result = conn.query_row(
                    "SELECT c.title, c.username, c.secret_blob, c.url, c.notes_blob, c.category \
                     FROM credentials c JOIN projects p ON c.project_id=p.id \
                     WHERE p.name=?1 AND c.title=?2",
                    rusqlite::params![project_name, title],
                    |row| {
                        let t: String = row.get(0)?;
                        let u: String = row.get(1).unwrap_or_default();
                        let sb: String = row.get(2).unwrap_or_default();
                        let url: String = row.get(3).unwrap_or_default();
                        let nb: String = row.get(4).unwrap_or_default();
                        let cat: String = row.get(5).unwrap_or_default();
                        let secret = decrypt_string(vk.as_bytes(), &sb).unwrap_or_default();
                        let notes = decrypt_string(vk.as_bytes(), &nb).unwrap_or_default();
                        Ok(format!(
                            "Title: {t}\nCategory: {cat}\nUsername: {u}\nSecret: {secret}\nURL: {url}\nNotes: {notes}"
                        ))
                    },
                );
                Ok::<String, String>(result.unwrap_or_else(|_| {
                    format!("Credential '{title}' not found in project '{project_name}'.")
                }))
            })?
        }

        "search_credentials" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let pattern = format!("%{query}%");
            state.with_key(|vk| {
                let mut stmt = conn
                    .prepare(
                        "SELECT p.name, c.title, c.username, c.secret_blob, c.url, c.category \
                         FROM credentials c JOIN projects p ON c.project_id=p.id \
                         WHERE c.title LIKE ?1 OR c.username LIKE ?1 OR c.url LIKE ?1 \
                         ORDER BY p.name, c.title",
                    )
                    .map_err(|e| e.to_string())?;
                let rows: Vec<String> = stmt
                    .query_map(rusqlite::params![pattern], |row| {
                        let proj: String = row.get(0)?;
                        let title: String = row.get(1)?;
                        let user: String = row.get(2).unwrap_or_default();
                        let sb: String = row.get(3).unwrap_or_default();
                        let url: String = row.get(4).unwrap_or_default();
                        let cat: String = row.get(5).unwrap_or_default();
                        let secret =
                            decrypt_string(vk.as_bytes(), &sb).unwrap_or_default();
                        Ok(format!(
                            "[{cat}] {proj} / {title}\n  username: {user}\n  secret: {secret}\n  url: {url}"
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok::<String, String>(if rows.is_empty() {
                    format!("No credentials found matching '{query}'.")
                } else {
                    format!("Search results for '{query}':\n\n{}", rows.join("\n\n"))
                })
            })?
        }

        "create_project" => {
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                return Err("'name' is required".to_string());
            }
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM projects WHERE name=?1",
                    rusqlite::params![name],
                    |row| row.get(0),
                )
                .ok();
            if existing.is_some() {
                return Ok(format!("Project '{name}' already exists — nothing changed."));
            }
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let color = args
                .get("color")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("indigo");
            conn.execute(
                "INSERT INTO projects (name, description, color) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, description, color],
            )
            .map_err(|e| e.to_string())?;
            state.touch();
            Ok(format!("Created project '{name}'."))
        }

        "update_project" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let (id, cur_name, cur_desc, cur_color): (i64, String, String, String) = conn
                .query_row(
                    "SELECT id, name, description, color FROM projects WHERE name=?1",
                    rusqlite::params![project_name],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2).unwrap_or_default(),
                            row.get(3).unwrap_or_else(|_| "indigo".to_string()),
                        ))
                    },
                )
                .map_err(|_| format!("Project '{project_name}' not found."))?;
            let new_name = args
                .get("new_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&cur_name);
            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or(&cur_desc);
            let color = args
                .get("color")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&cur_color);
            conn.execute(
                "UPDATE projects SET name=?1, description=?2, color=?3 WHERE id=?4",
                rusqlite::params![new_name, description, color, id],
            )
            .map_err(|e| e.to_string())?;
            state.touch();
            Ok(format!("Updated project '{project_name}' -> '{new_name}'."))
        }

        "delete_project" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let changed = conn
                .execute(
                    "DELETE FROM projects WHERE name=?1",
                    rusqlite::params![project_name],
                )
                .map_err(|e| e.to_string())?;
            state.touch();
            if changed == 0 {
                Ok(format!("Project '{project_name}' not found — nothing deleted."))
            } else {
                Ok(format!("Deleted project '{project_name}' and its credentials."))
            }
        }

        "create_credential" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let secret = args.get("secret").and_then(|v| v.as_str()).unwrap_or("");
            if project_name.is_empty() || title.is_empty() {
                return Err("'project_name' and 'title' are required".to_string());
            }
            let project_id: i64 = match conn.query_row(
                "SELECT id FROM projects WHERE name=?1",
                rusqlite::params![project_name],
                |row| row.get(0),
            ) {
                Ok(id) => id,
                Err(_) => {
                    conn.execute(
                        "INSERT INTO projects (name, description, color) VALUES (?1, '', 'indigo')",
                        rusqlite::params![project_name],
                    )
                    .map_err(|e| e.to_string())?;
                    conn.last_insert_rowid()
                }
            };
            let username = args.get("username").and_then(|v| v.as_str()).unwrap_or("");
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let notes = args.get("notes").and_then(|v| v.as_str()).unwrap_or("");
            let category = args
                .get("category")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("other");
            let favorite = args.get("favorite").and_then(|v| v.as_bool()).unwrap_or(false);
            state.with_key(|vk| {
                let secret_blob = encrypt_string(vk.as_bytes(), secret)?;
                let notes_blob = encrypt_string(vk.as_bytes(), notes)?;
                conn.execute(
                    "INSERT INTO credentials (project_id, title, username, secret_blob, url, \
                                              notes_blob, category, tags, favorite, totp_blob, \
                                              custom_blob, expiry_date) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,'[]',?8,'','','')",
                    rusqlite::params![
                        project_id,
                        title,
                        username,
                        secret_blob,
                        url,
                        notes_blob,
                        category,
                        if favorite { 1 } else { 0 },
                    ],
                )
                .map_err(|e| e.to_string())?;
                Ok::<String, String>(format!(
                    "Created credential '{title}' in project '{project_name}'."
                ))
            })?
            .map(|msg| {
                state.touch();
                msg
            })
        }

        "update_credential" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            state.with_key(|vk| {
                let (id, cur_username, cur_secret_blob, cur_url, cur_notes_blob, cur_category, cur_favorite): (
                    i64, String, String, String, String, String, i64,
                ) = conn
                    .query_row(
                        "SELECT c.id, c.username, c.secret_blob, c.url, c.notes_blob, c.category, c.favorite \
                         FROM credentials c JOIN projects p ON c.project_id=p.id \
                         WHERE p.name=?1 AND c.title=?2",
                        rusqlite::params![project_name, title],
                        |row| {
                            Ok((
                                row.get(0)?,
                                row.get(1).unwrap_or_default(),
                                row.get(2).unwrap_or_default(),
                                row.get(3).unwrap_or_default(),
                                row.get(4).unwrap_or_default(),
                                row.get(5).unwrap_or_else(|_| "other".to_string()),
                                row.get(6).unwrap_or(0),
                            ))
                        },
                    )
                    .map_err(|_| {
                        format!("Credential '{title}' not found in project '{project_name}'.")
                    })?;

                let new_title = args
                    .get("new_title")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(title);
                let username = args.get("username").and_then(|v| v.as_str()).unwrap_or(&cur_username);
                let url = args.get("url").and_then(|v| v.as_str()).unwrap_or(&cur_url);
                let category = args
                    .get("category")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&cur_category);
                let favorite = args
                    .get("favorite")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(cur_favorite != 0);

                // Secret/notes stay encrypted at rest — only re-encrypt if a new
                // plaintext value was actually provided; otherwise keep the
                // existing ciphertext blob untouched.
                let secret_blob = match args.get("secret").and_then(|v| v.as_str()) {
                    Some(s) => encrypt_string(vk.as_bytes(), s)?,
                    None => cur_secret_blob,
                };
                let notes_blob = match args.get("notes").and_then(|v| v.as_str()) {
                    Some(s) => encrypt_string(vk.as_bytes(), s)?,
                    None => cur_notes_blob,
                };

                conn.execute(
                    "UPDATE credentials SET title=?1, username=?2, secret_blob=?3, url=?4, \
                                            notes_blob=?5, category=?6, favorite=?7, \
                                            updated_at=datetime('now') WHERE id=?8",
                    rusqlite::params![
                        new_title,
                        username,
                        secret_blob,
                        url,
                        notes_blob,
                        category,
                        if favorite { 1 } else { 0 },
                        id,
                    ],
                )
                .map_err(|e| e.to_string())?;
                Ok::<String, String>(format!(
                    "Updated credential '{title}' in project '{project_name}'."
                ))
            })?
            .map(|msg| {
                state.touch();
                msg
            })
        }

        "delete_credential" => {
            let project_name = args
                .get("project_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let changed = conn
                .execute(
                    "DELETE FROM credentials WHERE title=?2 AND project_id = \
                     (SELECT id FROM projects WHERE name=?1)",
                    rusqlite::params![project_name, title],
                )
                .map_err(|e| e.to_string())?;
            state.touch();
            if changed == 0 {
                Ok(format!(
                    "Credential '{title}' not found in project '{project_name}' — nothing deleted."
                ))
            } else {
                Ok(format!(
                    "Deleted credential '{title}' from project '{project_name}'."
                ))
            }
        }

        _ => Err(format!("Unknown tool: {name}")),
    }
}
