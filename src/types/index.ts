export type EntryCategory = 'web' | 'bank' | 'card' | 'wallet' | 'wifi' | 'identity' | 'note' | 'passkey' | 'other';

export interface EntryField {
  name: string;
  value: string;
  sensitive: boolean;
  field_type?: string; // "text" | "password" | "textarea" | "seed_phrase" | "security_qa" | "totp" | "ssh_key"
}

// --- Audit Types ---
export interface AuditResult {
  total_entries: number;
  total_passwords: number;
  weak: AuditIssue[];
  duplicated: AuditDuplicate[];
  old: AuditIssue[];
  score: number;
}

export interface AuditIssue {
  entry_id: string;
  entry_title: string;
  field_name: string;
  reason: string;
}

export interface AuditDuplicate {
  password_hash: string;
  entries: AuditDuplicateEntry[];
}

export interface AuditDuplicateEntry {
  entry_id: string;
  entry_title: string;
  field_name: string;
}

export interface SshKeyInfo {
  entry_id: string;
  entry_title: string;
  key_type: string;
  fingerprint: string;
  added_to_agent: boolean;
}

export interface HibpResult {
  entry_id: string;
  entry_title: string;
  field_name: string;
  breach_count: number;
}

// --- License Types ---
export type LicenseTier = 'free' | 'premium' | 'pro' | 'owner';

export interface LicenseInfo {
  is_premium: boolean;
  is_pro: boolean;
  tier: LicenseTier;
  /** none | active | expired | invalid */
  status: 'none' | 'active' | 'expired' | 'invalid';
  trial: boolean;
  email: string | null;
  license_key: string | null;
  activated_at: string | null;
  expires_at: string | null;
  days_left: number | null;
}

export interface AttachmentMeta {
  id: string;
  entry_id: string;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface EntryMeta {
  id: string;
  category: string;
  title: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  tags: string[];
  last_used_at: string | null;
  use_count: number;
  expires_at: string | null;
  deleted_at: string | null;
}

export interface HistoryItem {
  field: string;
  value: string;
  changed_at: string;
}

export interface Entry {
  id: string;
  category: string;
  title: string;
  fields: EntryField[];
  notes: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  tags: string[];
  expires_at: string | null;
  history_count: number;
}

export interface NewEntry {
  category: string;
  title: string;
  fields: EntryField[];
  notes?: string;
  favorite?: boolean;
  tags?: string[];
}

export interface UpdateEntry {
  category?: string;
  title?: string;
  fields?: EntryField[];
  notes?: string;
  favorite?: boolean;
}

export interface PasswordGenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

export const CATEGORY_LABELS: Record<EntryCategory, string> = {
  web: 'Sitios Web',
  bank: 'Bancos',
  card: 'Tarjetas',
  wifi: 'Wi-Fi',
  identity: 'Identidades',
  wallet: 'Wallets',
  note: 'Notas',
  passkey: 'Passkeys',
  other: 'Otros',
};

export const CATEGORY_DEFAULTS: Record<EntryCategory, EntryField[]> = {
  web: [
    { name: 'Usuario', value: '', sensitive: false, field_type: 'text' },
    { name: 'Contraseña', value: '', sensitive: true, field_type: 'password' },
    { name: 'URL', value: '', sensitive: false, field_type: 'text' },
    { name: 'TOTP', value: '', sensitive: true, field_type: 'totp' },
  ],
  bank: [
    { name: 'Número de cuenta', value: '', sensitive: true, field_type: 'password' },
    { name: 'Número de ruta', value: '', sensitive: true, field_type: 'password' },
    { name: 'PIN', value: '', sensitive: true, field_type: 'password' },
    { name: '¿Cuál es el nombre de tu mascota?', value: '', sensitive: true, field_type: 'security_qa' },
  ],
  card: [
    { name: 'Titular', value: '', sensitive: false, field_type: 'text' },
    { name: 'Número de tarjeta', value: '', sensitive: true, field_type: 'password' },
    { name: 'Vencimiento (MM/AA)', value: '', sensitive: false, field_type: 'text' },
    { name: 'Código de seguridad (CVV)', value: '', sensitive: true, field_type: 'password' },
    { name: 'PIN', value: '', sensitive: true, field_type: 'password' },
  ],
  wifi: [
    { name: 'Nombre de la red (SSID)', value: '', sensitive: false, field_type: 'text' },
    { name: 'Contraseña', value: '', sensitive: true, field_type: 'password' },
    { name: 'Seguridad (WPA, WEP o nopass)', value: 'WPA', sensitive: false, field_type: 'text' },
  ],
  identity: [
    { name: 'Nombre completo', value: '', sensitive: false, field_type: 'text' },
    { name: 'Documento de identidad', value: '', sensitive: true, field_type: 'password' },
    { name: 'Pasaporte', value: '', sensitive: true, field_type: 'password' },
    { name: 'Fecha de nacimiento', value: '', sensitive: false, field_type: 'text' },
    { name: 'Dirección', value: '', sensitive: false, field_type: 'textarea' },
    { name: 'Teléfono', value: '', sensitive: false, field_type: 'text' },
    { name: 'Correo', value: '', sensitive: false, field_type: 'text' },
  ],
  wallet: [
    { name: 'Dirección', value: '', sensitive: false, field_type: 'text' },
    { name: 'Clave privada', value: '', sensitive: true, field_type: 'password' },
    { name: 'Frase semilla', value: '', sensitive: true, field_type: 'seed_phrase' },
  ],
  note: [
    { name: 'Contenido', value: '', sensitive: false, field_type: 'textarea' },
  ],
  passkey: [
    { name: 'Sitio web', value: '', sensitive: false, field_type: 'text' },
    { name: 'Nombre de usuario', value: '', sensitive: false, field_type: 'text' },
    { name: 'ID de credencial', value: '', sensitive: true, field_type: 'password' },
    { name: 'Clave privada', value: '', sensitive: true, field_type: 'textarea' },
    { name: 'Algoritmo', value: 'ES256', sensitive: false, field_type: 'text' },
  ],
  other: [],
};

// --- Ajustes ---
export interface AppSettings {
  auto_lock_minutes: number;
  lock_warning_secs: number;
  clipboard_clear_secs: number;
  lock_on_sleep: boolean;
  lock_on_session_lock: boolean;
  lock_on_minimize: boolean;
  tray_enabled: boolean;
  close_to_tray: boolean;
  quick_search_enabled: boolean;
  quick_search_shortcut: string;
  copy_sequence: boolean;
  auto_type_sequence: string;
  quick_unlock_enabled: boolean;
  quick_unlock_hours: number;
  quick_unlock_hello: boolean;
}

export interface QuickStatus {
  pin: boolean;
  hello: boolean;
  attempts_left: number;
  expires_in_secs: number;
}

export interface SettingsLimits {
  premium: boolean;
  max_auto_lock_minutes: number;
  max_clipboard_secs: number;
  max_lock_pause_minutes: number;
}

export interface SettingsResponse {
  effective: AppSettings;
  saved: AppSettings;
  limits: SettingsLimits;
}

export interface ClipboardStatus {
  active: boolean;
  seconds_left: number;
}
