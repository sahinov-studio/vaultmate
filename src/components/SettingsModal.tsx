import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, Copy, Check, AlertTriangle, Power } from "lucide-react";
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
    </div>
  );
}

// ── Security ─────────────────────────────────────────────────────────────────
function SecurityTab() {
  const settings = useStore((s) => s.settings);
  const loadSettings = useStore((s) => s.loadSettings);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const changePw = async () => {
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await api.changeMasterPassword(current, next);
      setCurrent(""); setNext(""); setConfirm("");
      toast.success("Master password updated. Quick PIN was disabled.");
      await loadSettings();
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  const enablePin = async () => {
    if (pin.length < 4) return toast.error("PIN must be at least 4 digits");
    if (pin !== confirmPin) return toast.error("PINs do not match");
    try {
      await api.enableQuickPin(pin);
      setPin(""); setConfirmPin("");
      await loadSettings();
      toast.success("Quick PIN enabled");
    } catch (e) {
      toast.error(asError(e));
    }
  };

  const disablePin = async () => {
    try {
      await api.disableQuickPin();
      await loadSettings();
      toast.success("Quick PIN disabled");
    } catch (e) {
      toast.error(asError(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Master password</h3>
        <Field label="Current password">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <Field label="New password">
          <input
            type={show ? "text" : "password"}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
          />
        </Field>
        <button
          onClick={changePw}
          disabled={busy || !current || !next}
          className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          Change password
        </button>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700/50">
        <div className="flex items-start gap-2">
          <KeyRound className="h-4 w-4 mt-1 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Quick unlock PIN</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {settings?.quick_pin_set
                ? "A PIN is set up — you can use it to unlock without typing your master password."
                : "Optional. Lets you unlock with a short PIN. Less secure than your master password."}
            </p>
          </div>
        </div>
        {settings?.quick_pin_set ? (
          <button
            onClick={disablePin}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/20 dark:text-red-400"
          >
            Disable Quick PIN
          </button>
        ) : (
          <div className="space-y-2">
            <Field label="PIN (4–12 digits)">
              <input
                type="password"
                inputMode="numeric"
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
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
              onClick={enablePin}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500"
            >
              Enable Quick PIN
            </button>
          </div>
        )}
      </section>
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
    </div>
  );
}

// ── Startup ──────────────────────────────────────────────────────────────────
function StartupTab() {
  const [autostart, setAutostart] = useState(false);
  const [autoUnlock, setAutoUnlock] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [as, au] = await Promise.all([
        api.isAutostartEnabled(),
        api.isAutoUnlockEnabled(),
      ]);
      setAutostart(as);
      setAutoUnlock(au);
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

  const enableAutoUnlock = async () => {
    if (!password) return toast.error("Enter your master password");
    setBusy(true);
    try {
      await api.enableAutoUnlock(password);
      setPassword("");
      setAutoUnlock(true);
      toast.success("Auto-unlock enabled");
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  const disableAutoUnlock = async () => {
    try {
      await api.disableAutoUnlock();
      setAutoUnlock(false);
      toast.success("Auto-unlock disabled");
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
                Launch VaultMate in the background (system tray) when you log into Windows.
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

      <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700/50">
        <div className="flex items-start gap-2">
          <KeyRound className="h-4 w-4 mt-1 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Auto-unlock</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Unlock automatically at startup using Windows' own credential protection (DPAPI),
              instead of typing your master password every time.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Anyone signed into this Windows account can unlock this vault without your master
            password. Only enable this on a machine only you use.
          </p>
        </div>

        {autoUnlock ? (
          <button
            onClick={disableAutoUnlock}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/20 dark:text-red-400"
          >
            Disable auto-unlock
          </button>
        ) : (
          <div className="space-y-2">
            <Field label="Confirm master password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </Field>
            <button
              onClick={enableAutoUnlock}
              disabled={busy || !password}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Enable auto-unlock
            </button>
          </div>
        )}
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
          Deletes every project and credential from this vault. Your master password is kept
          so you can start fresh. This cannot be undone.
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
