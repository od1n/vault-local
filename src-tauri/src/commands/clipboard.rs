// Comando para copiar texto al portapapeles con limpieza temporizada.
// Utiliza arboard para acceso multiplataforma al portapapeles del sistema.

use std::thread;
use std::time::Duration;

use secrecy::ExposeSecret;

use crate::crypto::cipher;
use crate::db::{models::EntryData, repository};
use crate::state::AppState;

/// Tiempo predeterminado en segundos para limpiar el portapapeles.
const DEFAULT_CLEAR_SECS: u64 = 15;

/// Copia texto al portapapeles del sistema con limpieza automática temporizada.
///
/// # Argumentos
/// - `text`: texto a copiar al portapapeles
/// - `clear_after_secs`: segundos antes de limpiar el portapapeles (por defecto 15)
///
/// Lanza un hilo en segundo plano que espera el tiempo especificado
/// y luego limpia el portapapeles para proteger datos sensibles.
#[tauri::command]
pub fn copy_to_clipboard(text: String, clear_after_secs: Option<u64>) -> Result<(), String> {
    // Crear instancia del portapapeles
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Error al acceder al portapapeles: {}", e))?;

    // Copiar el texto
    clipboard
        .set_text(&text)
        .map_err(|e| format!("Error al copiar al portapapeles: {}", e))?;

    // Determinar tiempo de limpieza
    let clear_secs = clear_after_secs.unwrap_or(DEFAULT_CLEAR_SECS);

    // Lanzar hilo de limpieza en segundo plano
    if clear_secs > 0 {
        // Guardar una copia del texto para verificar antes de limpiar
        let copied_text = text;
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(clear_secs));

            // Intentar limpiar el portapapeles solo si aún contiene nuestro texto
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if let Ok(current) = cb.get_text() {
                    if current == copied_text {
                        // El portapapeles aún tiene nuestro texto, limpiarlo
                        let _ = cb.set_text("");
                    }
                }
            }
        });
    }

    Ok(())
}

/// Copia un campo específico de una entrada al portapapeles.
/// El valor descifrado nunca cruza la frontera IPC como texto plano;
/// se descifra en el backend y se copia directamente al portapapeles.
///
/// # Argumentos
/// - `entry_id`: ID de la entrada que contiene el campo
/// - `field_index`: índice del campo dentro de la lista de campos de la entrada
/// - `clear_after_secs`: segundos antes de limpiar el portapapeles (opcional)
#[tauri::command]
pub fn copy_field_to_clipboard(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    field_index: u32,
    clear_after_secs: Option<u64>,
) -> Result<(), String> {
    // Obtener el vault desbloqueado
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al vault".to_string())?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;

    // Obtener la entrada cifrada y descifrarla
    let (_, _, encrypted_data, _, _, _) =
        repository::get_entry_raw(&vault.connection, &entry_id)?;
    let enc_key = &vault.enc_key.expose_secret().0;
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
    let entry_data: EntryData = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Error al deserializar: {}", e))?;

    // Obtener el campo por índice
    let field = entry_data
        .fields
        .get(field_index as usize)
        .ok_or_else(|| format!("Campo con índice {} no encontrado", field_index))?;

    // Copiar al portapapeles reutilizando la lógica existente
    copy_to_clipboard(field.value.clone(), clear_after_secs)
}
