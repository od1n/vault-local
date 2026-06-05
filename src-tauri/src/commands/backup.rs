// Comandos de respaldo automático del vault.
// Permite configurar, ejecutar y restaurar copias de seguridad de vault.db y vault.salt.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Configuración de respaldos persistida en disco.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    pub enabled: bool,
    pub backup_dir: String,
    pub max_backups: u32,
    pub last_backup: Option<String>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            backup_dir: String::new(),
            max_backups: 5,
            last_backup: None,
        }
    }
}

/// Información de un respaldo existente.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub timestamp: String,
    pub db_path: String,
    pub salt_path: String,
    pub db_size: u64,
    pub salt_size: u64,
}

/// Obtiene la ruta al directorio de datos de la aplicación.
fn get_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))
}

/// Obtiene la ruta al archivo de configuración de respaldos.
fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("backup_config.json"))
}

/// Lee la configuración de respaldos desde disco.
fn read_config(app: &tauri::AppHandle) -> Result<BackupConfig, String> {
    let config_path = get_config_path(app)?;
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Error al leer configuración de respaldos: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Error al parsear configuración de respaldos: {}", e))
    } else {
        Ok(BackupConfig::default())
    }
}

/// Guarda la configuración de respaldos en disco.
fn write_config(app: &tauri::AppHandle, config: &BackupConfig) -> Result<(), String> {
    let config_path = get_config_path(app)?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Error al serializar configuración de respaldos: {}", e))?;
    fs::write(&config_path, content)
        .map_err(|e| format!("Error al guardar configuración de respaldos: {}", e))
}

/// Extrae el timestamp de un nombre de archivo de respaldo.
/// Formato esperado: vault_backup_YYYYMMDD_HHMMSS.db o .salt
fn extract_timestamp(filename: &str) -> Option<String> {
    let name = filename.strip_prefix("vault_backup_")?;
    let ts = name
        .strip_suffix(".db")
        .or_else(|| name.strip_suffix(".salt"))?;
    // Validar formato básico: YYYYMMDD_HHMMSS (15 caracteres)
    if ts.len() == 15 && ts.chars().nth(8) == Some('_') {
        Some(ts.to_string())
    } else {
        None
    }
}

/// Lista los timestamps de respaldos existentes en el directorio (pares .db + .salt).
fn list_backup_timestamps(backup_dir: &Path) -> Result<Vec<String>, String> {
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|e| format!("Error al leer directorio de respaldos: {}", e))?;

    let mut db_timestamps = std::collections::HashSet::new();
    let mut salt_timestamps = std::collections::HashSet::new();

    for entry in entries.flatten() {
        let filename = entry.file_name().to_string_lossy().to_string();
        if let Some(ts) = extract_timestamp(&filename) {
            if filename.ends_with(".db") {
                db_timestamps.insert(ts);
            } else if filename.ends_with(".salt") {
                salt_timestamps.insert(ts);
            }
        }
    }

    // Solo considerar pares completos (.db + .salt)
    let mut timestamps: Vec<String> = db_timestamps
        .intersection(&salt_timestamps)
        .cloned()
        .collect();
    timestamps.sort();
    Ok(timestamps)
}

/// Configura los parámetros de respaldo automático.
#[tauri::command]
pub fn configure_backup(
    app: tauri::AppHandle,
    backup_dir: String,
    enabled: bool,
    max_backups: u32,
) -> Result<(), String> {
    // Validar que max_backups sea al menos 1
    if max_backups < 1 {
        return Err("El número máximo de respaldos debe ser al menos 1".to_string());
    }

    // Validar que el directorio exista o se pueda crear
    if enabled && !backup_dir.is_empty() {
        let dir = Path::new(&backup_dir);
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Error al crear directorio de respaldos: {}", e))?;
        }
    }

    let mut config = read_config(&app)?;
    config.enabled = enabled;
    config.backup_dir = backup_dir;
    config.max_backups = max_backups;
    write_config(&app, &config)?;

    Ok(())
}

/// Obtiene la configuración actual de respaldos.
#[tauri::command]
pub fn get_backup_config(app: tauri::AppHandle) -> Result<BackupConfig, String> {
    read_config(&app)
}

/// Ejecuta un respaldo manual o automático del vault.
/// Copia vault.db y vault.salt al directorio configurado con sufijo de timestamp.
/// Rota respaldos antiguos si se excede max_backups.
#[tauri::command]
pub fn perform_backup(app: tauri::AppHandle) -> Result<String, String> {
    let mut config = read_config(&app)?;

    if config.backup_dir.is_empty() {
        return Err("No se ha configurado un directorio de respaldos".to_string());
    }

    let backup_dir = Path::new(&config.backup_dir);
    if !backup_dir.exists() {
        fs::create_dir_all(backup_dir)
            .map_err(|e| format!("Error al crear directorio de respaldos: {}", e))?;
    }

    let app_data_dir = get_app_data_dir(&app)?;
    let db_source = app_data_dir.join("vault.db");
    let salt_source = app_data_dir.join("vault.salt");

    if !db_source.exists() {
        return Err("No se encontró el archivo vault.db".to_string());
    }
    if !salt_source.exists() {
        return Err("No se encontró el archivo vault.salt".to_string());
    }

    // Generar timestamp
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let db_dest = backup_dir.join(format!("vault_backup_{}.db", timestamp));
    let salt_dest = backup_dir.join(format!("vault_backup_{}.salt", timestamp));

    // Copiar archivos
    fs::copy(&db_source, &db_dest).map_err(|e| format!("Error al copiar vault.db: {}", e))?;
    fs::copy(&salt_source, &salt_dest).map_err(|e| format!("Error al copiar vault.salt: {}", e))?;

    // Actualizar último respaldo
    config.last_backup = Some(Local::now().to_rfc3339());
    write_config(&app, &config)?;

    // Rotar respaldos antiguos
    rotate_backups(backup_dir, config.max_backups)?;

    Ok(db_dest.to_string_lossy().to_string())
}

/// Elimina los respaldos más antiguos si se excede max_backups.
fn rotate_backups(backup_dir: &Path, max_backups: u32) -> Result<(), String> {
    let mut timestamps = list_backup_timestamps(backup_dir)?;

    while timestamps.len() > max_backups as usize {
        // Eliminar el más antiguo (el primero, ya que están ordenados)
        let oldest = timestamps.remove(0);
        let db_path = backup_dir.join(format!("vault_backup_{}.db", oldest));
        let salt_path = backup_dir.join(format!("vault_backup_{}.salt", oldest));
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(&salt_path);
    }

    Ok(())
}

/// Lista los respaldos existentes con fechas y tamaños.
#[tauri::command]
pub fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let config = read_config(&app)?;

    if config.backup_dir.is_empty() {
        return Ok(Vec::new());
    }

    let backup_dir = Path::new(&config.backup_dir);
    let timestamps = list_backup_timestamps(backup_dir)?;

    let mut backups = Vec::new();
    for ts in timestamps {
        let db_path = backup_dir.join(format!("vault_backup_{}.db", ts));
        let salt_path = backup_dir.join(format!("vault_backup_{}.salt", ts));

        let db_size = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
        let salt_size = fs::metadata(&salt_path).map(|m| m.len()).unwrap_or(0);

        backups.push(BackupInfo {
            timestamp: ts,
            db_path: db_path.to_string_lossy().to_string(),
            salt_path: salt_path.to_string_lossy().to_string(),
            db_size,
            salt_size,
        });
    }

    // Ordenar de más reciente a más antiguo
    backups.reverse();
    Ok(backups)
}

/// Restaura un respaldo copiando los archivos de vuelta.
/// El vault debe estar bloqueado para restaurar.
#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    backup_path: String,
) -> Result<(), String> {
    // Verificar que el vault esté bloqueado
    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;

    if vault_guard.is_some() {
        return Err("El vault debe estar bloqueado para restaurar un respaldo".to_string());
    }
    drop(vault_guard);

    let backup_db = Path::new(&backup_path);
    if !backup_db.exists() {
        return Err("No se encontró el archivo de respaldo".to_string());
    }

    // Derivar la ruta del .salt desde el .db
    let backup_salt_path = backup_path.replace(".db", ".salt");
    let backup_salt = Path::new(&backup_salt_path);
    if !backup_salt.exists() {
        return Err("No se encontró el archivo salt del respaldo".to_string());
    }

    let app_data_dir = get_app_data_dir(&app)?;
    let db_dest = app_data_dir.join("vault.db");
    let salt_dest = app_data_dir.join("vault.salt");

    // Copiar archivos de respaldo sobre los actuales
    fs::copy(backup_db, &db_dest).map_err(|e| format!("Error al restaurar vault.db: {}", e))?;
    fs::copy(backup_salt, &salt_dest)
        .map_err(|e| format!("Error al restaurar vault.salt: {}", e))?;

    Ok(())
}

/// Ejecuta un respaldo automático de forma silenciosa (para usar desde lock_vault).
/// No falla si el respaldo no se puede realizar; solo registra el error.
pub fn auto_backup(app: &tauri::AppHandle) {
    match read_config(app) {
        Ok(config) => {
            if !config.enabled || config.backup_dir.is_empty() {
                return;
            }

            let app_data_dir = match get_app_data_dir(app) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("[Backup] Error al obtener directorio de datos: {}", e);
                    return;
                }
            };

            let backup_dir_str = config.backup_dir.clone();
            let backup_dir = Path::new(&backup_dir_str);
            if !backup_dir.exists() {
                if let Err(e) = fs::create_dir_all(backup_dir) {
                    eprintln!("[Backup] Error al crear directorio de respaldos: {}", e);
                    return;
                }
            }

            let db_source = app_data_dir.join("vault.db");
            let salt_source = app_data_dir.join("vault.salt");

            if !db_source.exists() || !salt_source.exists() {
                eprintln!("[Backup] Archivos del vault no encontrados");
                return;
            }

            let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
            let db_dest = backup_dir.join(format!("vault_backup_{}.db", timestamp));
            let salt_dest = backup_dir.join(format!("vault_backup_{}.salt", timestamp));

            if let Err(e) = fs::copy(&db_source, &db_dest) {
                eprintln!("[Backup] Error al copiar vault.db: {}", e);
                return;
            }
            if let Err(e) = fs::copy(&salt_source, &salt_dest) {
                eprintln!("[Backup] Error al copiar vault.salt: {}", e);
                // Limpiar el .db copiado parcialmente
                let _ = fs::remove_file(&db_dest);
                return;
            }

            // Actualizar configuración con el timestamp del último respaldo
            let mut config = config;
            config.last_backup = Some(Local::now().to_rfc3339());
            if let Err(e) = write_config(app, &config) {
                eprintln!("[Backup] Error al actualizar configuración: {}", e);
            }

            // Rotar respaldos antiguos
            if let Err(e) = rotate_backups(backup_dir, config.max_backups) {
                eprintln!("[Backup] Error al rotar respaldos: {}", e);
            }

            eprintln!("[Backup] Respaldo automático completado: {}", timestamp);
        }
        Err(e) => {
            eprintln!("[Backup] Error al leer configuración de respaldos: {}", e);
        }
    }
}
