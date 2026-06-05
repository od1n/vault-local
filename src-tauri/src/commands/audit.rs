// Auditoría de contraseñas y verificación de filtraciones (HIBP).
// Analiza todas las entradas del vault para detectar contraseñas débiles,
// duplicadas y antiguas, y opcionalmente verifica si han sido filtradas.

use std::collections::HashMap;

use chrono::Utc;
use secrecy::ExposeSecret;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::crypto::cipher;
use crate::db::models::EntryData;
use crate::db::repository;
use crate::state::AppState;

/// Lista de contraseñas comunes más usadas (top 20).
/// Se usa para detectar contraseñas triviales que cualquier atacante probaría primero.
const COMMON_PASSWORDS: &[&str] = &[
    "123456",
    "password",
    "12345678",
    "qwerty",
    "123456789",
    "12345",
    "1234",
    "111111",
    "1234567",
    "dragon",
    "123123",
    "baseball",
    "abc123",
    "football",
    "monkey",
    "letmein",
    "shadow",
    "master",
    "666666",
    "qwerty123",
];

/// Umbral en días para considerar una contraseña como antigua.
const OLD_PASSWORD_DAYS: i64 = 90;

/// Umbral en días para considerar una contraseña antigua en el resumen rápido.
const OLD_PASSWORD_DAYS_SUMMARY: i64 = 180;

/// Resumen ligero de la auditoría para mostrar alertas rápidas al desbloquear.
#[derive(Serialize)]
pub struct AuditSummary {
    /// Número total de entradas en el vault
    pub total_entries: u32,
    /// Contraseñas débiles detectadas
    pub weak_passwords: u32,
    /// Contraseñas duplicadas (entradas que comparten contraseña)
    pub duplicate_passwords: u32,
    /// Contraseñas no actualizadas en más de 180 días
    pub old_passwords: u32,
    /// Puntuación general de salud (0-100)
    pub score: u32,
}

/// Resultado completo de la auditoría de contraseñas.
#[derive(Serialize)]
pub struct AuditResult {
    /// Número total de entradas en el vault
    pub total_entries: u32,
    /// Número total de campos de tipo contraseña analizados
    pub total_passwords: u32,
    /// Contraseñas débiles detectadas
    pub weak: Vec<AuditIssue>,
    /// Grupos de contraseñas duplicadas
    pub duplicated: Vec<AuditDuplicate>,
    /// Contraseñas que no se han cambiado en más de 90 días
    pub old: Vec<AuditIssue>,
    /// Puntuación general de salud (0-100, donde 100 es perfecto)
    pub score: u32,
}

/// Problema individual detectado en una contraseña.
#[derive(Serialize)]
pub struct AuditIssue {
    /// ID de la entrada afectada
    pub entry_id: String,
    /// Título de la entrada (para mostrar en la UI)
    pub entry_title: String,
    /// Nombre del campo con el problema
    pub field_name: String,
    /// Descripción del problema en español
    pub reason: String,
}

/// Grupo de entradas que comparten la misma contraseña.
#[derive(Serialize)]
pub struct AuditDuplicate {
    /// Hash SHA-256 de la contraseña (para agrupar, NO es la contraseña real)
    pub password_hash: String,
    /// Entradas que usan esta misma contraseña
    pub entries: Vec<AuditDuplicateEntry>,
}

/// Entrada individual dentro de un grupo de contraseñas duplicadas.
#[derive(Serialize)]
pub struct AuditDuplicateEntry {
    /// ID de la entrada
    pub entry_id: String,
    /// Título de la entrada
    pub entry_title: String,
    /// Nombre del campo con la contraseña duplicada
    pub field_name: String,
}

/// Resultado de la verificación HIBP para una contraseña filtrada.
/// NOTA: Esta es la ÚNICA funcionalidad de la aplicación que realiza una petición de red.
/// Se envían solo los primeros 5 caracteres del hash SHA-1 a la API de HIBP (k-anonymity),
/// nunca el hash completo ni la contraseña.
#[derive(Serialize)]
pub struct HibpResult {
    /// ID de la entrada afectada
    pub entry_id: String,
    /// Título de la entrada
    pub entry_title: String,
    /// Nombre del campo con la contraseña filtrada
    pub field_name: String,
    /// Número de veces que la contraseña apareció en filtraciones conocidas
    pub breach_count: u32,
}

/// Ejecuta una auditoría completa de todas las contraseñas del vault.
///
/// Analiza:
/// - **Debilidad**: longitud, variedad de caracteres, patrones comunes
/// - **Duplicados**: contraseñas reutilizadas entre entradas (comparación por hash SHA-256)
/// - **Antigüedad**: entradas no actualizadas en más de 90 días
///
/// Calcula un puntaje de salud general de 0 a 100.
#[tauri::command]
pub fn run_password_audit(state: tauri::State<'_, AppState>) -> Result<AuditResult, String> {
    // Obtener el vault desbloqueado
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = guard
        .as_ref()
        .ok_or("El vault está bloqueado. Desbloquéelo primero.".to_string())?;

    let enc_key = &vault.enc_key.expose_secret().0;

    // Cargar todas las entradas del vault
    let entries_meta = repository::list_entries(&vault.connection, None, None)?;
    let total_entries = entries_meta.len() as u32;

    let mut weak: Vec<AuditIssue> = Vec::new();
    let mut old: Vec<AuditIssue> = Vec::new();
    // Mapa de hash SHA-256 -> lista de entradas que comparten esa contraseña
    let mut hash_groups: HashMap<String, Vec<AuditDuplicateEntry>> = HashMap::new();
    let mut total_passwords: u32 = 0;

    let now = Utc::now();

    for entry_meta in &entries_meta {
        // Obtener y descifrar los datos de la entrada
        let (_category, _title, encrypted_data, _favorite, _created_at, updated_at) =
            repository::get_entry_raw(&vault.connection, &entry_meta.id)?;

        let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
        let entry_data: EntryData = serde_json::from_slice(&decrypted)
            .map_err(|e| format!("Error al deserializar entrada '{}': {}", entry_meta.id, e))?;

        // Filtrar campos de tipo contraseña (excluyendo seed_phrase y security_qa)
        for field in &entry_data.fields {
            let es_password = field.field_type == "password"
                || (field.sensitive
                    && field.field_type != "seed_phrase"
                    && field.field_type != "security_qa"
                    && field.field_type != "totp");

            if !es_password || field.value.is_empty() {
                continue;
            }

            total_passwords += 1;
            let password = &field.value;

            // --- Detección de contraseñas débiles ---
            let mut razones: Vec<String> = Vec::new();

            // Verificar longitud
            if password.len() < 8 {
                razones.push("Muy corta (menos de 8 caracteres)".to_string());
            } else if password.len() < 12 {
                razones.push("Corta (menos de 12 caracteres)".to_string());
            }

            // Verificar variedad de caracteres
            let tiene_mayusculas = password.chars().any(|c| c.is_ascii_uppercase());
            let tiene_minusculas = password.chars().any(|c| c.is_ascii_lowercase());
            let tiene_numeros = password.chars().any(|c| c.is_ascii_digit());
            let tiene_simbolos = password.chars().any(|c| !c.is_alphanumeric());

            if !tiene_mayusculas {
                razones.push("Sin mayúsculas".to_string());
            }
            if !tiene_minusculas {
                razones.push("Sin minúsculas".to_string());
            }
            if !tiene_numeros {
                razones.push("Sin números".to_string());
            }
            if !tiene_simbolos {
                razones.push("Sin símbolos especiales".to_string());
            }

            // Verificar si solo contiene letras o solo números
            let solo_letras = password.chars().all(|c| c.is_ascii_alphabetic());
            let solo_numeros = password.chars().all(|c| c.is_ascii_digit());
            if solo_letras || solo_numeros {
                razones.push("Poca variedad de caracteres".to_string());
            }

            // Verificar contra contraseñas comunes
            let password_lower = password.to_lowercase();
            if COMMON_PASSWORDS.contains(&password_lower.as_str()) {
                razones.push("Contraseña común".to_string());
            }

            // Agregar cada razón como un issue separado
            for razon in &razones {
                weak.push(AuditIssue {
                    entry_id: entry_meta.id.clone(),
                    entry_title: entry_meta.title.clone(),
                    field_name: field.name.clone(),
                    reason: razon.clone(),
                });
            }

            // --- Detección de duplicados (hash SHA-256) ---
            let mut hasher = Sha256::new();
            hasher.update(password.as_bytes());
            let hash_hex = hex::encode(hasher.finalize());

            hash_groups
                .entry(hash_hex)
                .or_default()
                .push(AuditDuplicateEntry {
                    entry_id: entry_meta.id.clone(),
                    entry_title: entry_meta.title.clone(),
                    field_name: field.name.clone(),
                });

            // --- Detección de contraseñas antiguas ---
            if let Ok(fecha_actualizado) = chrono::DateTime::parse_from_rfc3339(&updated_at) {
                let dias = (now - fecha_actualizado.with_timezone(&Utc)).num_days();
                if dias > OLD_PASSWORD_DAYS {
                    old.push(AuditIssue {
                        entry_id: entry_meta.id.clone(),
                        entry_title: entry_meta.title.clone(),
                        field_name: field.name.clone(),
                        reason: "No se ha cambiado en más de 90 días".to_string(),
                    });
                }
            }
        }
    }

    // Filtrar solo los grupos con más de una entrada (duplicados reales)
    let duplicated: Vec<AuditDuplicate> = hash_groups
        .into_iter()
        .filter(|(_, entries)| entries.len() > 1)
        .map(|(hash, entries)| AuditDuplicate {
            password_hash: hash,
            entries,
        })
        .collect();

    // Calcular el puntaje de salud general
    // Penalizaciones: contraseñas débiles (-10), grupos duplicados (-15), antiguas (-5)
    let penalizacion_debiles = weak.len() as i32 * 10;
    let penalizacion_duplicados = duplicated.len() as i32 * 15;
    let penalizacion_antiguas = old.len() as i32 * 5;
    let score_raw = 100 - penalizacion_debiles - penalizacion_duplicados - penalizacion_antiguas;
    let score = score_raw.clamp(0, 100) as u32;

    Ok(AuditResult {
        total_entries,
        total_passwords,
        weak,
        duplicated,
        old,
        score,
    })
}

/// Genera un resumen rápido de la salud de las contraseñas del vault.
///
/// A diferencia de `run_password_audit`, este comando es ligero y rápido:
/// - Solo cuenta problemas, no devuelve detalles individuales
/// - Usa un umbral de 180 días para contraseñas antiguas (más permisivo)
/// - No realiza verificaciones HIBP
///
/// Diseñado para ejecutarse en segundo plano al desbloquear el vault
/// y mostrar una alerta rápida al usuario.
#[tauri::command]
pub fn quick_audit_summary(state: tauri::State<'_, AppState>) -> Result<AuditSummary, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = guard
        .as_ref()
        .ok_or("El vault está bloqueado. Desbloquéelo primero.".to_string())?;

    let enc_key = &vault.enc_key.expose_secret().0;

    let entries_meta = repository::list_entries(&vault.connection, None, None)?;
    let total_entries = entries_meta.len() as u32;

    let mut weak_count: u32 = 0;
    let mut old_count: u32 = 0;
    let mut hash_groups: HashMap<String, u32> = HashMap::new();

    let now = Utc::now();

    for entry_meta in &entries_meta {
        let (_category, _title, encrypted_data, _favorite, _created_at, updated_at) =
            repository::get_entry_raw(&vault.connection, &entry_meta.id)?;

        let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
        let entry_data: EntryData = serde_json::from_slice(&decrypted)
            .map_err(|e| format!("Error al deserializar entrada '{}': {}", entry_meta.id, e))?;

        for field in &entry_data.fields {
            let es_password = field.field_type == "password"
                || (field.sensitive
                    && field.field_type != "seed_phrase"
                    && field.field_type != "security_qa"
                    && field.field_type != "totp");

            if !es_password || field.value.is_empty() {
                continue;
            }

            let password = &field.value;

            // Detección simplificada de debilidad
            let es_debil = password.len() < 8
                || !password.chars().any(|c| c.is_ascii_uppercase())
                || !password.chars().any(|c| c.is_ascii_lowercase())
                || !password.chars().any(|c| c.is_ascii_digit())
                || !password.chars().any(|c| !c.is_alphanumeric())
                || COMMON_PASSWORDS.contains(&password.to_lowercase().as_str());

            if es_debil {
                weak_count += 1;
            }

            // Detección de duplicados por hash
            let mut hasher = Sha256::new();
            hasher.update(password.as_bytes());
            let hash_hex = hex::encode(hasher.finalize());
            *hash_groups.entry(hash_hex).or_insert(0) += 1;

            // Detección de antigüedad (180 días)
            if let Ok(fecha) = chrono::DateTime::parse_from_rfc3339(&updated_at) {
                if (now - fecha.with_timezone(&Utc)).num_days() > OLD_PASSWORD_DAYS_SUMMARY {
                    old_count += 1;
                }
            }
        }
    }

    // Contar contraseñas duplicadas (entradas en grupos con > 1)
    let duplicate_count: u32 = hash_groups
        .values()
        .filter(|&&count| count > 1)
        .map(|&count| count)
        .sum();

    // Calcular puntuación
    let penalizacion = weak_count as i32 * 10
        + hash_groups.values().filter(|&&c| c > 1).count() as i32 * 15
        + old_count as i32 * 5;
    let score = (100 - penalizacion).clamp(0, 100) as u32;

    Ok(AuditSummary {
        total_entries,
        weak_passwords: weak_count,
        duplicate_passwords: duplicate_count,
        old_passwords: old_count,
        score,
    })
}

/// Calcula el hash SHA-1 de un texto y lo devuelve en hexadecimal mayúsculas.
/// Se usa internamente para el protocolo k-anonymity de HIBP.
fn sha1_hex(input: &str) -> String {
    use sha1::Digest;
    let mut hasher = sha1::Sha1::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(result).to_uppercase()
}

/// Verifica si las contraseñas del vault han sido filtradas en brechas de seguridad conocidas.
///
/// Usa el servicio Have I Been Pwned (HIBP) con el protocolo k-anonymity:
/// - Solo se envían los primeros 5 caracteres del hash SHA-1 de cada contraseña
/// - NUNCA se envía el hash completo ni la contraseña en texto plano
/// - La API devuelve todos los sufijos que coinciden con ese prefijo
/// - La verificación final se hace localmente
///
/// **IMPORTANTE**: Esta es la ÚNICA funcionalidad de la aplicación que realiza peticiones de red.
/// El usuario debe activarla explícitamente (botón "Verificar filtraciones").
///
/// Se aplica un retardo de 100ms entre peticiones para respetar los límites de la API.
#[tauri::command]
pub fn check_hibp(state: tauri::State<'_, AppState>) -> Result<Vec<HibpResult>, String> {
    // Obtener el vault desbloqueado
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = guard
        .as_ref()
        .ok_or("El vault está bloqueado. Desbloquéelo primero.".to_string())?;

    let enc_key = &vault.enc_key.expose_secret().0;

    // Cargar todas las entradas
    let entries_meta = repository::list_entries(&vault.connection, None, None)?;
    let mut resultados: Vec<HibpResult> = Vec::new();
    let mut es_primera_peticion = true;

    // Crear cliente HTTP para las peticiones a la API de HIBP
    let client = reqwest::blocking::Client::builder()
        .user_agent("VaultLocal-PasswordManager")
        .build()
        .map_err(|e| format!("Error al crear cliente HTTP: {}", e))?;

    for entry_meta in &entries_meta {
        // Obtener y descifrar los datos de la entrada
        let (_category, _title, encrypted_data, _favorite, _created_at, _updated_at) =
            repository::get_entry_raw(&vault.connection, &entry_meta.id)?;

        let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
        let entry_data: EntryData = serde_json::from_slice(&decrypted)
            .map_err(|e| format!("Error al deserializar entrada '{}': {}", entry_meta.id, e))?;

        // Verificar cada campo de tipo contraseña
        for field in &entry_data.fields {
            let es_password = field.field_type == "password"
                || (field.sensitive
                    && field.field_type != "seed_phrase"
                    && field.field_type != "security_qa"
                    && field.field_type != "totp");

            if !es_password || field.value.is_empty() {
                continue;
            }

            // Respetar los límites de la API con un retardo entre peticiones
            if !es_primera_peticion {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            es_primera_peticion = false;

            // Calcular el hash SHA-1 completo de la contraseña
            let hash_completo = sha1_hex(&field.value);
            let prefijo = &hash_completo[..5];
            let sufijo = &hash_completo[5..];

            // Consultar la API de HIBP con el prefijo (k-anonymity)
            let url = format!("https://api.pwnedpasswords.com/range/{}", prefijo);
            let respuesta = client
                .get(&url)
                .send()
                .map_err(|e| format!("Error al consultar HIBP: {}", e))?;

            if !respuesta.status().is_success() {
                return Err(format!(
                    "La API de HIBP respondió con código {}: {}",
                    respuesta.status(),
                    respuesta
                        .text()
                        .unwrap_or_else(|_| "sin detalle".to_string())
                ));
            }

            let cuerpo = respuesta
                .text()
                .map_err(|e| format!("Error al leer respuesta de HIBP: {}", e))?;

            // Buscar si el sufijo del hash aparece en la respuesta
            // Cada línea tiene el formato: SUFIJO:CANTIDAD
            for linea in cuerpo.lines() {
                let partes: Vec<&str> = linea.trim().split(':').collect();
                if partes.len() == 2 && partes[0] == sufijo {
                    let cantidad: u32 = partes[1].parse().unwrap_or(0);
                    if cantidad > 0 {
                        resultados.push(HibpResult {
                            entry_id: entry_meta.id.clone(),
                            entry_title: entry_meta.title.clone(),
                            field_name: field.name.clone(),
                            breach_count: cantidad,
                        });
                    }
                    break;
                }
            }
        }
    }

    Ok(resultados)
}
