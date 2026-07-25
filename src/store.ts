import { create } from "zustand";
import { api } from "./lib/api";
import { toast, asError } from "./lib/toast";
import type {
  AppSettings,
  Credential,
  CredentialWithProject,
  CustomField,
  Project,
  VaultStatus,
} from "./lib/types";

type ViewMode = "projects" | "categories" | "favorites";
type Theme = "light" | "dark";

export interface CredentialInput {
  title: string;
  username: string;
  secret: string;
  url: string;
  notes: string;
  category: string;
  tags: string[];
  favorite: boolean;
  totp_secret: string;
  custom_fields: CustomField[];
  expiry_date: string;
}

interface Store {
  theme: Theme;
  toggleTheme: () => void;

  status: VaultStatus | null;
  refreshStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  replayOnboarding: () => Promise<void>;
  finishMigration: (secret: string, isPin: boolean) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  removePin: () => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  lock: () => Promise<void>;

  settings: AppSettings | null;
  loadSettings: () => Promise<void>;
  saveSettings: (autoLockMinutes: number, clipboardClearSeconds: number) => Promise<void>;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;

  projects: Project[];
  activeProjectId: number | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string, description: string, color: string) => Promise<Project>;
  updateProject: (id: number, name: string, description: string, color: string) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  setActiveProject: (id: number | null) => void;

  credentials: Credential[];
  loadCredentials: (projectId: number) => Promise<void>;
  createCredential: (projectId: number, input: CredentialInput) => Promise<void>;
  updateCredential: (id: number, input: CredentialInput) => Promise<void>;
  deleteCredential: (id: number) => Promise<void>;
  toggleFavorite: (id: number) => Promise<void>;
  touchUsed: (id: number) => Promise<void>;

  allCredentials: CredentialWithProject[];
  loadAllCredentials: () => Promise<void>;

  searchQuery: string;
  searchResults: CredentialWithProject[];
  search: (query: string) => Promise<void>;
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export const useStore = create<Store>((set, get) => ({
  theme: (localStorage.getItem("vm-theme") as Theme) ?? "dark",

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("vm-theme", next);
    applyTheme(next);
    set({ theme: next });
  },

  status: null,

  refreshStatus: async () => {
    try {
      const status = await api.vaultStatus();
      set({ status });
    } catch (e) {
      toast.error(asError(e));
    }
  },

  completeOnboarding: async () => {
    await api.completeOnboarding();
    await get().refreshStatus();
  },

  replayOnboarding: async () => {
    await api.replayOnboarding();
    await get().refreshStatus();
  },

  finishMigration: async (secret, isPin) => {
    await api.finishMigration(secret, isPin);
    await get().refreshStatus();
    await Promise.all([get().loadProjects(), get().loadAllCredentials(), get().loadSettings()]);
    toast.success("Vault migrated — VaultMate will never ask for a password again");
  },

  setPin: async (pin) => {
    await api.setPin(pin);
    await get().refreshStatus();
  },

  removePin: async () => {
    await api.removePin();
    await get().refreshStatus();
  },

  verifyPin: async (pin) => {
    try {
      await api.verifyPin(pin);
      await get().refreshStatus();
      await Promise.all([get().loadProjects(), get().loadAllCredentials(), get().loadSettings()]);
      return true;
    } catch (e) {
      toast.error(asError(e));
      return false;
    }
  },

  lock: async () => {
    await api.lockScreen();
    set({
      credentials: [],
      allCredentials: [],
      searchQuery: "",
      searchResults: [],
      activeProjectId: null,
    });
    await get().refreshStatus();
  },

  settings: null,
  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings });
    } catch (e) {
      // Settings call doesn't require unlocked vault, but it's still fine to swallow.
      console.warn("Failed to load settings:", e);
    }
  },
  saveSettings: async (autoLockMinutes, clipboardClearSeconds) => {
    await api.updateSettings(autoLockMinutes, clipboardClearSeconds);
    await get().loadSettings();
    toast.success("Settings saved");
  },

  viewMode: "projects",
  setViewMode: (viewMode) =>
    set({
      viewMode,
      selectedCategory: null,
      // Clear the active project when leaving the projects view so "Add Credential"
      // doesn't appear in favorites/categories and credentials don't reload stale.
      ...(viewMode !== "projects" ? { activeProjectId: null, credentials: [] } : {}),
    }),
  selectedCategory: null,
  setSelectedCategory: (selectedCategory) => set({ selectedCategory }),

  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    try {
      const projects = await api.listProjects();
      set({ projects });
    } catch {
      // Vault locked — not an error worth surfacing.
    }
  },

  createProject: async (name, description, color) => {
    const project = await api.createProject(name, description, color);
    await get().loadProjects();
    return project;
  },

  updateProject: async (id, name, description, color) => {
    await api.updateProject(id, name, description, color);
    await get().loadProjects();
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    if (get().activeProjectId === id)
      set({ activeProjectId: null, credentials: [] });
    await Promise.all([get().loadProjects(), get().loadAllCredentials()]);
  },

  setActiveProject: (id) => {
    set({
      activeProjectId: id,
      searchQuery: "",
      searchResults: [],
      selectedCategory: null,
    });
    if (id !== null) get().loadCredentials(id);
  },

  credentials: [],
  loadCredentials: async (projectId) => {
    try {
      const credentials = await api.listCredentials(projectId);
      set({ credentials });
    } catch (e) {
      toast.error(asError(e));
    }
  },

  createCredential: async (projectId, input) => {
    await api.createCredential(projectId, input);
    await Promise.all([get().loadCredentials(projectId), get().loadAllCredentials()]);
  },

  updateCredential: async (id, input) => {
    await api.updateCredential(id, input);
    const { activeProjectId } = get();
    if (activeProjectId !== null) await get().loadCredentials(activeProjectId);
    await get().loadAllCredentials();
  },

  deleteCredential: async (id) => {
    await api.deleteCredential(id);
    const { activeProjectId } = get();
    if (activeProjectId !== null) await get().loadCredentials(activeProjectId);
    await get().loadAllCredentials();
  },

  toggleFavorite: async (id) => {
    const flip = <T extends { id: number; favorite: boolean }>(list: T[]): T[] =>
      list.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c));
    // Optimistic update — flip immediately so favorites view responds instantly.
    set((s) => ({ credentials: flip(s.credentials), allCredentials: flip(s.allCredentials) }));
    try {
      await api.toggleFavorite(id);
      const { activeProjectId } = get();
      if (activeProjectId !== null) await get().loadCredentials(activeProjectId);
      await get().loadAllCredentials();
    } catch (e) {
      // Rollback optimistic update on failure.
      set((s) => ({ credentials: flip(s.credentials), allCredentials: flip(s.allCredentials) }));
      toast.error(asError(e));
    }
  },

  touchUsed: async (id) => {
    try {
      await api.touchCredentialUsed(id);
    } catch {
      // Best-effort.
    }
  },

  allCredentials: [],
  loadAllCredentials: async () => {
    try {
      const allCredentials = await api.listAllCredentials();
      set({ allCredentials });
    } catch {
      // Locked — fine.
    }
  },

  searchQuery: "",
  searchResults: [],
  search: async (query) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    try {
      const searchResults = await api.searchCredentials(query);
      set({ searchResults });
    } catch (e) {
      toast.error(asError(e));
    }
  },
}));
