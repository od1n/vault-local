// Generador de códigos TOTP (Time-based One-Time Password) según RFC 6238.
// Compatible con Google Authenticator y otras aplicaciones de autenticación.
//
// Implementa:
// - Decodificación Base32 (RFC 4648) del secreto compartido
// - HMAC-SHA1 con el contador de tiempo
// - Truncamiento dinámico para generar códigos numéricos

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;

/// Alfabeto Base32 según RFC 4648 (A-Z, 2-7)
const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Código TOTP generado con metadata de expiración.
#[derive(Serialize)]
pub struct TotpCode {
    /// Código numérico formateado con ceros a la izquierda (ej: "012345")
    pub code: String,
    /// Segundos restantes antes de que el código expire
    pub remaining_secs: u32,
    /// Período total del código en segundos (normalmente 30)
    pub period: u32,
}

/// Decodifica una cadena Base32 (RFC 4648) a bytes.
///
/// Soporta el alfabeto estándar A-Z y 2-7.
/// Ignora el padding ('=') y los espacios para mayor flexibilidad.
/// Retorna error si encuentra caracteres inválidos.
fn base32_decode(input: &str) -> Result<Vec<u8>, String> {
    // Limpiar la entrada: quitar espacios, padding y convertir a mayúsculas
    let limpio: String = input
        .chars()
        .filter(|c| *c != '=' && !c.is_whitespace() && *c != '-')
        .flat_map(|c| c.to_uppercase())
        .collect();

    if limpio.is_empty() {
        return Err("El secreto TOTP está vacío".to_string());
    }

    let mut resultado: Vec<u8> = Vec::new();
    let mut buffer: u64 = 0;
    let mut bits_en_buffer: u32 = 0;

    for ch in limpio.chars() {
        // Buscar el valor del carácter en el alfabeto Base32
        let valor = BASE32_ALPHABET
            .iter()
            .position(|&b| b == ch as u8)
            .ok_or_else(|| format!("Carácter inválido en secreto Base32: '{}'", ch))?
            as u64;

        // Acumular 5 bits por cada carácter Base32
        buffer = (buffer << 5) | valor;
        bits_en_buffer += 5;

        // Extraer bytes completos (8 bits) del buffer
        if bits_en_buffer >= 8 {
            bits_en_buffer -= 8;
            resultado.push((buffer >> bits_en_buffer) as u8);
            // Limpiar los bits ya extraídos
            buffer &= (1u64 << bits_en_buffer) - 1;
        }
    }

    Ok(resultado)
}

/// Genera un código TOTP según RFC 6238.
///
/// # Argumentos
/// - `secret`: secreto compartido codificado en Base32 (formato estándar de Google Authenticator)
/// - `digits`: número de dígitos del código (por defecto 6)
/// - `period`: período de validez en segundos (por defecto 30)
///
/// # Algoritmo (RFC 6238 / RFC 4226)
/// 1. Decodificar el secreto de Base32 a bytes
/// 2. Calcular el contador: timestamp_unix / período
/// 3. Calcular HMAC-SHA1(secreto, contador_big_endian)
/// 4. Truncamiento dinámico: extraer 4 bytes desde un offset dinámico
/// 5. Aplicar módulo 10^dígitos y formatear con ceros a la izquierda
#[tauri::command]
pub fn generate_totp(
    secret: String,
    digits: Option<u32>,
    period: Option<u32>,
) -> Result<TotpCode, String> {
    let digitos = digits.unwrap_or(6);
    let periodo = period.unwrap_or(30);

    // Validar parámetros
    if digitos < 6 || digitos > 8 {
        return Err("El número de dígitos debe estar entre 6 y 8".to_string());
    }
    if periodo == 0 {
        return Err("El período no puede ser cero".to_string());
    }

    // 1. Decodificar el secreto de Base32
    let secret_bytes = base32_decode(&secret)?;
    if secret_bytes.is_empty() {
        return Err("El secreto TOTP decodificado está vacío".to_string());
    }

    // 2. Obtener el timestamp Unix actual y calcular el contador de tiempo
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Error al obtener timestamp: {}", e))?
        .as_secs();

    let contador = timestamp / periodo as u64;

    // 3. Calcular HMAC-SHA1(secreto, contador en big-endian de 8 bytes)
    let contador_bytes = contador.to_be_bytes();

    let mut mac = Hmac::<Sha1>::new_from_slice(&secret_bytes)
        .map_err(|e| format!("Error al inicializar HMAC: {}", e))?;
    mac.update(&contador_bytes);
    let hmac_resultado = mac.finalize().into_bytes();

    // 4. Truncamiento dinámico (RFC 4226, sección 5.4)
    // El offset se determina por los 4 bits menos significativos del último byte
    let offset = (hmac_resultado[19] & 0x0f) as usize;

    // Extraer 4 bytes desde el offset y enmascarar el bit más significativo
    let codigo_bin = ((hmac_resultado[offset] as u32 & 0x7f) << 24)
        | ((hmac_resultado[offset + 1] as u32) << 16)
        | ((hmac_resultado[offset + 2] as u32) << 8)
        | (hmac_resultado[offset + 3] as u32);

    // 5. Aplicar módulo para obtener el número de dígitos deseados
    let modulo = 10u32.pow(digitos);
    let codigo = codigo_bin % modulo;

    // Formatear con ceros a la izquierda hasta alcanzar la longitud deseada
    let codigo_formateado = format!("{:0>width$}", codigo, width = digitos as usize);

    // Calcular segundos restantes antes de que expire el código
    let segundos_restantes = periodo - (timestamp % periodo as u64) as u32;

    Ok(TotpCode {
        code: codigo_formateado,
        remaining_secs: segundos_restantes,
        period: periodo,
    })
}
