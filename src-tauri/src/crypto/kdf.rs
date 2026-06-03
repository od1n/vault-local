// Funciones de derivación de claves (Key Derivation Functions).
// Utiliza Argon2id para derivar la clave maestra y HKDF-SHA256 para sub-claves.

use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroize;

/// Genera un salt criptográficamente aleatorio de 32 bytes.
pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Deriva una clave maestra de 32 bytes a partir de la contraseña y el salt usando Argon2id.
///
/// Parámetros de Argon2id:
/// - m_cost: 19456 KiB (~19 MiB de memoria)
/// - t_cost: 2 iteraciones
/// - p_cost: 1 hilo (sin paralelismo)
///
/// Retorna la clave maestra de 32 bytes o un error descriptivo.
pub fn derive_master_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], String> {
    // Configurar parámetros de Argon2id: 19MiB memoria, 2 iteraciones, 1 hilo
    let params = Params::new(
        19456,  // m_cost en KiB (~19 MiB)
        2,      // t_cost (iteraciones)
        1,      // p_cost (paralelismo)
        Some(32) // longitud de salida en bytes
    )
    .map_err(|e| format!("Error en parámetros Argon2: {}", e))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut master_key = [0u8; 32];
    argon2
        .hash_password_into(password, salt, &mut master_key)
        .map_err(|e| format!("Error al derivar clave maestra: {}", e))?;

    Ok(master_key)
}

/// Deriva dos sub-claves de 32 bytes a partir de la clave maestra usando HKDF-SHA256.
///
/// - db_key: clave para SQLCipher (info: "vault-local-db")
/// - enc_key: clave para XChaCha20-Poly1305 (info: "vault-local-field-enc")
///
/// Retorna (db_key, enc_key) o un error descriptivo.
pub fn derive_sub_keys(master_key: &[u8; 32], salt: &[u8]) -> Result<([u8; 32], [u8; 32]), String> {
    let hk = Hkdf::<Sha256>::new(Some(salt), master_key);

    // Derivar clave para la base de datos (SQLCipher)
    let mut db_key = [0u8; 32];
    hk.expand(b"vault-local-db", &mut db_key)
        .map_err(|e| format!("Error al derivar db_key: {}", e))?;

    // Derivar clave para cifrado de campos (XChaCha20-Poly1305)
    let mut enc_key = [0u8; 32];
    hk.expand(b"vault-local-field-enc", &mut enc_key)
        .map_err(|e| format!("Error al derivar enc_key: {}", e))?;

    Ok((db_key, enc_key))
}

/// Ejecuta el flujo completo de derivación de claves a partir de la contraseña y el salt.
/// Retorna (db_key, enc_key) y zeroiza la clave maestra intermedia.
pub fn derive_keys_from_password(
    password: &[u8],
    salt: &[u8],
) -> Result<([u8; 32], [u8; 32]), String> {
    let mut master_key = derive_master_key(password, salt)?;
    let result = derive_sub_keys(&master_key, salt);

    // Zeroizar la clave maestra intermedia
    master_key.zeroize();

    result
}
