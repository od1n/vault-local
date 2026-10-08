// Comandos CRUD para las entradas del vault.
// Todas las operaciones requieren que el vault esté desbloqueado.

use chrono::Utc;
use secrecy::ExposeSecret;
use uuid::Uuid;

use crate::crypto::cipher;
use crate::db::models::{
    Entry, EntryData, EntryField, EntryMeta, HistoryItem, NewEntry, UpdateEntry,
};
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

    repository::list_entries(&vault.connection, category.as_deref(), search.as_deref())
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

    let meta = repository::get_entry_meta(&vault.connection, &id)?;

    Ok(Entry {
        id,
        category,
        title,
        fields: entry_data.fields,
        notes: entry_data.notes,
        favorite,
        created_at,
        updated_at,
        tags: meta.tags,
        expires_at: meta.expires_at,
        history_count: entry_data.history.len(),
    })
}

/// Crea una nueva entrada en el vault.
/// Genera un UUID v4 como identificador y cifra los datos sensibles.
/// Retorna el ID de la nueva entrada.
#[tauri::command]
pub fn create_entry(state: tauri::State<'_, AppState>, entry: NewEntry) -> Result<String, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Generar ID único
    let id = Uuid::new_v4().to_string();

    // Construir los datos a cifrar
    let entry_data = EntryData {
        fields: entry.fields,
        notes: entry.notes.unwrap_or_default(),
        history: Vec::new(),
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

    if let Some(tags) = entry.tags {
        repository::set_tags(&vault.connection, &id, &normalize_tags(tags))?;
    }

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
        record_history(&mut current_data, &fields, &Utc::now().to_rfc3339());
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

/// Envía una entrada a la papelera. Se borra definitivamente a los 30 días.
#[tauri::command]
pub fn delete_entry(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::soft_delete_entry(&vault.connection, &id, &Utc::now().to_rfc3339())
}

/// Días que una entrada permanece en la papelera antes de borrarse sola.
pub const TRASH_DAYS: i64 = 30;

/// Máximo de valores anteriores guardados por entrada.
const HISTORY_LIMIT: usize = 20;

/// Guarda en el historial los valores sensibles que cambiaron.
fn record_history(data: &mut EntryData, new_fields: &[EntryField], now: &str) {
    for old in data.fields.iter().filter(|f| {
        (f.sensitive || f.field_type == "password") && f.field_type != "totp" && !f.value.is_empty()
    }) {
        let still_same = new_fields
            .iter()
            .any(|n| n.name == old.name && n.value == old.value);
        if !still_same {
            data.history.insert(
                0,
                HistoryItem {
                    field: old.name.clone(),
                    value: old.value.clone(),
                    changed_at: now.to_string(),
                },
            );
        }
    }
    data.history.truncate(HISTORY_LIMIT);
}

/// Limpia etiquetas: sin espacios sobrantes, sin vacías, sin duplicados, máximo 20.
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim().chars().take(40).collect::<String>();
        if !t.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&t)) {
            out.push(t);
        }
    }
    out.truncate(20);
    out
}

/// Lista las entradas de la papelera y borra las que superan los 30 días.
#[tauri::command]
pub fn get_trash(state: tauri::State<'_, AppState>) -> Result<Vec<EntryMeta>, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    let limit = (Utc::now() - chrono::Duration::days(TRASH_DAYS)).to_rfc3339();
    repository::purge_trash(&vault.connection, Some(&limit))?;
    repository::list_trash(&vault.connection)
}

#[tauri::command]
pub fn restore_entry(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    repository::restore_entry(&vault.connection, &id)
}

/// Borra definitivamente una entrada que está en la papelera.
#[tauri::command]
pub fn delete_entry_permanently(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    let in_trash = repository::list_trash(&vault.connection)?
        .iter()
        .any(|e| e.id == id);
    if !in_trash {
        return Err("Solo se pueden borrar definitivamente entradas de la papelera".to_string());
    }
    repository::delete_entry(&vault.connection, &id)
}

#[tauri::command]
pub fn empty_trash(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    repository::purge_trash(&vault.connection, None)
}

/// Cambia las etiquetas de una entrada (gratis).
#[tauri::command]
pub fn set_entry_tags(
    state: tauri::State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    let tags = normalize_tags(tags);
    repository::set_tags(&vault.connection, &id, &tags)?;
    Ok(tags)
}

/// Define o quita la fecha para cambiar la contraseña (Premium).
#[tauri::command]
pub fn set_entry_expiry(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    expires_at: Option<String>,
) -> Result<(), String> {
    if expires_at.is_some() {
        crate::commands::license::require_tier(&app, crate::commands::license::Tier::Premium)?;
    }
    let expires_at = match expires_at {
        Some(d) => Some(
            chrono::DateTime::parse_from_rfc3339(&d)
                .map_err(|_| "Fecha de vencimiento inválida".to_string())?
                .to_rfc3339(),
        ),
        None => None,
    };
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    repository::set_expiry(&vault.connection, &id, expires_at.as_deref())
}

/// Historial de valores anteriores de los campos sensibles (Premium).
#[tauri::command]
pub fn get_password_history(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<HistoryItem>, String> {
    crate::commands::license::require_tier(&app, crate::commands::license::Tier::Premium)?;
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    let (_, _, encrypted, _, _, _) = repository::get_entry_raw(&vault.connection, &id)?;
    let decrypted = cipher::decrypt(&vault.enc_key.expose_secret().0, &encrypted)?;
    let data: EntryData =
        serde_json::from_slice(&decrypted).map_err(|e| format!("Error al deserializar: {}", e))?;
    Ok(data.history)
}

/// Crea una copia de una entrada (sin historial) y retorna el ID nuevo.
#[tauri::command]
pub fn duplicate_entry(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();
    let enc_key = &vault.enc_key.expose_secret().0;
    let (category, title, encrypted, _, _, _) = repository::get_entry_raw(&vault.connection, &id)?;
    let mut data: EntryData = serde_json::from_slice(&cipher::decrypt(enc_key, &encrypted)?)
        .map_err(|e| format!("Error al deserializar: {}", e))?;
    data.history.clear();
    let json = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let new_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    repository::insert_entry(
        &vault.connection,
        &new_id,
        &category,
        &format!("{} (copia)", title),
        &cipher::encrypt(enc_key, &json)?,
        false,
        &now,
        &now,
    )?;
    let tags = repository::get_entry_meta(&vault.connection, &id)?.tags;
    repository::set_tags(&vault.connection, &new_id, &tags)?;
    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(name: &str, value: &str, t: &str, sensitive: bool) -> EntryField {
        EntryField {
            name: name.into(),
            value: value.into(),
            sensitive,
            field_type: t.into(),
        }
    }

    #[test]
    fn historial_guarda_solo_cambios_sensibles() {
        let mut data = EntryData {
            fields: vec![
                f("Usuario", "yo", "text", false),
                f("Contraseña", "vieja", "password", true),
            ],
            notes: String::new(),
            history: Vec::new(),
        };
        record_history(
            &mut data,
            &[
                f("Usuario", "otro", "text", false),
                f("Contraseña", "vieja", "password", true),
            ],
            "t1",
        );
        assert!(
            data.history.is_empty(),
            "cambiar el usuario no guarda historial"
        );
        record_history(
            &mut data,
            &[
                f("Usuario", "otro", "text", false),
                f("Contraseña", "nueva", "password", true),
            ],
            "t2",
        );
        assert_eq!(data.history.len(), 1);
        assert_eq!(data.history[0].value, "vieja");
    }

    #[test]
    fn etiquetas_normalizadas() {
        let t = normalize_tags(vec![
            " trabajo ".into(),
            "Trabajo".into(),
            "".into(),
            "banco".into(),
        ]);
        assert_eq!(t, vec!["trabajo".to_string(), "banco".to_string()]);
    }
}

/// Alterna el estado de favorito de una entrada.
/// Retorna el nuevo estado (true = favorito, false = no favorito).
#[tauri::command]
pub fn toggle_favorite(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    repository::toggle_favorite(&vault.connection, &id)
}
