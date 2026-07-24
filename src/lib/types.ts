export interface Project {
  id: number;
  name: string;
  description: string;
  color: string;
  created_at: string;
}

export interface CustomField {
  label: string;
  value: string;
  secret: boolean;
}

export interface Credential {
  id: number;
  project_id: number;
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
  last_used_at: string;
  created_at: string;
  updated_at: string;
}

export interface CredentialWithProject
  extends Omit<Credential, "created_at" | "updated_at"> {
  project_name: string;
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  legacy: boolean;
  locked_until_ms: number | null;
  failed_attempts: number;
}

export interface AppSettings {
  auto_lock_minutes: number;
  clipboard_clear_seconds: number;
  mcp_token: string;
  quick_pin_set: boolean;
}

export interface TotpResult {
  code: string;
  remaining_seconds: number;
}

export interface GenPwOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoid_ambiguous: boolean;
}

export type CredentialCategory =
  | "login"
  | "api_key"
  | "database"
  | "ssh"
  | "token"
  | "env"
  | "card"
  | "wifi"
  | "crypto"
  | "license"
  | "server"
  | "note"
  | "identity"
  | "email"
  | "other";

export const CATEGORIES: { value: CredentialCategory; label: string }[] = [
  { value: "login", label: "Login" },
  { value: "api_key", label: "API Key" },
  { value: "database", label: "Database" },
  { value: "ssh", label: "SSH Key" },
  { value: "token", label: "Token" },
  { value: "env", label: "Env Variable" },
  { value: "card", label: "Credit Card" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "crypto", label: "Crypto Wallet" },
  { value: "license", label: "Software License" },
  { value: "server", label: "Server" },
  { value: "note", label: "Secure Note" },
  { value: "identity", label: "Identity" },
  { value: "email", label: "Email Account" },
  { value: "other", label: "Other" },
];

export interface ExcelFile {
  path: string;
  filename: string;
  project_name: string;
  size_kb: number;
}

export const PROJECT_COLORS = [
  { value: "indigo", class: "bg-indigo-500" },
  { value: "blue", class: "bg-blue-500" },
  { value: "violet", class: "bg-violet-500" },
  { value: "green", class: "bg-green-500" },
  { value: "yellow", class: "bg-yellow-500" },
  { value: "orange", class: "bg-orange-500" },
  { value: "red", class: "bg-red-500" },
  { value: "pink", class: "bg-pink-500" },
];

export function colorDot(color: string) {
  const map: Record<string, string> = {
    indigo: "bg-indigo-500",
    blue: "bg-blue-500",
    violet: "bg-violet-500",
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
    pink: "bg-pink-500",
  };
  return map[color] ?? "bg-slate-500";
}

export function categoryColor(cat: string) {
  const map: Record<string, string> = {
    login:    "bg-indigo-500/20 text-indigo-300",
    api_key:  "bg-yellow-500/20 text-yellow-300",
    database: "bg-green-500/20 text-green-300",
    ssh:      "bg-violet-500/20 text-violet-300",
    token:    "bg-blue-500/20 text-blue-300",
    env:      "bg-orange-500/20 text-orange-300",
    card:     "bg-rose-500/20 text-rose-300",
    wifi:     "bg-cyan-500/20 text-cyan-300",
    crypto:   "bg-amber-500/20 text-amber-300",
    license:  "bg-fuchsia-500/20 text-fuchsia-300",
    server:   "bg-teal-500/20 text-teal-300",
    note:     "bg-slate-400/20 text-slate-300",
    identity: "bg-pink-500/20 text-pink-300",
    email:    "bg-sky-500/20 text-sky-300",
    other:    "bg-slate-500/20 text-slate-300",
  };
  return map[cat] ?? "bg-slate-500/20 text-slate-300";
}

export function categoryAccentBar(cat: string) {
  const map: Record<string, string> = {
    login: "bg-indigo-500", api_key: "bg-yellow-500",
    database: "bg-green-500", ssh: "bg-violet-500",
    token: "bg-blue-500", env: "bg-orange-500",
    card: "bg-rose-500", wifi: "bg-cyan-500",
    crypto: "bg-amber-500", license: "bg-fuchsia-500",
    server: "bg-teal-500", note: "bg-slate-400",
    identity: "bg-pink-500", email: "bg-sky-500",
    other: "bg-slate-400",
  };
  return map[cat] ?? "bg-slate-400";
}

export function emptyCredential(projectId: number): Credential {
  return {
    id: 0,
    project_id: projectId,
    title: "",
    username: "",
    secret: "",
    url: "",
    notes: "",
    category: "login",
    tags: [],
    favorite: false,
    totp_secret: "",
    custom_fields: [],
    expiry_date: "",
    last_used_at: "",
    created_at: "",
    updated_at: "",
  };
}
