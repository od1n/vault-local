// Definición del estado global de la aplicación.
// Contiene la conexión a la base de datos y la clave de cifrado de campos.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use secrecy::Secret;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Clave de cifrado de 32 bytes para XChaCha20-Poly1305.
/// Se zeroiza automáticamente al salir del scope gracias a ZeroizeOnDrop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct EncKey(pub [u8; 32]);

/// Estado interno del vault cuando está desbloqueado.
/// Contiene la conexión SQLCipher y la clave de cifrado de campos.
pub struct VaultState {
    /// Conexión activa a la base de datos SQLCipher
    pub connection: Connection,
    /// Clave de cifrado para campos sensibles (envuelta en Secret para protección en memoria)
    pub enc_key: Secret<EncKey>,
    /// Ruta al archivo de la base de datos
    pub db_path: PathBuf,
}

/// Estado global de la aplicación gestionado por Tauri.
/// El vault es None cuando está bloqueado y Some cuando está desbloqueado.
pub struct AppState {
    pub vault: Mutex<Option<VaultState>>,
}

impl AppState {
    /// Crea un nuevo estado con el vault bloqueado (None).
    pub fn new() -> Self {
        Self {
            vault: Mutex::new(None),
        }
    }
}
