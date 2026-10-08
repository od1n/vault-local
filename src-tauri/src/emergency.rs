// Acceso de emergencia (gratis): 2 de 3 partes abren la bóveda en modo solo lectura.
//
// Modelo de seguridad:
// - Se genera una clave de recuperación aleatoria de 256 bits (rk). Con ella se cifran las
//   claves de la bóveda (db_key || enc_key) y el resultado se guarda en `vault.recovery`,
//   junto a vault.db. Ese archivo, solo, no sirve para nada.
// - rk se divide con Shamir (umbral 2, 3 partes) sobre GF(256). Una parte sola no revela
//   NADA de rk (seguridad de teoría de la información); dos partes cualesquiera la reconstruyen.
// - Cada parte se imprime como 24 palabras BIP39 (con suma de verificación, detecta errores
//   al escribir) más un código para QR. Se entregan a personas distintas.
// - rk también se guarda DENTRO de la bóveda (cifrada con enc_key) para poder volver a
//   envolver las claves cuando cambia la contraseña maestra, sin reimprimir las partes.
// - Generar partes nuevas reemplaza vault.recovery: las partes anteriores dejan de servir
//   para la bóveda actual (pero sí abrirían respaldos antiguos que tengan el archivo viejo).
// - La bóveda abierta así queda en solo lectura a nivel de SQLite (PRAGMA query_only).

use std::fs;
use std::path::{Path, PathBuf};

use rand::rngs::OsRng;
use rand::RngCore;
use secrecy::{ExposeSecret, Secret};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::{cipher, kdf};
use crate::db::repository;
use crate::state::{AppState, EncKey, VaultState};

const RECOVERY_FILE: &str = "vault.recovery";
const RK_CONFIG_KEY: &str = "emergency_rk";
const CODE_PREFIX: &str = "VLR1";
const PARTS: u8 = 3;
const THRESHOLD: usize = 2;

/// Clave de recuperación junto con su identificador de juego de partes.
pub type RecoveryKey = ([u8; 4], Zeroizing<[u8; 32]>);

// ---------------------------------------------------------------------------
// Shamir sobre GF(2^8) (polinomio de AES, 0x11b)
// ---------------------------------------------------------------------------

fn gf_mul(mut a: u8, mut b: u8) -> u8 {
    let mut p = 0u8;
    while b != 0 {
        if b & 1 != 0 {
            p ^= a;
        }
        let hi = a & 0x80;
        a <<= 1;
        if hi != 0 {
            a ^= 0x1b;
        }
        b >>= 1;
    }
    p
}

fn gf_inv(a: u8) -> u8 {
    // a^254 = a^-1 en GF(256) (a != 0)
    let mut r = 1u8;
    let mut base = a;
    let mut e = 254u8;
    while e > 0 {
        if e & 1 != 0 {
            r = gf_mul(r, base);
        }
        base = gf_mul(base, base);
        e >>= 1;
    }
    r
}

/// Divide `secret` en `n` partes con umbral `k`. Devuelve (x, y) con x = 1..=n.
fn split(secret: &[u8; 32], k: usize, n: u8) -> Vec<(u8, Zeroizing<[u8; 32]>)> {
    let mut coeffs = Zeroizing::new(vec![[0u8; 32]; k - 1]);
    for c in coeffs.iter_mut() {
        OsRng.fill_bytes(c);
    }
    (1..=n)
        .map(|x| {
            let mut y = Zeroizing::new([0u8; 32]);
            for i in 0..32 {
                // Horner: f(x) = s + a1 x + a2 x^2 ...
                let mut acc = 0u8;
                for c in coeffs.iter().rev() {
                    acc = gf_mul(acc, x) ^ c[i];
                }
                y[i] = gf_mul(acc, x) ^ secret[i];
            }
            (x, y)
        })
        .collect()
}

/// Reconstruye el secreto con interpolación de Lagrange en x = 0.
fn combine(shares: &[(u8, [u8; 32])]) -> Result<Zeroizing<[u8; 32]>, String> {
    if shares.len() < THRESHOLD {
        return Err(format!("Hacen falta {} partes distintas", THRESHOLD));
    }
    for (i, a) in shares.iter().enumerate() {
        if a.0 == 0 {
            return Err("Número de parte no válido".to_string());
        }
        if shares[..i].iter().any(|b| b.0 == a.0) {
            return Err(
                "Escribiste dos veces la misma parte: hacen falta dos partes distintas".to_string(),
            );
        }
    }
    let mut out = Zeroizing::new([0u8; 32]);
    for (j, (xj, yj)) in shares.iter().enumerate() {
        let mut num = 1u8;
        let mut den = 1u8;
        for (m, (xm, _)) in shares.iter().enumerate() {
            if m != j {
                num = gf_mul(num, *xm);
                den = gf_mul(den, xj ^ xm);
            }
        }
        let l = gf_mul(num, gf_inv(den));
        for i in 0..32 {
            out[i] ^= gf_mul(yj[i], l);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Archivo vault.recovery
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct RecoveryFile {
    v: u8,
    key_id: String,
    created_at: String,
    /// hex(nonce || XChaCha20-Poly1305(rk, db_key || enc_key))
    wrap: String,
}

pub fn recovery_path_for(db_path: &Path) -> PathBuf {
    db_path.with_file_name(RECOVERY_FILE)
}

fn read_file(path: &Path) -> Result<RecoveryFile, String> {
    let s = fs::read_to_string(path).map_err(|_| {
        "No se encontró el archivo de acceso de emergencia (vault.recovery)".to_string()
    })?;
    let f: RecoveryFile = serde_json::from_str(&s)
        .map_err(|_| "El archivo vault.recovery está dañado".to_string())?;
    if f.v != 1 {
        return Err("Versión de vault.recovery no compatible".to_string());
    }
    Ok(f)
}

fn write_file(path: &Path, f: &RecoveryFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(f).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("recovery.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Error al guardar vault.recovery: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Error al guardar vault.recovery: {}", e))
}

fn wrap_keys(rk: &[u8; 32], db_key: &[u8; 32], enc_key: &[u8; 32]) -> Result<String, String> {
    let mut material = Zeroizing::new([0u8; 64]);
    material[..32].copy_from_slice(db_key);
    material[32..].copy_from_slice(enc_key);
    Ok(hex::encode(cipher::encrypt(rk, &material[..])?))
}

/// Guarda rk dentro de la bóveda: key_id (4 bytes) || rk (32), cifrado con enc_key.
fn store_rk(
    conn: &rusqlite::Connection,
    enc_key: &[u8; 32],
    key_id: &[u8; 4],
    rk: &[u8; 32],
) -> Result<(), String> {
    let mut plain = Zeroizing::new([0u8; 36]);
    plain[..4].copy_from_slice(key_id);
    plain[4..].copy_from_slice(rk);
    let blob = cipher::encrypt(enc_key, &plain[..])?;
    repository::save_config(conn, RK_CONFIG_KEY, &blob)
}

fn load_rk(conn: &rusqlite::Connection, enc_key: &[u8; 32]) -> Option<RecoveryKey> {
    let blob = repository::get_config(conn, RK_CONFIG_KEY).ok().flatten()?;
    let plain = Zeroizing::new(cipher::decrypt(enc_key, &blob).ok()?);
    if plain.len() != 36 {
        return None;
    }
    let mut id = [0u8; 4];
    id.copy_from_slice(&plain[..4]);
    let mut rk = Zeroizing::new([0u8; 32]);
    rk.copy_from_slice(&plain[4..]);
    Some((id, rk))
}

/// Dentro de la transacción del cambio de contraseña: vuelve a cifrar rk con la enc_key nueva.
/// Devuelve rk para envolver de nuevo las claves en vault.recovery cuando termine el cambio.
pub fn reencrypt_rk(
    conn: &rusqlite::Connection,
    old_enc: &[u8; 32],
    new_enc: &[u8; 32],
) -> Result<Option<RecoveryKey>, String> {
    match load_rk(conn, old_enc) {
        Some((id, rk)) => {
            store_rk(conn, new_enc, &id, &rk)?;
            Ok(Some((id, rk)))
        }
        None => Ok(None),
    }
}

/// Escribe vault.recovery en `path` envolviendo las claves indicadas (conserva la fecha).
fn write_wrap(
    path: &Path,
    created_from: &Path,
    rk: &RecoveryKey,
    db_key: &[u8; 32],
    enc_key: &[u8; 32],
) -> Result<(), String> {
    let created_at = read_file(created_from)
        .map(|f| f.created_at)
        .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
    write_file(
        path,
        &RecoveryFile {
            v: 1,
            key_id: hex::encode(rk.0),
            created_at,
            wrap: wrap_keys(&rk.1, db_key, enc_key)?,
        },
    )
}

fn pending_path_for(db_path: &Path) -> PathBuf {
    db_path.with_file_name("vault.recovery.new")
}

/// Cambio de contraseña: prepara vault.recovery con las claves nuevas (se activa al final).
pub fn write_pending(
    db_path: &Path,
    rk: &RecoveryKey,
    new_db_key: &[u8; 32],
    new_enc_key: &[u8; 32],
) -> Result<(), String> {
    write_wrap(
        &pending_path_for(db_path),
        &recovery_path_for(db_path),
        rk,
        new_db_key,
        new_enc_key,
    )
}

/// Cambio de contraseña terminado: activa el vault.recovery preparado.
pub fn commit_pending(db_path: &Path) {
    let pending = pending_path_for(db_path);
    if pending.exists() {
        if let Err(e) = fs::rename(&pending, recovery_path_for(db_path)) {
            eprintln!("[Emergencia] No se pudo activar vault.recovery: {}", e);
        }
    }
}

/// Cambio de contraseña descartado.
pub fn discard_pending(db_path: &Path) {
    let _ = fs::remove_file(pending_path_for(db_path));
}

/// Comprueba que vault.recovery abre de verdad las claves actuales.
fn wrap_matches(file: &RecoveryFile, rk: &[u8; 32], db_key: &[u8; 32], enc_key: &[u8; 32]) -> bool {
    hex::decode(&file.wrap)
        .ok()
        .and_then(|w| cipher::decrypt(rk, &w).ok())
        .map(Zeroizing::new)
        .map(|m| m.len() == 64 && m[..32] == db_key[..] && m[32..] == enc_key[..])
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Formato de las partes
// ---------------------------------------------------------------------------

fn format_key_id(id: &str) -> String {
    let up = id.to_uppercase();
    if up.len() == 8 {
        format!("{}-{}", &up[..4], &up[4..])
    } else {
        up
    }
}

/// Interpreta una parte escrita: código "VLR1:<id>:<parte>:<hex>" o 24 palabras + número de parte.
fn parse_share(input: &ShareInput) -> Result<(Option<String>, u8, [u8; 32]), String> {
    let text = input.text.trim();
    if text.to_uppercase().starts_with(CODE_PREFIX) {
        let parts: Vec<&str> = text.split(':').map(|p| p.trim()).collect();
        if parts.len() != 4 {
            return Err("El código de la parte está incompleto".to_string());
        }
        let x: u8 = parts[2]
            .parse()
            .map_err(|_| "Número de parte no válido".to_string())?;
        let bytes =
            hex::decode(parts[3]).map_err(|_| "El código de la parte está dañado".to_string())?;
        if bytes.len() != 32 || x == 0 || x > PARTS {
            return Err("El código de la parte está dañado".to_string());
        }
        let mut y = [0u8; 32];
        y.copy_from_slice(&bytes);
        return Ok((Some(parts[1].to_lowercase()), x, y));
    }
    let x = input
        .part
        .ok_or("Indica el número de cada parte (1, 2 o 3)")?;
    if x == 0 || x > PARTS {
        return Err("El número de parte debe ser 1, 2 o 3".to_string());
    }
    let normalized = text
        .split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == '-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            w.trim_start_matches(|c: char| c.is_ascii_digit())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>();
    if normalized.len() != 24 {
        return Err(format!(
            "La parte {} debe tener 24 palabras (tiene {})",
            x,
            normalized.len()
        ));
    }
    let m = bip39::Mnemonic::parse_normalized(&normalized.join(" ")).map_err(|_| {
        format!(
            "La parte {} tiene una palabra mal escrita o en otro orden. Revísala con la hoja impresa.",
            x
        )
    })?;
    let ent = Zeroizing::new(m.to_entropy());
    if ent.len() != 32 {
        return Err("Parte no válida".to_string());
    }
    let mut y = [0u8; 32];
    y.copy_from_slice(&ent);
    Ok((None, x, y))
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct EmergencyStatus {
    pub configured: bool,
    pub key_id: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct ShareOut {
    pub part: u8,
    pub words: Vec<String>,
    pub code: String,
}

#[derive(Serialize)]
pub struct EmergencySetup {
    pub key_id: String,
    pub created_at: String,
    pub vault_name: String,
    pub shares: Vec<ShareOut>,
}

#[derive(Deserialize)]
pub struct ShareInput {
    pub part: Option<u8>,
    pub text: String,
}

#[derive(Deserialize)]
pub struct EmergencySource {
    /// Bóveda de este equipo (por id)
    pub vault_id: Option<String>,
    /// Archivo .db de un respaldo (junto a él debe estar el .recovery)
    pub db_file: Option<String>,
}

#[derive(Serialize)]
pub struct EmergencyCandidate {
    pub id: String,
    pub name: String,
}

fn with_open<T>(
    state: &AppState,
    f: impl FnOnce(&VaultState) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
    f(vault)
}

fn check_master(vault: &VaultState, password: &str) -> Result<(), String> {
    let salt = fs::read(crate::commands::auth::salt_path_for(&vault.db_path))
        .map_err(|e| format!("Error al leer salt: {}", e))?;
    let (mut db_key, mut enc_key) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;
    db_key.zeroize();
    let ok = crate::commands::auth::verify_token(&vault.connection, &enc_key);
    enc_key.zeroize();
    if ok {
        Ok(())
    } else {
        Err("Contraseña maestra incorrecta".to_string())
    }
}

#[tauri::command]
pub fn emergency_status(state: tauri::State<'_, AppState>) -> Result<EmergencyStatus, String> {
    with_open(&state, |vault| {
        let enc = &vault.enc_key.expose_secret().0;
        let db = &vault.db_key.expose_secret().0;
        let path = recovery_path_for(&vault.db_path);
        let file = read_file(&path).ok();
        let inner = load_rk(&vault.connection, enc);
        match (file, inner) {
            (Some(f), Some(rk)) if f.key_id == hex::encode(rk.0) => {
                // Si vault.recovery quedó con claves anteriores (por ejemplo, un cambio de
                // contraseña que no pudo escribirlo), repararlo ahora que la bóveda está abierta
                if !wrap_matches(&f, &rk.1, db, enc) {
                    if vault.read_only {
                        return Err("El acceso de emergencia necesita revisión".to_string());
                    }
                    write_wrap(&path, &path, &rk, db, enc)?;
                }
                Ok(EmergencyStatus {
                    configured: true,
                    key_id: Some(format_key_id(&f.key_id)),
                    created_at: Some(f.created_at),
                })
            }
            _ => Ok(EmergencyStatus {
                configured: false,
                key_id: None,
                created_at: None,
            }),
        }
    })
}

/// Crea (o reemplaza) el acceso de emergencia y devuelve las 3 partes para imprimir.
/// Las partes NO se guardan en ningún sitio: se muestran una sola vez.
#[tauri::command]
pub async fn emergency_setup(
    app: tauri::AppHandle,
    password: String,
) -> Result<EmergencySetup, String> {
    // Argon2 fuera del hilo principal
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let mut password = password;
        let result = with_open(&state, |vault| {
            if vault.read_only {
                return Err("No disponible en modo solo lectura".to_string());
            }
            check_master(vault, &password)?;

            let mut rk = Zeroizing::new([0u8; 32]);
            OsRng.fill_bytes(&mut rk[..]);
            let mut id = [0u8; 4];
            OsRng.fill_bytes(&mut id);
            let key_id = hex::encode(id);
            let enc = &vault.enc_key.expose_secret().0;
            let db = &vault.db_key.expose_secret().0;
            let created_at = chrono::Utc::now().to_rfc3339();

            // Primero dentro de la bóveda, luego el archivo (si falla el archivo, el estado
            // muestra "no configurado" porque los key_id no coinciden)
            store_rk(&vault.connection, enc, &id, &rk)?;
            write_file(
                &recovery_path_for(&vault.db_path),
                &RecoveryFile {
                    v: 1,
                    key_id: key_id.clone(),
                    created_at: created_at.clone(),
                    wrap: wrap_keys(&rk, db, enc)?,
                },
            )?;

            let shares = split(&rk, THRESHOLD, PARTS)
                .into_iter()
                .map(|(x, y)| {
                    let words = bip39::Mnemonic::from_entropy(&y[..])
                        .map(|m| m.words().map(String::from).collect::<Vec<_>>())
                        .map_err(|e| e.to_string())?;
                    Ok(ShareOut {
                        part: x,
                        words,
                        code: format!("{}:{}:{}:{}", CODE_PREFIX, key_id, x, hex::encode(&y[..])),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;

            Ok(EmergencySetup {
                key_id: format_key_id(&key_id),
                created_at,
                vault_name: vault.name.clone(),
                shares,
            })
        });
        password.zeroize();
        result
    })
    .await
    .map_err(|e| format!("Error interno: {}", e))?
}

/// Desactiva el acceso de emergencia: las partes impresas dejan de servir.
#[tauri::command]
pub async fn emergency_disable(app: tauri::AppHandle, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let mut password = password;
        let result = with_open(&state, |vault| {
            if vault.read_only {
                return Err("No disponible en modo solo lectura".to_string());
            }
            check_master(vault, &password)?;
            repository::delete_config(&vault.connection, RK_CONFIG_KEY)?;
            let path = recovery_path_for(&vault.db_path);
            if path.exists() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Error al borrar vault.recovery: {}", e))?;
            }
            Ok(())
        });
        password.zeroize();
        result
    })
    .await
    .map_err(|e| format!("Error interno: {}", e))?
}

/// Bóvedas de este equipo que tienen acceso de emergencia configurado.
#[tauri::command]
pub fn emergency_candidates(app: tauri::AppHandle) -> Vec<EmergencyCandidate> {
    crate::vaults::list_vaults(app.clone())
        .vaults
        .into_iter()
        .filter(|v| {
            crate::vaults::dir_for(&app, &v.id)
                .map(|d| d.join(RECOVERY_FILE).exists() && d.join("vault.db").exists())
                .unwrap_or(false)
        })
        .map(|v| EmergencyCandidate {
            id: v.id,
            name: v.name,
        })
        .collect()
}

/// Busca el archivo .recovery que acompaña a un .db de respaldo.
fn recovery_for_backup(db_file: &Path) -> Option<PathBuf> {
    let same_stem = db_file.with_extension("recovery");
    if same_stem.exists() {
        return Some(same_stem);
    }
    let sibling = db_file.with_file_name(RECOVERY_FILE);
    sibling.exists().then_some(sibling)
}

/// Abre una bóveda en modo solo lectura con 2 de las 3 partes.
#[tauri::command]
pub async fn emergency_open(
    app: tauri::AppHandle,
    source: EmergencySource,
    shares: Vec<ShareInput>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        let mut shares = shares;
        if state.vault.lock().map(|g| g.is_some()).unwrap_or(true) {
            return Err("Bloquea la bóveda abierta antes de usar el acceso de emergencia".to_string());
        }

        let (db_path, rec_path, name) = match (&source.vault_id, &source.db_file) {
            (Some(id), _) => {
                let dir = crate::vaults::dir_for(&app, id)?;
                let name = crate::vaults::list_vaults(app.clone())
                    .vaults
                    .into_iter()
                    .find(|v| &v.id == id)
                    .map(|v| v.name)
                    .unwrap_or_else(|| "Bóveda".to_string());
                (dir.join("vault.db"), dir.join(RECOVERY_FILE), name)
            }
            (None, Some(file)) => {
                let db = PathBuf::from(file);
                if !db.is_file() {
                    return Err("No se encontró el archivo de la bóveda".to_string());
                }
                let rec = recovery_for_backup(&db).ok_or(
                    "Junto a ese archivo no está el archivo de acceso de emergencia (.recovery). Copia ambos a la misma carpeta.",
                )?;
                let name = db
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Respaldo".to_string());
                (db, rec, name)
            }
            _ => return Err("Elige qué bóveda abrir".to_string()),
        };

        let file = read_file(&rec_path)?;
        let mut parsed: Vec<(u8, [u8; 32])> = Vec::new();
        let parse_result = (|| {
            for s in shares.iter().filter(|s| !s.text.trim().is_empty()) {
                let (kid, x, y) = parse_share(s)?;
                if let Some(kid) = kid {
                    if kid != file.key_id {
                        return Err(format!(
                            "La parte {} pertenece a otro juego de partes (código {}). Este archivo usa el código {}.",
                            x,
                            format_key_id(&kid),
                            format_key_id(&file.key_id)
                        ));
                    }
                }
                parsed.push((x, y));
            }
            combine(&parsed)
        })();
        for p in parsed.iter_mut() {
            p.1.zeroize();
        }
        for s in shares.iter_mut() {
            s.text.zeroize();
        }
        let rk = parse_result?;

        // vault.recovery y, si un cambio de contraseña quedó a medias, el preparado
        let mut wraps = vec![file.wrap.clone()];
        if let Ok(f) = read_file(&rec_path.with_file_name("vault.recovery.new")) {
            if f.key_id == file.key_id {
                wraps.push(f.wrap);
            }
        }
        let mut rk_ok = false;
        let mut opened = None;
        for w in &wraps {
            let Ok(wrap) = hex::decode(w) else { continue };
            let Ok(m) = cipher::decrypt(&rk, &wrap) else { continue };
            rk_ok = true;
            let material = Zeroizing::new(m);
            if material.len() != 64 {
                continue;
            }
            let mut db_key = Zeroizing::new([0u8; 32]);
            let mut enc_key = Zeroizing::new([0u8; 32]);
            db_key.copy_from_slice(&material[..32]);
            enc_key.copy_from_slice(&material[32..]);
            if let Ok(conn) = repository::open_db(&db_path, &db_key) {
                if crate::commands::auth::verify_token(&conn, &enc_key) {
                    opened = Some((conn, db_key, enc_key));
                    break;
                }
            }
        }
        let Some((conn, db_key, enc_key)) = opened else {
            return Err(if rk_ok {
                "Las partes son correctas pero no coinciden con este archivo de bóveda (¿es un respaldo de otra fecha?)".to_string()
            } else {
                "Las partes no abren esta bóveda. Comprueba que sean del mismo juego (mismo código en la hoja) y que estén bien escritas.".to_string()
            });
        };
        // Solo lectura a nivel de base de datos: cualquier escritura falla
        conn.execute_batch("PRAGMA query_only = ON;")
            .map_err(|e| format!("Error al abrir en solo lectura: {}", e))?;

        let mut guard = state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al estado del vault".to_string())?;
        // Pudo abrirse una bóveda mientras se calculaba: no reemplazarla
        if guard.is_some() {
            return Err("Ya hay una bóveda abierta: bloquéala antes de usar el acceso de emergencia".to_string());
        }
        *guard = Some(VaultState {
            connection: conn,
            enc_key: Secret::new(EncKey(*enc_key)),
            db_key: Secret::new(EncKey(*db_key)),
            db_path,
            name: name.clone(),
            read_only: true,
        });
        Ok(name)
    })
    .await
    .map_err(|e| format!("Error interno: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gf_inverso() {
        for a in 1..=255u8 {
            assert_eq!(gf_mul(a, gf_inv(a)), 1, "a = {}", a);
        }
    }

    #[test]
    fn dos_de_tres_reconstruyen_cualquier_par() {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let shares: Vec<(u8, [u8; 32])> = split(&secret, 2, 3)
            .into_iter()
            .map(|(x, y)| (x, *y))
            .collect();
        for (a, b) in [(0, 1), (0, 2), (1, 2), (2, 0)] {
            let got = combine(&[shares[a], shares[b]]).unwrap();
            assert_eq!(*got, secret);
        }
        // Las tres juntas también
        assert_eq!(*combine(&shares).unwrap(), secret);
        // Una sola no basta; repetida tampoco
        assert!(combine(&[shares[0]]).is_err());
        assert!(combine(&[shares[1], shares[1]]).is_err());
    }

    #[test]
    fn una_parte_no_es_el_secreto() {
        let secret = [7u8; 32];
        let shares = split(&secret, 2, 3);
        assert!(shares.iter().all(|(_, y)| **y != secret));
    }

    #[test]
    fn palabras_y_codigo_ida_y_vuelta() {
        let mut y = [0u8; 32];
        OsRng.fill_bytes(&mut y);
        let words: Vec<String> = bip39::Mnemonic::from_entropy(&y)
            .unwrap()
            .words()
            .map(String::from)
            .collect();
        assert_eq!(words.len(), 24);
        // Con números, mayúsculas y saltos de línea como en la hoja impresa
        let text = words
            .iter()
            .enumerate()
            .map(|(i, w)| format!("{}. {}", i + 1, w.to_uppercase()))
            .collect::<Vec<_>>()
            .join("\n");
        let (kid, x, got) = parse_share(&ShareInput {
            part: Some(2),
            text,
        })
        .unwrap();
        assert_eq!((kid, x, got), (None, 2, y));

        let code = format!("VLR1:abcd1234:3:{}", hex::encode(y));
        let (kid, x, got) = parse_share(&ShareInput {
            part: None,
            text: code,
        })
        .unwrap();
        assert_eq!((kid.as_deref(), x, got), (Some("abcd1234"), 3, y));

        // Una palabra cambiada se detecta (suma de verificación de BIP39), salvo coincidencia rara
        let mut malas = words.clone();
        malas[5] = if malas[5] == "abandon" {
            "ability".into()
        } else {
            "abandon".into()
        };
        let r = parse_share(&ShareInput {
            part: Some(1),
            text: malas.join(" "),
        });
        if let Ok((_, _, g)) = r {
            assert_ne!(g, y);
        }
        assert!(parse_share(&ShareInput {
            part: Some(4),
            text: words.join(" ")
        })
        .is_err());
        assert!(parse_share(&ShareInput {
            part: None,
            text: words.join(" ")
        })
        .is_err());
    }

    /// Flujo completo con una base SQLCipher real: crear, preparar el acceso, abrir con
    /// dos partes en palabras y comprobar que la base queda en solo lectura.
    #[test]
    fn flujo_completo_con_base_real() {
        let dir = std::env::temp_dir().join(format!("vl-emerg-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("vault.db");
        let (db_key, enc_key) =
            kdf::derive_keys_from_password(b"maestra-larga-123", &[3u8; 32]).unwrap();
        let conn = repository::open_db(&db_path, &db_key).unwrap();
        repository::init_tables(&conn).unwrap();

        let mut rk = [0u8; 32];
        OsRng.fill_bytes(&mut rk);
        let id = [0xab, 0xcd, 0x12, 0x34];
        store_rk(&conn, &enc_key, &id, &rk).unwrap();
        let rec = recovery_path_for(&db_path);
        write_file(
            &rec,
            &RecoveryFile {
                v: 1,
                key_id: hex::encode(id),
                created_at: "x".into(),
                wrap: wrap_keys(&rk, &db_key, &enc_key).unwrap(),
            },
        )
        .unwrap();
        drop(conn);

        // Partes 1 y 3 escritas como palabras
        let shares = split(&rk, 2, 3);
        let inputs: Vec<ShareInput> = [0usize, 2]
            .iter()
            .map(|&i| ShareInput {
                part: Some(shares[i].0),
                text: bip39::Mnemonic::from_entropy(&shares[i].1[..])
                    .unwrap()
                    .words()
                    .collect::<Vec<_>>()
                    .join(" "),
            })
            .collect();
        let parsed: Vec<(u8, [u8; 32])> = inputs
            .iter()
            .map(|s| {
                let (_, x, y) = parse_share(s).unwrap();
                (x, y)
            })
            .collect();
        let got = combine(&parsed).unwrap();
        let file = read_file(&rec).unwrap();
        let m = cipher::decrypt(&got, &hex::decode(file.wrap).unwrap()).unwrap();
        let mut k1 = [0u8; 32];
        k1.copy_from_slice(&m[..32]);
        let mut k2 = [0u8; 32];
        k2.copy_from_slice(&m[32..]);
        assert_eq!((k1, k2), (db_key, enc_key));

        let conn = repository::open_db(&db_path, &k1).unwrap();
        conn.execute_batch("PRAGMA query_only = ON;").unwrap();
        assert!(
            repository::save_config(&conn, "x", b"y").is_err(),
            "debe ser solo lectura"
        );
        assert!(load_rk(&conn, &k2).is_some());

        // Cambio de contraseña: rk se vuelve a cifrar y el archivo se vuelve a envolver
        drop(conn);
        let conn = repository::open_db(&db_path, &db_key).unwrap();
        let new_enc = [5u8; 32];
        let rk2 = reencrypt_rk(&conn, &enc_key, &new_enc).unwrap();
        write_pending(&db_path, rk2.as_ref().unwrap(), &db_key, &new_enc).unwrap();
        commit_pending(&db_path);
        let file = read_file(&rec).unwrap();
        let m = cipher::decrypt(&got, &hex::decode(file.wrap).unwrap()).unwrap();
        assert_eq!(&m[32..], &new_enc, "las mismas partes siguen sirviendo");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn envoltura_ida_y_vuelta() {
        let rk = [9u8; 32];
        let db = [1u8; 32];
        let enc = [2u8; 32];
        let w = wrap_keys(&rk, &db, &enc).unwrap();
        let m = cipher::decrypt(&rk, &hex::decode(w).unwrap()).unwrap();
        assert_eq!(&m[..32], &db);
        assert_eq!(&m[32..], &enc);
    }
}
