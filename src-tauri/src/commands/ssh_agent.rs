// Integración con el agente SSH del sistema.
// Permite agregar y remover claves SSH almacenadas en el vault al agente del sistema.
// Utiliza el comando `ssh-add` del sistema operativo para gestionar las claves.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

use base64::Engine;
use secrecy::ExposeSecret;
use serde::Serialize;
use tauri::Manager;

use crate::crypto::cipher;
use crate::db::{models::EntryData, repository};
use crate::state::AppState;

// ─── Estructuras ──────────────────────────────────────────────────────────────

/// Información de una clave SSH almacenada en el vault.
#[derive(Serialize)]
pub struct SshKeyInfo {
    /// ID de la entrada que contiene la clave
    pub entry_id: String,
    /// Título de la entrada
    pub entry_title: String,
    /// Tipo de clave: "ed25519", "rsa", "ecdsa", "unknown"
    pub key_type: String,
    /// Fingerprint SHA-256 de la clave (simplificado)
    pub fingerprint: String,
    /// Indica si la clave está actualmente cargada en el agente
    pub added_to_agent: bool,
    /// Índice del campo SSH key dentro de la entrada
    pub field_index: u32,
}

// ─── Macro auxiliar ───────────────────────────────────────────────────────────

/// Macro auxiliar para obtener el vault desbloqueado o retornar error.
/// Duplicada de vault.rs para evitar dependencias circulares.
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

// ─── Funciones auxiliares ─────────────────────────────────────────────────────

/// Detecta el tipo de clave SSH basándose en el contenido del texto.
/// Analiza los encabezados PEM y heurísticas de tamaño para determinar el tipo.
fn detect_key_type(key_text: &str) -> String {
    let trimmed = key_text.trim();
    if trimmed.contains("BEGIN OPENSSH PRIVATE KEY") {
        // Podría ser ed25519, rsa o ecdsa - verificar datos de la clave
        if trimmed.contains("ssh-ed25519") || key_text.len() < 500 {
            "ed25519".to_string()
        } else if trimmed.contains("ssh-rsa") || key_text.len() > 1500 {
            "rsa".to_string()
        } else {
            "ecdsa".to_string()
        }
    } else if trimmed.contains("BEGIN RSA PRIVATE KEY") {
        "rsa".to_string()
    } else if trimmed.contains("BEGIN EC PRIVATE KEY") {
        "ecdsa".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Genera un fingerprint simplificado de la clave SSH.
/// Calcula el hash SHA-256 del contenido y retorna los primeros 16 bytes en base64.
fn simple_fingerprint(key_text: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(key_text.as_bytes());
    let result = hasher.finalize();
    format!(
        "SHA256:{}",
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(&result[..16])
    )
}

/// Obtiene la ruta al ejecutable ssh-add del sistema.
/// En Windows busca en las ubicaciones comunes de OpenSSH.
fn find_ssh_add() -> Result<PathBuf, String> {
    // Intentar encontrar ssh-add en el PATH del sistema
    #[cfg(windows)]
    {
        // Verificar la ubicación estándar de OpenSSH en Windows
        let system_path = PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh-add.exe");
        if system_path.exists() {
            return Ok(system_path);
        }

        // Intentar buscar en el PATH
        if let Ok(output) = Command::new("where").arg("ssh-add").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = path_str.lines().next() {
                    let path = PathBuf::from(first_line.trim());
                    if path.exists() {
                        return Ok(path);
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        // En Unix/Linux/macOS, buscar en el PATH
        if let Ok(output) = Command::new("which").arg("ssh-add").output() {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout);
                let path = PathBuf::from(path_str.trim());
                if path.exists() {
                    return Ok(path);
                }
            }
        }
    }

    // Intentar ejecutar directamente desde PATH como último recurso
    if Command::new("ssh-add").arg("--help").output().is_ok() {
        return Ok(PathBuf::from("ssh-add"));
    }

    Err("No se encontró ssh-add. Asegúrese de tener OpenSSH instalado.".to_string())
}

/// Escribe la clave SSH a un archivo temporal con permisos restrictivos.
/// Retorna la ruta del archivo temporal creado.
fn write_temp_key(app: &tauri::AppHandle, key_text: &str) -> Result<PathBuf, String> {
    let temp_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))?;

    // Asegurar que el directorio existe
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Error al crear directorio temporal: {}", e))?;

    let temp_path = temp_dir.join(format!("ssh_tmp_{}.key", uuid::Uuid::new_v4()));

    // Escribir el contenido de la clave
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Error al crear archivo temporal de clave SSH: {}", e))?;
    file.write_all(key_text.as_bytes())
        .map_err(|e| format!("Error al escribir clave SSH temporal: {}", e))?;

    // En Unix, establecer permisos 0600 (solo lectura/escritura para el propietario)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Error al configurar permisos del archivo temporal: {}", e))?;
    }

    Ok(temp_path)
}

/// Configura un Command para no mostrar ventana de consola en Windows.
#[cfg(windows)]
fn spawn_hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
}

/// En plataformas no-Windows, no se necesita configuración especial.
#[cfg(not(windows))]
fn spawn_hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

/// Descifra una entrada y obtiene el campo SSH key en el índice especificado.
/// Retorna el texto de la clave SSH.
fn get_ssh_key_field(
    enc_key: &[u8; 32],
    conn: &rusqlite::Connection,
    entry_id: &str,
    field_index: u32,
) -> Result<String, String> {
    // Obtener la entrada cifrada
    let (_category, _title, encrypted_data, _favorite, _created_at, _updated_at) =
        repository::get_entry_raw(conn, entry_id)?;

    // Descifrar los datos
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;

    // Deserializar
    let entry_data: EntryData = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Error al deserializar entrada: {}", e))?;

    // Obtener el campo en el índice indicado
    let field = entry_data
        .fields
        .get(field_index as usize)
        .ok_or_else(|| format!("Índice de campo {} fuera de rango", field_index))?;

    // Verificar que sea un campo de tipo ssh_key
    if field.field_type != "ssh_key" {
        return Err(format!(
            "El campo en el índice {} no es de tipo ssh_key (es '{}')",
            field_index, field.field_type
        ));
    }

    Ok(field.value.clone())
}

// ─── Comandos Tauri ───────────────────────────────────────────────────────────

/// Lista las claves SSH almacenadas en el vault (entradas con campo ssh_key).
/// Recorre todas las entradas, descifra cada una y busca campos de tipo "ssh_key".
/// Retorna información resumida de cada clave encontrada.
#[tauri::command]
pub fn list_ssh_keys(state: tauri::State<'_, AppState>) -> Result<Vec<SshKeyInfo>, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Obtener todas las entradas sin filtros
    let all_entries = repository::list_entries(&vault.connection, None, None)?;

    let mut ssh_keys = Vec::new();

    for meta in &all_entries {
        // Obtener y descifrar cada entrada
        let (_category, _title, encrypted_data, _favorite, _created_at, _updated_at) =
            match repository::get_entry_raw(&vault.connection, &meta.id) {
                Ok(data) => data,
                Err(_) => continue, // Omitir entradas con error
            };

        let decrypted = match cipher::decrypt(enc_key, &encrypted_data) {
            Ok(data) => data,
            Err(_) => continue,
        };

        let entry_data: EntryData = match serde_json::from_slice(&decrypted) {
            Ok(data) => data,
            Err(_) => continue,
        };

        // Buscar campos de tipo "ssh_key" en la entrada
        for (idx, field) in entry_data.fields.iter().enumerate() {
            if field.field_type == "ssh_key" {
                let key_text = &field.value;
                let key_type = detect_key_type(key_text);
                let fingerprint = simple_fingerprint(key_text);

                ssh_keys.push(SshKeyInfo {
                    entry_id: meta.id.clone(),
                    entry_title: meta.title.clone(),
                    key_type,
                    fingerprint,
                    added_to_agent: false, // No hay forma confiable de verificar sin parsear la salida de ssh-add -l
                    field_index: idx as u32,
                });
            }
        }
    }

    Ok(ssh_keys)
}

/// Agrega una clave SSH al agente del sistema.
/// Escribe la clave privada a un archivo temporal, ejecuta ssh-add, y luego borra el archivo.
/// El archivo temporal se elimina inmediatamente después de la operación, exitosa o no.
#[tauri::command]
pub fn add_key_to_agent(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    field_index: u32,
) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Obtener el texto de la clave SSH
    let key_text = get_ssh_key_field(enc_key, &vault.connection, &entry_id, field_index)?;

    // Encontrar ssh-add en el sistema
    let ssh_add_path = find_ssh_add()?;

    // Escribir clave a archivo temporal
    let temp_path = write_temp_key(&app, &key_text)?;

    // Ejecutar ssh-add con el archivo temporal
    let mut cmd = Command::new(&ssh_add_path);
    cmd.arg(temp_path.to_string_lossy().as_ref());
    let result = spawn_hidden(&mut cmd)
        .output()
        .map_err(|e| format!("Error al ejecutar ssh-add: {}", e));

    // Eliminar el archivo temporal inmediatamente (sin importar si ssh-add tuvo éxito)
    let _ = fs::remove_file(&temp_path);

    // Evaluar el resultado de ssh-add
    let output = result?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Error al agregar clave al agente SSH: {}",
            stderr.trim()
        ));
    }

    Ok(())
}

/// Remueve una clave SSH del agente del sistema.
/// Escribe la clave a un archivo temporal, ejecuta ssh-add -d, y elimina el archivo.
#[tauri::command]
pub fn remove_key_from_agent(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    field_index: u32,
) -> Result<(), String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Obtener el texto de la clave SSH
    let key_text = get_ssh_key_field(enc_key, &vault.connection, &entry_id, field_index)?;

    // Encontrar ssh-add en el sistema
    let ssh_add_path = find_ssh_add()?;

    // Escribir clave a archivo temporal
    let temp_path = write_temp_key(&app, &key_text)?;

    // Ejecutar ssh-add -d para remover la clave del agente
    let mut cmd = Command::new(&ssh_add_path);
    cmd.args(["-d", &temp_path.to_string_lossy()]);
    let result = spawn_hidden(&mut cmd)
        .output()
        .map_err(|e| format!("Error al ejecutar ssh-add -d: {}", e));

    // Eliminar el archivo temporal inmediatamente
    let _ = fs::remove_file(&temp_path);

    // Evaluar el resultado
    let output = result?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Error al remover clave del agente SSH: {}",
            stderr.trim()
        ));
    }

    Ok(())
}

/// Agrega todas las claves SSH almacenadas en el vault al agente del sistema.
/// Se llama automáticamente al desbloquear el vault.
/// Retorna la cantidad de claves agregadas exitosamente.
#[tauri::command]
pub fn add_all_ssh_keys(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    let enc_key = &vault.enc_key.expose_secret().0;

    // Encontrar ssh-add antes de iterar (si no existe, fallar temprano)
    let ssh_add_path = find_ssh_add()?;

    // Obtener todas las entradas
    let all_entries = repository::list_entries(&vault.connection, None, None)?;

    let mut keys_added: u32 = 0;

    for meta in &all_entries {
        // Obtener y descifrar cada entrada
        let (_category, _title, encrypted_data, _favorite, _created_at, _updated_at) =
            match repository::get_entry_raw(&vault.connection, &meta.id) {
                Ok(data) => data,
                Err(_) => continue,
            };

        let decrypted = match cipher::decrypt(enc_key, &encrypted_data) {
            Ok(data) => data,
            Err(_) => continue,
        };

        let entry_data: EntryData = match serde_json::from_slice(&decrypted) {
            Ok(data) => data,
            Err(_) => continue,
        };

        // Buscar campos de tipo ssh_key e intentar agregarlos al agente
        for field in &entry_data.fields {
            if field.field_type == "ssh_key" {
                let key_text = &field.value;

                // Escribir a archivo temporal
                let temp_path = match write_temp_key(&app, key_text) {
                    Ok(path) => path,
                    Err(_) => continue,
                };

                // Ejecutar ssh-add
                let mut cmd = Command::new(&ssh_add_path);
                cmd.arg(temp_path.to_string_lossy().as_ref());
                let result = spawn_hidden(&mut cmd).output();

                // Eliminar archivo temporal inmediatamente
                let _ = fs::remove_file(&temp_path);

                // Contar solo las claves agregadas exitosamente
                if let Ok(output) = result {
                    if output.status.success() {
                        keys_added += 1;
                    }
                }
            }
        }
    }

    Ok(keys_added)
}
