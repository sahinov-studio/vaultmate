import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Copy, Check, AlertTriangle, Power } from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { toast, asError } from "../lib/toast";
import { Modal, Field, inputCls } from "./AppShellShared";

type Tab = "general" | "security" | "mcp" | "startup" | "danger";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-700/50">
        <TabBtn id="general" active={tab} on={setTab}>General</TabBtn>
        <TabBtn id="security" active={tab} on={setTab}>Security</TabBtn>
        <TabBtn id="mcp" active={tab} on={setTab}>MCP</TabBtn>
        <TabBtn id="startup" active={tab} on={setTab}>Startup</TabBtn>
        <TabBtn id="danger" active={tab} on={setTab}>Advanced</TabBtn>
      </div>
      {tab === "general" && <GeneralTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "mcp" && <McpTab />}
      {tab === "startup" && <StartupTab />}
      {tab === "danger" && <DangerTab />}
    </Modal>
  );
}

function TabBtn({
  id, children, active, on,
}: {
  id: Tab;
  children: React.ReactNode;
  active: Tab;
  on: (t: Tab) => void;
}) {
  return (
    <button
      onClick={() => on(id)}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active === id
          ? "bg-white text-slate-800 shadow dark:bg-slate-600 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// ── General ──────────────────────────────────────────────────────────────────
function GeneralTab() {
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const replayOnboarding = useStore((s) => s.replayOnboarding);
  const [autoLock, setAutoLock] = useState(settings?.auto_lock_minutes ?? 5);
  const [clipboard, setClipboard] = useState(settings?.clipboard_clear_seconds ?? 30);

  useEffect(() => {
    if (settings) {
      setAutoLock(settings.auto_lock_minutes);
      setClipboard(settings.clipboard_clear_seconds);
    }
  }, [settings]);

  const submit = async () => {
    try {
      await save(autoLock, clipboard);
    } catch (e) {
      toast.error(asError(e));
    }
  };

  const showIntro = async () => {
    try {
      await replayOnboarding();
    } catch (e) {
      toast.error(asError(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Auto-lock after (minutes)"
        hint="Vault locks automatically after this many minutes of no activity."
      >
        <input
          type="number"
          min={1}
          max={120}
          value={autoLock}
          onChange={(e) => setAutoLock(Number(e.target.value))}
          className={inputCls}
        />
      </Field>
      <Field
        label="Clipboard auto-clear (seconds)"
        hint="Copied secrets are wiped from the clipboard after this many seconds."
      >
        <input
          type="number"
          min={5}
          max={300}
          value={clipboard}
          onChange={(e) => setClipboard(Number(e.target.value))}
          className={inputCls}
        />
      </Field>
      <button
        onClick={submit}
        className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Save
      </button>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-700/50">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Want to see the welcome tour again?
        </p>
        <button
          onClick={showIntro}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          Replay onboarding
        </button>
      </div>
    </div>
  );
}

// ── Security (Screen Lock) ────────────────────────────────────────────────────
function SecurityTab() {
  const status = useStore((s) => s.status);
  const setPin = useStore((s) => s.setPin);
  const removePin = useStore((s) => s.removePin);

  const [pinValue, setPinValue] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    if (pinValue.length < 4) return toast.error("PIN must be at least 4 digits");
    if (pinValue !== confirmPin) return toast.error("PINs do not match");
    setBusy(true);
    try {
      await setPin(pinValue);
      setPinValue(""); setConfirmPin("");
      toast.success("Screen-lock PIN set");
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    try {
      await removePin();
      toast.success("Screen-lock PIN removed");
    } catch (e) {
      toast.error(asError(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <KeyRound className="h-4 w-4 mt-1 text-slate-400" />
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Screen Lock</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Optional local PIN gate for this window — a screen-privacy convenience, not
            encryption. VaultMate stores credentials in plaintext on this machine, by design.
            If no PIN is set, the app never gates access at all.
          </p>
        </div>
      </div>
      {status?.pin_set ? (
        <button
          onClick={disable}
          className="self-start rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/20 dark:text-red-400"
        >
          Remove PIN
        </button>
      ) : (
        <div className="space-y-2">
          <Field label="PIN (4–12 digits)">
            <input
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
              className={inputCls}
            />
          </Field>
          <Field label="Confirm PIN">
            <input
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              className={inputCls}
            />
          </Field>
          <button
            onClick={enable}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Set PIN
          </button>
        </div>
      )}
    </div>
  );
}

// ── MCP ──────────────────────────────────────────────────────────────────────
function McpTab() {
  const settings = useStore((s) => s.settings);
  const loadSettings = useStore((s) => s.loadSettings);
  const [copied, setCopied] = useState(false);

  const rotate = async () => {
    try {
      await api.rotateMcpToken();
      await loadSettings();
      toast.success("MCP token rotated. Update your Claude Code config.");
    } catch (e) {
      toast.error(asError(e));
    }
  };

  const copy = async () => {
    if (!settings?.mcp_token) return;
    await navigator.clipboard.writeText(settings.mcp_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const [installing, setInstalling] = useState(false);
  const installSkill = async () => {
    setInstalling(true);
    try {
      const path = await api.installClaudeSkill();
      toast.success(`Skill installed — say "connect vaultmate" in Claude Code to finish setup.`);
      console.info(`VaultMate skill written to ${path}`);
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">MCP Server</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Local-only HTTP server on port 43218 for Claude Code integration. Anyone with the
          token below can connect — like a Supabase personal access token, the token itself
          is the only thing that gates access.
        </p>
      </div>

      <Field
        label="MCP Token"
        hint="Bearer token clients must send. Treat like a password."
      >
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 dark:bg-slate-700/60 dark:border-slate-600/40">
          <code className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">
            {settings?.mcp_token || "—"}
          </code>
          <button onClick={copy} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button onClick={rotate} title="Generate new token" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </Field>

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 dark:bg-slate-900/40 dark:border-slate-700/50">
        <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          Claude Code config
        </p>
        <pre className="overflow-x-auto rounded bg-slate-900 px-3 py-2 text-[11px] text-slate-200">
{`{
  "mcpServers": {
    "vaultmate": {
      "url": "http://127.0.0.1:43218",
      "headers": { "Authorization": "Bearer ${settings?.mcp_token ?? "<token>"}" }
    }
  }
}`}
        </pre>
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 dark:bg-slate-900/40 dark:border-slate-700/50">
        <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
          Claude Code skill
        </p>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          One click, no manual JSON editing, no internet needed — writes a guided setup
          skill to <code className="rounded bg-slate-200/70 px-1 dark:bg-slate-700/60">~/.claude/skills/</code>.
          Afterward just say <span className="italic">"connect vaultmate"</span> in Claude Code.
        </p>
        <button
          onClick={installSkill}
          disabled={installing}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {installing ? "Installing..." : "Install Claude Code Skill"}
        </button>
      </div>
    </div>
  );
}

// ── Startup ──────────────────────────────────────────────────────────────────
function StartupTab() {
  const [autostart, setAutostart] = useState(false);

  const refresh = async () => {
    try {
      setAutostart(await api.isAutostartEnabled());
    } catch (e) {
      toast.error(asError(e));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAutostart = async (next: boolean) => {
    try {
      if (next) await api.enableAutostart();
      else await api.disableAutostart();
      setAutostart(next);
    } catch (e) {
      toast.error(asError(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <Power className="h-4 w-4 mt-1 text-slate-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Start at login</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Launch VaultMate in the background (system tray) when you log into Windows —
                keeps it running so Claude/MCP can always reach it.
              </p>
            </div>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => toggleAutostart(e.target.checked)}
              className="sr-only peer"
            />
            <span className="relative h-5 w-10 rounded-full bg-slate-300 transition-colors peer-checked:bg-indigo-500 dark:bg-slate-600">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}

// ── Danger Zone ──────────────────────────────────────────────────────────────
function DangerTab() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshAll = useStore((s) => s.loadProjects);
  const refreshAllCreds = useStore((s) => s.loadAllCredentials);

  const wipe = async () => {
    if (confirm !== "DELETE") return toast.error('Type "DELETE" to confirm');
    setBusy(true);
    try {
      await api.deleteAllData();
      await Promise.all([refreshAll(), refreshAllCreds()]);
      toast.success("All projects and credentials deleted");
      setConfirm("");
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="mb-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-red-500" />
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Wipe all data</h3>
        </div>
        <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
          Deletes every project and credential from this vault so you can start fresh. This
          cannot be undone.
        </p>
        <Field label='Type "DELETE" to confirm'>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
          />
        </Field>
        <button
          onClick={wipe}
          disabled={busy || confirm !== "DELETE"}
          className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
        >
          {busy ? "Deleting..." : "Permanently delete all data"}
        </button>
      </div>
    </div>
  );
}
