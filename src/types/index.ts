export type EntryCategory = 'web' | 'bank' | 'wallet' | 'note' | 'passkey' | 'other';

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
export interface LicenseInfo {
  is_premium: boolean;
  license_key: string | null;
  activated_at: string | null;
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
}

export interface NewEntry {
  category: string;
  title: string;
  fields: EntryField[];
  notes?: string;
  favorite?: boolean;
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
