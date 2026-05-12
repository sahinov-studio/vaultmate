import { useEffect } from "react";
import { useStore } from "./store";
import { MasterPasswordSetup } from "./components/MasterPasswordSetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { MigrateLegacyVault } from "./components/MigrateLegacyVault";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/Toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAutoLock } from "./hooks/useAutoLock";

function AppRouter() {
  const { status, refreshStatus, theme, lock } = useStore();

  useEffect(() => {
    refreshStatus();
    document.documentElement.classList.toggle("dark", theme === "dark");

    // Re-check status periodically in case the Rust side auto-locks (e.g. via
    // future suspend handling) — keeps frontend in sync.
    const t = setInterval(() => refreshStatus(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock the vault when the OS user locks the screen / window loses focus
  // for an extended period. Browser visibility change is the closest signal.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && status?.unlocked) {
        // Locking on hidden is too aggressive for normal use; only lock if the
        // window has been hidden for >2 minutes by checking again later.
        setTimeout(() => {
          if (document.visibilityState === "hidden") lock();
        }, 120_000);
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [status?.unlocked, lock]);

  useAutoLock();

  if (!status) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  if (status.legacy && !status.initialized) return <MigrateLegacyVault />;
  if (!status.initialized) return <MasterPasswordSetup />;
  if (!status.unlocked) return <UnlockScreen />;
  return <AppShell />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
      <Toaster />
    </ErrorBoundary>
  );
}
