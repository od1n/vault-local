// Módulo de protección contra fuerza bruta.
// Gestiona los intentos fallidos de login con retardo exponencial (exponential backoff).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};

/// Estado de bloqueo por intentos fallidos.
/// Se persiste en disco para sobrevivir reinicios de la aplicación.
#[derive(Serialize, Deserialize, Default)]
pub struct LockoutState {
    /// Cantidad de intentos fallidos consecutivos
    pub failed_attempts: u32,
    /// Marca de tiempo del último intento fallido (ISO 8601)
    pub last_attempt: Option<String>,
}

/// Cantidad de intentos permitidos antes de activar el retardo
const MAX_ATTEMPTS_BEFORE_DELAY: u32 = 3;

/// Retardo máximo en segundos (tope del backoff exponencial)
const MAX_DELAY_SECS: u64 = 60;

impl LockoutState {
    /// Carga el estado de bloqueo desde un archivo JSON.
    /// Si el archivo no existe o está corrupto, retorna estado por defecto.
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Persiste el estado de bloqueo en disco.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let json = serde_json::to_string(self).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| format!("Error guardando lockout: {}", e))
    }

    /// Verifica si se permite un nuevo intento de desbloqueo.
    /// Retorna Ok(()) si está permitido, Err(segundos_restantes) si está bloqueado.
    pub fn check_allowed(&self) -> Result<(), u64> {
        if self.failed_attempts < MAX_ATTEMPTS_BEFORE_DELAY {
            return Ok(());
        }
        let delay = self.calculate_delay();
        if let Some(ref last) = self.last_attempt {
            if let Ok(last_dt) = DateTime::parse_from_rfc3339(last) {
                let elapsed = Utc::now().signed_duration_since(last_dt);
                let remaining = delay as i64 - elapsed.num_seconds();
                if remaining > 0 {
                    return Err(remaining as u64);
                }
            }
        }
        Ok(())
    }

    /// Registra un intento fallido con la marca de tiempo actual.
    pub fn record_failure(&mut self) {
        self.failed_attempts += 1;
        self.last_attempt = Some(Utc::now().to_rfc3339());
    }

    /// Reinicia el contador de intentos fallidos tras un desbloqueo exitoso.
    pub fn reset(&mut self) {
        self.failed_attempts = 0;
        self.last_attempt = None;
    }

    /// Calcula el retardo en segundos usando backoff exponencial.
    /// Fórmula: 2^(intentos - umbral), con tope en MAX_DELAY_SECS.
    fn calculate_delay(&self) -> u64 {
        if self.failed_attempts < MAX_ATTEMPTS_BEFORE_DELAY {
            return 0;
        }
        let power = self.failed_attempts - MAX_ATTEMPTS_BEFORE_DELAY;
        let delay = 2u64.saturating_pow(power);
        delay.min(MAX_DELAY_SECS)
    }
}
