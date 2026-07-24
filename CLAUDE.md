# CLAUDE.md — VaultMate

## What This Project Is
A local, single-user Windows desktop app (Tauri v2 + React/TypeScript) for storing project
credentials (API keys, tokens, passwords). Exposes a local-only MCP server on
`127.0.0.1:43218`, bearer-token gated, so Claude Code can read/create/update/delete
credentials directly — this is also the project referenced as "VaultMate" in the global
`~/.claude/CLAUDE.md` credential-lookup hierarchy.

**Live URL:** N/A — local desktop app only, no backend service.

---

## Tech Stack Overrides
Not a Supabase project — this predates and is independent of the global stack defaults.

| Layer | This project uses |
|-------|-----------------|
| Backend | Rust (Tauri v2 commands) + `rusqlite` (SQLite, `%APPDATA%/vaultmate/vaultmate.db`) |
| Frontend | React + TypeScript, Zustand (`store.ts`), Tailwind |
| Integration | Local-only HTTP MCP server (`src-tauri/src/mcp.rs`), bearer-token auth |

---

## Deviations from Global CLAUDE.md

**No at-rest encryption on credential data** (global: "ALWAYS enable Row Level Security... never expose secrets in plaintext" equivalent for local apps) → VaultMate stores all credential fields (`secret`, `notes`, `totp_secret`, `custom_fields`) as **plaintext** in `vaultmate.db`. There is no master password, no cryptographic vault key, and no DPAPI wrapping at runtime.

**Reason:** deliberate owner decision (2026-07-24). The app previously used AES-256-GCM encryption with a master-password/DPAPI-derived key. The owner explicitly rejected finishing a zero-friction *encrypted* auto-unlock migration (which was proposed and would have kept encryption intact) and instead asked to remove encryption entirely in favor of a simple local PIN, stating this is a local-only, single-user app and the risk is accepted. Claude pushed back once (malware/exfiltration risk — infostealers commonly target unencrypted local credential stores) and the owner confirmed the decision after hearing it.

**What remains:** an optional 4+ digit "screen lock PIN" (Settings → Security) is a **UI nuisance-gate only**, not a security boundary — it never gates MCP access, only the bearer token does (matching a Supabase personal-access-token model). Backup export/import (`export_backup`/`import_backup`) still password-encrypts the exported *file* — a portable backup is a meaningfully different risk (casually emailed/uploaded) than the live local DB, so that layer was kept.

**Scope:** applies only to VaultMate's own data model. Does not change the encryption stance for any other project, and does not change how VaultMate itself is *used* as the global credential store for other projects (per `~/.claude/CLAUDE.md` §9) — reading/writing secrets through it still goes exclusively through its MCP tools, never raw SQLite.

---

## MCP Integration Notes
- MCP server starts with the app process and needs VaultMate running (tray or foreground) to be reachable — "Start at login" (Settings → Startup) is opt-in, not defaulted on.
- A vault created before 2026-07-24 needs a one-time interactive step (`FinalUnlockScreen`, entering the last master password/PIN) to flatten existing encrypted data to plaintext — gated by `vault_status.needs_migration`. Fresh installs skip this entirely.
