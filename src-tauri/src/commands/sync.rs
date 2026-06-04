// Comandos de sincronización cifrada del vault.
// Permite exportar e importar la bóveda completa (entradas + adjuntos)
// en un archivo cifrado con contraseña independiente, para transferir entre dispositivos.

use std::fs;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::crypto::{cipher, kdf};
use crate::db::models::EntryData;
use crate::db::repository;
use crate::security::validate_file_path;
use crate::state::AppState;

// ─── Estructuras del paquete de sincronización ─────────────────────────────

/// Paquete completo de sincronización que contiene todas las entradas y adjuntos.
#[derive(Serialize, Deserialize)]
struct SyncPackage {
    /// Versión del formato de sincronización
    version: String,
    /// Fecha de creación del paquete en formato ISO 8601
    created_at: String,
    /// Lista de entradas descifradas
    entries: Vec<SyncEntry>,
    /// Lista de adjuntos con datos en base64
    attachments: Vec<SyncAttachment>,
}

/// Entrada individual dentro del paquete de sincronización.
#[derive(Serialize, Deserialize)]
struct SyncEntry {
    id: String,
    category: String,
    title: String,
    /// Datos descifrados de la entrada (campos + notas)
    data: EntryData,
    favorite: bool,
    created_at: String,
    updated_at: String,
}

/// Adjunto individual dentro del paquete de sincronización.
#[derive(Serialize, Deserialize)]
struct SyncAttachment {
    id: String,
    entry_id: String,
    filename: String,
    mime_type: String,
    size: u64,
    /// Datos del archivo codificados en base64
    data_base64: String,
}

/// Estadísticas de la operación de sincronización.
#[derive(Serialize)]
pub struct SyncStats {
    /// Cantidad de entradas procesadas
    pub entries: u32,
    /// Cantidad de adjuntos procesados
    pub attachments: u32,
}

// ─── Macro auxiliar ─────────────────────────────────────────────────────────

/// Macro auxiliar para obtener el vault desbloqueado o retornar error.
macro_rules! with_vault {
    ($state:expr) => {{
        let guard = $state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al estado del vault".to_string())?;
        if guard.is_none() {
            return Err("El vault está bloqueado. Desbloquéelo primero.".to_string());
        }
        guard
    }};
}

// ─── Exportar archivo de sincronización ────────────────────────────────────

/// Exporta toda la bóveda a un archivo cifrado con una contraseña de sincronización.
///
/// El archivo resultante contiene: salt (32 bytes) || datos cifrados (XChaCha20-Poly1305).
/// Los datos internos son un SyncPackage serializado a JSON con todas las entradas
/// y adjuntos descifrados, luego re-cifrado con una clave derivada de la contraseña
/// de sincronización mediante Argon2id.
#[tauri::command]
pub fn export_sync_file(
    state: tauri::State<'_, AppState>,
    file_path: String,
    sync_password: String,
) -> Result<SyncStats, String> {
    // Validar la ruta del archivo destino
    let validated_path = validate_file_path(&file_path)?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Obtener todas las entradas sin filtros
    let all_entries = repository::list_entries(&vault.connection, None, None)?;

    let mut sync_entries: Vec<SyncEntry> = Vec::new();
    let mut sync_attachments: Vec<SyncAttachment> = Vec::new();

    // Descifrar cada entrada y sus adjuntos
    for meta in &all_entries {
        let (category, title, encrypted_data, favorite, created_at, updated_at) =
            repository::get_entry_raw(&vault.connection, &meta.id)?;

        // Descifrar los datos de la entrada
        let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
        let entry_data: EntryData = serde_json::from_slice(&decrypted)
            .map_err(|e| format!("Error al deserializar entrada '{}': {}", title, e))?;

        sync_entries.push(SyncEntry {
            id: meta.id.clone(),
            category,
            title,
            data: entry_data,
            favorite,
            created_at,
            updated_at,
        });

        // Obtener adjuntos de esta entrada
        let attachments = repository::list_attachments(&vault.connection, &meta.id)?;
        for att_meta in &attachments {
            let (_, encrypted_att) =
                repository::get_attachment_data(&vault.connection, &att_meta.id)?;

            // Descifrar los datos del adjunto
            let decrypted_att = cipher::decrypt(enc_key, &encrypted_att)?;

            sync_attachments.push(SyncAttachment {
                id: att_meta.id.clone(),
                entry_id: att_meta.entry_id.clone(),
                filename: att_meta.filename.clone(),
                mime_type: att_meta.mime_type.clone(),
                size: att_meta.size,
                data_base64: BASE64.encode(&decrypted_att),
            });
        }
    }

    let entry_count = sync_entries.len() as u32;
    let attachment_count = sync_attachments.len() as u32;

    // Construir el paquete de sincronización
    let package = SyncPackage {
        version: "1.0".to_string(),
        created_at: Utc::now().to_rfc3339(),
        entries: sync_entries,
        attachments: sync_attachments,
    };

    // Serializar a JSON
    let json_data = serde_json::to_vec(&package)
        .map_err(|e| format!("Error al serializar paquete de sincronización: {}", e))?;

    // Generar salt para la contraseña de sincronización
    let salt = kdf::generate_salt();

    // Derivar clave de cifrado a partir de la contraseña de sincronización (Argon2id)
    let mut sync_key = kdf::derive_master_key(sync_password.as_bytes(), &salt)?;

    // Cifrar el JSON con XChaCha20-Poly1305
    let encrypted = cipher::encrypt(&sync_key, &json_data)?;

    // Escribir archivo: salt (32 bytes) || datos cifrados
    let mut output = Vec::with_capacity(32 + encrypted.len());
    output.extend_from_slice(&salt);
    output.extend_from_slice(&encrypted);

    fs::write(&validated_path, &output)
        .map_err(|e| format!("Error al escribir archivo de sincronización: {}", e))?;

    // Zeroizar material sensible
    sync_key.zeroize();
    let mut sync_password = sync_password;
    sync_password.zeroize();

    Ok(SyncStats {
        entries: entry_count,
        attachments: attachment_count,
    })
}

// ─── Importar archivo de sincronización ────────────────────────────────────

/// Importa entradas y adjuntos desde un archivo de sincronización cifrado.
///
/// Lee el archivo (salt || datos cifrados), descifra con la contraseña de sincronización,
/// y según el modo ("merge" o "replace") combina o reemplaza las entradas existentes.
///
/// En modo "merge": solo actualiza entradas cuyo updated_at sea más reciente.
/// En modo "replace": elimina todas las entradas existentes antes de importar.
#[tauri::command]
pub fn import_sync_file(
    state: tauri::State<'_, AppState>,
    file_path: String,
    sync_password: String,
    mode: String,
) -> Result<SyncStats, String> {
    // Validar la ruta del archivo origen
    let validated_path = validate_file_path(&file_path)?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Leer el archivo completo
    let file_data = fs::read(&validated_path)
        .map_err(|e| format!("Error al leer archivo de sincronización: {}", e))?;

    // El archivo debe tener al menos 32 (salt) + 40 (nonce+tag mínimo) bytes
    if file_data.len() < 72 {
        return Err("Archivo de sincronización inválido o corrupto".to_string());
    }

    // Separar salt y datos cifrados
    let (salt, encrypted) = file_data.split_at(32);

    // Derivar clave a partir de la contraseña de sincronización
    let mut sync_key = kdf::derive_master_key(sync_password.as_bytes(), salt)?;

    // Descifrar los datos
    let decrypted = cipher::decrypt(&sync_key, encrypted)
        .map_err(|_| "Contraseña de sincronización incorrecta o archivo corrupto".to_string())?;

    // Zeroizar la clave de sincronización
    sync_key.zeroize();
    let mut sync_password = sync_password;
    sync_password.zeroize();

    // Deserializar el paquete
    let package: SyncPackage = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Error al deserializar paquete de sincronización: {}", e))?;

    let enc_key = &vault.enc_key.expose_secret().0;

    // Si el modo es "replace", eliminar todas las entradas existentes
    if mode == "replace" {
        let existing = repository::list_entries(&vault.connection, None, None)?;
        for entry in &existing {
            repository::delete_entry(&vault.connection, &entry.id)?;
        }
    }

    let mut entry_count: u32 = 0;
    let mut attachment_count: u32 = 0;

    // Importar entradas
    for sync_entry in &package.entries {
        // Serializar y cifrar los datos de la entrada con la clave del vault
        let json_data = serde_json::to_vec(&sync_entry.data)
            .map_err(|e| format!("Error al serializar entrada '{}': {}", sync_entry.title, e))?;
        let encrypted_data = cipher::encrypt(enc_key, &json_data)?;

        if mode == "merge" {
            // Verificar si la entrada ya existe
            match repository::get_entry_raw(&vault.connection, &sync_entry.id) {
                Ok((_, _, _, _, _, existing_updated_at)) => {
                    // Solo actualizar si la entrada del sync es más reciente
                    if sync_entry.updated_at > existing_updated_at {
                        repository::update_entry_raw(
                            &vault.connection,
                            &sync_entry.id,
                            &sync_entry.category,
                            &sync_entry.title,
                            &encrypted_data,
                            sync_entry.favorite,
                            &sync_entry.updated_at,
                        )?;
                        entry_count += 1;
                    }
                }
                Err(_) => {
                    // La entrada no existe, insertar como nueva
                    repository::insert_entry(
                        &vault.connection,
                        &sync_entry.id,
                        &sync_entry.category,
                        &sync_entry.title,
                        &encrypted_data,
                        sync_entry.favorite,
                        &sync_entry.created_at,
                        &sync_entry.updated_at,
                    )?;
                    entry_count += 1;
                }
            }
        } else {
            // Modo "replace": insertar directamente (ya se eliminaron las existentes)
            repository::insert_entry(
                &vault.connection,
                &sync_entry.id,
                &sync_entry.category,
                &sync_entry.title,
                &encrypted_data,
                sync_entry.favorite,
                &sync_entry.created_at,
                &sync_entry.updated_at,
            )?;
            entry_count += 1;
        }
    }

    // Importar adjuntos
    for sync_att in &package.attachments {
        // Decodificar los datos de base64
        let att_data = BASE64.decode(&sync_att.data_base64).map_err(|e| {
            format!(
                "Error al decodificar adjunto '{}': {}",
                sync_att.filename, e
            )
        })?;

        // Cifrar con la clave del vault
        let encrypted_att = cipher::encrypt(enc_key, &att_data)?;

        // Generar nuevo ID para evitar colisiones en modo merge
        let att_id = if mode == "merge" {
            Uuid::new_v4().to_string()
        } else {
            sync_att.id.clone()
        };

        // Verificar que la entrada padre existe antes de insertar el adjunto
        if repository::get_entry_raw(&vault.connection, &sync_att.entry_id).is_ok() {
            repository::insert_attachment(
                &vault.connection,
                &att_id,
                &sync_att.entry_id,
                &sync_att.filename,
                &sync_att.mime_type,
                &encrypted_att,
                sync_att.size,
                &Utc::now().to_rfc3339(),
            )?;
            attachment_count += 1;
        }
    }

    Ok(SyncStats {
        entries: entry_count,
        attachments: attachment_count,
    })
}
