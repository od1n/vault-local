// Generador de contraseñas criptográficamente seguro.
// Utiliza OsRng para garantizar aleatoriedad de calidad criptográfica.

use rand::rngs::OsRng;
use rand::RngCore;

/// Caracteres disponibles para cada categoría
const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const NUMBERS: &[u8] = b"0123456789";
const SYMBOLS: &[u8] = b"!@#$%^&*()_+-=[]{}|;:,.<>?";

/// Genera una contraseña aleatoria con los conjuntos de caracteres seleccionados.
///
/// # Argumentos
/// - `length`: longitud de la contraseña (mínimo 4, máximo 128)
/// - `uppercase`: incluir letras mayúsculas
/// - `lowercase`: incluir letras minúsculas
/// - `numbers`: incluir dígitos numéricos
/// - `symbols`: incluir símbolos especiales
///
/// Garantiza al menos un carácter de cada conjunto habilitado.
#[tauri::command]
pub fn generate_password(
    length: u32,
    uppercase: bool,
    lowercase: bool,
    numbers: bool,
    symbols: bool,
) -> Result<String, String> {
    // Validar que al menos un conjunto está habilitado
    if !uppercase && !lowercase && !numbers && !symbols {
        return Err("Debe seleccionar al menos un tipo de carácter".to_string());
    }

    // Validar longitud
    if length < 4 {
        return Err("La longitud mínima es 4 caracteres".to_string());
    }
    if length > 128 {
        return Err("La longitud máxima es 128 caracteres".to_string());
    }

    // Construir el conjunto de caracteres disponibles
    let mut charset: Vec<u8> = Vec::new();
    let mut required: Vec<&[u8]> = Vec::new();

    if uppercase {
        charset.extend_from_slice(UPPERCASE);
        required.push(UPPERCASE);
    }
    if lowercase {
        charset.extend_from_slice(LOWERCASE);
        required.push(LOWERCASE);
    }
    if numbers {
        charset.extend_from_slice(NUMBERS);
        required.push(NUMBERS);
    }
    if symbols {
        charset.extend_from_slice(SYMBOLS);
        required.push(SYMBOLS);
    }

    // Verificar que la longitud permite incluir al menos uno de cada tipo requerido
    if (length as usize) < required.len() {
        return Err(format!(
            "La longitud mínima para los tipos seleccionados es {} caracteres",
            required.len()
        ));
    }

    let charset_len = charset.len();

    // Generar contraseña aleatoria usando rechazo para evitar sesgo modular
    let mut password: Vec<u8> = Vec::with_capacity(length as usize);
    for _ in 0..length {
        let idx = random_index(charset_len);
        password.push(charset[idx]);
    }

    // Garantizar al menos un carácter de cada conjunto habilitado.
    // Colocar uno obligatorio en posiciones aleatorias.
    let mut positions: Vec<usize> = (0..length as usize).collect();
    // Mezclar posiciones usando Fisher-Yates
    for i in (1..positions.len()).rev() {
        let j = random_index(i + 1);
        positions.swap(i, j);
    }

    for (i, req_set) in required.iter().enumerate() {
        let pos = positions[i];
        let idx = random_index(req_set.len());
        password[pos] = req_set[idx];
    }

    String::from_utf8(password).map_err(|e| format!("Error al generar contraseña: {}", e))
}

/// Genera un índice aleatorio en el rango [0, max) usando rechazo para evitar sesgo modular.
fn random_index(max: usize) -> usize {
    if max <= 1 {
        return 0;
    }

    // Usar rechazo para eliminar sesgo modular
    let limit = usize::MAX - (usize::MAX % max);
    loop {
        let mut buf = [0u8; 8];
        OsRng.fill_bytes(&mut buf);
        let val = usize::from_le_bytes(buf);
        if val < limit {
            return val % max;
        }
    }
}
