# VaultMate

A local-first, encrypted credentials manager for developers — built with Tauri (Rust + React) and ships with a built-in MCP server so Claude Code and other AI assistants can read your secrets without copy-paste.

> **Local-only.** Your data never leaves your machine. There is no cloud sync, no analytics, no telemetry.

---

## Features

- **AES-256-GCM encryption at rest** — every secret is encrypted with a vault key derived from your master password via Argon2id (64 MiB / 3 passes)
- **Master password + optional quick PIN** — full-strength password by default, with an opt-in numeric PIN for fast unlock
- **Auto-lock on idle** — vault locks itself after configurable inactivity (default 5 min)
- **Rate-limited unlock** — exponential backoff after 5 failed attempts, capped at 30 min
- **15 categories** — Login, API Key, Database, SSH Key, Token, Env Variable, Credit Card, Wi-Fi, Crypto Wallet, Software License, Server, Secure Note, Identity, Email Account, Other
- **Rich credential fields** — title, username, secret, URL, notes, tags, favorite, expiry date, custom fields, TOTP/2FA secret
- **TOTP code generation** — built-in 2FA code generator with 30-second countdown (RFC 6238)
- **Password generator** — configurable length, character classes, ambiguity-avoidance
- **Encrypted backup & restore** — export your entire vault to a single password-protected `.vmbackup` file
- **Excel import** — auto-detect credential columns from `.xlsx`/`.xls`/`.csv` files
- **MCP server** — local HTTP server on port 43218 with bearer-token auth, lets Claude Code list, search, and retrieve credentials
- **Dark / light themes** — toggle in the sidebar
- **Cross-platform** — Windows, macOS, Linux

---

## Install

Pre-built installers are published on the [Releases page](https://github.com/bittuai/vaultmate/releases):

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

1. Launch VaultMate.
2. Create a master password (minimum 8 characters; the strength meter encourages mixed cases, digits, and symbols).
3. **Write the master password down somewhere safe.** There is no recovery — losing it means losing every credential in the vault.
4. (Optional) In Settings → Security, enable a quick PIN for faster unlocks during the day.
5. Create your first project, then start adding credentials.

---

## Backups (do this on day one)

Sidebar → **Export Backup** writes every project and credential to an AES-256-GCM-encrypted JSON file. The backup uses a separate password — you can use the same as your master password or a different one.

Without a backup, a corrupted database file or a forgotten master password means total data loss. **Take a backup before you trust the app with anything important.**

---

## MCP Server (Claude Code integration)

VaultMate runs a local HTTP server on `127.0.0.1:43218` while it's open. Authentication uses a bearer token shown in **Settings → MCP**.

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

The MCP server only responds while VaultMate is **unlocked**. When you lock the vault, calls return `423 Locked`.

Available tools:

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects |
| `list_credentials` | List all credentials in a project (returns secrets in plaintext to the local MCP client) |
| `get_credential` | Get one credential by project + title |
| `search_credentials` | Substring search across title / username / URL |

Disable the MCP server in **Settings → MCP** if you don't use Claude Code.

---

## Build From Source

You'll need:

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs/) 1.75+
- Tauri 2 system dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/bittuai/vaultmate
cd vaultmate
npm install
npm run tauri dev    # development
npm run tauri build  # release installer in src-tauri/target/release/bundle
```

---

## Security Model

### What's encrypted

- **Secret field, notes, TOTP secret, custom field values** — encrypted with AES-256-GCM using a 256-bit vault key, unique nonce per encryption
- **Vault key** — encrypted with a key derived from your master password via Argon2id (m=64 MiB, t=3, p=4)
- **Backup files** — encrypted with AES-256-GCM, key derived from a backup password you choose

### What's *not* encrypted (stored in plaintext)

- Project names, project descriptions, project colors
- Credential titles, usernames, URLs, categories, tags, favorite flag, expiry date

The plaintext fields enable substring search without first decrypting every record. If your threat model requires title/URL secrecy, do not put sensitive identifiers in those fields.

### What VaultMate protects against

- **Stolen laptop / DB file copy.** Without the master password, the vault key cannot be derived and AES-GCM ciphertext is computationally infeasible to recover.
- **Local brute-force unlock.** Argon2id makes each guess take ~250 ms; failed attempts trigger exponential backoff capped at 30 minutes.
- **Memory exposure on lock.** The vault key is wiped from memory (zeroized) when you lock the vault.

### What VaultMate does *not* protect against

- **A keylogger or RAM scraper while you're unlocked** — no app can defend against that without OS-level help.
- **A forgotten master password** — there is no recovery mechanism. This is the price of zero-knowledge encryption.
- **Backups stored in the cloud without encryption** — VaultMate's `.vmbackup` files are encrypted, so storing them in Dropbox / iCloud / Google Drive is fine. Plain database file copies are *not* safe.

---

## Database Location

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\vaultmate\vaultmate.db` |
| macOS    | `~/Library/Application Support/vaultmate/vaultmate.db` |
| Linux    | `~/.config/vaultmate/vaultmate.db` |

The database is a single SQLite file. Copy it elsewhere for off-machine backups (it is the encrypted form, so it's safe to put on cloud storage — though `.vmbackup` exports are preferred since they're versioned and labelled).

---

## Upgrading from v0.1.0

Versions prior to 1.0 stored secrets in plaintext SQLite. On first launch of v1.0+ you'll see an **Upgrade Vault** screen: enter your old 4-digit PIN, choose a new master password, and VaultMate re-encrypts every credential with the new format.

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

This is a small, focused project. Bug reports and PRs welcome at <https://github.com/bittuai/vaultmate>.
