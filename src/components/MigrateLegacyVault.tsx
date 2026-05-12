import { useMemo, useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useStore } from "../store";
import { asError } from "../lib/toast";

export function MigrateLegacyVault() {
  const migrate = useStore((s) => s.migrate);
  const [step, setStep] = useState<"intro" | "form">("intro");
  const [oldPin, setOldPin] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = useMemo(
    () => oldPin.length === 4 && pw.length >= 8 && pw === confirm,
    [oldPin, pw, confirm],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!ready) {
      setError("Old PIN must be 4 digits, new password at least 8 characters and matching.");
      return;
    }
    setBusy(true);
    try {
      await migrate(oldPin, pw);
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "intro") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
        <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl border border-slate-200 dark:bg-slate-800 dark:border-slate-700/50">
          <div className="mb-5 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20">
              <ShieldAlert className="h-7 w-7 text-amber-500" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Vault Upgrade Required</h1>
          </div>
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
            <p>
              Your vault was created with an older version of VaultMate that did not encrypt
              secrets at rest. The upgrade re-encrypts every credential with strong AES-256-GCM
              encryption derived from a new master password.
            </p>
            <p>
              You will keep all your projects, credentials, and settings. The 4-digit PIN is
              replaced with a master password (you can re-enable a quick PIN afterward in
              Settings).
            </p>
            <p className="text-amber-600 dark:text-amber-400">
              Tip: take a manual backup of your DB file at <code className="rounded bg-amber-500/10 px-1">%APPDATA%\vaultmate\vaultmate.db</code> before continuing.
            </p>
          </div>
          <button
            onClick={() => setStep("form")}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl border border-slate-200 dark:bg-slate-800 dark:border-slate-700/50">
        <h1 className="mb-1 text-xl font-bold text-slate-900 dark:text-white">Upgrade Vault</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Verify your old PIN and create a new master password.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Old 4-digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 text-center text-2xl tracking-[1rem] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              New Master Password
            </label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 pr-10 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Confirm Password
            </label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type it again"
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-500 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !ready}
            className="rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Re-encrypting..." : "Upgrade Vault"}
          </button>
        </form>
      </div>
    </div>
  );
}
