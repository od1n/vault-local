// Comandos CRUD para las entradas del vault.
// Todas las operaciones requieren que el vault esté desbloqueado.

use chrono::Utc;
use secrecy::ExposeSecret;
use uuid::Uuid;

use crate::crypto::cipher;
use crate::db::models::{Entry, EntryData, EntryMeta, NewEntry, UpdateEntry};
use crate::db::repository;
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

/// Obtiene la lista de entradas con filtros opcionales.
///
/// # Argumentos
/// - `category`: filtrar por categoría (opcional)
/// - `search`: buscar por título con LIKE (opcional)
#[tauri::command]
pub fn get_entries(
    state: tauri::State<'_, AppState>,
    category: Option<String>,
    search: Option<String>,
) -> Result<Vec<EntryMeta>, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::list_entries(
        &vault.connection,
        category.as_deref(),
        search.as_deref(),
    )
}

/// Obtiene una entrada completa por su ID, descifrando los datos sensibles.
#[tauri::command]
pub fn get_entry(state: tauri::State<'_, AppState>, id: String) -> Result<Entry, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Obtener datos raw de la base de datos
    let (category, title, encrypted_data, favorite, created_at, updated_at) =
        repository::get_entry_raw(&vault.connection, &id)?;

    // Descifrar los datos con la clave de cifrado de campos
    let enc_key = &vault.enc_key.expose_secret().0;
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;

    // Deserializar los datos JSON
    let entry_data: EntryData = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Error al deserializar datos de la entrada: {}", e))?;

    Ok(Entry {
        id,
        category,
        title,
        fields: entry_data.fields,
        notes: entry_data.notes,
        favorite,
        created_at,
        updated_at,
    })
}

/// Crea una nueva entrada en el vault.
/// Genera un UUID v4 como identificador y cifra los datos sensibles.
/// Retorna el ID de la nueva entrada.
#[tauri::command]
pub fn create_entry(
    state: tauri::State<'_, AppState>,
    entry: NewEntry,
) -> Result<String, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Generar ID único
    let id = Uuid::new_v4().to_string();

    // Construir los datos a cifrar
    let entry_data = EntryData {
        fields: entry.fields,
        notes: entry.notes.unwrap_or_default(),
    };

    // Serializar a JSON
    let json_data = serde_json::to_vec(&entry_data)
        .map_err(|e| format!("Error al serializar datos de la entrada: {}", e))?;

    // Cifrar con XChaCha20-Poly1305
    let enc_key = &vault.enc_key.expose_secret().0;
    let encrypted_data = cipher::encrypt(enc_key, &json_data)?;

    // Timestamps en formato ISO 8601
    let now = Utc::now().to_rfc3339();
    let favorite = entry.favorite.unwrap_or(false);

    // Insertar en la base de datos
    repository::insert_entry(
        &vault.connection,
        &id,
        &entry.category,
        &entry.title,
        &encrypted_data,
        favorite,
        &now,
        &now,
    )?;

    Ok(id)
}

/// Actualiza una entrada existente. Solo modifica los campos proporcionados.
#[tauri::command]
pub fn update_entry(
    state: tauri::State<'_, AppState>,
    id: String,
    entry: UpdateEntry,
) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Obtener la entrada actual
    let (current_category, current_title, current_encrypted, current_favorite, _, _) =
        repository::get_entry_raw(&vault.connection, &id)?;

    // Descifrar los datos actuales
    let current_decrypted = cipher::decrypt(enc_key, &current_encrypted)?;
    let mut current_data: EntryData = serde_json::from_slice(&current_decrypted)
        .map_err(|e| format!("Error al deserializar datos actuales: {}", e))?;

    // Aplicar las actualizaciones proporcionadas
    let new_category = entry.category.unwrap_or(current_category);
    let new_title = entry.title.unwrap_or(current_title);
    let new_favorite = entry.favorite.unwrap_or(current_favorite);

    if let Some(fields) = entry.fields {
        current_data.fields = fields;
    }
    if let Some(notes) = entry.notes {
        current_data.notes = notes;
    }

    // Re-serializar y re-cifrar los datos actualizados
    let json_data = serde_json::to_vec(&current_data)
        .map_err(|e| format!("Error al serializar datos actualizados: {}", e))?;
    let encrypted_data = cipher::encrypt(enc_key, &json_data)?;

    let updated_at = Utc::now().to_rfc3339();

    // Actualizar en la base de datos
    repository::update_entry_raw(
        &vault.connection,
        &id,
        &new_category,
        &new_title,
        &encrypted_data,
        new_favorite,
        &updated_at,
    )
}

/// Elimina una entrada del vault por su ID.
#[tauri::command]
pub fn delete_entry(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::delete_entry(&vault.connection, &id)
}

/// Alterna el estado de favorito de una entrada.
/// Retorna el nuevo estado (true = favorito, false = no favorito).
#[tauri::command]
pub fn toggle_favorite(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::toggle_favorite(&vault.connection, &id)
}
