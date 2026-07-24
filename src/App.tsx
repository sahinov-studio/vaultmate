import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./store";
import { api } from "./lib/api";
import { MasterPasswordSetup } from "./components/MasterPasswordSetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { MigrateLegacyVault } from "./components/MigrateLegacyVault";
import { AppShell } from "./components/AppShell";
import { Toaster } from "./components/Toaster";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAutoLock } from "./hooks/useAutoLock";

function AppRouter() {
  const { status, refreshStatus, theme, lock, loadProjects, loadAllCredentials } = useStore();

  useEffect(() => {
    refreshStatus();
    document.documentElement.classList.toggle("dark", theme === "dark");

    // Show the main window once we've actually mounted, unless this was the
    // `--hidden` launch the autostart plugin injects. Doing this from Rust
    // `.setup()` is unreliable on Windows — the async WebView2 attachment
    // that happens afterward can silently re-hide a window shown that early.
    api.wasLaunchedHidden().then((hidden) => {
      if (!hidden) api.showMainWindow().catch(() => {});
    });

    // MCP tool calls (e.g. from Claude Code) write straight to SQLite on
    // their own connection, bypassing our own create/update/delete commands
    // entirely — so this already-mounted app never hears about them on its
    // own. The Rust side emits this event after any MCP write; reload the
    // lists we cache in memory so the UI reflects it without a manual
    // lock/unlock or restart.
    const unlistenPromise = listen("vaultmate://data-changed", () => {
      loadProjects();
      loadAllCredentials();
    });

    // Re-check status periodically in case the Rust side auto-locks (e.g. via
    // future suspend handling) — keeps frontend in sync.
    const t = setInterval(() => refreshStatus(), 30_000);
    return () => {
      clearInterval(t);
      unlistenPromise.then((unlisten) => unlisten());
    };
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
