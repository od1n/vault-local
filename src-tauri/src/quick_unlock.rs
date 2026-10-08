// Desbloqueo rápido con PIN o Windows Hello (Premium).
//
// Modelo de seguridad:
// - El PIN se guarda DENTRO de la bóveda (vault_config, cifrado con enc_key). Nunca en
//   un archivo aparte: un PIN corto fuera de la bóveda se podría adivinar por fuerza bruta.
// - Al desbloquear con la contraseña maestra, las claves (db_key || enc_key) se envuelven
//   EN MEMORIA con una clave derivada del PIN (Argon2id + XChaCha20-Poly1305) y/o con una
//   clave aleatoria que solo se usa tras confirmar con Windows Hello.
// - Ese material vive solo en memoria: al cerrar la app desaparece y se vuelve a pedir la
//   contraseña maestra. También caduca tras N horas desde el último desbloqueo con
//   contraseña maestra, y se anula tras 3 PIN incorrectos o al cambiar la contraseña maestra.

use std::time::{Duration, SystemTime};

use secrecy::ExposeSecret;
use serde::Serialize;
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::{cipher, kdf};
use crate::db::repository;
use crate::settings;
use crate::state::AppState;

const PIN_CONFIG_KEY: &str = "quick_unlock_pin";
const MAX_ATTEMPTS: u8 = 3;
const PIN_MIN: usize = 4;
const PIN_MAX: usize = 32;

/// Material envuelto que permite reabrir la bóveda sin la contraseña maestra.
pub struct Armed {
    pin: Option<([u8; 32], Vec<u8>)>,
    hello: Option<(Zeroizing<[u8; 32]>, Vec<u8>)>,
    db_path: std::path::PathBuf,
    expires: SystemTime,
    attempts_left: u8,
}

#[derive(Serialize)]
pub struct QuickStatus {
    pub pin: bool,
    pub hello: bool,
    pub attempts_left: u8,
    pub expires_in_secs: u64,
}

fn lock_quick(state: &AppState) -> std::sync::MutexGuard<'_, Option<Armed>> {
    state.quick.lock().unwrap_or_else(|e| e.into_inner())
}

/// Anula el desbloqueo rápido (se pedirá la contraseña maestra).
pub fn disarm(state: &AppState) {
    *lock_quick(state) = None;
}

/// Prepara el desbloqueo rápido con las claves de la bóveda abierta.
/// Se llama justo después de desbloquear con la contraseña maestra o al cambiar el PIN.
pub fn arm(app: &tauri::AppHandle, state: &AppState) {
    let cfg = settings::effective(app);
    if !cfg.quick_unlock_enabled || !settings::is_premium(app) {
        disarm(state);
        return;
    }

    let guard = match state.vault.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(vault) = guard.as_ref() else {
        return;
    };
    let enc_key = &vault.enc_key.expose_secret().0;
    let mut material = Zeroizing::new([0u8; 64]);
    material[..32].copy_from_slice(&vault.db_key.expose_secret().0);
    material[32..].copy_from_slice(enc_key);

    // PIN guardado dentro de la bóveda
    let pin = repository::get_config(&vault.connection, PIN_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|blob| cipher::decrypt(enc_key, &blob).ok())
        .map(Zeroizing::new);

    let pin_wrap = pin.and_then(|pin| {
        let salt = kdf::generate_salt();
        let mut k = kdf::derive_master_key(&pin, &salt).ok()?;
        let blob = cipher::encrypt(&k, &material[..]).ok();
        k.zeroize();
        blob.map(|b| (salt, b))
    });

    // La disponibilidad de Windows Hello se comprueba al activarlo en Ajustes
    // (no aquí: esta función puede correr en el hilo principal).
    let hello_wrap = if cfg.quick_unlock_hello {
        let mut key = Zeroizing::new([0u8; 32]);
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut key[..]);
        cipher::encrypt(&key, &material[..]).ok().map(|b| (key, b))
    } else {
        None
    };

    let db_path = vault.db_path.clone();
    drop(guard);

    *lock_quick(state) = if pin_wrap.is_none() && hello_wrap.is_none() {
        None
    } else {
        Some(Armed {
            pin: pin_wrap,
            hello: hello_wrap,
            db_path,
            expires: SystemTime::now()
                + Duration::from_secs(u64::from(cfg.quick_unlock_hours) * 3600),
            attempts_left: MAX_ATTEMPTS,
        })
    };
}

fn current_status(app: &tauri::AppHandle, state: &AppState) -> QuickStatus {
    let premium = settings::is_premium(app);
    let mut q = lock_quick(state);
    if let Some(a) = q.as_ref() {
        if SystemTime::now() >= a.expires || !premium {
            *q = None;
        }
    }
    match q.as_ref() {
        Some(a) => QuickStatus {
            pin: a.pin.is_some(),
            hello: a.hello.is_some(),
            attempts_left: a.attempts_left,
            expires_in_secs: a
                .expires
                .duration_since(SystemTime::now())
                .unwrap_or_default()
                .as_secs(),
        },
        None => QuickStatus {
            pin: false,
            hello: false,
            attempts_left: 0,
            expires_in_secs: 0,
        },
    }
}

/// Estado del desbloqueo rápido (se consulta desde la pantalla de bloqueo).
#[tauri::command]
pub fn quick_unlock_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> QuickStatus {
    current_status(&app, &state)
}

/// Reabre la bóveda con el material desenvuelto.
fn restore(
    app: &tauri::AppHandle,
    state: &AppState,
    material: &[u8],
    db_path: std::path::PathBuf,
) -> Result<(), String> {
    if material.len() != 64 {
        return Err("Material de desbloqueo inválido".to_string());
    }
    let mut db_key = [0u8; 32];
    let mut enc_key = [0u8; 32];
    db_key.copy_from_slice(&material[..32]);
    enc_key.copy_from_slice(&material[32..]);

    let result = (|| {
        let conn = repository::open_db(&db_path, &db_key)
            .map_err(|_| "No se pudo abrir la bóveda; usa tu contraseña maestra".to_string())?;
        if !crate::commands::auth::verify_token(&conn, &enc_key) {
            return Err("No se pudo verificar la bóveda; usa tu contraseña maestra".to_string());
        }
        crate::commands::auth::install_unlocked(app, state, conn, db_key, enc_key, db_path)
    })();
    db_key.zeroize();
    enc_key.zeroize();
    if result.is_err() {
        disarm(state);
    }
    result
}

/// Desbloquea con el PIN.
#[tauri::command]
pub fn quick_unlock_with_pin(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    pin: String,
) -> Result<(), String> {
    let pin = Zeroizing::new(pin);
    if !current_status(&app, &state).pin {
        return Err(
            "El desbloqueo con PIN no está disponible; usa tu contraseña maestra".to_string(),
        );
    }
    let (salt, blob, db_path) = {
        let q = lock_quick(&state);
        let a = q.as_ref().ok_or("Desbloqueo rápido no disponible")?;
        let (salt, blob) = a.pin.as_ref().ok_or("PIN no configurado")?;
        (*salt, blob.clone(), a.db_path.clone())
    };

    let mut k = kdf::derive_master_key(pin.as_bytes(), &salt)?;
    let opened = cipher::decrypt(&k, &blob);
    k.zeroize();

    match opened {
        Ok(material) => {
            let material = Zeroizing::new(material);
            restore(&app, &state, &material, db_path)
        }
        Err(_) => {
            let mut q = lock_quick(&state);
            let left = q.as_mut().map(|a| {
                a.attempts_left = a.attempts_left.saturating_sub(1);
                a.attempts_left
            });
            match left {
                Some(n) if n > 0 => Err(format!("PIN incorrecto. Te quedan {} intento(s).", n)),
                _ => {
                    *q = None;
                    Err(
                        "PIN incorrecto. Por seguridad, ahora debes usar tu contraseña maestra."
                            .to_string(),
                    )
                }
            }
        }
    }
}

/// Desbloquea con Windows Hello (huella, rostro o PIN de Windows).
#[tauri::command]
pub async fn quick_unlock_with_hello(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<AppState>();
    if !current_status(&app, &state).hello {
        return Err("Windows Hello no está disponible; usa tu contraseña maestra".to_string());
    }
    let hwnd = hello::window_handle(&window);
    let ok = tauri::async_runtime::spawn_blocking(move || {
        hello::verify(hwnd, "Desbloquear Vault Local")
    })
    .await
    .map_err(|e| e.to_string())??;
    if !ok {
        return Err("Windows Hello no confirmó tu identidad".to_string());
    }

    let (key, blob, db_path) = {
        let q = lock_quick(&state);
        let a = q.as_ref().ok_or("Desbloqueo rápido no disponible")?;
        let (key, blob) = a.hello.as_ref().ok_or("Windows Hello no configurado")?;
        (key.clone(), blob.clone(), a.db_path.clone())
    };
    let material = Zeroizing::new(
        cipher::decrypt(&key, &blob).map_err(|_| "Material de desbloqueo dañado".to_string())?,
    );
    restore(&app, &state, &material, db_path)
}

/// true si la bóveda tiene un PIN de desbloqueo rápido guardado.
#[tauri::command]
pub fn has_quick_unlock_pin(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al vault")?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
    Ok(repository::get_config(&vault.connection, PIN_CONFIG_KEY)?.is_some())
}

/// Guarda (o quita, con None) el PIN de desbloqueo rápido. Requiere la bóveda abierta.
#[tauri::command]
pub fn set_quick_unlock_pin(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    pin: Option<String>,
) -> Result<(), String> {
    let pin = pin.map(Zeroizing::new);
    if pin.is_some() && !settings::is_premium(&app) {
        return Err("El desbloqueo rápido requiere una licencia Premium".to_string());
    }
    {
        let guard = state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al vault")?;
        let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
        match &pin {
            Some(p) => {
                let len = p.chars().count();
                if !(PIN_MIN..=PIN_MAX).contains(&len) {
                    return Err(format!(
                        "El PIN debe tener entre {} y {} caracteres",
                        PIN_MIN, PIN_MAX
                    ));
                }
                let blob = cipher::encrypt(&vault.enc_key.expose_secret().0, p.as_bytes())?;
                repository::save_config(&vault.connection, PIN_CONFIG_KEY, &blob)?;
            }
            None => repository::delete_config(&vault.connection, PIN_CONFIG_KEY)?,
        }
    }
    arm(&app, &state);
    Ok(())
}

/// true si Windows Hello está disponible en este equipo.
#[tauri::command]
pub async fn hello_available() -> bool {
    tauri::async_runtime::spawn_blocking(hello::available)
        .await
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
mod hello {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    pub fn window_handle(window: &tauri::WebviewWindow) -> isize {
        window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
    }

    pub fn verify(hwnd: isize, message: &str) -> Result<bool, String> {
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
            .map_err(|e| format!("Windows Hello no disponible: {}", e))?;
        let op: windows_future::IAsyncOperation<UserConsentVerificationResult> = unsafe {
            interop.RequestVerificationForWindowAsync(
                HWND(hwnd as *mut core::ffi::c_void),
                &HSTRING::from(message),
            )
        }
        .map_err(|e| format!("Error al solicitar Windows Hello: {}", e))?;
        let result = op
            .get()
            .map_err(|e| format!("Error en Windows Hello: {}", e))?;
        Ok(result == UserConsentVerificationResult::Verified)
    }
}

#[cfg(not(target_os = "windows"))]
mod hello {
    pub fn available() -> bool {
        false
    }

    pub fn window_handle(_window: &tauri::WebviewWindow) -> isize {
        0
    }

    pub fn verify(_hwnd: isize, _message: &str) -> Result<bool, String> {
        Err("Windows Hello solo está disponible en Windows".to_string())
    }
}
