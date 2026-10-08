// Compartir una entrada como archivo cifrado (.vlshare).
//
// El archivo se cifra con una contraseña de un solo uso que el remitente comunica
// por OTRO canal (por ejemplo, en persona o por llamada). Formato:
//   "VLSHARE1" (8 bytes) || salt (32 bytes) || XChaCha20-Poly1305(JSON)
// La clave se deriva con Argon2id, igual que la sincronización.
//
// Exportar requiere Premium; importar es gratis (quien recibe no necesita pagar).

use std::fs;

use chrono::Utc;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::commands::license::{require_tier, Tier};
use crate::crypto::{cipher, kdf};
use crate::db::models::{EntryData, EntryField};
use crate::db::repository;
use crate::security::validate_file_path;
use crate::state::AppState;

const MAGIC: &[u8; 8] = b"VLSHARE1";
const MIN_PASSWORD_LEN: usize = 8;
/// Tamaño máximo de un archivo compartido (una sola entrada)
const MAX_SHARE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct SharedEntry {
    category: String,
    title: String,
    fields: Vec<EntryField>,
    notes: String,
    shared_at: String,
}

/// Exporta una entrada cifrada con `share_password` al archivo `file_path`.
#[tauri::command]
pub fn export_share(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    file_path: String,
    share_password: String,
) -> Result<(), String> {
    require_tier(&app, Tier::Premium)?;
    let mut share_password = share_password;
    if share_password.chars().count() < MIN_PASSWORD_LEN {
        share_password.zeroize();
        return Err(format!(
            "La contraseña para compartir debe tener al menos {} caracteres",
            MIN_PASSWORD_LEN
        ));
    }
    let path = validate_file_path(&file_path)?;

    let shared = {
        let guard = state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al vault".to_string())?;
        let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
        let (category, title, encrypted, _, _, _) =
            repository::get_entry_raw(&vault.connection, &entry_id)?;
        let data: EntryData = serde_json::from_slice(&cipher::decrypt(
            &vault.enc_key.expose_secret().0,
            &encrypted,
        )?)
        .map_err(|e| format!("Error al deserializar: {}", e))?;
        // El historial de contraseñas NO se comparte
        SharedEntry {
            category,
            title,
            fields: data.fields,
            notes: data.notes,
            shared_at: Utc::now().to_rfc3339(),
        }
    };

    let mut json = serde_json::to_vec(&shared).map_err(|e| e.to_string())?;
    let salt = kdf::generate_salt();
    let mut key = kdf::derive_master_key(share_password.as_bytes(), &salt)?;
    share_password.zeroize();
    let encrypted = cipher::encrypt(&key, &json);
    key.zeroize();
    json.zeroize();
    let encrypted = encrypted?;

    let mut out = Vec::with_capacity(8 + 32 + encrypted.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&encrypted);
    fs::write(&path, out).map_err(|e| format!("Error al escribir el archivo: {}", e))
}

/// Importa un archivo .vlshare como entrada nueva. Retorna el ID creado.
#[tauri::command]
pub fn import_share(
    state: tauri::State<'_, AppState>,
    file_path: String,
    share_password: String,
) -> Result<String, String> {
    let mut share_password = share_password;
    let path = validate_file_path(&file_path)?;
    let meta = fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {}", e))?;
    if meta.len() > MAX_SHARE_BYTES {
        share_password.zeroize();
        return Err("El archivo es demasiado grande para ser una entrada compartida".to_string());
    }
    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {}", e))?;
    if bytes.len() < 8 + 32 || &bytes[..8] != MAGIC {
        share_password.zeroize();
        return Err("El archivo no es una entrada compartida de Vault Local".to_string());
    }
    let mut key = kdf::derive_master_key(share_password.as_bytes(), &bytes[8..40])?;
    share_password.zeroize();
    let plain = cipher::decrypt(&key, &bytes[40..]);
    key.zeroize();
    let mut plain = plain.map_err(|_| "Contraseña incorrecta o archivo dañado".to_string())?;
    let shared: Result<SharedEntry, _> = serde_json::from_slice(&plain);
    plain.zeroize();
    let shared = shared.map_err(|_| "El contenido compartido no es válido".to_string())?;

    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al vault".to_string())?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
    let data = EntryData {
        fields: shared.fields,
        notes: shared.notes,
        history: Vec::new(),
    };
    let json = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let encrypted = cipher::encrypt(&vault.enc_key.expose_secret().0, &json)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    repository::insert_entry(
        &vault.connection,
        &id,
        &shared.category,
        &shared.title,
        &encrypted,
        false,
        &now,
        &now,
    )?;
    repository::set_tags(&vault.connection, &id, &["compartida".to_string()])?;
    Ok(id)
}
