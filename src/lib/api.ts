import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Credential,
  CredentialWithProject,
  CustomField,
  ExcelFile,
  GenPwOptions,
  Project,
  TotpResult,
  VaultStatus,
} from "./types";

interface CredentialPayload {
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

export const api = {
  // ── Auth ───────────────────────────────────────────────────────────
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  setupMasterPassword: (password: string) =>
    invoke<void>("setup_master_password", { password }),
  unlockVault: (password: string) => invoke<void>("unlock_vault", { password }),
  unlockWithPin: (pin: string) => invoke<void>("unlock_with_pin", { pin }),
  lockVault: () => invoke<void>("lock_vault"),
  touchActivity: () => invoke<number>("touch_activity"),
  idleSeconds: () => invoke<number>("idle_seconds"),
  changeMasterPassword: (current: string, newPassword: string) =>
    invoke<void>("change_master_password", { current, newPassword }),
  migrateLegacyVault: (oldPin: string, newPassword: string) =>
    invoke<void>("migrate_legacy_vault", { oldPin, newPassword }),
  enableQuickPin: (pin: string) => invoke<void>("enable_quick_pin", { pin }),
  disableQuickPin: () => invoke<void>("disable_quick_pin"),

  // ── Auto-unlock (DPAPI) + autostart ────────────────────────────────
  enableAutoUnlock: (password: string) =>
    invoke<void>("enable_auto_unlock", { password }),
  disableAutoUnlock: () => invoke<void>("disable_auto_unlock"),
  isAutoUnlockEnabled: () => invoke<boolean>("is_auto_unlock_enabled"),
  enableAutostart: () => invoke<void>("enable_autostart"),
  disableAutostart: () => invoke<void>("disable_autostart"),
  isAutostartEnabled: () => invoke<boolean>("is_autostart_enabled"),
  wasLaunchedHidden: () => invoke<boolean>("was_launched_hidden"),
  showMainWindow: () => invoke<void>("show_main_window"),

  // ── Settings ───────────────────────────────────────────────────────
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (autoLockMinutes: number, clipboardClearSeconds: number) =>
    invoke<void>("update_settings", {
      autoLockMinutes,
      clipboardClearSeconds,
    }),
  rotateMcpToken: () => invoke<string>("rotate_mcp_token"),

  // ── Projects ───────────────────────────────────────────────────────
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string, description: string, color: string) =>
    invoke<Project>("create_project", { name, description, color }),
  updateProject: (id: number, name: string, description: string, color: string) =>
    invoke<Project>("update_project", { id, name, description, color }),
  deleteProject: (id: number) => invoke<void>("delete_project", { id }),

  // ── Credentials ────────────────────────────────────────────────────
  listCredentials: (projectId: number) =>
    invoke<Credential[]>("list_credentials", { projectId }),
  createCredential: (projectId: number, payload: CredentialPayload) =>
    invoke<Credential>("create_credential", {
      projectId,
      title: payload.title,
      username: payload.username,
      secret: payload.secret,
      url: payload.url,
      notes: payload.notes,
      category: payload.category,
      tags: payload.tags,
      favorite: payload.favorite,
      totpSecret: payload.totp_secret,
      customFields: payload.custom_fields,
      expiryDate: payload.expiry_date,
    }),
  updateCredential: (id: number, payload: CredentialPayload) =>
    invoke<Credential>("update_credential", {
      id,
      title: payload.title,
      username: payload.username,
      secret: payload.secret,
      url: payload.url,
      notes: payload.notes,
      category: payload.category,
      tags: payload.tags,
      favorite: payload.favorite,
      totpSecret: payload.totp_secret,
      customFields: payload.custom_fields,
      expiryDate: payload.expiry_date,
    }),
  deleteCredential: (id: number) => invoke<void>("delete_credential", { id }),
  toggleFavorite: (id: number) => invoke<boolean>("toggle_favorite", { id }),
  touchCredentialUsed: (id: number) =>
    invoke<void>("touch_credential_used", { id }),
  searchCredentials: (query: string) =>
    invoke<CredentialWithProject[]>("search_credentials", { query }),
  listAllCredentials: () =>
    invoke<CredentialWithProject[]>("list_all_credentials"),

  // ── TOTP / password ────────────────────────────────────────────────
  totpForCredential: (credentialId: number) =>
    invoke<TotpResult>("totp_for_credential", { credentialId }),
  generatePassword: (opts: GenPwOptions) =>
    invoke<string>("generate_password", { opts }),

  // ── Backup ─────────────────────────────────────────────────────────
  exportBackup: (password: string) =>
    invoke<string>("export_backup", { password }),
  importBackup: (
    backupJson: string,
    password: string,
    replaceExisting: boolean,
  ) =>
    invoke<number>("import_backup", { backupJson, password, replaceExisting }),

  // ── Files ──────────────────────────────────────────────────────────
  writeTextFile: (path: string, contents: string) =>
    invoke<void>("write_text_file", { path, contents }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  scanExcelFiles: (root: string) =>
    invoke<ExcelFile[]>("scan_excel_files", { root }),
  readFileBytes: (path: string) =>
    invoke<number[]>("read_file_bytes", { path }),
  deleteAllData: () => invoke<void>("delete_all_data"),
};
