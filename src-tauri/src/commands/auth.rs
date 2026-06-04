// Comandos de autenticación: crear, desbloquear y bloquear el vault.
// Gestiona el ciclo de vida de la clave maestra y la sesión del vault.

use std::fs;
use std::path::PathBuf;

use secrecy::{ExposeSecret, Secret};
use tauri::Manager;
use zeroize::Zeroize;

use crate::crypto::{cipher, kdf};
use crate::db::repository;
use crate::ipc_server;
use crate::lockout::LockoutState;
use crate::state::{AppState, EncKey, VaultState};

/// Token de verificación para validar que la contraseña es correcta.
const VERIFY_TOKEN: &str = "VAULT_LOCAL_OK_v1";

/// Obtiene la ruta al directorio de datos de la aplicación.
fn get_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))
}

/// Obtiene la ruta al archivo de la base de datos.
fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("vault.db"))
}

/// Obtiene la ruta al archivo del salt.
fn get_salt_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("vault.salt"))
}

/// Obtiene la ruta al archivo de estado de bloqueo por intentos fallidos.
fn get_lockout_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("vault.lock"))
}

/// Verifica si el vault ya fue creado (si existe el archivo de la base de datos).
#[tauri::command]
pub fn is_vault_created(app: tauri::AppHandle) -> Result<bool, String> {
    let db_path = get_db_path(&app)?;
    let salt_path = get_salt_path(&app)?;

    // El vault existe si ambos archivos están presentes
    Ok(db_path.exists() && salt_path.exists())
}

/// Crea un nuevo vault con la contraseña maestra proporcionada.
///
/// Flujo:
/// 1. Genera un salt aleatorio de 32 bytes
/// 2. Deriva las claves (db_key + enc_key) usando Argon2id + HKDF
/// 3. Crea la base de datos SQLCipher cifrada
/// 4. Cifra y almacena el token de verificación
/// 5. Guarda el salt en un archivo separado
/// 6. Almacena el estado del vault desbloqueado
#[tauri::command]
pub fn create_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    // Verificar que no existe un vault previo
    let db_path = get_db_path(&app)?;
    if db_path.exists() {
        return Err("Ya existe un vault. Elimínelo primero para crear uno nuevo.".to_string());
    }

    // Generar salt aleatorio
    let salt = kdf::generate_salt();

    // Derivar claves desde la contraseña
    let (mut db_key, enc_key) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;

    // Crear el directorio de datos si no existe
    let app_data_dir = get_app_data_dir(&app)?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Error al crear directorio de datos: {}", e))?;

    // Guardar el salt en archivo separado (necesario para desbloquear)
    let salt_path = get_salt_path(&app)?;
    fs::write(&salt_path, salt).map_err(|e| format!("Error al guardar salt: {}", e))?;

    // Abrir la base de datos SQLCipher con la clave derivada
    let conn = repository::open_db(&db_path, &db_key)?;

    // Inicializar las tablas
    repository::init_tables(&conn)?;

    // Cifrar el token de verificación y guardarlo en la base de datos
    let encrypted_token = cipher::encrypt(&enc_key, VERIFY_TOKEN.as_bytes())?;
    repository::save_config(&conn, "verify_token", &encrypted_token)?;

    // Zeroizar la clave de la base de datos (ya no la necesitamos en memoria)
    db_key.zeroize();

    // Zeroizar la contraseña original
    let mut password = password;
    password.zeroize();

    // Almacenar el estado del vault desbloqueado
    let vault_state = VaultState {
        connection: conn,
        enc_key: Secret::new(EncKey(enc_key)),
        db_path,
    };

    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    *vault_guard = Some(vault_state);

    Ok(())
}

/// Desbloquea un vault existente con la contraseña maestra.
///
/// Flujo:
/// 1. Verifica el estado de bloqueo por intentos fallidos (protección anti fuerza bruta)
/// 2. Lee el salt del archivo vault.salt
/// 3. Deriva las claves usando Argon2id + HKDF
/// 4. Intenta abrir la base de datos SQLCipher (falla si la clave es incorrecta)
/// 5. Verifica el token de verificación descifrado
/// 6. Almacena el estado del vault desbloqueado
/// 7. Reinicia el contador de intentos fallidos
#[tauri::command]
pub fn unlock_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    // Cargar estado de bloqueo y verificar si se permite un nuevo intento
    let lockout_path = get_lockout_path(&app)?;
    let mut lockout = LockoutState::load(&lockout_path);
    if let Err(secs) = lockout.check_allowed() {
        return Err(format!(
            "Demasiados intentos fallidos. Espera {} segundos.",
            secs
        ));
    }

    // Verificar que el vault existe
    let db_path = get_db_path(&app)?;
    let salt_path = get_salt_path(&app)?;

    if !db_path.exists() || !salt_path.exists() {
        return Err("No se encontró un vault. Cree uno primero.".to_string());
    }

    // Leer el salt del archivo
    let salt = fs::read(&salt_path).map_err(|e| format!("Error al leer salt: {}", e))?;

    if salt.len() != 32 {
        return Err("Archivo de salt corrupto (tamaño incorrecto)".to_string());
    }

    // Derivar claves desde la contraseña
    let (mut db_key, enc_key) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;

    // Copiar db_key para el servidor IPC antes de zeroizar
    let ipc_db_key = db_key;

    // Intentar abrir la base de datos (falla si la contraseña es incorrecta)
    let conn = match repository::open_db(&db_path, &db_key) {
        Ok(c) => c,
        Err(_) => {
            // Registrar intento fallido y persistir
            lockout.record_failure();
            let _ = lockout.save(&lockout_path);
            return Err("Contraseña incorrecta".to_string());
        }
    };

    // Zeroizar la clave de la base de datos (la copia para IPC se zeroiza después de iniciar el servidor)
    db_key.zeroize();

    // Verificar el token de verificación
    let encrypted_token = repository::get_config(&conn, "verify_token")?
        .ok_or_else(|| "Token de verificación no encontrado en la base de datos".to_string())?;

    let decrypted_token = match cipher::decrypt(&enc_key, &encrypted_token) {
        Ok(t) => t,
        Err(_) => {
            // Registrar intento fallido y persistir
            lockout.record_failure();
            let _ = lockout.save(&lockout_path);
            return Err("Contraseña incorrecta".to_string());
        }
    };

    let token_str = String::from_utf8(decrypted_token)
        .map_err(|_| "Token de verificación corrupto".to_string())?;

    if token_str != VERIFY_TOKEN {
        // Registrar intento fallido y persistir
        lockout.record_failure();
        let _ = lockout.save(&lockout_path);
        return Err("Contraseña incorrecta".to_string());
    }

    // Desbloqueo exitoso: reiniciar contador de intentos fallidos
    lockout.reset();
    let _ = lockout.save(&lockout_path);

    // Zeroizar la contraseña original
    let mut password = password;
    password.zeroize();

    // Almacenar el estado del vault desbloqueado
    let vault_state = VaultState {
        connection: conn,
        enc_key: Secret::new(EncKey(enc_key)),
        db_path: db_path.clone(),
    };

    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    *vault_guard = Some(vault_state);

    // Iniciar el servidor IPC para la extensión del navegador
    let app_data_dir = get_app_data_dir(&app)?;
    let mut ipc_db_key = ipc_db_key;
    if let Err(e) = ipc_server::start(db_path, &ipc_db_key, enc_key, app_data_dir) {
        // No es crítico: el vault funciona sin la extensión
        eprintln!("[IPC] Error al iniciar servidor IPC: {}", e);
    }
    // Zeroizar la copia de db_key usada para el IPC
    ipc_db_key.zeroize();

    Ok(())
}

/// Consulta el estado de bloqueo por intentos fallidos.
/// Retorna los segundos restantes de bloqueo, o None si no hay bloqueo activo.
#[tauri::command]
pub fn get_lockout_status(app: tauri::AppHandle) -> Result<Option<u64>, String> {
    let lockout_path = get_lockout_path(&app)?;
    let lockout = LockoutState::load(&lockout_path);
    match lockout.check_allowed() {
        Ok(()) => Ok(None),
        Err(secs) => Ok(Some(secs)),
    }
}

/// Bloquea el vault eliminando la conexión y las claves de la memoria.
/// El VaultState se destruye y las claves se zeroizan automáticamente (ZeroizeOnDrop).
#[tauri::command]
pub fn lock_vault(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;

    if vault_guard.is_none() {
        return Err("El vault ya está bloqueado".to_string());
    }

    // Detener el servidor IPC y limpiar token
    ipc_server::stop();
    if let Ok(app_data_dir) = get_app_data_dir(&app) {
        ipc_server::cleanup_token(&app_data_dir);
    }

    // Tomar el VaultState y dejarlo como None.
    // Al salir del scope, VaultState se destruye y EncKey se zeroiza.
    let _vault = vault_guard.take();

    Ok(())
}

/// Cambia la contraseña maestra del vault.
/// Re-cifra todos los datos (entradas y adjuntos) con las nuevas claves derivadas.
/// Usa PRAGMA rekey para re-cifrar la base de datos SQLCipher.
///
/// Flujo:
/// 1. Verifica la contraseña actual
/// 2. Genera nuevo salt y deriva nuevas claves
/// 3. Re-cifra todas las entradas con la nueva enc_key
/// 4. Re-cifra todos los adjuntos con la nueva enc_key
/// 5. Re-cifra el token de verificación
/// 6. Ejecuta PRAGMA rekey para re-cifrar la base de datos
/// 7. Guarda el nuevo salt y actualiza el estado en memoria
#[tauri::command]
pub fn change_master_password(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    // 1. Verificar la contraseña actual
    let salt_path = get_salt_path(&app)?;
    let old_salt = fs::read(&salt_path).map_err(|e| format!("Error al leer salt: {}", e))?;
    let (mut old_db_key, old_enc_key) =
        kdf::derive_keys_from_password(current_password.as_bytes(), &old_salt)?;
    old_db_key.zeroize();

    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = vault_guard
        .as_ref()
        .ok_or("El vault está bloqueado".to_string())?;

    // Verificar descifrando el token con la clave derivada de la contraseña actual
    let encrypted_token = repository::get_config(&vault.connection, "verify_token")?
        .ok_or("Token de verificación no encontrado".to_string())?;
    cipher::decrypt(&old_enc_key, &encrypted_token)
        .map_err(|_| "Contraseña actual incorrecta".to_string())?;

    // 2. Generar nuevo salt y derivar nuevas claves
    let new_salt = kdf::generate_salt();
    let (new_db_key, new_enc_key) =
        kdf::derive_keys_from_password(new_password.as_bytes(), &new_salt)?;

    // 3. Re-cifrar TODAS las entradas con la nueva enc_key
    let current_enc_key = &vault.enc_key.expose_secret().0;
    let entries_meta = repository::list_entries(&vault.connection, None, None)?;

    for entry_meta in &entries_meta {
        let (_cat, _title, encrypted_data, _fav, _created, updated) =
            repository::get_entry_raw(&vault.connection, &entry_meta.id)?;

        // Descifrar con la clave actual
        let plaintext = cipher::decrypt(current_enc_key, &encrypted_data)?;
        // Re-cifrar con la nueva clave
        let new_encrypted = cipher::encrypt(&new_enc_key, &plaintext)?;
        // Actualizar en la base de datos
        repository::update_entry_raw(
            &vault.connection,
            &entry_meta.id,
            &entry_meta.category,
            &entry_meta.title,
            &new_encrypted,
            entry_meta.favorite,
            &updated,
        )?;
    }

    // 4. Re-cifrar todos los adjuntos
    for entry_meta in &entries_meta {
        let attachments = repository::list_attachments(&vault.connection, &entry_meta.id)?;
        for att in &attachments {
            let (_, encrypted_blob) = repository::get_attachment_data(&vault.connection, &att.id)?;
            let plaintext = cipher::decrypt(current_enc_key, &encrypted_blob)?;
            let new_encrypted = cipher::encrypt(&new_enc_key, &plaintext)?;
            repository::update_attachment_data(&vault.connection, &att.id, &new_encrypted)?;
        }
    }

    // 5. Re-cifrar el token de verificación
    let new_verify = cipher::encrypt(&new_enc_key, VERIFY_TOKEN.as_bytes())?;
    repository::save_config(&vault.connection, "verify_token", &new_verify)?;

    // 6. Re-cifrar la base de datos con PRAGMA rekey
    let new_hex_key = hex::encode(new_db_key);
    vault
        .connection
        .execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", new_hex_key))
        .map_err(|e| format!("Error al re-cifrar la base de datos: {}", e))?;

    // 7. Guardar el nuevo salt en disco
    fs::write(&salt_path, new_salt).map_err(|e| format!("Error al guardar nuevo salt: {}", e))?;

    // 8. Actualizar el estado del vault con la nueva clave de cifrado
    let db_path = vault.db_path.clone();
    let conn = repository::open_db(&db_path, &new_db_key)?;

    let new_vault = VaultState {
        connection: conn,
        enc_key: Secret::new(EncKey(new_enc_key)),
        db_path,
    };
    *vault_guard = Some(new_vault);

    // 9. Zeroizar contraseñas y claves temporales
    let mut current_password = current_password;
    let mut new_password = new_password;
    current_password.zeroize();
    new_password.zeroize();

    Ok(())
}

/// Obtiene el token IPC actual para la extensión del navegador.
/// Retorna None si el servidor IPC no está activo (vault bloqueado).
#[tauri::command]
pub fn get_ipc_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let app_data_dir = get_app_data_dir(&app)?;
    let token_path = app_data_dir.join("ipc.token");
    if token_path.exists() {
        let token = fs::read_to_string(&token_path)
            .map_err(|e| format!("Error al leer token IPC: {}", e))?;
        Ok(Some(token.trim().to_string()))
    } else {
        Ok(None)
    }
}
