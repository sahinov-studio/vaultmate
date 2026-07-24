import { useState } from "react";
import { Lock } from "lucide-react";
import { useStore } from "../store";

/// Optional local screen-lock gate — a UI convenience, not a security
/// boundary (VaultMate stores credentials in plaintext; see Settings >
/// Screen Lock). Only shown when the user has opted into a PIN and the app
/// is currently locked.
export function PinGate() {
  const verifyPin = useStore((s) => s.verifyPin);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (!ok) {
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setPin("");
      }
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
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/20">
            <Lock className="h-7 w-7 text-indigo-500 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">VaultMate</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Enter your screen-lock PIN</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="rounded-lg bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking..." : "Unlock"}
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
