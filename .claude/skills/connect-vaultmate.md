---
name: connect-vaultmate
description: One-time setup connecting a local VaultMate install to this machine's Claude Code, so Claude can read, create, update, and delete projects/credentials directly through VaultMate's MCP server — zero unlock friction, bearer-token gated only. Triggers on "connect vaultmate", "set up vaultmate mcp", "integrate vaultmate with claude code", "add vaultmate to claude code", "hook up vaultmate". Run once per machine.
---

# Connect VaultMate to Claude Code

VaultMate is a local credential manager (Windows/macOS/Linux, Tauri app) that exposes a
local-only MCP server so Claude Code can read and manage your projects/credentials
directly — no copy-pasting secrets into chat. This skill walks through connecting it,
end to end, on a machine that doesn't have it wired up yet.

**Security model, up front (read this before proceeding):** VaultMate stores credentials
as **plaintext** in its local SQLite database — there is no master password and no
at-rest encryption. This is a deliberate design choice (a local-only, single-user app,
optimized for exactly this kind of zero-friction AI-assistant integration), not a bug.
The only gate on both the app and the MCP server is: is this your own machine, and do
you have the MCP bearer token. If that trade-off doesn't fit your threat model, stop
here — this isn't the right tool for you. Otherwise, continue.

---

## Step 1 — Confirm VaultMate is installed and running

Check whether it's already running:

- **Windows**: look for a VaultMate icon in the system tray, or check Task Manager for `vaultmate.exe`.
- **macOS**: check the menu bar.
- **Linux**: check your system tray / `ps aux | grep vaultmate`.

If it's not installed, ask the user to install it first (point them at the project's
Releases page or ask them for the install source — don't guess a download URL). If it's
installed but not running, ask the user to launch it once.

**Don't try to launch it yourself via a shell command that assumes a specific install
path** — path conventions differ by platform and by whether it was installed via
installer vs. built from source. Ask the user to open it, or use `open_application`
(computer-use) only if you already know the exact app name on their system.

---

## Step 2 — Get the MCP bearer token

Ask the user to open VaultMate → **Settings → MCP** and copy the token shown there (it's
displayed specifically for this purpose — this is not a secret you should ever try to
read out of the database file directly). If you have computer-use access to their
desktop and it's already been granted for VaultMate, you can navigate to that screen
yourself to read the displayed token — but never type anything into VaultMate's
password/PIN fields; the token field is a display-only value meant to be copied, so
reading it on-screen is fine.

Do not ask for or accept a master password — VaultMate has none. If the user offers
one, that means they're running a pre-1.0 build from before encryption was removed;
tell them to update VaultMate first.

---

## Step 3 — Register the MCP server

Prefer the Claude Code CLI if available (syntax may vary by Claude Code version — check
`claude mcp add --help` first):

```bash
claude mcp add --transport http vaultmate http://127.0.0.1:43218 --header "Authorization: Bearer <TOKEN>"
```

If that doesn't work or isn't available, register it directly by adding this to the
user's `~/.claude.json` under `mcpServers` (merge with whatever's already there — don't
overwrite the file):

```json
{
  "mcpServers": {
    "vaultmate": {
      "url": "http://127.0.0.1:43218",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

This is a **user-level** config — once set, it's available in every project on this
machine, not just the one you're in right now.

---

## Step 4 — Verify it works

Load the tools and try a real call:

```
ToolSearch: "vaultmate"
```

Then call `mcp__vaultmate__list_projects`. If it returns the user's actual project list
(or "No projects found." for a fresh vault), you're done. If it errors:

- **Connection refused** → VaultMate isn't running. Ask the user to launch it.
- **401 Unauthorized** → the token is wrong or stale (they may have rotated it since
  copying it) — go back to Step 2.
- **423** → this vault still has old encrypted data from before VaultMate 1.x removed
  at-rest encryption. Tell the user to open VaultMate — it'll show a one-time "finish
  migration" screen asking for their old master password/PIN. That's the only remaining
  case where VaultMate ever asks for a password, and it only happens once.

---

## Step 5 (optional) — Note it in the user's own CLAUDE.md

If the user has a personal `~/.claude/CLAUDE.md` (or wants project-level notes), offer
to add a short pointer so future sessions don't have to rediscover this:

```markdown
## Credentials

VaultMate is connected — Claude can read/create/update/delete credentials directly via
its MCP tools (`mcp__vaultmate__*`) whenever VaultMate is running. No unlock step; the
bearer token in `~/.claude.json` is the only gate. Never read `vaultmate.db` directly
with raw SQLite — always go through the MCP tools.
```

Ask before editing a file you don't own the context of — don't silently append this to
an existing CLAUDE.md without the user's OK.

---

## What this skill does NOT do

- Install VaultMate itself — that's a separate manual step (download/build + run the installer).
- Decide whether plaintext local storage is acceptable for the user's situation — that's
  their call, made explicit in the security-model note above.
- Auto-launch VaultMate at login — that's VaultMate's own **Settings → Startup** toggle,
  a separate opt-in the user makes for themselves.
