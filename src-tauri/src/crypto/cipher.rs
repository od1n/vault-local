// Cifrado y descifrado de campos usando XChaCha20-Poly1305.
// Cada operación de cifrado genera un nonce aleatorio de 24 bytes.
// El formato del blob cifrado es: nonce (24 bytes) || ciphertext+tag (N+16 bytes).

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::rngs::OsRng;
use rand::RngCore;

/// Cifra datos con XChaCha20-Poly1305 usando la clave proporcionada.
///
/// Genera un nonce aleatorio de 24 bytes y retorna nonce || ciphertext.
/// El resultado tiene un tamaño de 24 (nonce) + plaintext.len() + 16 (tag) bytes.
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    // Crear instancia del cifrador con la clave
    let cipher = XChaCha20Poly1305::new(key.into());

    // Generar nonce aleatorio de 24 bytes
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    // Cifrar los datos
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Error al cifrar datos: {}", e))?;

    // Concatenar nonce + ciphertext para almacenamiento
    let mut result = Vec::with_capacity(24 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Descifra datos previamente cifrados con XChaCha20-Poly1305.
///
/// Espera el formato: nonce (24 bytes) || ciphertext+tag.
/// Retorna los datos en texto plano o un error si la clave/datos son incorrectos.
pub fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    // Verificar longitud mínima: 24 (nonce) + 16 (tag) = 40 bytes
    if data.len() < 40 {
        return Err("Datos cifrados demasiado cortos (mínimo 40 bytes)".to_string());
    }

    // Separar nonce y ciphertext
    let (nonce_bytes, ciphertext) = data.split_at(24);
    let nonce = XNonce::from_slice(nonce_bytes);

    // Crear instancia del cifrador con la clave
    let cipher = XChaCha20Poly1305::new(key.into());

    // Descifrar los datos
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Error al descifrar: clave incorrecta o datos corruptos".to_string())
}
