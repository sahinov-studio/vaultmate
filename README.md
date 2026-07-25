# VaultMate

A local-first credentials manager for developers — built with Tauri (Rust + React) and ships with a built-in MCP server so Claude Code and other AI assistants can read, create, update, and delete your secrets directly, with zero copy-paste and zero unlock friction.

> **Local-only.** Your data never leaves your machine. There is no cloud sync, no analytics, no telemetry.
>
> **No at-rest encryption.** This is a deliberate design choice, not an oversight — see [Security Model](#security-model) before you decide whether VaultMate fits your threat model.

---

## Features

- **Zero-friction MCP** — no unlock step, ever. VaultMate's MCP server is gated purely by a bearer token, same as a Supabase personal access token — as long as VaultMate is running, Claude Code can use it
- **Optional local screen-lock PIN** — a UI privacy convenience (Settings → Security), not a security boundary; it never gates MCP access, and if you never set one the app never gates access at all
- **Auto-lock the screen on idle** — if a PIN is set, the screen re-locks after configurable inactivity (default 5 min); meaningless/no-op if no PIN is set
- **15 categories** — Login, API Key, Database, SSH Key, Token, Env Variable, Credit Card, Wi-Fi, Crypto Wallet, Software License, Server, Secure Note, Identity, Email Account, Other
- **Rich credential fields** — title, username, secret, URL, notes, tags, favorite, expiry date, custom fields, TOTP/2FA secret
- **TOTP code generation** — built-in 2FA code generator with 30-second countdown (RFC 6238)
- **Password generator** — configurable length, character classes, ambiguity-avoidance
- **Password-protected backup & restore** — export your entire vault to a single password-encrypted `.vmbackup` file (the export file itself is still real AES-256-GCM encryption, independent of the live database's plaintext storage)
- **Excel import** — auto-detect credential columns from `.xlsx`/`.xls`/`.csv` files
- **Full-CRUD MCP server** — local HTTP server on port 43218, bearer-token auth, lets Claude Code list, search, create, update, and delete both projects and credentials
- **Dark / light themes** — toggle in the sidebar
- **Cross-platform** — Windows, macOS, Linux

---

## Install

Pre-built installers are published on the [Releases page](https://github.com/sahinov-studio/vaultmate/releases):

- **Windows**: download `VaultMate_<version>_x64-setup.exe` or the `.msi` installer
- **macOS**: download `VaultMate_<version>_x64.dmg` (Intel) or `VaultMate_<version>_aarch64.dmg` (Apple Silicon)
- **Linux**: download the `.AppImage` or `.deb` package

> **Code signing notice.** VaultMate is distributed unsigned because code-signing certificates are expensive ($300–400/yr for Windows EV, $99/yr for Apple). On first run:
>
> - **Windows**: SmartScreen will warn "Windows protected your PC". Click **More info → Run anyway**.
> - **macOS**: right-click the app → **Open** → **Open** to bypass Gatekeeper.
>
> If you don't trust unsigned binaries, build from source — the instructions are below.

---

## First Run

1. Launch VaultMate — it opens straight to your projects. No setup step, no password to create.
2. (Optional) In Settings → Security, set a local screen-lock PIN if you want a privacy gate on the window itself — purely a UI convenience, not encryption (see [Security Model](#security-model)).
3. Create your first project, then start adding credentials.
4. Want Claude Code to use it directly? See [Connect to Claude Code](#connect-to-claude-code) below.

---

## Backups (do this on day one)

Sidebar → **Export Backup** writes every project and credential to an AES-256-GCM-encrypted JSON file, protected by a password you choose at export time.

Without a backup, a corrupted or deleted database file means total data loss — there's no server-side copy anywhere. **Take a backup before you trust the app with anything important.**

---

## MCP Server (Claude Code integration)

VaultMate runs a local HTTP server on `127.0.0.1:43218` while it's open. Authentication uses a bearer token shown in **Settings → MCP** — that token is the *only* gate. There's no unlock step: as long as VaultMate is running, the MCP server works, regardless of whether the optional screen-lock PIN is currently locked.

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "vaultmate": {
      "url": "http://127.0.0.1:43218",
      "headers": {
        "Authorization": "Bearer <token-from-settings>"
      }
    }
  }
}
```

(See [Connect to Claude Code](#connect-to-claude-code) below for a guided setup you can hand to Claude Code itself instead of doing this by hand.)

Available tools:

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects |
| `list_credentials` | List all credentials in a project (returns secrets to the local MCP client) |
| `get_credential` | Get one credential by project + title |
| `search_credentials` | Substring search across title / username / URL / notes / tags / category |
| `create_project` | Create a new project |
| `update_project` | Update a project's name, description, or color |
| `delete_project` | Delete a project and all its credentials |
| `create_credential` | Create a new credential (auto-creates the project if missing) |
| `update_credential` | Partial update — only pass the fields that changed |
| `delete_credential` | Delete a credential |

A `423` response means this vault still has old encrypted data from before at-rest encryption was removed (see [Security Model](#security-model)) — open VaultMate and complete the one-time migration screen. Otherwise, every call above works with zero prompts.

---

## Connect to Claude Code

The fastest way to wire up the MCP integration is to hand it to Claude Code itself. This
repo ships a [Claude Code skill](.claude/skills/connect-vaultmate.md) that walks through
getting the token, registering the MCP server, and verifying it end to end.

**Download just the skill file** and drop it into your personal skills folder:

```bash
curl -o ~/.claude/skills/connect-vaultmate.md \
  https://raw.githubusercontent.com/sahinov-studio/vaultmate/main/.claude/skills/connect-vaultmate.md
```

Then, in Claude Code, just say **"connect vaultmate"** — it'll check VaultMate is
running, ask you for the token from Settings → MCP, register it, and verify a real call
works. Takes about a minute.

(If you've cloned this repo instead of downloading the installer, the skill is already
available project-locally — no separate download needed.)

---

## Build From Source

You'll need:

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs/) 1.75+
- Tauri 2 system dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/sahinov-studio/vaultmate
cd vaultmate
npm install
npm run tauri dev    # development
npm run tauri build  # release installer in src-tauri/target/release/bundle
```

---

## Security Model

**VaultMate does not encrypt your data at rest.** As of the current version, there is no
master password, no cryptographic vault key, and no at-rest encryption at all — every
credential field is stored as plaintext in the local SQLite database. This was a
deliberate design change (earlier versions did use AES-256-GCM + a master password; see
[Upgrading](#upgrading-from-an-earlier-encrypted-version) below).

**Why:** VaultMate is built for a specific use case — a single developer's own machine,
optimized for the lowest possible friction integrating with an AI coding assistant. A
master-password unlock gate was the one thing standing between "just works" and "ask the
user to unlock every session." If that trade-off doesn't match your situation — a shared
machine, a machine you don't fully trust, a compliance requirement — **don't use
VaultMate for anything sensitive**, or fork it and reintroduce encryption.

### What this means concretely

- Anyone with read access to your user account (or your `%APPDATA%\vaultmate\vaultmate.db` / equivalent file) can read every credential in plaintext. There is no password protecting the data itself.
- The optional **screen-lock PIN** (Settings → Security) is a UI convenience — it hides the window's contents from someone glancing at your unattended screen. It is **not** a cryptographic gate, is trivial to bypass by anyone with filesystem access, and never affects MCP access.
- **Backup files remain genuinely encrypted.** `.vmbackup` exports are still AES-256-GCM encrypted with a password you choose at export time — a portable file is a meaningfully different risk (easy to accidentally email/upload) than the live local database, so that layer was kept.
- The MCP bearer token (Settings → MCP) is the only access control on the whole system. Anyone who can read that token and reach `127.0.0.1:43218` on your machine has full read/write access to your vault.

### What VaultMate still protects against

- **Casual shoulder-surfing** — the optional screen-lock PIN hides the window.
- **Remote network access** — the MCP server binds to `127.0.0.1` only; it is never reachable from another machine.

### What VaultMate does *not* protect against

- **Anyone with local file access to your machine or user account** — malware, another local user, a stolen unlocked laptop, backup software that syncs `%APPDATA%` unencrypted to the cloud.
- **A keylogger or credential-stealing malware** — no local app can defend against that without OS-level help, but an unencrypted credential store is a materially easier target than an encrypted one.

If you want the old encrypted model back, the code that implemented it (Argon2id + AES-256-GCM + master password) is in the git history prior to the security-model change — see the project's `CLAUDE.md` for the exact commit and rationale.

---

## Database Location

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\vaultmate\vaultmate.db` |
| macOS    | `~/Library/Application Support/vaultmate/vaultmate.db` |
| Linux    | `~/.config/vaultmate/vaultmate.db` |

The database is a single SQLite file, stored as **plaintext** (see [Security Model](#security-model)) — do not sync it unencrypted to cloud storage or a shared location. For off-machine backups, use **Export Backup** (`.vmbackup`), which is genuinely password-encrypted and safe to store anywhere.

---

## Upgrading from an Earlier (Encrypted) Version

If you're updating from a version that had a master password (the AES-256-GCM +
Argon2id model described in earlier releases), first launch shows a one-time **"One
last unlock"** screen — enter your current master password or quick PIN. VaultMate
decrypts everything, flattens it to plaintext, and deletes the old password/key
settings. You won't be asked for a password again after that, on this or any future
launch.

This also transparently absorbs the even older pre-1.0 plaintext-legacy format in the
same step, if you somehow skipped straight from that version to this one.

**Do this on a machine and account you trust** — after this step, anyone with access to
this user account can read your credentials without any password at all (see
[Security Model](#security-model)). If that's not acceptable, take an encrypted
`.vmbackup` export *before* upgrading, using the old version, and don't upgrade this
install.

---

## Auto-update (optional)

The Tauri auto-updater is wired up in `src-tauri/tauri.conf.json` but disabled by default (`active: false`). To enable it on a fork:

1. Generate a signing key pair: `npm run tauri signer generate -- -w ~/.tauri/vaultmate.key`
2. Set `TAURI_SIGNING_PRIVATE_KEY` (and optional password) as a GitHub Actions secret.
3. Set `pubkey` in `tauri.conf.json` to the public half.
4. Set `"active": true` and update the `endpoints` URL.

Without these steps, the updater is inert — releases are manual downloads from GitHub Releases.

---

## License

MIT — see [LICENSE](LICENSE).

## Contributing

This is a small, focused project. Bug reports and PRs welcome at <https://github.com/sahinov-studio/vaultmate>.
