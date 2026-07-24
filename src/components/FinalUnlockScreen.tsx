import { useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldAlert } from "lucide-react";
import { useStore } from "../store";
import { asError } from "../lib/toast";

/// Shown exactly once, only for a vault that predates removing at-rest
/// encryption: the user enters their current master password (or quick PIN)
/// one last time so the backend can decrypt everything and flatten it to
/// plaintext. After this succeeds, `status.needs_migration` is permanently
/// false and this screen never appears again — for this vault or any fresh
/// install.
export function FinalUnlockScreen() {
  const finishMigration = useStore((s) => s.finishMigration);
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pw, setPw] = useState("");
  const [pin, setPin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await finishMigration(mode === "password" ? pw : pin, mode === "pin");
    } catch (err) {
      setError(asError(err));
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div
        className={`w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl border border-slate-200 dark:bg-slate-800 dark:border-slate-700/50 transition-transform ${
          shake ? "animate-[shake_0.4s_ease]" : ""
        }`}
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20">
            <ShieldAlert className="h-7 w-7 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">One last unlock</h1>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Enter your current {mode === "password" ? "master password" : "PIN"} one final time.
            VaultMate will never ask for a password again after this.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "password" ? (
            <div className="relative">
              <input
                autoFocus
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Master password"
                className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 pr-10 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 text-center text-2xl tracking-[0.6rem] text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-500 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || (mode === "password" ? pw.length === 0 : pin.length < 4)}
            className="rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Finishing up..." : "Finish & remove password protection"}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === "password" ? "pin" : "password")}
            className="flex items-center justify-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            <KeyRound className="h-3 w-3" />
            {mode === "password" ? "Use quick PIN instead" : "Use master password instead"}
          </button>
        </form>

        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-8px); }
            40% { transform: translateX(8px); }
            60% { transform: translateX(-6px); }
            80% { transform: translateX(6px); }
          }
        `}</style>
      </div>
    </div>
  );
}
