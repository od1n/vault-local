// Comandos para gestionar archivos adjuntos cifrados.
// Los archivos se cifran con XChaCha20-Poly1305 antes de almacenarse en la base de datos.

use std::fs;

use chrono::Utc;
use secrecy::ExposeSecret;
use uuid::Uuid;

use crate::crypto::cipher;
use crate::db::models::AttachmentMeta;
use crate::db::repository;
use crate::security::validate_file_path;
use crate::state::AppState;

/// Macro auxiliar para obtener el vault desbloqueado o retornar error.
/// Evita repetir el patrón de bloqueo del mutex en cada comando.
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

/// Tamaño máximo permitido para archivos adjuntos: 10 MB
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Adjunta un archivo a una entrada. Lee el archivo, lo cifra y lo almacena en la DB.
///
/// # Argumentos
/// - `entry_id`: ID de la entrada a la que se adjunta el archivo
/// - `file_path`: ruta absoluta al archivo en el sistema de archivos
///
/// # Retorna
/// Los metadatos del adjunto creado (sin datos binarios).
#[tauri::command]
pub fn add_attachment(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    file_path: String,
) -> Result<AttachmentMeta, String> {
    // Validar la ruta del archivo antes de leer (protección contra path traversal)
    let validated_path = validate_file_path(&file_path)?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Verificar que la entrada existe antes de adjuntar
    repository::get_entry_raw(&vault.connection, &entry_id)?;

    // Leer metadatos del archivo para validar tamaño
    let metadata = fs::metadata(&validated_path)
        .map_err(|e| format!("Error al leer archivo: {}", e))?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "El archivo excede el límite de {} MB",
            MAX_FILE_SIZE / 1024 / 1024
        ));
    }

    // Leer el contenido del archivo usando la ruta validada
    let file_data = fs::read(&validated_path)
        .map_err(|e| format!("Error al leer archivo: {}", e))?;

    // Extraer el nombre del archivo desde la ruta validada
    let filename = std::path::Path::new(&validated_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("archivo")
        .to_string();

    // Detectar el tipo MIME basado en la extensión
    let mime_type = detect_mime(&filename);

    // Cifrar los datos del archivo con XChaCha20-Poly1305
    let enc_key = &vault.enc_key.expose_secret().0;
    let encrypted = cipher::encrypt(enc_key, &file_data)?;

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let size = file_data.len() as u64;

    // Almacenar el adjunto cifrado en la base de datos
    repository::insert_attachment(
        &vault.connection,
        &id,
        &entry_id,
        &filename,
        &mime_type,
        &encrypted,
        size,
        &created_at,
    )?;

    Ok(AttachmentMeta {
        id,
        entry_id,
        filename,
        mime_type,
        size,
        created_at,
    })
}

/// Lista los adjuntos de una entrada (solo metadatos, sin datos binarios).
///
/// # Argumentos
/// - `entry_id`: ID de la entrada cuyos adjuntos se quieren listar
#[tauri::command]
pub fn list_attachments(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<Vec<AttachmentMeta>, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::list_attachments(&vault.connection, &entry_id)
}

/// Descarga un adjunto: lo descifra y lo guarda en la ruta indicada.
///
/// # Argumentos
/// - `attachment_id`: ID del adjunto a descargar
/// - `save_path`: ruta absoluta donde guardar el archivo descifrado
#[tauri::command]
pub fn download_attachment(
    state: tauri::State<'_, AppState>,
    attachment_id: String,
    save_path: String,
) -> Result<(), String> {
    // Validar la ruta de destino antes de escribir (protección contra path traversal)
    let validated_path = validate_file_path(&save_path)?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Obtener los datos cifrados de la base de datos
    let (_meta, encrypted_data) =
        repository::get_attachment_data(&vault.connection, &attachment_id)?;

    // Descifrar los datos con la clave de cifrado
    let enc_key = &vault.enc_key.expose_secret().0;
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;

    // Escribir el archivo descifrado en la ruta validada
    fs::write(&validated_path, &decrypted)
        .map_err(|e| format!("Error al guardar archivo: {}", e))?;

    Ok(())
}

/// Elimina un adjunto de la base de datos.
///
/// # Argumentos
/// - `attachment_id`: ID del adjunto a eliminar
#[tauri::command]
pub fn delete_attachment(
    state: tauri::State<'_, AppState>,
    attachment_id: String,
) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::delete_attachment(&vault.connection, &attachment_id)
}

/// Detecta el tipo MIME basado en la extensión del archivo.
/// Retorna "application/octet-stream" para extensiones desconocidas.
fn detect_mime(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "txt" => "text/plain",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "zip" => "application/zip",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
    .to_string()
}
