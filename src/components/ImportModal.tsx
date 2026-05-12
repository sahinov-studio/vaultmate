import { useState } from "react";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, FolderSearch, CheckSquare, Square,
  AlertCircle, CheckCircle2, Loader2, Upload,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import type { ExcelFile } from "../lib/types";
import { Modal } from "./AppShellShared";

type Step = "scan" | "select" | "importing" | "done";

interface ParsedFile {
  excelFile: ExcelFile;
  rows: CredentialRow[];
  projectName: string;
  error?: string;
}

interface CredentialRow {
  title: string;
  username: string;
  secret: string;
  url: string;
  notes: string;
  category: string;
}

interface ImportResult {
  projectName: string;
  imported: number;
  skipped: number;
  error?: string;
}

// ── Column detection ──────────────────────────────────────────────────────────
function detectCol(headers: string[], ...keywords: string[]): number {
  const lower = headers.map((h) => String(h ?? "").toLowerCase().trim());
  for (const kw of keywords) {
    const i = lower.findIndex((h) => h.includes(kw));
    if (i >= 0) return i;
  }
  return -1;
}

/** Same as detectCol but skips columns already assigned to another dimension. */
function detectColExcl(headers: string[], excluded: number[], ...keywords: string[]): number {
  const lower = headers.map((h) => String(h ?? "").toLowerCase().trim());
  for (const kw of keywords) {
    const i = lower.findIndex((h, idx) => !excluded.includes(idx) && h.includes(kw));
    if (i >= 0) return i;
  }
  return -1;
}

function detectCategory(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("api") || v.includes("key")) return "api_key";
  if (v.includes("db") || v.includes("database") || v.includes("sql")) return "database";
  if (v.includes("ssh")) return "ssh";
  if (v.includes("token") || v.includes("oauth")) return "token";
  if (v.includes("env") || v.includes("variable")) return "env";
  if (v.includes("login") || v.includes("password") || v.includes("cred")) return "login";
  return "other";
}

function parseWorkbook(data: Uint8Array, excelFile: ExcelFile): ParsedFile {
  try {
    const wb = XLSX.read(data, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { excelFile, rows: [], projectName: excelFile.project_name, error: "No sheets found" };

    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });

    if (raw.length < 2) return { excelFile, rows: [], projectName: excelFile.project_name, error: "No data rows" };

    const headers = (raw[0] as string[]).map(String);

    // Two-dimension title: "Service" (group) + "Key Name" (specific item)
    // This handles sheets like: Service | Key Name | Value → "Supabase > Supabase Anon Key"
    const colGroup    = detectCol(headers, "service", "platform", "provider", "application", "system", "site", "group");
    const colKeyName  = detectColExcl(headers, [colGroup], "key name", "keyname", "credential name", "name", "title", "label", "item", "description");

    const excl1 = [colGroup, colKeyName].filter((c) => c >= 0);
    const colUser     = detectColExcl(headers, excl1, "user", "login", "email", "account", "id", "username");
    const excl2 = [...excl1, colUser].filter((c) => c >= 0);
    const colSecret   = detectColExcl(headers, excl2, "password", "passwd", "pass", "pwd", "secret", "value", "token", "key", "credential");
    const colUrl      = detectCol(headers, "url", "link", "website", "host", "address", "endpoint", "server");
    const colNotes    = detectCol(headers, "note", "remark", "comment", "info", "detail");
    const colCategory = detectCol(headers, "type", "category", "cat", "kind");

    const rows: CredentialRow[] = [];
    for (let i = 1; i < raw.length; i++) {
      const row = raw[i] as string[];

      // Compose title from both dimensions when available
      const groupVal   = colGroup   >= 0 ? String(row[colGroup]   ?? "").trim() : "";
      const keyNameVal = colKeyName >= 0 ? String(row[colKeyName] ?? "").trim() : "";
      let title: string;
      if (groupVal && keyNameVal && groupVal !== keyNameVal) {
        title = `${groupVal} > ${keyNameVal}`;
      } else {
        title = groupVal || keyNameVal || `Row ${i}`;
      }
      if (!title) continue; // skip empty rows

      const secret  = colSecret   >= 0 ? String(row[colSecret]   ?? "").trim() : "";
      const catRaw  = colCategory >= 0 ? String(row[colCategory] ?? "") : "";
      const category = catRaw ? detectCategory(catRaw) : (secret ? detectCategory(title) : "other");

      rows.push({
        title,
        username: colUser  >= 0 ? String(row[colUser]  ?? "").trim() : "",
        secret,
        url:      colUrl   >= 0 ? String(row[colUrl]   ?? "").trim() : "",
        notes:    colNotes >= 0 ? String(row[colNotes] ?? "").trim() : "",
        category,
      });
    }

    // Use filename (without ext) if folder name is generic / same as root
    const projectName = ["s:", "s", "project management", "projects"].includes(
      excelFile.project_name.toLowerCase()
    )
      ? excelFile.filename.replace(/\.(xlsx?|csv)$/i, "")
      : excelFile.project_name;

    return { excelFile, rows, projectName };
  } catch (err) {
    return { excelFile, rows: [], projectName: excelFile.project_name, error: String(err) };
  }
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ImportModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("scan");
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<ExcelFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, setParsed] = useState<ParsedFile[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState("");
  const [scanRoot, setScanRoot] = useState("S:\\");
  const [clearBeforeImport, setClearBeforeImport] = useState(false);

  const { createProject, loadProjects, loadAllCredentials, projects } = useStore();

  const handleScan = async () => {
    setScanning(true);
    setFiles([]);
    try {
      const found = await api.scanExcelFiles(scanRoot);
      setFiles(found);
      // Pre-select all
      setSelected(new Set(found.map((f) => f.path)));
      setStep("select");
    } catch (e) {
      alert(`Scan failed: ${e}`);
    } finally {
      setScanning(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const handleImport = async () => {
    setStep("importing");

    if (clearBeforeImport) {
      setProgress("Clearing existing data…");
      await api.deleteAllData();
      await loadProjects();
    }

    const toImport = files.filter((f) => selected.has(f.path));
    const parsedFiles: ParsedFile[] = [];

    // Parse all selected files
    for (const f of toImport) {
      setProgress(`Reading ${f.filename}…`);
      try {
        const bytes = await api.readFileBytes(f.path);
        const data = new Uint8Array(bytes);
        parsedFiles.push(parseWorkbook(data, f));
      } catch (e) {
        parsedFiles.push({ excelFile: f, rows: [], projectName: f.project_name, error: String(e) });
      }
    }
    setParsed(parsedFiles);

    // Import into DB
    const importResults: ImportResult[] = [];
    for (const pf of parsedFiles) {
      if (pf.error || pf.rows.length === 0) {
        importResults.push({ projectName: pf.projectName, imported: 0, skipped: 0, error: pf.error ?? "No rows" });
        continue;
      }

      setProgress(`Importing ${pf.projectName}…`);

      try {
        // Find or create project
        let project = projects.find(
          (p) => p.name.toLowerCase() === pf.projectName.toLowerCase()
        );
        if (!project) {
          project = await createProject(pf.projectName, "", "indigo");
        }

        let imported = 0, skipped = 0;
        for (const row of pf.rows) {
          if (!row.title) { skipped++; continue; }
          try {
            await api.createCredential(project.id, {
              title: row.title,
              username: row.username,
              secret: row.secret,
              url: row.url,
              notes: row.notes,
              category: row.category,
              tags: [],
              favorite: false,
              totp_secret: "",
              custom_fields: [],
              expiry_date: "",
            });
            imported++;
          } catch {
            skipped++;
          }
        }
        importResults.push({ projectName: pf.projectName, imported, skipped });
      } catch (e) {
        importResults.push({ projectName: pf.projectName, imported: 0, skipped: pf.rows.length, error: String(e) });
      }
    }

    await Promise.all([loadProjects(), loadAllCredentials()]);
    setResults(importResults);
    setStep("done");
    setProgress("");
  };

  const totalImported = results.reduce((s, r) => s + r.imported, 0);

  return (
    <Modal title="Import from Excel / S: Drive" onClose={onClose} wide>
      {/* Step: Scan */}
      {step === "scan" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-slate-700/30 border border-slate-600/30 p-4 flex items-start gap-3">
            <FolderSearch className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-white">Scan for credential files</p>
              <p className="text-xs text-slate-400 mt-1">
                Searches for .xlsx, .xls, and .csv files. Auto-detects credential columns
                (Name, Username, Password, URL, Notes).
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Scan Root Directory</label>
            <input
              value={scanRoot}
              onChange={(e) => setScanRoot(e.target.value)}
              placeholder="S:\"
              className="w-full rounded-lg bg-slate-700/60 border border-slate-600/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <p className="mt-1 text-[10px] text-slate-500">Default: S:\ — scans up to 4 folders deep</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-700 transition">
              Cancel
            </button>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}
              {scanning ? "Scanning…" : "Scan Now"}
            </button>
          </div>
        </div>
      )}

      {/* Step: Select files */}
      {step === "select" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">
              Found <span className="text-white font-semibold">{files.length}</span> file{files.length !== 1 ? "s" : ""}
            </p>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setSelected(new Set(files.map((f) => f.path)))}
                className="text-indigo-400 hover:text-indigo-300">Select all</button>
              <span className="text-slate-600">·</span>
              <button onClick={() => setSelected(new Set())}
                className="text-slate-500 hover:text-slate-300">None</button>
            </div>
          </div>

          {files.length === 0 ? (
            <div className="rounded-xl bg-slate-700/30 border border-slate-600/30 p-6 text-center">
              <AlertCircle className="h-8 w-8 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No Excel/CSV files found in {scanRoot}</p>
              <button onClick={() => setStep("scan")} className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">
                ← Change directory
              </button>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto flex flex-col gap-1.5">
              {files.map((f) => (
                <div
                  key={f.path}
                  onClick={() => toggleSelect(f.path)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                    selected.has(f.path)
                      ? "bg-indigo-500/10 border-indigo-500/30"
                      : "bg-slate-700/30 border-slate-600/30 hover:bg-slate-700/50"
                  }`}
                >
                  {selected.has(f.path)
                    ? <CheckSquare className="h-4 w-4 text-indigo-400 shrink-0" />
                    : <Square className="h-4 w-4 text-slate-500 shrink-0" />
                  }
                  <FileSpreadsheet className="h-4 w-4 text-green-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{f.filename}</p>
                    <p className="text-[10px] text-slate-500 truncate">{f.path}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-medium text-slate-300 block">{f.project_name}</span>
                    <span className="text-[10px] text-slate-500">{f.size_kb} KB</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer select-none rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2">
            <input
              type="checkbox"
              checked={clearBeforeImport}
              onChange={(e) => setClearBeforeImport(e.target.checked)}
              className="h-4 w-4 accent-orange-500 cursor-pointer"
            />
            <div>
              <span className="text-sm text-orange-300 font-medium">Clear all existing data before import</span>
              <p className="text-[10px] text-slate-500 mt-0.5">Deletes all current projects &amp; credentials — useful when re-importing with fixed formatting</p>
            </div>
          </label>

          <div className="flex justify-between items-center pt-1">
            <button onClick={() => setStep("scan")}
              className="text-xs text-slate-500 hover:text-slate-300 transition">← Rescan</button>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-700 transition">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
              >
                <Upload className="h-4 w-4" />
                Import {selected.size} file{selected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === "importing" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
          <div className="text-center">
            <p className="text-white font-medium">Importing credentials…</p>
            <p className="text-slate-400 text-sm mt-1">{progress}</p>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl bg-green-500/10 border border-green-500/20 p-4">
            <CheckCircle2 className="h-6 w-6 text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Import Complete</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {totalImported} credential{totalImported !== 1 ? "s" : ""} imported across{" "}
                {results.filter((r) => r.imported > 0).length} project{results.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5">
            {results.map((r, i) => (
              <div key={i}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  r.error
                    ? "bg-red-500/5 border-red-500/20"
                    : "bg-slate-700/30 border-slate-600/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.error
                    ? <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                    : <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                  }
                  <span className={r.error ? "text-red-300" : "text-white"}>{r.projectName}</span>
                </div>
                <div className="text-right text-xs text-slate-400">
                  {r.error ? (
                    <span className="text-red-400">{r.error}</span>
                  ) : (
                    <>
                      <span className="text-green-400">{r.imported} imported</span>
                      {r.skipped > 0 && <span className="ml-1 text-slate-500">{r.skipped} skipped</span>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <button onClick={onClose}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition">
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
