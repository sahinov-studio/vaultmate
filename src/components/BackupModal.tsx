import { useState } from "react";
import { Download, Upload, ShieldAlert } from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { toast, asError } from "../lib/toast";
import { Modal, Field, ModalActions, inputCls } from "./AppShellShared";
import { useStore } from "../store";

type Mode = "export" | "import";

export function BackupModal({ onClose, mode: initial }: { onClose: () => void; mode: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  return (
    <Modal title={mode === "export" ? "Export Backup" : "Import Backup"} onClose={onClose} wide>
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-700/50">
        <Tab label="Export" active={mode === "export"} onClick={() => setMode("export")} />
        <Tab label="Import" active={mode === "import"} onClick={() => setMode("import")} />
      </div>
      {mode === "export" ? (
        <ExportForm onClose={onClose} />
      ) : (
        <ImportForm onClose={onClose} />
      )}
    </Modal>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-white text-slate-800 shadow dark:bg-slate-600 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function ExportForm({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const json = await api.exportBackup(pw);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const path = await save({
        defaultPath: `vaultmate-${stamp}.vmbackup`,
        filters: [{ name: "VaultMate Backup", extensions: ["vmbackup", "json"] }],
      });
      if (!path) {
        setBusy(false);
        return;
      }
      await api.writeTextFile(path as string, json);
      toast.success("Backup saved");
      onClose();
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The backup is encrypted with the password you choose here — it can be different from
          your master password. Without this password, the backup cannot be restored.
        </p>
      </div>
      <Field label="Backup Password">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="At least 8 characters"
          className={inputCls}
          autoFocus
        />
      </Field>
      <Field label="Confirm Password">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it again"
          className={inputCls}
        />
      </Field>
      <ModalActions
        onClose={onClose}
        submitLabel={busy ? "Exporting..." : "Export Backup"}
        icon={<Download className="h-4 w-4" />}
      />
    </form>
  );
}

function ImportForm({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [filePath, setFilePath] = useState<string>("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshAll = useStore((s) => s.loadProjects);
  const refreshAllCreds = useStore((s) => s.loadAllCredentials);

  const pickFile = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "VaultMate Backup", extensions: ["vmbackup", "json"] }],
    });
    if (typeof path === "string") setFilePath(path);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath) return toast.error("Choose a backup file first");
    if (!pw) return toast.error("Enter the backup password");
    setBusy(true);
    try {
      const contents = await api.readTextFile(filePath);
      const imported = await api.importBackup(contents, pw, replace);
      await Promise.all([refreshAll(), refreshAllCreds()]);
      toast.success(`Imported ${imported} credential${imported !== 1 ? "s" : ""}`);
      onClose();
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Backup File">
        <button
          type="button"
          onClick={pickFile}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-600 transition dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:border-indigo-500 dark:hover:bg-indigo-500/10"
        >
          {filePath ? <span className="font-mono text-xs">{filePath}</span> : "Click to choose .vmbackup file"}
        </button>
      </Field>
      <Field label="Backup Password">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password used at export time"
          className={inputCls}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
          className="accent-indigo-500"
        />
        Replace existing data (deletes all current projects and credentials before import)
      </label>
      <ModalActions
        onClose={onClose}
        submitLabel={busy ? "Importing..." : "Import"}
        icon={<Upload className="h-4 w-4" />}
      />
    </form>
  );
}
