// Sistema de licencias offline para Vault Local (formato v2, firmas Ed25519).
//
// Por qué Ed25519 y no HMAC:
// con HMAC la misma clave sirve para firmar y para verificar, así que tenía que viajar
// dentro del ejecutable y cualquiera podía extraerla y fabricar licencias. Con Ed25519
// la app solo contiene la clave PÚBLICA (sirve para verificar, no para firmar). La clave
// privada vive únicamente en el servidor de licencias (variable de entorno de Vercel)
// y en la carpeta privada del autor, nunca en este repositorio.
//
// Formato de la clave:  VL2-<payload base64url>.<firma base64url>
// El payload es un JSON firmado:
//   { "v":2, "id":"...", "email":"...", "tier":"premium|pro|owner",
//     "trial":false, "iat":1760000000, "exp":1791536000 | null }
//
// La verificación es completamente offline.

use std::fs;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{TimeZone, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Clave pública Ed25519 para verificar licencias (32 bytes).
/// La clave privada correspondiente NO está en el repositorio.
const LICENSE_PUBLIC_KEY: [u8; 32] = [
    0x0e, 0x28, 0x6f, 0x19, 0x69, 0x1d, 0x59, 0xfb, 0x82, 0x58, 0xa2, 0x26, 0x5c, 0xfb, 0xa5, 0xd0,
    0xae, 0x5e, 0xaf, 0xeb, 0xc1, 0xc2, 0x02, 0xd1, 0x29, 0xc5, 0x44, 0x84, 0x47, 0xdf, 0xdd, 0x1b,
];

/// Prefijo que identifica las claves de licencia v2.
const LICENSE_PREFIX: &str = "VL2-";

/// Nombre del archivo donde se persiste la licencia activada.
const LICENSE_FILENAME: &str = "license.json";

/// Tolerancia para relojes adelantados al validar la fecha de emisión (1 día).
const CLOCK_SKEW_SECS: i64 = 86_400;

/// Nivel de licencia. El orden importa: un nivel superior incluye a los inferiores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Free,
    Premium,
    Pro,
    Owner,
}

/// Contenido firmado de una licencia.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LicensePayload {
    v: u8,
    id: String,
    email: String,
    tier: Tier,
    #[serde(default)]
    trial: bool,
    iat: i64,
    exp: Option<i64>,
}

/// Información de la licencia que se entrega al frontend.
#[derive(Serialize)]
pub struct LicenseInfo {
    /// true si el nivel efectivo es Premium o superior
    pub is_premium: bool,
    /// true si el nivel efectivo es Pro o superior
    pub is_pro: bool,
    /// Nivel efectivo (free si no hay licencia o está vencida)
    pub tier: Tier,
    /// "none" | "active" | "expired" | "invalid"
    pub status: String,
    /// true si es una licencia de prueba (código promocional)
    pub trial: bool,
    /// Correo al que está emitida la licencia
    pub email: Option<String>,
    /// Clave de licencia completa (el frontend la enmascara)
    pub license_key: Option<String>,
    /// Fecha de activación en este equipo (ISO 8601)
    pub activated_at: Option<String>,
    /// Fecha de vencimiento (ISO 8601). None = sin vencimiento
    pub expires_at: Option<String>,
    /// Días restantes (None si no vence o no hay licencia)
    pub days_left: Option<i64>,
}

/// Datos persistidos en license.json.
#[derive(Serialize, Deserialize)]
struct LicenseFile {
    key: String,
    activated_at: String,
    /// Mayor marca de tiempo observada; se usa para detectar que alguien atrasó el reloj
    #[serde(default)]
    last_seen: i64,
}

fn get_license_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))?;
    Ok(dir.join(LICENSE_FILENAME))
}

/// Verifica la firma y decodifica el payload. No revisa vencimiento.
fn decode_and_verify(license_key: &str) -> Result<LicensePayload, String> {
    let key = license_key.trim();
    let body = key
        .strip_prefix(LICENSE_PREFIX)
        .ok_or("Clave de licencia inválida: debe empezar con 'VL2-'")?;

    let (payload_b64, sig_b64) = body
        .split_once('.')
        .ok_or("Clave de licencia inválida: formato incorrecto")?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| "Clave de licencia inválida: contenido dañado")?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| "Clave de licencia inválida: firma dañada")?;
    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| "Clave de licencia inválida: longitud de firma incorrecta")?;

    let verifying_key = VerifyingKey::from_bytes(&LICENSE_PUBLIC_KEY)
        .map_err(|_| "Error interno: clave pública inválida")?;
    verifying_key
        .verify(&payload_bytes, &Signature::from_bytes(&sig_arr))
        .map_err(|_| "Clave de licencia inválida: la firma no corresponde")?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "Clave de licencia inválida: contenido ilegible")?;

    if payload.v != 2 {
        return Err("Versión de licencia no soportada".to_string());
    }
    if payload.tier == Tier::Free {
        return Err("Clave de licencia inválida".to_string());
    }
    Ok(payload)
}

fn iso(ts: i64) -> Option<String> {
    Utc.timestamp_opt(ts, 0).single().map(|d| d.to_rfc3339())
}

fn empty_info(status: &str) -> LicenseInfo {
    LicenseInfo {
        is_premium: false,
        is_pro: false,
        tier: Tier::Free,
        status: status.to_string(),
        trial: false,
        email: None,
        license_key: None,
        activated_at: None,
        expires_at: None,
        days_left: None,
    }
}

/// Construye la información de licencia evaluando el vencimiento contra `now`.
fn build_info(payload: &LicensePayload, key: &str, activated_at: &str, now: i64) -> LicenseInfo {
    let expired = payload.exp.map(|exp| now >= exp).unwrap_or(false);
    let tier = if expired { Tier::Free } else { payload.tier };
    LicenseInfo {
        is_premium: tier >= Tier::Premium,
        is_pro: tier >= Tier::Pro,
        tier,
        status: if expired { "expired" } else { "active" }.to_string(),
        trial: payload.trial,
        email: Some(payload.email.clone()),
        license_key: Some(key.to_string()),
        activated_at: Some(activated_at.to_string()),
        expires_at: payload.exp.and_then(iso),
        days_left: payload
            .exp
            .map(|exp| ((exp - now) as f64 / 86_400.0).ceil() as i64),
    }
}

/// Lee la licencia guardada, la verifica y devuelve su información.
/// También actualiza la marca `last_seen` para detectar relojes atrasados.
fn load_license(app: &tauri::AppHandle) -> LicenseInfo {
    let path = match get_license_path(app) {
        Ok(p) => p,
        Err(_) => return empty_info("none"),
    };
    let contenido = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return empty_info("none"),
    };
    let mut datos: LicenseFile = match serde_json::from_str(&contenido) {
        Ok(d) => d,
        Err(_) => return empty_info("invalid"),
    };
    let payload = match decode_and_verify(&datos.key) {
        Ok(p) => p,
        // Incluye las claves del formato anterior (HMAC), que ya no se aceptan
        Err(_) => return empty_info("invalid"),
    };

    // Si el reloj del sistema va por detrás de lo ya observado, usar lo observado.
    let real_now = Utc::now().timestamp();
    let now = real_now.max(datos.last_seen);
    if real_now > datos.last_seen {
        datos.last_seen = real_now;
        if let Ok(json) = serde_json::to_string_pretty(&datos) {
            let _ = fs::write(&path, json);
        }
    }

    build_info(&payload, &datos.key, &datos.activated_at, now)
}

/// Nivel de licencia efectivo. Lo usan otros módulos del backend para limitar funciones.
pub fn current_tier(app: &tauri::AppHandle) -> Tier {
    load_license(app).tier
}

/// Devuelve error si el nivel efectivo es menor que `min`. Se usa en los comandos de pago
/// para que el límite no dependa solo de la interfaz.
pub fn require_tier(app: &tauri::AppHandle, min: Tier) -> Result<(), String> {
    if current_tier(app) >= min {
        Ok(())
    } else if min >= Tier::Pro {
        Err("Esta función requiere una licencia Pro".to_string())
    } else {
        Err("Esta función requiere una licencia Premium".to_string())
    }
}

/// Activa una licencia: verifica la firma, revisa el vencimiento y la guarda.
#[tauri::command]
pub fn activate_license(app: tauri::AppHandle, license_key: String) -> Result<LicenseInfo, String> {
    let clave = license_key.split_whitespace().collect::<String>();
    let payload = decode_and_verify(&clave)?;
    let now = Utc::now().timestamp();

    if payload.iat > now + CLOCK_SKEW_SECS {
        return Err(
            "La fecha de tu equipo parece incorrecta. Corrígela y vuelve a intentarlo.".to_string(),
        );
    }
    if let Some(exp) = payload.exp {
        if now >= exp {
            return Err(format!(
                "Esta licencia venció el {}. Renueva tu plan en https://vault-local.vercel.app",
                iso(exp).unwrap_or_default().get(..10).unwrap_or("")
            ));
        }
    }

    let path = get_license_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Error al crear directorio de datos: {}", e))?;
    }
    let activated_at = Utc::now().to_rfc3339();
    let datos = LicenseFile {
        key: clave.clone(),
        activated_at: activated_at.clone(),
        last_seen: now,
    };
    let json = serde_json::to_string_pretty(&datos)
        .map_err(|e| format!("Error al serializar licencia: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Error al guardar licencia: {}", e))?;

    Ok(build_info(&payload, &clave, &activated_at, now))
}

/// Consulta el estado actual de la licencia.
#[tauri::command]
pub fn check_license(app: tauri::AppHandle) -> Result<LicenseInfo, String> {
    Ok(load_license(&app))
}

/// Desactiva la licencia eliminando license.json.
#[tauri::command]
pub fn deactivate_license(app: tauri::AppHandle) -> Result<(), String> {
    let path = get_license_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Error al eliminar licencia: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Licencia real emitida con tools/issue-license.mjs (nivel pro, vencía al día siguiente).
    const LICENCIA_PRUEBA: &str = "VL2-eyJ2IjoyLCJpZCI6Im1hbnVhbC05ZWZhMzdlNC05MmZmLTQzYTMtYWVkNS04ZGVkOGYxN2MyZjgiLCJlbWFpbCI6InBydWViYUBleGFtcGxlLmNvbSIsInRpZXIiOiJwcm8iLCJ0cmlhbCI6ZmFsc2UsImlhdCI6MTc5MTQ3ODQ5MSwiZXhwIjoxNzkxNTY0ODkxfQ.r0EXC_Jz36oA1C9uZnwcdGFkAXyWnRiti_RwIhJ6lY9M6kpSxd_dfZ3lT3ECUeBBUpgysTIpgJWQAuaEUoGyBA";

    #[test]
    fn acepta_licencia_firmada_y_detecta_vencimiento() {
        let p = decode_and_verify(LICENCIA_PRUEBA).expect("la firma debe validar");
        assert_eq!(p.tier, Tier::Pro);
        assert_eq!(p.email, "prueba@example.com");
        assert!(build_info(&p, LICENCIA_PRUEBA, "", p.iat + 10).is_pro);
        assert_eq!(
            build_info(&p, LICENCIA_PRUEBA, "", p.exp.unwrap()).tier,
            Tier::Free
        );
    }

    #[test]
    fn rechaza_payload_alterado_con_firma_real() {
        // Mismo contenido pero con "owner" en lugar de "pro": la firma ya no corresponde
        let (cuerpo, firma) = LICENCIA_PRUEBA[4..].split_once('.').unwrap();
        let json = String::from_utf8(URL_SAFE_NO_PAD.decode(cuerpo).unwrap()).unwrap();
        let alterado = URL_SAFE_NO_PAD.encode(json.replace("\"pro\"", "\"owner\""));
        assert!(decode_and_verify(&format!("VL2-{}.{}", alterado, firma)).is_err());
    }

    #[test]
    fn rechaza_formato_anterior_hmac() {
        assert!(decode_and_verify("VL-a1b2c3d4-e5f6a7b8-c9d0e1f2-a3b4c5d6-7f8e9d0c").is_err());
    }

    #[test]
    fn rechaza_firma_alterada() {
        let payload = URL_SAFE_NO_PAD
            .encode(br#"{"v":2,"id":"x","email":"a@b.c","tier":"owner","iat":0,"exp":null}"#);
        let firma = URL_SAFE_NO_PAD.encode([0u8; 64]);
        assert!(decode_and_verify(&format!("VL2-{}.{}", payload, firma)).is_err());
    }

    #[test]
    fn vencimiento_baja_a_free() {
        let p = LicensePayload {
            v: 2,
            id: "x".into(),
            email: "a@b.c".into(),
            tier: Tier::Pro,
            trial: false,
            iat: 0,
            exp: Some(100),
        };
        let activa = build_info(&p, "k", "", 50);
        assert!(activa.is_pro && activa.is_premium);
        let vencida = build_info(&p, "k", "", 100);
        assert_eq!(vencida.tier, Tier::Free);
        assert_eq!(vencida.status, "expired");
    }
}
