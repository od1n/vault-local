// Portapapeles seguro con limpieza temporizada.
//
// - Un solo temporizador activo: cada copia nueva reemplaza al anterior.
// - El temporizador se puede extender (pago) o cancelar limpiando ahora (gratis).
// - Mientras espera NO guarda el texto copiado, solo su hash SHA-256, para
//   comprobar que el portapapeles sigue teniendo nuestro contenido antes de borrarlo.
// - Lo copiado se marca para que NO entre al historial del portapapeles del sistema
//   (Win+V en Windows, gestores de historial en macOS/Linux) ni a la nube de Windows.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use secrecy::ExposeSecret;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Emitter;

use crate::crypto::cipher;
use crate::db::{models::EntryData, repository};
use crate::settings;
use crate::state::AppState;

/// Segundos máximos que se puede extender de una vez.
const MAX_EXTEND_SECS: u32 = 300;

struct ClipJob {
    generation: u64,
    deadline: Instant,
    hash: [u8; 32],
}

static GENERATION: AtomicU64 = AtomicU64::new(0);
static JOB: Mutex<Option<ClipJob>> = Mutex::new(None);

/// Estado del portapapeles que se entrega a la interfaz.
#[derive(Serialize, Clone)]
pub struct ClipboardStatus {
    /// true si hay un borrado pendiente
    pub active: bool,
    /// Segundos restantes hasta el borrado
    pub seconds_left: u64,
}

fn hash(text: &str) -> [u8; 32] {
    Sha256::digest(text.as_bytes()).into()
}

/// Escribe texto en el portapapeles excluyéndolo del historial del sistema.
fn write_text(text: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new()
        .map_err(|e| format!("Error al acceder al portapapeles: {}", e))?;

    #[cfg(target_os = "windows")]
    let set = {
        use arboard::SetExtWindows;
        cb.set().exclude_from_history().exclude_from_cloud()
    };
    #[cfg(target_os = "macos")]
    let set = {
        use arboard::SetExtApple;
        cb.set().exclude_from_history()
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let set = {
        use arboard::SetExtLinux;
        cb.set().exclude_from_history()
    };

    set.text(text)
        .map_err(|e| format!("Error al copiar al portapapeles: {}", e))
}

/// Borra el portapapeles solo si todavía contiene el texto con este hash.
fn clear_if_ours(expected: &[u8; 32]) {
    if let Ok(mut cb) = arboard::Clipboard::new() {
        let ours = cb
            .get_text()
            .map(|t| &hash(&t) == expected)
            .unwrap_or(false);
        if ours {
            let _ = cb.clear();
        }
    }
}

fn status() -> ClipboardStatus {
    let guard = JOB.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(job) => ClipboardStatus {
            active: true,
            seconds_left: job
                .deadline
                .saturating_duration_since(Instant::now())
                .as_secs_f64()
                .ceil() as u64,
        },
        None => ClipboardStatus {
            active: false,
            seconds_left: 0,
        },
    }
}

/// Copia un secreto y programa su borrado según los ajustes efectivos.
/// Es la función que usan todos los caminos de copia (interfaz, búsqueda rápida, secuencias).
pub fn copy_secret(app: &tauri::AppHandle, text: &str) -> Result<ClipboardStatus, String> {
    write_text(text)?;
    let secs = settings::effective(app).clipboard_clear_secs;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut guard = JOB.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(ClipJob {
            generation,
            deadline: Instant::now() + Duration::from_secs(u64::from(secs)),
            hash: hash(text),
        });
    }

    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let mut guard = JOB.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            // Otra copia reemplazó a esta, o se limpió manualmente
            Some(job) if job.generation != generation => return,
            None => return,
            Some(job) if Instant::now() >= job.deadline => {
                clear_if_ours(&job.hash);
                *guard = None;
                drop(guard);
                let _ = app.emit("clipboard-cleared", ());
                return;
            }
            Some(_) => {}
        }
    });

    Ok(status())
}

/// Copia texto al portapapeles con borrado automático.
/// `clear_after_secs` se ignora: el tiempo sale de los ajustes (se mantiene por compatibilidad).
#[tauri::command]
pub fn copy_to_clipboard(
    app: tauri::AppHandle,
    text: String,
    #[allow(unused_variables)] clear_after_secs: Option<u64>,
) -> Result<ClipboardStatus, String> {
    copy_secret(&app, &text)
}

/// Descifra un campo en el backend y lo copia sin que cruce la frontera IPC.
#[tauri::command]
pub fn copy_field_to_clipboard(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    field_index: u32,
    #[allow(unused_variables)] clear_after_secs: Option<u64>,
) -> Result<ClipboardStatus, String> {
    let value = read_field(&state, &entry_id, field_index)?;
    copy_secret(&app, &value)
}

/// Lee y descifra el valor de un campo de una entrada.
pub fn read_field(state: &AppState, entry_id: &str, field_index: u32) -> Result<String, String> {
    let entry_data = read_entry(state, entry_id)?;
    entry_data
        .fields
        .get(field_index as usize)
        .map(|f| f.value.clone())
        .ok_or_else(|| format!("Campo con índice {} no encontrado", field_index))
}

/// Lee y descifra una entrada completa.
pub fn read_entry(state: &AppState, entry_id: &str) -> Result<EntryData, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al vault".to_string())?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
    let (_, _, encrypted_data, _, _, _) = repository::get_entry_raw(&vault.connection, entry_id)?;
    let enc_key = &vault.enc_key.expose_secret().0;
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
    serde_json::from_slice(&decrypted).map_err(|e| format!("Error al deserializar: {}", e))
}

/// Extiende el tiempo antes del borrado (solo pago).
#[tauri::command]
pub fn extend_clipboard(app: tauri::AppHandle, secs: u32) -> Result<ClipboardStatus, String> {
    if !settings::is_premium(&app) {
        return Err(
            "Extender el tiempo del portapapeles requiere una licencia Premium".to_string(),
        );
    }
    let secs = secs.clamp(1, MAX_EXTEND_SECS);
    {
        let mut guard = JOB.lock().unwrap_or_else(|e| e.into_inner());
        let job = guard.as_mut().ok_or("No hay nada pendiente de borrar")?;
        // Nunca más allá del máximo de pago contado desde ahora
        let max =
            Instant::now() + Duration::from_secs(u64::from(settings::PAID_MAX_CLIPBOARD_SECS));
        job.deadline = (job.deadline + Duration::from_secs(u64::from(secs))).min(max);
    }
    Ok(status())
}

/// Borra lo que copiamos, si sigue en el portapapeles, y cancela el temporizador.
pub fn clear_owned() {
    let job = JOB.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(job) = job {
        clear_if_ours(&job.hash);
    }
}

/// Borra el portapapeles ahora (gratis).
#[tauri::command]
pub fn clear_clipboard_now(app: tauri::AppHandle) -> ClipboardStatus {
    clear_owned();
    let _ = app.emit("clipboard-cleared", ());
    status()
}

#[tauri::command]
pub fn get_clipboard_status() -> ClipboardStatus {
    status()
}
