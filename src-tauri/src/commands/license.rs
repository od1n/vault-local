// Sistema de licencias offline para Vault Local.
// Usa HMAC-SHA256 para generar y verificar claves de licencia sin necesidad de conexión a internet.
//
// Formato de clave: VL-{UUID_PARTE1}-{UUID_PARTE2}-{UUID_PARTE3}-{UUID_PARTE4}-{HMAC_PREFIJO}
// Ejemplo: VL-a1b2c3d4-e5f6a7b8-c9d0e1f2-a3b4c5d6-7f8e9d0c
//
// La verificación es completamente offline: se recalcula el HMAC del UUID
// y se compara con el prefijo incluido en la clave.

use std::fs;

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::Manager;
use uuid::Uuid;

/// Clave de firma embebida en el binario para verificación de licencias.
/// IMPORTANTE: En producción, esta clave debe ser diferente y solo conocida
/// por el servidor de licencias. Cambiarla antes de distribuir la aplicación.
const LICENSE_SIGNING_KEY: &[u8] = b"vault-local-license-signing-key-v1-CHANGE-IN-PRODUCTION";

/// Prefijo que identifica las claves de licencia de Vault Local.
const LICENSE_PREFIX: &str = "VL-";

/// Longitud del prefijo HMAC incluido en la clave (8 caracteres hexadecimales).
const HMAC_PREFIX_LEN: usize = 8;

/// Nombre del archivo donde se persiste la licencia activada.
const LICENSE_FILENAME: &str = "license.json";

/// Información de la licencia del usuario.
#[derive(Serialize, Deserialize)]
pub struct LicenseInfo {
    /// Indica si el usuario tiene licencia premium activa
    pub is_premium: bool,
    /// Clave de licencia activada (None si no hay licencia)
    pub license_key: Option<String>,
    /// Fecha de activación en formato ISO 8601 (None si no hay licencia)
    pub activated_at: Option<String>,
}

/// Datos persistidos en el archivo license.json.
#[derive(Serialize, Deserialize)]
struct LicenseFile {
    /// Clave de licencia completa (incluyendo prefijo VL-)
    key: String,
    /// Fecha de activación en formato ISO 8601
    activated_at: String,
}

/// Obtiene la ruta al archivo de licencia en el directorio de datos de la aplicación.
fn get_license_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))?;
    Ok(app_data_dir.join(LICENSE_FILENAME))
}

/// Calcula el HMAC-SHA256 de los bytes del UUID con la clave de firma.
/// Retorna el hash completo en hexadecimal minúsculas.
fn compute_hmac(uuid_hex: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(LICENSE_SIGNING_KEY)
        .map_err(|e| format!("Error al inicializar HMAC: {}", e))?;
    mac.update(uuid_hex.as_bytes());
    let resultado = mac.finalize().into_bytes();
    Ok(hex::encode(resultado))
}

/// Verifica si una clave de licencia es válida.
///
/// Proceso:
/// 1. Quitar el prefijo "VL-"
/// 2. Separar las partes por "-": las primeras 4 son el UUID, la última es el prefijo HMAC
/// 3. Recalcular HMAC-SHA256(clave_firma, uuid_hex)
/// 4. Comparar los primeros 8 caracteres hex del HMAC con el prefijo proporcionado
fn verify_license_key(license_key: &str) -> Result<bool, String> {
    // Verificar que la clave empieza con el prefijo correcto
    if !license_key.starts_with(LICENSE_PREFIX) {
        return Err("Clave de licencia inválida: debe empezar con 'VL-'".to_string());
    }

    // Quitar el prefijo "VL-" y separar por guiones
    let sin_prefijo = &license_key[LICENSE_PREFIX.len()..];
    let partes: Vec<&str> = sin_prefijo.split('-').collect();

    // Debe tener exactamente 5 partes: 4 del UUID + 1 del HMAC
    if partes.len() != 5 {
        return Err(
            "Clave de licencia inválida: formato incorrecto (se esperan 5 segmentos después de VL-)"
                .to_string(),
        );
    }

    // Las primeras 4 partes forman el UUID (sin guiones)
    let uuid_hex = partes[..4].join("");
    // La última parte es el prefijo del HMAC
    let hmac_prefijo = partes[4];

    // Validar que el prefijo HMAC tiene la longitud correcta
    if hmac_prefijo.len() != HMAC_PREFIX_LEN {
        return Err(format!(
            "Clave de licencia inválida: el código de verificación debe tener {} caracteres",
            HMAC_PREFIX_LEN
        ));
    }

    // Recalcular el HMAC y comparar el prefijo
    let hmac_completo = compute_hmac(&uuid_hex)?;
    let hmac_calculado_prefijo = &hmac_completo[..HMAC_PREFIX_LEN];

    Ok(hmac_prefijo.to_lowercase() == hmac_calculado_prefijo.to_lowercase())
}

/// Activa una licencia premium en la aplicación.
///
/// Verifica la validez de la clave de licencia usando HMAC-SHA256 y,
/// si es válida, la persiste en el archivo license.json del directorio de datos.
///
/// Retorna la información de la licencia activada.
#[tauri::command]
pub fn activate_license(
    app: tauri::AppHandle,
    license_key: String,
) -> Result<LicenseInfo, String> {
    // Limpiar espacios en la clave
    let clave_limpia = license_key.trim().to_string();

    // Verificar la validez de la clave
    let es_valida = verify_license_key(&clave_limpia)?;
    if !es_valida {
        return Err("Clave de licencia inválida: la verificación HMAC falló".to_string());
    }

    // Preparar los datos de la licencia
    let ahora = Utc::now().to_rfc3339();
    let datos_licencia = LicenseFile {
        key: clave_limpia.clone(),
        activated_at: ahora.clone(),
    };

    // Persistir en disco
    let ruta_licencia = get_license_path(&app)?;

    // Asegurar que el directorio existe
    if let Some(directorio) = ruta_licencia.parent() {
        fs::create_dir_all(directorio)
            .map_err(|e| format!("Error al crear directorio de datos: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&datos_licencia)
        .map_err(|e| format!("Error al serializar datos de licencia: {}", e))?;
    fs::write(&ruta_licencia, json)
        .map_err(|e| format!("Error al guardar licencia: {}", e))?;

    Ok(LicenseInfo {
        is_premium: true,
        license_key: Some(clave_limpia),
        activated_at: Some(ahora),
    })
}

/// Consulta el estado actual de la licencia.
///
/// Lee el archivo license.json, re-verifica la clave almacenada y retorna
/// el estado. Si no hay licencia o la verificación falla, retorna is_premium = false.
#[tauri::command]
pub fn check_license(app: tauri::AppHandle) -> Result<LicenseInfo, String> {
    let ruta_licencia = get_license_path(&app)?;

    // Si no existe el archivo, no hay licencia
    if !ruta_licencia.exists() {
        return Ok(LicenseInfo {
            is_premium: false,
            license_key: None,
            activated_at: None,
        });
    }

    // Leer y deserializar el archivo
    let contenido = fs::read_to_string(&ruta_licencia)
        .map_err(|e| format!("Error al leer archivo de licencia: {}", e))?;
    let datos: LicenseFile = serde_json::from_str(&contenido)
        .map_err(|e| format!("Error al parsear archivo de licencia: {}", e))?;

    // Re-verificar la clave almacenada para detectar manipulación
    let es_valida = verify_license_key(&datos.key).unwrap_or(false);

    if es_valida {
        Ok(LicenseInfo {
            is_premium: true,
            license_key: Some(datos.key),
            activated_at: Some(datos.activated_at),
        })
    } else {
        // La clave almacenada no es válida (posible manipulación del archivo)
        Ok(LicenseInfo {
            is_premium: false,
            license_key: None,
            activated_at: None,
        })
    }
}

/// Desactiva la licencia premium eliminando el archivo license.json.
#[tauri::command]
pub fn deactivate_license(app: tauri::AppHandle) -> Result<(), String> {
    let ruta_licencia = get_license_path(&app)?;

    if ruta_licencia.exists() {
        fs::remove_file(&ruta_licencia)
            .map_err(|e| format!("Error al eliminar archivo de licencia: {}", e))?;
    }

    Ok(())
}

/// Genera una clave de licencia válida para testing y desarrollo.
///
/// **ADVERTENCIA**: En producción, esta función NO debe estar disponible en el cliente.
/// La generación de claves debe realizarse exclusivamente en un servidor seguro
/// que posea la clave de firma.
///
/// Genera un UUID v4 aleatorio y calcula el HMAC-SHA256 correspondiente.
#[tauri::command]
pub fn generate_license_key() -> Result<String, String> {
    // Generar un UUID v4 aleatorio
    let uuid = Uuid::new_v4();
    let uuid_str = uuid.to_string().replace('-', "");

    // Calcular el HMAC del UUID
    let hmac_completo = compute_hmac(&uuid_str)?;
    let hmac_prefijo = &hmac_completo[..HMAC_PREFIX_LEN];

    // Formatear la clave: VL-{8chars}-{8chars}-{8chars}-{8chars}-{8chars_hmac}
    // El UUID tiene 32 caracteres hex, se divide en 4 grupos de 8
    let clave = format!(
        "VL-{}-{}-{}-{}-{}",
        &uuid_str[0..8],
        &uuid_str[8..16],
        &uuid_str[16..24],
        &uuid_str[24..32],
        hmac_prefijo
    );

    Ok(clave)
}
