use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;

use serde_json::Value;

use crate::crypto::decrypt_string;
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

        _ => Err(format!("Unknown tool: {name}")),
    }
}
