import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Copy, Check, Eye, EyeOff, Plus, Search, Lock, Trash2, Edit2, FolderOpen, X,
  Key, Zap, Database, Terminal, Shield, Code2, FileDown, LayoutGrid, LayoutList,
  Tag, ChevronRight, Layers, Upload, Sun, Moon, CreditCard, Wifi, Coins, Award,
  Server, StickyNote, IdCard, Mail, Star, Settings as SettingsIcon, Download,
  Heart,
} from "lucide-react";
import { useStore } from "../store";
import type { Credential, CredentialWithProject, Project } from "../lib/types";
import { CATEGORIES, PROJECT_COLORS, categoryColor, categoryAccentBar, colorDot, emptyCredential } from "../lib/types";
import { ImportModal } from "./ImportModal";
import { CredentialModal } from "./CredentialModal";
import { SettingsModal } from "./SettingsModal";
import { BackupModal } from "./BackupModal";
import { TotpDisplay } from "./TotpDisplay";
import { Modal, Field, ModalActions, inputCls } from "./AppShellShared";
import { toast } from "../lib/toast";

const CAT_ICONS: Record<string, React.ReactNode> = {
  login:    <Key className="h-3.5 w-3.5" />,
  api_key:  <Zap className="h-3.5 w-3.5" />,
  database: <Database className="h-3.5 w-3.5" />,
  ssh:      <Terminal className="h-3.5 w-3.5" />,
  token:    <Shield className="h-3.5 w-3.5" />,
  env:      <Code2 className="h-3.5 w-3.5" />,
  card:     <CreditCard className="h-3.5 w-3.5" />,
  wifi:     <Wifi className="h-3.5 w-3.5" />,
  crypto:   <Coins className="h-3.5 w-3.5" />,
  license:  <Award className="h-3.5 w-3.5" />,
  server:   <Server className="h-3.5 w-3.5" />,
  note:     <StickyNote className="h-3.5 w-3.5" />,
  identity: <IdCard className="h-3.5 w-3.5" />,
  email:    <Mail className="h-3.5 w-3.5" />,
  other:    <FileDown className="h-3.5 w-3.5" />,
};

interface ColWidths { title: number; secret: number; url: number }
const DEFAULT_COL_WIDTHS: ColWidths = { title: 220, secret: 180, url: 140 };

export function AppShell() {
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [showCredModal, setShowCredModal] = useState(false);
  const [editCred, setEditCred] = useState<Credential | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBackup, setShowBackup] = useState<"export" | "import" | null>(null);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        onNewProject={() => { setEditProject(null); setShowProjectModal(true); }}
        onEditProject={(p) => { setEditProject(p); setShowProjectModal(true); }}
        onImport={() => setShowImport(true)}
        onSettings={() => setShowSettings(true)}
        onExport={() => setShowBackup("export")}
        onImportBackup={() => setShowBackup("import")}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MainPanel
          onNewCred={() => { setEditCred(null); setShowCredModal(true); }}
          onEditCred={(c) => { setEditCred(c); setShowCredModal(true); }}
        />
      </div>
      {showProjectModal && (
        <ProjectModal project={editProject} onClose={() => setShowProjectModal(false)} />
      )}
      {showCredModal && (
        <CredentialModal credential={editCred} onClose={() => setShowCredModal(false)} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showBackup && (
        <BackupModal mode={showBackup} onClose={() => setShowBackup(null)} />
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({
  onNewProject, onEditProject, onImport, onSettings, onExport, onImportBackup,
}: {
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onImport: () => void;
  onSettings: () => void;
  onExport: () => void;
  onImportBackup: () => void;
}) {
  const {
    projects, activeProjectId, setActiveProject, deleteProject, lock,
    search, searchQuery, viewMode, setViewMode, selectedCategory,
    setSelectedCategory, allCredentials, theme, toggleTheme,
  } = useStore();

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allCredentials.forEach((c) => {
      counts[c.category] = (counts[c.category] ?? 0) + 1;
    });
    return counts;
  }, [allCredentials]);

  const favoritesCount = useMemo(
    () => allCredentials.filter((c) => c.favorite).length,
    [allCredentials],
  );

  const handleDeleteProject = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Delete this project and all its credentials?")) {
      await deleteProject(id);
      toast.success("Project deleted");
    }
  };

  return (
    <aside className="flex w-64 flex-col bg-white border-r border-slate-200 dark:bg-slate-900 dark:border-slate-800">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
          <Lock className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-slate-900 text-sm dark:text-white">VaultMate</span>
          <div className="text-[10px] text-slate-400 dark:text-slate-500">Local Vault</div>
        </div>
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 dark:bg-slate-800/80 dark:border-slate-700/50">
          <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => search(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
          />
          {searchQuery && (
            <button onClick={() => search("")}>
              <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" />
            </button>
          )}
        </div>
      </div>

      {/* View toggle */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex rounded-lg bg-slate-100 border border-slate-200 p-0.5 dark:bg-slate-800/50 dark:border-slate-700/30">
          <ViewToggle id="projects" current={viewMode} on={setViewMode} icon={<Layers className="h-3 w-3" />} label="Projects" />
          <ViewToggle id="categories" current={viewMode} on={setViewMode} icon={<Tag className="h-3 w-3" />} label="Categories" />
          <ViewToggle id="favorites" current={viewMode} on={setViewMode} icon={<Heart className="h-3 w-3" />} label={`★ ${favoritesCount}`} />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {viewMode === "projects" ? (
          <>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Projects
              </span>
              <button
                onClick={onNewProject}
                title="New project"
                className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
                No projects yet
              </p>
            ) : (
              projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setActiveProject(p.id)}
                  className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all ${
                    activeProjectId === p.id
                      ? "bg-indigo-50 text-slate-900 border border-indigo-200 dark:bg-indigo-500/10 dark:text-white dark:border-indigo-500/20"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 border border-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <div className={`h-2 w-2 shrink-0 rounded-full ${colorDot(p.color)}`} />
                  <span className="flex-1 truncate text-sm">{p.name}</span>
                  <div className="hidden items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditProject(p); }}
                      className="rounded p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 dark:hover:bg-slate-600 dark:text-slate-500 dark:hover:text-slate-200"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteProject(e, p.id)}
                      className="rounded p-1 hover:bg-red-100 text-slate-400 hover:text-red-500 dark:hover:bg-red-500/20 dark:text-slate-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {activeProjectId === p.id && (
                    <ChevronRight className="h-3 w-3 text-indigo-500 shrink-0 dark:text-indigo-400" />
                  )}
                </div>
              ))
            )}
          </>
        ) : viewMode === "categories" ? (
          <>
            <div className="px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Categories
              </span>
            </div>
            <CategoryRow
              icon={<LayoutGrid className="h-3.5 w-3.5 text-slate-400" />}
              label="All Credentials"
              count={allCredentials.length}
              active={selectedCategory === null}
              onClick={() => setSelectedCategory(null)}
            />
            {CATEGORIES.map((cat) => {
              const count = catCounts[cat.value] ?? 0;
              return (
                <CategoryRow
                  key={cat.value}
                  icon={<span className="text-slate-400">{CAT_ICONS[cat.value]}</span>}
                  label={cat.label}
                  count={count}
                  active={selectedCategory === cat.value}
                  onClick={() => setSelectedCategory(cat.value)}
                />
              );
            })}
          </>
        ) : (
          <div className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
            Showing favorited credentials.
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-slate-200 p-3 flex flex-col gap-1 dark:border-slate-800">
        <FooterBtn icon={<Upload className="h-3.5 w-3.5" />} label="Import from Excel" onClick={onImport} />
        <FooterBtn icon={<Download className="h-3.5 w-3.5" />} label="Export Backup" onClick={onExport} />
        <FooterBtn icon={<Upload className="h-3.5 w-3.5" />} label="Restore Backup" onClick={onImportBackup} />
        <FooterBtn icon={<SettingsIcon className="h-3.5 w-3.5" />} label="Settings" onClick={onSettings} />
        <button
          onClick={lock}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-red-50 hover:text-red-500 transition dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-red-400"
        >
          <Lock className="h-3.5 w-3.5" />
          Lock Vault
        </button>
      </div>
    </aside>
  );
}

function ViewToggle({
  id, current, on, icon, label,
}: {
  id: "projects" | "categories" | "favorites";
  current: string;
  on: (v: "projects" | "categories" | "favorites") => void;
  icon: React.ReactNode;
  label: string;
}) {
  const active = current === id;
  return (
    <button
      onClick={() => on(id)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
        active
          ? "bg-white text-slate-800 shadow dark:bg-slate-700 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function CategoryRow({
  icon, label, count, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all ${
        active
          ? "bg-indigo-50 text-slate-900 border border-indigo-200 dark:bg-indigo-500/10 dark:text-white dark:border-indigo-500/20"
          : "text-slate-600 hover:bg-slate-100 border border-transparent dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      }`}
    >
      {icon}
      <span className="flex-1 text-sm">{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-400">
          {count}
        </span>
      )}
    </div>
  );
}

function FooterBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {icon} {label}
    </button>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
function MainPanel({
  onNewCred, onEditCred,
}: {
  onNewCred: () => void;
  onEditCred: (c: Credential) => void;
}) {
  const {
    searchQuery, searchResults, viewMode, selectedCategory,
    allCredentials, projects, activeProjectId, credentials,
  } = useStore();

  if (searchQuery.trim()) {
    return (
      <CredentialGrid
        title={`"${searchQuery}"`}
        subtitle={`${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}`}
        items={searchResults}
        onEdit={onEditCred}
        onNew={onNewCred}
        showProject
      />
    );
  }

  if (viewMode === "favorites") {
    const favs = allCredentials.filter((c) => c.favorite);
    return (
      <CredentialGrid
        title="Favorites"
        subtitle={`${favs.length} starred`}
        items={favs}
        onEdit={onEditCred}
        onNew={onNewCred}
        showProject
      />
    );
  }

  if (viewMode === "categories") {
    const filtered = selectedCategory
      ? allCredentials.filter((c) => c.category === selectedCategory)
      : allCredentials;
    const catLabel = CATEGORIES.find((c) => c.value === selectedCategory)?.label ?? "All Credentials";
    return (
      <CredentialGrid
        title={catLabel}
        subtitle={`${filtered.length} credential${filtered.length !== 1 ? "s" : ""}`}
        items={filtered}
        onEdit={onEditCred}
        onNew={onNewCred}
        showProject
      />
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="rounded-2xl bg-slate-100 p-8 text-center border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700/30">
          <FolderOpen className="h-12 w-12 mx-auto mb-3 text-slate-400 dark:text-slate-600" />
          <p className="text-slate-600 font-medium dark:text-slate-400">Select a project</p>
          <p className="text-slate-400 text-sm mt-1 dark:text-slate-600">or switch to Categories view</p>
        </div>
      </div>
    );
  }

  const project = projects.find((p) => p.id === activeProjectId);
  const items: CredentialWithProject[] = credentials.map((c) => ({
    ...c, project_name: project?.name ?? "",
  }));

  return (
    <CredentialGrid
      title={project?.name ?? ""}
      subtitle={`${credentials.length} credential${credentials.length !== 1 ? "s" : ""}`}
      accentColor={project?.color}
      items={items}
      onEdit={onEditCred}
      onNew={onNewCred}
    />
  );
}

// ── Resizable column divider ──────────────────────────────────────────────────
function ResizeDivider({ onResize }: { onResize: (dx: number) => void }) {
  const lastX = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    lastX.current = e.clientX;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - lastX.current;
    lastX.current = e.clientX;
    onResizeRef.current(dx);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-dragging={dragging}
      className="col-resize-handle"
    />
  );
}

function ListColumnHeader({
  colWidths, onResize, showProject,
}: {
  colWidths: ColWidths;
  onResize: (col: keyof ColWidths, dx: number) => void;
  showProject?: boolean;
}) {
  const hdrCls = "text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none";
  return (
    <div className="flex items-center px-4 py-2 border-b border-slate-200 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60">
      <div className="w-4 shrink-0" />
      <div className="relative shrink-0 pr-3" style={{ width: colWidths.title }}>
        <span className={hdrCls}>{showProject ? "Name / Project" : "Name"}</span>
        <ResizeDivider onResize={(dx) => onResize("title", dx)} />
      </div>
      <div className="w-24 shrink-0 pr-3"><span className={hdrCls}>Type</span></div>
      <div className="flex-1 min-w-0 pr-3"><span className={hdrCls}>Username</span></div>
      <div className="relative shrink-0 pr-3" style={{ width: colWidths.secret }}>
        <span className={hdrCls}>Secret</span>
        <ResizeDivider onResize={(dx) => onResize("secret", dx)} />
      </div>
      <div className="relative hidden lg:block shrink-0 pr-3" style={{ width: colWidths.url }}>
        <span className={hdrCls}>URL</span>
        <ResizeDivider onResize={(dx) => onResize("url", dx)} />
      </div>
      <div className="w-20 shrink-0" />
    </div>
  );
}

function CredentialGrid({
  title, subtitle, accentColor, items, onEdit, onNew, showProject,
}: {
  title: string;
  subtitle: string;
  accentColor?: string;
  items: CredentialWithProject[];
  onEdit: (c: Credential) => void;
  onNew: () => void;
  showProject?: boolean;
}) {
  const [filterCat, setFilterCat] = useState<string>("all");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [localSearch, setLocalSearch] = useState("");
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const { activeProjectId } = useStore();

  const resizeCol = useCallback((col: keyof ColWidths, dx: number) => {
    setColWidths((prev) => ({ ...prev, [col]: Math.max(80, prev[col] + dx) }));
  }, []);

  const usedCats = useMemo(() => {
    const s = new Set(items.map((c) => c.category));
    return CATEGORIES.filter((c) => s.has(c.value));
  }, [items]);

  const displayed = useMemo(() => {
    let result = filterCat === "all" ? items : items.filter((c) => c.category === filterCat);
    if (localSearch.trim()) {
      const q = localSearch.toLowerCase();
      result = result.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q) ||
        c.url.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (showProject && c.project_name.toLowerCase().includes(q))
      );
    }
    // Sort favorites first.
    return [...result].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [items, filterCat, localSearch, showProject]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center gap-3">
          {accentColor && (
            <div className={`h-3 w-3 rounded-full ${colorDot(accentColor)}`} />
          )}
          <div>
            <h2 className="font-semibold text-slate-900 text-base dark:text-white">{title}</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {localSearch ? `${displayed.length} of ${items.length}` : subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 border border-slate-200 p-0.5 dark:bg-slate-800 dark:border-slate-700/50">
            <button
              onClick={() => setLayout("list")}
              title="List view"
              className={`rounded-md p-1.5 transition ${layout === "list" ? "bg-white text-slate-700 shadow dark:bg-slate-600 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"}`}
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <button
              onClick={() => setLayout("grid")}
              title="Grid view"
              className={`rounded-md p-1.5 transition ${layout === "grid" ? "bg-white text-slate-700 shadow dark:bg-slate-600 dark:text-white" : "text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          {activeProjectId && (
            <button
              onClick={onNew}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition shadow-lg shadow-indigo-500/20"
            >
              <Plus className="h-4 w-4" /> Add Credential
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-200/60 bg-slate-50/50 dark:border-slate-800/60 dark:bg-slate-900/30">
        <div className="flex items-center gap-2 flex-1 max-w-xs rounded-lg bg-white border border-slate-200 px-3 py-1.5 dark:bg-slate-800/80 dark:border-slate-700/50">
          <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Filter credentials…"
            className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
          />
          {localSearch && (
            <button onClick={() => setLocalSearch("")}>
              <X className="h-3 w-3 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" />
            </button>
          )}
        </div>
        {usedCats.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto">
            <FilterPill label="All" active={filterCat === "all"} onClick={() => setFilterCat("all")} />
            {usedCats.map((c) => (
              <FilterPill
                key={c.value}
                label={c.label}
                active={filterCat === c.value}
                onClick={() => setFilterCat(c.value)}
                icon={CAT_ICONS[c.value]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="rounded-2xl bg-slate-100 p-8 text-center border border-slate-200 dark:bg-slate-800/40 dark:border-slate-700/30">
              <Key className="h-10 w-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-slate-500 text-sm dark:text-slate-400">
                {localSearch ? `No matches for "${localSearch}"` : "No credentials here"}
              </p>
              {!localSearch && activeProjectId && (
                <button onClick={onNew} className="mt-3 text-xs text-indigo-500 hover:text-indigo-400 dark:text-indigo-400 dark:hover:text-indigo-300">
                  + Add the first one
                </button>
              )}
            </div>
          </div>
        ) : layout === "grid" ? (
          <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayed.map((c) => (
              <CredentialCard key={c.id} cred={c} onEdit={onEdit} showProject={showProject} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            <ListColumnHeader colWidths={colWidths} onResize={resizeCol} showProject={showProject} />
            {displayed.map((c) => (
              <CredentialListRow
                key={c.id}
                cred={c}
                onEdit={onEdit}
                showProject={showProject}
                colWidths={colWidths}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label, active, onClick, icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30"
          : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function useClipboardCopy() {
  const settings = useStore((s) => s.settings);
  const clearAfter = (settings?.clipboard_clear_seconds ?? 30) * 1000;
  return useCallback(
    async (text: string, label?: string) => {
      await navigator.clipboard.writeText(text);
      if (label) toast.success(`Copied ${label}`);
      setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), clearAfter);
    },
    [clearAfter],
  );
}

// ── Credential Card (grid) ────────────────────────────────────────────────────
function CredentialCard({
  cred, onEdit, showProject,
}: {
  cred: CredentialWithProject;
  onEdit: (c: Credential) => void;
  showProject?: boolean;
}) {
  const { deleteCredential, toggleFavorite, touchUsed } = useStore();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"secret" | "user" | null>(null);
  const copy = useClipboardCopy();

  const onCopy = async (text: string, type: "secret" | "user") => {
    await copy(text, type === "secret" ? "secret" : "username");
    touchUsed(cred.id);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const catLabel = CATEGORIES.find((c) => c.value === cred.category)?.label ?? cred.category;

  return (
    <div className="group relative flex flex-col gap-0 rounded-xl bg-white border border-slate-200 overflow-hidden transition-all hover:border-slate-300 hover:shadow-md dark:bg-slate-800 dark:border-slate-700/50 dark:hover:border-slate-600 dark:hover:shadow-lg dark:hover:shadow-black/20">
      <div className={`h-0.5 w-full ${categoryAccentBar(cred.category)}`} />
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-slate-900 text-sm leading-tight truncate dark:text-white">{cred.title}</p>
              {cred.favorite && <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />}
            </div>
            {showProject && <p className="text-[10px] text-indigo-600 mt-0.5 dark:text-indigo-400">{cred.project_name}</p>}
          </div>
          <span className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${categoryColor(cred.category)}`}>
            {CAT_ICONS[cred.category]}
            {catLabel}
          </span>
        </div>
        {cred.username && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-700/40">
            <span className="flex-1 truncate text-xs text-slate-600 dark:text-slate-400">{cred.username}</span>
            <button onClick={() => onCopy(cred.username, "user")} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300" title="Copy username">
              {copied === "user" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        )}
        {cred.secret && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1.5 dark:bg-slate-900/60 dark:border-slate-700/30">
            <code className="flex-1 truncate text-xs font-mono text-slate-700 dark:text-slate-300">
              {revealed ? cred.secret : "••••••••••••••••"}
            </code>
            <button onClick={() => setRevealed((v) => !v)} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300">
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => onCopy(cred.secret, "secret")} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300">
              {copied === "secret" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        {cred.totp_secret && <TotpDisplay credentialId={cred.id} />}
        {cred.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cred.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                #{t}
              </span>
            ))}
          </div>
        )}
        {cred.url && <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{cred.url}</p>}
        {cred.expiry_date && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Expires: {cred.expiry_date}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity dark:border-slate-700/30 dark:bg-slate-900/40">
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleFavorite(cred.id)}
            title={cred.favorite ? "Unfavorite" : "Favorite"}
            className={`rounded-md p-1 transition ${cred.favorite ? "text-amber-500" : "text-slate-400 hover:text-amber-500"}`}
          >
            <Star className={`h-3 w-3 ${cred.favorite ? "fill-amber-500" : ""}`} />
          </button>
          <button
            onClick={() => onEdit(toCredential(cred))}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Edit2 className="h-3 w-3" /> Edit
          </button>
        </div>
        <button
          onClick={async () => {
            if (confirm(`Delete "${cred.title}"?`)) {
              await deleteCredential(cred.id);
              toast.success("Credential deleted");
            }
          }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-red-100 hover:text-red-500 transition dark:text-slate-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>
    </div>
  );
}

// ── Credential List Row ───────────────────────────────────────────────────────
function CredentialListRow({
  cred, onEdit, showProject, colWidths,
}: {
  cred: CredentialWithProject;
  onEdit: (c: Credential) => void;
  showProject?: boolean;
  colWidths: ColWidths;
}) {
  const { deleteCredential, toggleFavorite, touchUsed } = useStore();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"secret" | "user" | null>(null);
  const copy = useClipboardCopy();

  const onCopy = async (text: string, type: "secret" | "user") => {
    await copy(text, type === "secret" ? "secret" : "username");
    touchUsed(cred.id);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const catLabel = CATEGORIES.find((c) => c.value === cred.category)?.label ?? cred.category;

  return (
    <div className="group flex items-center px-4 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors dark:border-slate-800/40 dark:hover:bg-slate-800/40">
      <div className="w-4 shrink-0">
        <div className={`h-2 w-2 rounded-full ${categoryAccentBar(cred.category)}`} />
      </div>

      <div className="shrink-0 min-w-0 pr-3" style={{ width: colWidths.title }}>
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium text-slate-800 truncate dark:text-white">{cred.title}</p>
          {cred.favorite && <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />}
        </div>
        {showProject && <p className="text-[10px] text-indigo-600 truncate dark:text-indigo-400">{cred.project_name}</p>}
      </div>

      <div className="w-24 shrink-0 pr-3">
        <span className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${categoryColor(cred.category)}`}>
          {CAT_ICONS[cred.category]}
          {catLabel}
        </span>
      </div>

      <div className="flex flex-1 min-w-0 items-center gap-1.5 rounded-md bg-slate-100 border border-slate-200 px-2.5 py-1 mr-3 dark:bg-slate-700/30 dark:border-transparent">
        <span className="flex-1 truncate text-xs text-slate-600 dark:text-slate-400">
          {cred.username || <span className="text-slate-400 italic dark:text-slate-600">no username</span>}
        </span>
        {cred.username && (
          <button onClick={() => onCopy(cred.username, "user")} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300" title="Copy username">
            {copied === "user" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-1.5 rounded-md bg-slate-100 border border-slate-200 px-2.5 py-1 mr-3 dark:bg-slate-900/60 dark:border-slate-700/30" style={{ width: colWidths.secret }}>
        <code className="flex-1 truncate text-xs font-mono text-slate-700 dark:text-slate-300">
          {cred.secret ? (revealed ? cred.secret : "••••••••••••") : <span className="italic text-slate-400">none</span>}
        </code>
        {cred.secret && (
          <>
            <button onClick={() => setRevealed((v) => !v)} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300" title={revealed ? "Hide" : "Reveal"}>
              {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
            <button onClick={() => onCopy(cred.secret, "secret")} className="shrink-0 text-slate-400 hover:text-slate-600 transition dark:text-slate-600 dark:hover:text-slate-300" title="Copy secret">
              {copied === "secret" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
          </>
        )}
      </div>

      <div className="hidden lg:block shrink-0 pr-3 overflow-hidden" style={{ width: colWidths.url }}>
        {cred.url && <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{cred.url}</p>}
      </div>

      <div className="w-20 flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => toggleFavorite(cred.id)}
          title={cred.favorite ? "Unfavorite" : "Favorite"}
          className={`rounded-md p-1.5 transition ${cred.favorite ? "text-amber-500" : "text-slate-400 hover:text-amber-500"}`}
        >
          <Star className={`h-3 w-3 ${cred.favorite ? "fill-amber-500" : ""}`} />
        </button>
        <button
          onClick={() => onEdit(toCredential(cred))}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          title="Edit"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={async () => {
            if (confirm(`Delete "${cred.title}"?`)) {
              await deleteCredential(cred.id);
              toast.success("Credential deleted");
            }
          }}
          className="rounded-md p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-500 transition dark:text-slate-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function toCredential(c: CredentialWithProject): Credential {
  return {
    ...emptyCredential(c.project_id),
    ...c,
    created_at: "",
    updated_at: "",
  };
}

// ── Project Modal ─────────────────────────────────────────────────────────────
function ProjectModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { createProject, updateProject } = useStore();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? "indigo");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (project) {
      await updateProject(project.id, name, description, color);
      toast.success("Project updated");
    } else {
      await createProject(name, description, color);
      toast.success("Project created");
    }
    onClose();
  };

  return (
    <Modal title={project ? "Edit Project" : "New Project"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Project Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp" className={inputCls} />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional short description" className={inputCls} />
        </Field>
        <Field label="Color">
          <div className="flex gap-2 flex-wrap">
            {PROJECT_COLORS.map((c) => (
              <button key={c.value} type="button" onClick={() => setColor(c.value)}
                className={`h-7 w-7 rounded-full ${c.class} transition-transform hover:scale-110 ${
                  color === c.value ? "ring-2 ring-white ring-offset-2 ring-offset-slate-100 scale-110 dark:ring-offset-slate-800" : ""
                }`}
              />
            ))}
          </div>
        </Field>
        <ModalActions onClose={onClose} submitLabel={project ? "Save Changes" : "Create Project"} />
      </form>
    </Modal>
  );
}

// Re-export shared modal helpers for ImportModal compatibility.
export { Modal, Field, ModalActions, inputCls };

// Suppress unused import warnings.
void useEffect;
