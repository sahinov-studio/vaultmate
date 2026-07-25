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
  // ── Auth / migration / screen lock ──────────────────────────────────
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  completeOnboarding: () => invoke<void>("complete_onboarding"),
  replayOnboarding: () => invoke<void>("replay_onboarding"),
  finishMigration: (secret: string, isPin: boolean) =>
    invoke<void>("finish_migration", { secret, isPin }),
  setPin: (pin: string) => invoke<void>("set_pin", { pin }),
  removePin: () => invoke<void>("remove_pin"),
  verifyPin: (pin: string) => invoke<void>("verify_pin", { pin }),
  lockScreen: () => invoke<void>("lock_screen"),
  touchActivity: () => invoke<number>("touch_activity"),
  idleSeconds: () => invoke<number>("idle_seconds"),

  // ── Autostart ────────────────────────────────────────────────────
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
  installClaudeSkill: () => invoke<string>("install_claude_skill"),

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
