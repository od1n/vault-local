// Ajustes de la aplicación (tiempos, atajos, bandeja, escritura automática).
//
// Se guardan en settings.json dentro del directorio de datos de la app. No contienen
// secretos. Lo que el usuario guarda se respeta, pero el valor EFECTIVO siempre se
// recalcula según la licencia vigente: si la licencia vence, los valores de pago
// vuelven a los límites gratuitos sin perder la preferencia guardada.
//
// Criterio gratis / pago:
//   - Gratis: valores seguros por defecto y la posibilidad de hacerlos MÁS estrictos.
//   - Pago:   extender tiempos, pausar el bloqueo, búsqueda rápida, escritura
//             automática, copia en secuencia, bandeja del sistema.
//   - La seguridad básica (bloqueo al suspender/bloquear sesión, limpiar ahora,
//     exclusión del historial del portapapeles) es gratis.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::license::{current_tier, Tier};

const SETTINGS_FILENAME: &str = "settings.json";

/// Límites para usuarios gratuitos
pub const FREE_MAX_AUTO_LOCK_MIN: u32 = 5;
pub const FREE_MAX_CLIPBOARD_SECS: u32 = 15;
/// Límites para usuarios de pago
pub const PAID_MAX_AUTO_LOCK_MIN: u32 = 480;
pub const PAID_MAX_CLIPBOARD_SECS: u32 = 300;
pub const MAX_LOCK_PAUSE_MIN: u32 = 240;
/// Mínimos para todos
pub const MIN_AUTO_LOCK_MIN: u32 = 1;
pub const MIN_CLIPBOARD_SECS: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AppSettings {
    /// Minutos de inactividad antes de bloquear
    pub auto_lock_minutes: u32,
    /// Segundos de aviso antes del bloqueo automático
    pub lock_warning_secs: u32,
    /// Segundos antes de limpiar el portapapeles
    pub clipboard_clear_secs: u32,
    /// Bloquear al suspender/hibernar el equipo
    pub lock_on_sleep: bool,
    /// Bloquear al bloquear la sesión del sistema (Win+L)
    pub lock_on_session_lock: bool,
    /// Bloquear al minimizar la ventana
    pub lock_on_minimize: bool,
    /// Ícono en la bandeja del sistema (pago)
    pub tray_enabled: bool,
    /// Al cerrar la ventana, ocultarla en la bandeja en lugar de salir (pago)
    pub close_to_tray: bool,
    /// Atajo global de búsqueda rápida activo (pago)
    pub quick_search_enabled: bool,
    /// Combinación del atajo global de búsqueda rápida
    pub quick_search_shortcut: String,
    /// Copia en secuencia usuario -> contraseña -> TOTP (pago)
    pub copy_sequence: bool,
    /// Secuencia de escritura automática por defecto (pago)
    pub auto_type_sequence: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: 5,
            lock_warning_secs: 30,
            clipboard_clear_secs: 15,
            lock_on_sleep: true,
            lock_on_session_lock: true,
            lock_on_minimize: false,
            tray_enabled: false,
            close_to_tray: false,
            quick_search_enabled: false,
            quick_search_shortcut: "CommandOrControl+Shift+Space".to_string(),
            copy_sequence: false,
            auto_type_sequence: "{USERNAME}{TAB}{PASSWORD}{ENTER}".to_string(),
        }
    }
}

/// Límites aplicables según la licencia, para que la interfaz los muestre.
#[derive(Serialize)]
pub struct SettingsLimits {
    pub premium: bool,
    pub max_auto_lock_minutes: u32,
    pub max_clipboard_secs: u32,
    pub max_lock_pause_minutes: u32,
}

#[derive(Serialize)]
pub struct SettingsResponse {
    /// Valores efectivos (ya limitados por la licencia)
    pub effective: AppSettings,
    /// Valores guardados por el usuario
    pub saved: AppSettings,
    pub limits: SettingsLimits,
}

fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(SETTINGS_FILENAME))
}

pub fn load_saved(app: &tauri::AppHandle) -> AppSettings {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn limits_for(premium: bool) -> SettingsLimits {
    SettingsLimits {
        premium,
        max_auto_lock_minutes: if premium {
            PAID_MAX_AUTO_LOCK_MIN
        } else {
            FREE_MAX_AUTO_LOCK_MIN
        },
        max_clipboard_secs: if premium {
            PAID_MAX_CLIPBOARD_SECS
        } else {
            FREE_MAX_CLIPBOARD_SECS
        },
        max_lock_pause_minutes: if premium { MAX_LOCK_PAUSE_MIN } else { 0 },
    }
}

/// Aplica los límites de la licencia a unos ajustes guardados.
pub fn apply_limits(saved: &AppSettings, premium: bool) -> AppSettings {
    let l = limits_for(premium);
    let mut e = saved.clone();
    e.auto_lock_minutes = e
        .auto_lock_minutes
        .clamp(MIN_AUTO_LOCK_MIN, l.max_auto_lock_minutes);
    e.clipboard_clear_secs = e
        .clipboard_clear_secs
        .clamp(MIN_CLIPBOARD_SECS, l.max_clipboard_secs);
    e.lock_warning_secs = e.lock_warning_secs.clamp(10, 120);
    if !premium {
        e.tray_enabled = false;
        e.close_to_tray = false;
        e.quick_search_enabled = false;
        e.copy_sequence = false;
    }
    if !e.tray_enabled {
        e.close_to_tray = false;
    }
    e
}

pub fn is_premium(app: &tauri::AppHandle) -> bool {
    current_tier(app) >= Tier::Premium
}

/// Ajustes efectivos según la licencia actual.
pub fn effective(app: &tauri::AppHandle) -> AppSettings {
    apply_limits(&load_saved(app), is_premium(app))
}

fn response(app: &tauri::AppHandle) -> SettingsResponse {
    let premium = is_premium(app);
    let saved = load_saved(app);
    SettingsResponse {
        effective: apply_limits(&saved, premium),
        saved,
        limits: limits_for(premium),
    }
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> SettingsResponse {
    response(&app)
}

#[tauri::command]
pub fn update_settings(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<SettingsResponse, String> {
    // Rechazar explícitamente los ajustes de pago para que la interfaz pueda avisar
    if !is_premium(&app) {
        let pide_pago = settings.auto_lock_minutes > FREE_MAX_AUTO_LOCK_MIN
            || settings.clipboard_clear_secs > FREE_MAX_CLIPBOARD_SECS
            || settings.tray_enabled
            || settings.close_to_tray
            || settings.quick_search_enabled
            || settings.copy_sequence;
        if pide_pago {
            return Err("Ese ajuste requiere una licencia Premium".to_string());
        }
    }
    if settings.quick_search_shortcut.trim().is_empty() {
        return Err("El atajo de búsqueda rápida no puede estar vacío".to_string());
    }
    if settings.auto_type_sequence.len() > 500 {
        return Err("La secuencia de escritura automática es demasiado larga".to_string());
    }

    let path = settings_path(&app).ok_or("No se pudo ubicar el directorio de datos")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Error al crear directorio: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Error al serializar ajustes: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Error al guardar ajustes: {}", e))?;

    // Aplicar cambios que dependen del sistema (atajo global, bandeja)
    crate::desktop::apply_settings(&app);

    Ok(response(&app))
}

/// Pausa el bloqueo automático durante `minutes` (solo pago).
/// Devuelve la marca de tiempo (ms desde epoch) hasta la que queda pausado.
#[tauri::command]
pub fn request_lock_pause(app: tauri::AppHandle, minutes: u32) -> Result<i64, String> {
    if !is_premium(&app) {
        return Err("Pausar el bloqueo requiere una licencia Premium".to_string());
    }
    let minutes = minutes.clamp(1, MAX_LOCK_PAUSE_MIN);
    Ok(chrono::Utc::now().timestamp_millis() + i64::from(minutes) * 60_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gratis_no_puede_extender_pero_si_acortar() {
        let s = AppSettings {
            auto_lock_minutes: 60,
            clipboard_clear_secs: 120,
            quick_search_enabled: true,
            ..Default::default()
        };
        let e = apply_limits(&s, false);
        assert_eq!(e.auto_lock_minutes, FREE_MAX_AUTO_LOCK_MIN);
        assert_eq!(e.clipboard_clear_secs, FREE_MAX_CLIPBOARD_SECS);
        assert!(!e.quick_search_enabled);

        let corto = AppSettings {
            auto_lock_minutes: 2,
            clipboard_clear_secs: 5,
            ..Default::default()
        };
        assert_eq!(apply_limits(&corto, false), corto);
    }

    #[test]
    fn pago_respeta_valores_dentro_del_limite() {
        let s = AppSettings {
            auto_lock_minutes: 60,
            clipboard_clear_secs: 120,
            quick_search_enabled: true,
            tray_enabled: true,
            close_to_tray: true,
            ..Default::default()
        };
        assert_eq!(apply_limits(&s, true), s);
        let excesivo = AppSettings {
            auto_lock_minutes: 10_000,
            ..Default::default()
        };
        assert_eq!(
            apply_limits(&excesivo, true).auto_lock_minutes,
            PAID_MAX_AUTO_LOCK_MIN
        );
    }
}
