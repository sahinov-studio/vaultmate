import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, KeyRound } from "lucide-react";
import { useStore } from "../store";

export function UnlockScreen() {
  const { unlock, unlockWithPin, status, refreshStatus, settings, loadSettings } = useStore();
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pw, setPw] = useState("");
  const [pin, setPin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    loadSettings();
  }, []);

  // Tick once per second so countdown updates.
  useEffect(() => {
    if (!status?.locked_until_ms) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status?.locked_until_ms]);

  const lockedUntil = status?.locked_until_ms ?? 0;
  const lockedSecs = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  const isLockedOut = lockedSecs > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLockedOut) return;
    setBusy(true);
    try {
      const ok =
        mode === "password" ? await unlock(pw) : await unlockWithPin(pin);
      if (!ok) {
        setShake(true);
        setTimeout(() => setShake(false), 500);
        if (mode === "password") setPw("");
        else setPin("");
        await refreshStatus();
      }
    } finally {
      setBusy(false);
    }
  };

  const canUsePin = settings?.quick_pin_set ?? false;

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div
        className={`w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl border border-slate-200 dark:bg-slate-800 dark:border-slate-700/50 transition-transform ${
          shake ? "animate-[shake_0.4s_ease]" : ""
        }`}
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/20">
            <Lock className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">VaultMate</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === "password" ? "Enter your master password" : "Enter your quick PIN"}
          </p>
        </div>

        {isLockedOut ? (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-center">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Too many failed attempts
            </p>
            <p className="mt-1 text-xs text-red-500/80 dark:text-red-300/80">
              Try again in {lockedSecs} second{lockedSecs !== 1 ? "s" : ""}.
            </p>
          </div>
        ) : (
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

            <button
              type="submit"
              disabled={
                busy ||
                (mode === "password" ? pw.length === 0 : pin.length < 4)
              }
              className="rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Unlocking..." : "Unlock"}
            </button>

            {canUsePin && (
              <button
                type="button"
                onClick={() => setMode(mode === "password" ? "pin" : "password")}
                className="flex items-center justify-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                <KeyRound className="h-3 w-3" />
                {mode === "password" ? "Use quick PIN" : "Use master password"}
              </button>
            )}

            {(status?.failed_attempts ?? 0) > 0 && (
              <p className="text-center text-xs text-amber-600 dark:text-amber-400">
                {status?.failed_attempts} failed attempt{status?.failed_attempts !== 1 ? "s" : ""}
              </p>
            )}
          </form>
        )}

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
