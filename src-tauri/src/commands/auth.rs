// Comandos de autenticación: crear, desbloquear y bloquear el vault.
// Gestiona el ciclo de vida de la clave maestra y la sesión del vault.

use std::fs;
use std::path::{Path, PathBuf};

use secrecy::{ExposeSecret, Secret};
use tauri::Manager;
use zeroize::{Zeroize, Zeroizing};

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

/// Obtiene la ruta al archivo de la base de datos de la bóveda seleccionada.
fn get_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::vaults::active_dir(app)?.join("vault.db"))
}

/// Obtiene la ruta al archivo del salt de la bóveda seleccionada.
fn get_salt_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::vaults::active_dir(app)?.join("vault.salt"))
}

/// Obtiene la ruta al archivo de estado de bloqueo por intentos fallidos.
fn get_lockout_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::vaults::active_dir(app)?.join("vault.lock"))
}

/// Ruta del salt de la bóveda ABIERTA (junto a su vault.db).
pub(crate) fn salt_path_for(db_path: &Path) -> PathBuf {
    db_path.with_file_name("vault.salt")
}

/// Comprueba la contraseña maestra de la bóveda guardada en `dir` sin dejarla abierta.
pub(crate) fn check_password_at(dir: &Path, password: &str) -> Result<(), String> {
    let salt =
        fs::read(dir.join("vault.salt")).map_err(|e| format!("Error al leer salt: {}", e))?;
    if salt.len() != 32 {
        return Err("Archivo de salt corrupto (tamaño incorrecto)".to_string());
    }
    let (mut db_key, enc_key) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;
    let conn = repository::open_db(&dir.join("vault.db"), &db_key);
    db_key.zeroize();
    let ok = conn.map(|c| verify_token(&c, &enc_key)).unwrap_or(false);
    let mut enc_key = enc_key;
    enc_key.zeroize();
    if ok {
        Ok(())
    } else {
        Err("Contraseña incorrecta".to_string())
    }
}

/// Ruta del salt pendiente que se escribe durante un cambio de contraseña.
fn pending_salt_path(salt_path: &Path) -> PathBuf {
    salt_path.with_extension("salt.new")
}

/// Activa el salt nuevo de un cambio de contraseña: escribe los 32 bytes en vault.salt de
/// forma atómica (temporal + renombrar) y borra el pendiente.
fn activate_salt(salt_path: &Path, new_salt: &[u8]) -> Result<(), String> {
    let tmp = salt_path.with_extension("salt.tmp");
    fs::write(&tmp, new_salt).map_err(|e| format!("Error al guardar nuevo salt: {}", e))?;
    fs::rename(&tmp, salt_path).map_err(|e| format!("Error al guardar nuevo salt: {}", e))?;
    let _ = fs::remove_file(pending_salt_path(salt_path));
    Ok(())
}

fn read_salt(path: &Path) -> Result<Vec<u8>, String> {
    let salt = fs::read(path).map_err(|e| format!("Error al leer salt: {}", e))?;
    if salt.len() != 32 {
        return Err("Archivo de salt corrupto (tamaño incorrecto)".to_string());
    }
    Ok(salt)
}

/// Conexión abierta con su clave de base y su clave de campos.
type Opened = (rusqlite::Connection, [u8; 32], [u8; 32]);

/// Abre la bóveda con la contraseña. Devuelve None si la contraseña no es correcta.
///
/// El cambio de contraseña escribe primero `vault.salt.new` (salt nuevo + la clave de base
/// ANTERIOR cifrada con la clave de campos nueva), después confirma el re-cifrado de las
/// entradas, luego hace PRAGMA rekey y por último renombra el salt. Si se interrumpe en
/// cualquier punto, aquí se abre con la contraseña que corresponda y se termina el cambio.
fn open_with_pending(
    db_path: &Path,
    salt_path: &Path,
    password: &[u8],
) -> Result<Option<Opened>, String> {
    let pending_path = pending_salt_path(salt_path);

    // 1. Caso normal: salt actual
    let (mut cur_db, mut cur_enc) =
        kdf::derive_keys_from_password(password, &read_salt(salt_path)?)?;
    if let Ok(conn) = repository::open_db(db_path, &cur_db) {
        if verify_token(&conn, &cur_enc) {
            if pending_path.exists() {
                // Un cambio que no llegó a confirmarse: el pendiente sobra
                let _ = fs::remove_file(&pending_path);
                crate::emergency::discard_pending(db_path);
            }
            let r = Some((conn, cur_db, cur_enc));
            cur_db.zeroize();
            cur_enc.zeroize();
            return Ok(r);
        }
    }
    cur_db.zeroize();
    cur_enc.zeroize();

    // 2. Cambio de contraseña a medias: probar con el salt pendiente (contraseña NUEVA)
    let Ok(pending) = fs::read(&pending_path) else {
        return Ok(None);
    };
    if pending.len() < 32 {
        return Ok(None);
    }
    let (new_db, new_enc) = kdf::derive_keys_from_password(password, &pending[..32])?;
    let old_db: Option<Zeroizing<[u8; 32]>> = cipher::decrypt(&new_enc, &pending[32..])
        .ok()
        .filter(|k| k.len() == 32)
        .map(|k| {
            let mut a = Zeroizing::new([0u8; 32]);
            a.copy_from_slice(&k);
            a
        });

    // 2a. El rekey ya se hizo; solo faltaba renombrar el salt
    let conn = match repository::open_db(db_path, &new_db) {
        Ok(c) if verify_token(&c, &new_enc) => Some(c),
        _ => None,
    };
    // 2b. Las entradas ya usan la clave nueva pero la base sigue con la anterior: rekey
    let conn = match (conn, old_db) {
        (Some(c), _) => c,
        (None, Some(old)) => match repository::open_db(db_path, &old) {
            Ok(c) if verify_token(&c, &new_enc) => {
                c.execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", hex::encode(new_db)))
                    .map_err(|e| format!("Error al terminar el cambio de contraseña: {}", e))?;
                drop(c);
                repository::open_db(db_path, &new_db)?
            }
            _ => return Ok(None),
        },
        (None, None) => return Ok(None),
    };
    activate_salt(salt_path, &pending[..32])?;
    crate::emergency::commit_pending(db_path);
    Ok(Some((conn, new_db, new_enc)))
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
    // Las bóvedas adicionales son de Pro (la principal es gratis)
    if crate::vaults::active_id(&app) != crate::vaults::MAIN_ID {
        crate::commands::license::require_tier(&app, crate::commands::license::Tier::Pro)?;
    }
    let state_open = state.vault.lock().map(|g| g.is_some()).unwrap_or(true);
    if state_open {
        return Err("Bloquea la bóveda actual antes de crear otra".to_string());
    }

    // Generar salt aleatorio
    let salt = kdf::generate_salt();

    // Derivar claves desde la contraseña
    let (mut db_key, enc_key) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;

    // Crear el directorio de la bóveda si no existe
    let vault_dir = crate::vaults::active_dir(&app)?;
    fs::create_dir_all(&vault_dir)
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

    let kept_db_key = db_key;
    // Zeroizar la clave de la base de datos (la copia queda protegida en VaultState)
    db_key.zeroize();

    // Zeroizar la contraseña original
    let mut password = password;
    password.zeroize();

    // Almacenar el estado del vault desbloqueado
    let vault_state = VaultState {
        connection: conn,
        enc_key: Secret::new(EncKey(enc_key)),
        db_key: Secret::new(EncKey(kept_db_key)),
        db_path,
        name: crate::vaults::active_name(&app),
        read_only: false,
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

    // Abrir con el salt actual; si un cambio de contraseña quedó a medias (corte de luz,
    // antivirus que bloqueó un archivo), también se prueba el salt pendiente y se termina.
    let (conn, ipc_db_key, enc_key) =
        match open_with_pending(&db_path, &salt_path, password.as_bytes())? {
            Some(v) => v,
            None => {
                // Registrar intento fallido y persistir
                lockout.record_failure();
                let _ = lockout.save(&lockout_path);
                return Err("Contraseña incorrecta".to_string());
            }
        };
    // Desbloqueo exitoso: reiniciar contador de intentos fallidos
    lockout.reset();
    let _ = lockout.save(&lockout_path);

    // Zeroizar la contraseña original
    let mut password = password;
    password.zeroize();

    install_unlocked(&app, &state, conn, ipc_db_key, enc_key, db_path)?;

    // Preparar el desbloqueo rápido en segundo plano (Argon2 no debe congelar la interfaz).
    // Solo el desbloqueo con contraseña maestra reinicia el vencimiento y los intentos.
    let app_bg = app.clone();
    std::thread::spawn(move || {
        let state = app_bg.state::<AppState>();
        crate::quick_unlock::arm(&app_bg, &state, true);
    });

    Ok(())
}

/// Verifica el token de verificación con la clave de campos.
pub(crate) fn verify_token(conn: &rusqlite::Connection, enc_key: &[u8; 32]) -> bool {
    repository::get_config(conn, "verify_token")
        .ok()
        .flatten()
        .and_then(|t| cipher::decrypt(enc_key, &t).ok())
        .map(|t| t == VERIFY_TOKEN.as_bytes())
        .unwrap_or(false)
}

/// Deja la bóveda desbloqueada e inicia el servidor IPC de la extensión.
/// Lo usan el desbloqueo con contraseña maestra y el desbloqueo rápido.
pub(crate) fn install_unlocked(
    app: &tauri::AppHandle,
    state: &AppState,
    conn: rusqlite::Connection,
    db_key: [u8; 32],
    enc_key: [u8; 32],
    db_path: PathBuf,
) -> Result<(), String> {
    {
        let mut vault_guard = state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al estado del vault".to_string())?;
        *vault_guard = Some(VaultState {
            connection: conn,
            enc_key: Secret::new(EncKey(enc_key)),
            db_key: Secret::new(EncKey(db_key)),
            db_path: db_path.clone(),
            name: crate::vaults::active_name(app),
            read_only: false,
        });
    }

    // Iniciar el servidor IPC para la extensión del navegador
    let app_data_dir = get_app_data_dir(app)?;
    let mut ipc_db_key = db_key;
    if let Err(e) = ipc_server::start(db_path, &ipc_db_key, enc_key, app_data_dir) {
        // No es crítico: el vault funciona sin la extensión
        eprintln!("[IPC] Error al iniciar servidor IPC: {}", e);
    }
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
/// Si el respaldo automático está habilitado, se ejecuta de forma no bloqueante.
#[tauri::command]
pub fn lock_vault(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;

    if vault_guard.is_none() {
        return Err("El vault ya está bloqueado".to_string());
    }

    // Ejecutar respaldo automático antes de cerrar la conexión (no bloqueante)
    super::backup::auto_backup(&app);

    // Al bloquear: cancelar la copia en secuencia, borrar lo copiado y ocultar la búsqueda rápida
    super::quick::cancel_sequence();
    super::clipboard::clear_owned();
    crate::desktop::hide_quick(&app);

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
    let db_path_open = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?
        .as_ref()
        .map(|v| v.db_path.clone())
        .ok_or("El vault está bloqueado".to_string())?;
    let salt_path = salt_path_for(&db_path_open);
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
    if vault.read_only {
        return Err("No disponible en modo solo lectura".to_string());
    }

    // Verificar descifrando el token con la clave derivada de la contraseña actual
    let encrypted_token = repository::get_config(&vault.connection, "verify_token")?
        .ok_or("Token de verificación no encontrado".to_string())?;
    cipher::decrypt(&old_enc_key, &encrypted_token)
        .map_err(|_| "Contraseña actual incorrecta".to_string())?;

    // 2. Generar nuevo salt y derivar nuevas claves
    let new_salt = kdf::generate_salt();
    let (new_db_key, new_enc_key) =
        kdf::derive_keys_from_password(new_password.as_bytes(), &new_salt)?;

    // 2b. Antes de tocar nada: salt pendiente = salt nuevo + clave de base actual cifrada con
    // la clave de campos nueva. Si el proceso se corta, el próximo desbloqueo con la
    // contraseña NUEVA termina el cambio (ver open_with_pending).
    let pending_salt = pending_salt_path(&salt_path);
    {
        let mut pending = Vec::with_capacity(32 + 72);
        pending.extend_from_slice(&new_salt);
        pending.extend_from_slice(&cipher::encrypt(
            &new_enc_key,
            &vault.db_key.expose_secret().0,
        )?);
        fs::write(&pending_salt, &pending)
            .map_err(|e| format!("Error al guardar el salt nuevo: {}", e))?;
    }

    // Los pasos 3 a 5 van en una transacción: si algo falla, no queda nada cifrado a medias
    let tx = vault
        .connection
        .unchecked_transaction()
        .map_err(|e| format!("Error al iniciar la transacción: {}", e))?;

    // 3. Re-cifrar TODAS las entradas con la nueva enc_key
    let current_enc_key = &vault.enc_key.expose_secret().0;
    // Incluye la papelera: si no, esas entradas quedarían cifradas con la clave anterior
    let entries_meta = repository::list_entries_including_deleted(&vault.connection)?;

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

    // 5b. Re-cifrar el PIN de desbloqueo rápido, si existe
    crate::quick_unlock::reencrypt_pin(&vault.connection, current_enc_key, &new_enc_key)?;
    // 5c. Re-cifrar la clave de recuperación de emergencia, si existe
    let recovery_key =
        crate::emergency::reencrypt_rk(&vault.connection, current_enc_key, &new_enc_key)?;
    // 5d. Acceso de emergencia con las claves nuevas (se activa junto con el salt)
    if let Some(rk) = &recovery_key {
        if let Err(e) =
            crate::emergency::write_pending(&db_path_open, rk, &new_db_key, &new_enc_key)
        {
            eprintln!(
                "[Emergencia] No se pudo preparar el acceso de emergencia: {}",
                e
            );
        }
    }

    if let Err(e) = tx.commit() {
        let _ = fs::remove_file(&pending_salt);
        crate::emergency::discard_pending(&db_path_open);
        return Err(format!("Error al confirmar el re-cifrado: {}", e));
    }

    // Desde aquí las entradas usan la clave nueva. Si algo falla, bloquear: el próximo
    // desbloqueo con la contraseña NUEVA termina el cambio.
    let finish = |vault: &VaultState| -> Result<(), String> {
        // 6. Re-cifrar la base de datos con PRAGMA rekey
        vault
            .connection
            .execute_batch(&format!(
                "PRAGMA rekey = \"x'{}'\";",
                hex::encode(new_db_key)
            ))
            .map_err(|e| format!("Error al re-cifrar la base de datos: {}", e))?;
        // 7. Activar el salt nuevo y el acceso de emergencia nuevo
        activate_salt(&salt_path, &new_salt)?;
        crate::emergency::commit_pending(&db_path_open);
        Ok(())
    };
    if let Err(e) = finish(vault) {
        *vault_guard = None;
        drop(vault_guard);
        crate::quick_unlock::disarm(&state);
        ipc_server::stop();
        if let Ok(dir) = get_app_data_dir(&app) {
            ipc_server::cleanup_token(&dir);
        }
        // Ya está bloqueada: esto solo lleva la interfaz a la pantalla de desbloqueo
        crate::desktop::request_lock(&app, "password-change");
        return Err(format!(
            "{}. La bóveda se bloqueó: desbloquéala con la contraseña NUEVA y el cambio se completará.",
            e
        ));
    }

    // 8. Actualizar el estado del vault con la nueva clave de cifrado
    let db_path = vault.db_path.clone();
    let conn = repository::open_db(&db_path, &new_db_key)?;

    let new_vault = VaultState {
        connection: conn,
        enc_key: Secret::new(EncKey(new_enc_key)),
        db_key: Secret::new(EncKey(new_db_key)),
        db_path,
        name: vault.name.clone(),
        read_only: false,
    };
    *vault_guard = Some(new_vault);
    drop(vault_guard);

    // El material del desbloqueo rápido usa las claves anteriores: anularlo
    crate::quick_unlock::disarm(&state);

    // Reiniciar el servidor de la extensión con las claves nuevas (antes seguía con una
    // conexión abierta con la clave anterior y la extensión dejaba de funcionar)
    if let Ok(app_data_dir) = get_app_data_dir(&app) {
        let mut ipc_db_key = new_db_key;
        if let Err(e) =
            ipc_server::start(db_path_open.clone(), &ipc_db_key, new_enc_key, app_data_dir)
        {
            eprintln!("[IPC] Error al reiniciar servidor IPC: {}", e);
        }
        ipc_db_key.zeroize();
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Prepara una bóveda con contraseña "vieja" y deja un cambio a "nueva" detenido en
    /// la etapa indicada: 0 = antes de confirmar, 1 = confirmado sin rekey, 2 = rekey sin renombrar.
    fn bóveda_con_cambio_a_medias(etapa: u8) -> (PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vl-auth-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("vault.db");
        let salt_path = dir.join("vault.salt");
        let old_salt = kdf::generate_salt();
        fs::write(&salt_path, old_salt).unwrap();
        let (old_db, old_enc) = kdf::derive_keys_from_password(b"vieja", &old_salt).unwrap();
        let conn = repository::open_db(&db_path, &old_db).unwrap();
        repository::init_tables(&conn).unwrap();
        repository::save_config(
            &conn,
            "verify_token",
            &cipher::encrypt(&old_enc, VERIFY_TOKEN.as_bytes()).unwrap(),
        )
        .unwrap();

        let new_salt = kdf::generate_salt();
        let (new_db, new_enc) = kdf::derive_keys_from_password(b"nueva", &new_salt).unwrap();
        let mut pending = new_salt.to_vec();
        pending.extend_from_slice(&cipher::encrypt(&new_enc, &old_db).unwrap());
        fs::write(pending_salt_path(&salt_path), pending).unwrap();
        if etapa >= 1 {
            repository::save_config(
                &conn,
                "verify_token",
                &cipher::encrypt(&new_enc, VERIFY_TOKEN.as_bytes()).unwrap(),
            )
            .unwrap();
        }
        if etapa >= 2 {
            conn.execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", hex::encode(new_db)))
                .unwrap();
        }
        drop(conn);
        (dir, db_path, salt_path)
    }

    #[test]
    fn cambio_interrumpido_antes_de_confirmar_sigue_la_vieja() {
        let (dir, db, salt) = bóveda_con_cambio_a_medias(0);
        assert!(open_with_pending(&db, &salt, b"nueva").unwrap().is_none());
        assert!(open_with_pending(&db, &salt, b"vieja").unwrap().is_some());
        assert!(
            !pending_salt_path(&salt).exists(),
            "el pendiente sobrante se borra"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cambio_interrumpido_sin_rekey_se_termina_con_la_nueva() {
        let (dir, db, salt) = bóveda_con_cambio_a_medias(1);
        assert!(open_with_pending(&db, &salt, b"vieja").unwrap().is_none());
        assert!(open_with_pending(&db, &salt, b"nueva").unwrap().is_some());
        assert!(!pending_salt_path(&salt).exists());
        // Ya terminado: abre directo con la nueva
        assert!(open_with_pending(&db, &salt, b"nueva").unwrap().is_some());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cambio_interrumpido_tras_rekey_se_termina_con_la_nueva() {
        let (dir, db, salt) = bóveda_con_cambio_a_medias(2);
        assert!(open_with_pending(&db, &salt, b"nueva").unwrap().is_some());
        assert!(open_with_pending(&db, &salt, b"nueva").unwrap().is_some());
        assert!(open_with_pending(&db, &salt, b"vieja").unwrap().is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
