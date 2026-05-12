import { useMemo, useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { useStore } from "../store";
import { toast, asError } from "../lib/toast";

function strengthScore(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score++;
  const labels = ["Very weak", "Weak", "Okay", "Good", "Strong", "Strong", "Very strong", "Excellent"];
  const colors = [
    "bg-red-500", "bg-red-500", "bg-orange-500", "bg-yellow-500",
    "bg-green-500", "bg-green-500", "bg-emerald-500", "bg-emerald-600",
  ];
  return { score, label: labels[Math.min(score, 7)], color: colors[Math.min(score, 7)] };
}

export function MasterPasswordSetup() {
  const setup = useStore((s) => s.setupMasterPassword);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const strength = useMemo(() => strengthScore(pw), [pw]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (strength.score < 3) {
      setError("Please choose a stronger password (mix of cases, digits, symbols).");
      return;
    }
    setBusy(true);
    try {
      await setup(pw);
      toast.success("Vault initialized");
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl border border-slate-200 dark:bg-slate-800 dark:border-slate-700/50">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/20">
            <ShieldCheck className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Welcome to VaultMate</h1>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Create a master password to encrypt your vault.
            <br />
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Write it down somewhere safe — there is no recovery.
            </span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Master Password
            </label>
            <div className="relative">
              <input
                autoFocus
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => { setPw(e.target.value); setError(""); }}
                placeholder="At least 8 characters"
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
            {pw && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full transition-all ${strength.color}`}
                    style={{ width: `${Math.min(100, (strength.score / 7) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 w-20 text-right">
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Confirm Password
            </label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Type it again"
              className="w-full rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600/40 px-4 py-3 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-500 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !pw || !confirm}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Lock className="h-4 w-4" /> {busy ? "Setting up..." : "Create Vault"}
          </button>
        </form>
      </div>
    </div>
  );
}
