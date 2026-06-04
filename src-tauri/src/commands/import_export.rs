// Comandos de importación y exportación de entradas del vault.
// Soporta múltiples formatos de gestores de contraseñas populares.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use chrono::Utc;
use csv::ReaderBuilder;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use tauri::Manager;
use zeroize::Zeroize;

use crate::crypto::{cipher, kdf};
use crate::db::models::{EntryData, EntryField};
use crate::db::repository;
use crate::security::validate_file_path;
use crate::state::AppState;

// ─── Resultado de importación ───────────────────────────────────────────────

/// Resultado de una operación de importación con conteos y errores detallados.
#[derive(Debug, Serialize)]
pub struct ImportResult {
    /// Cantidad de entradas importadas exitosamente
    pub imported: u32,
    /// Cantidad de entradas omitidas (vacías o duplicadas)
    pub skipped: u32,
    /// Lista de errores encontrados durante la importación
    pub errors: Vec<String>,
}

// ─── Macro auxiliar ─────────────────────────────────────────────────────────

/// Macro auxiliar para obtener el vault desbloqueado o retornar error.
/// Duplicada de vault.rs para evitar dependencias circulares.
macro_rules! with_vault {
    ($state:expr) => {{
        let guard = $state
            .vault
            .lock()
            .map_err(|_| "Error al acceder al estado del vault".to_string())?;
        if guard.is_none() {
            return Err("El vault está bloqueado. Desbloquéelo primero.".to_string());
        }
        guard
    }};
}

// ─── Estructuras auxiliares para deserialización JSON ────────────────────────

/// Estructura del archivo JSON exportado por Bitwarden.
#[derive(Debug, Deserialize)]
struct BitwardenExport {
    items: Vec<BitwardenItem>,
}

/// Entrada individual en un export de Bitwarden.
#[derive(Debug, Deserialize)]
struct BitwardenItem {
    #[serde(rename = "type")]
    item_type: u32,
    name: Option<String>,
    notes: Option<String>,
    favorite: Option<bool>,
    login: Option<BitwardenLogin>,
}

/// Datos de login de una entrada de Bitwarden.
#[derive(Debug, Deserialize)]
struct BitwardenLogin {
    uris: Option<Vec<BitwardenUri>>,
    username: Option<String>,
    password: Option<String>,
    totp: Option<String>,
}

/// URI en una entrada de Bitwarden.
#[derive(Debug, Deserialize)]
struct BitwardenUri {
    uri: Option<String>,
}

// ─── Estructura intermedia para entradas parseadas ──────────────────────────

/// Representación intermedia de una entrada parseada antes de cifrar e insertar.
struct ParsedEntry {
    category: String,
    title: String,
    fields: Vec<EntryField>,
    notes: String,
    favorite: bool,
}

// ─── Funciones auxiliares ───────────────────────────────────────────────────

/// Extrae el dominio de una URL para usar como título.
/// Si la URL no es válida, retorna la URL original recortada.
fn extract_domain(url: &str) -> String {
    let url_trimmed = url.trim();
    if url_trimmed.is_empty() {
        return String::new();
    }

    // Intentar parsear la URL para extraer el host
    let with_scheme = if url_trimmed.contains("://") {
        url_trimmed.to_string()
    } else {
        format!("https://{}", url_trimmed)
    };

    // Extraer el host entre :// y el siguiente /
    if let Some(after_scheme) = with_scheme.split("://").nth(1) {
        let host = after_scheme.split('/').next().unwrap_or(after_scheme);
        // Eliminar puerto si existe
        let domain = host.split(':').next().unwrap_or(host);
        // Eliminar "www." del inicio si existe
        let clean = domain.strip_prefix("www.").unwrap_or(domain);
        if clean.is_empty() {
            url_trimmed.to_string()
        } else {
            clean.to_string()
        }
    } else {
        url_trimmed.to_string()
    }
}

/// Crea un campo de tipo "Usuario" (no sensible).
fn field_usuario(value: &str) -> EntryField {
    EntryField {
        name: "Usuario".to_string(),
        value: value.to_string(),
        sensitive: false,
        field_type: "text".to_string(),
    }
}

/// Crea un campo de tipo "Contraseña" (sensible).
fn field_password(value: &str) -> EntryField {
    EntryField {
        name: "Contraseña".to_string(),
        value: value.to_string(),
        sensitive: true,
        field_type: "password".to_string(),
    }
}

/// Crea un campo de tipo "URL" (no sensible).
fn field_url(value: &str) -> EntryField {
    EntryField {
        name: "URL".to_string(),
        value: value.to_string(),
        sensitive: false,
        field_type: "text".to_string(),
    }
}

/// Crea un campo de tipo "TOTP" (sensible).
fn field_totp(value: &str) -> EntryField {
    EntryField {
        name: "TOTP".to_string(),
        value: value.to_string(),
        sensitive: true,
        field_type: "password".to_string(),
    }
}

/// Verifica si una entrada parseada debe ser omitida (sin título ni credenciales).
fn should_skip(entry: &ParsedEntry) -> bool {
    let has_title = !entry.title.trim().is_empty();
    let has_credentials = entry.fields.iter().any(|f| {
        let name_lower = f.name.to_lowercase();
        (name_lower.contains("usuario")
            || name_lower.contains("user")
            || name_lower.contains("contraseña")
            || name_lower.contains("password"))
            && !f.value.trim().is_empty()
    });

    !has_title && !has_credentials
}

/// Obtiene un valor de un HashMap de headers por nombre, con valor por defecto vacío.
fn get_field<'a>(record: &'a HashMap<String, String>, key: &str) -> &'a str {
    record.get(key).map_or("", String::as_str)
}

// ─── Parsers por formato ────────────────────────────────────────────────────

/// Parsea un CSV genérico a un vector de HashMaps (header → valor).
fn parse_csv_to_maps(content: &str) -> Result<Vec<HashMap<String, String>>, String> {
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(content.as_bytes());

    // Obtener los nombres de los headers
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| format!("Error al leer headers CSV: {}", e))?
        .iter()
        .map(|h| h.trim().trim_matches('"').to_string())
        .collect();

    let mut records = Vec::new();

    for (i, result) in reader.records().enumerate() {
        match result {
            Ok(record) => {
                let mut map = HashMap::new();
                for (j, header) in headers.iter().enumerate() {
                    let value = record.get(j).unwrap_or("").to_string();
                    map.insert(header.clone(), value);
                }
                records.push(map);
            }
            Err(e) => {
                // Registrar error pero continuar con las siguientes filas
                eprintln!("Error en fila {}: {}", i + 2, e);
            }
        }
    }

    Ok(records)
}

/// Parsea entradas de Chrome/Edge CSV.
/// Formato: name,url,username,password,note
fn parse_chrome_edge(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let name = get_field(record, "name");
        let url = get_field(record, "url");
        let username = get_field(record, "username");
        let password = get_field(record, "password");
        let note = get_field(record, "note");

        // Determinar el título: usar name si existe, sino el dominio de la URL
        let title = if !name.trim().is_empty() {
            name.to_string()
        } else if !url.trim().is_empty() {
            extract_domain(url)
        } else {
            format!("Entrada importada {}", i + 1)
        };

        let mut fields = Vec::new();
        if !username.is_empty() {
            fields.push(field_usuario(username));
        }
        if !password.is_empty() {
            fields.push(field_password(password));
        }
        if !url.is_empty() {
            fields.push(field_url(url));
        }

        entries.push(ParsedEntry {
            category: "web".to_string(),
            title,
            fields,
            notes: note.to_string(),
            favorite: false,
        });
    }

    Ok(entries)
}

/// Parsea entradas de Firefox CSV.
/// Formato: "url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
fn parse_firefox(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let url = get_field(record, "url");
        let username = get_field(record, "username");
        let password = get_field(record, "password");

        // Título: dominio extraído de la URL
        let title = if !url.trim().is_empty() {
            extract_domain(url)
        } else {
            format!("Entrada Firefox {}", i + 1)
        };

        let mut fields = Vec::new();
        if !username.is_empty() {
            fields.push(field_usuario(username));
        }
        if !password.is_empty() {
            fields.push(field_password(password));
        }
        if !url.is_empty() {
            fields.push(field_url(url));
        }

        entries.push(ParsedEntry {
            category: "web".to_string(),
            title,
            fields,
            notes: String::new(),
            favorite: false,
        });
    }

    Ok(entries)
}

/// Parsea entradas de Bitwarden CSV.
/// Formato: folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
fn parse_bitwarden_csv(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let type_str = get_field(record, "type");
        let name = get_field(record, "name");
        let notes = get_field(record, "notes");
        let login_uri = get_field(record, "login_uri");
        let login_username = get_field(record, "login_username");
        let login_password = get_field(record, "login_password");
        let login_totp = get_field(record, "login_totp");

        // Mapear tipo numérico a categoría
        let type_num: u32 = type_str.parse().unwrap_or(1);
        let category = match type_num {
            1 => "web",
            2 => "note",
            3 => "bank",
            4 => "other",
            _ => "other",
        };

        let title = if !name.trim().is_empty() {
            name.to_string()
        } else {
            format!("Entrada Bitwarden {}", i + 1)
        };

        let mut fields = Vec::new();
        if !login_username.is_empty() {
            fields.push(field_usuario(login_username));
        }
        if !login_password.is_empty() {
            fields.push(field_password(login_password));
        }
        if !login_uri.is_empty() {
            fields.push(field_url(login_uri));
        }
        if !login_totp.is_empty() {
            fields.push(field_totp(login_totp));
        }

        entries.push(ParsedEntry {
            category: category.to_string(),
            title,
            fields,
            notes: notes.to_string(),
            favorite: false,
        });
    }

    Ok(entries)
}

/// Parsea entradas de Bitwarden JSON.
fn parse_bitwarden_json(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let export: BitwardenExport = match serde_json::from_str(content) {
        Ok(e) => e,
        Err(e) => {
            errors.push(format!("Error al parsear JSON de Bitwarden: {}", e));
            return Err(errors);
        }
    };

    for (i, item) in export.items.iter().enumerate() {
        // Mapear tipo numérico a categoría
        let category = match item.item_type {
            1 => "web",
            2 => "note",
            3 => "bank",
            4 => "other",
            _ => "other",
        };

        let title = item
            .name
            .clone()
            .unwrap_or_else(|| format!("Entrada Bitwarden {}", i + 1));

        let mut fields = Vec::new();

        // Extraer datos de login si existen
        if let Some(login) = &item.login {
            if let Some(username) = &login.username {
                if !username.is_empty() {
                    fields.push(field_usuario(username));
                }
            }
            if let Some(password) = &login.password {
                if !password.is_empty() {
                    fields.push(field_password(password));
                }
            }
            // Tomar la primera URI disponible
            if let Some(uris) = &login.uris {
                if let Some(first_uri) = uris.first() {
                    if let Some(uri) = &first_uri.uri {
                        if !uri.is_empty() {
                            fields.push(field_url(uri));
                        }
                    }
                }
            }
            if let Some(totp) = &login.totp {
                if !totp.is_empty() {
                    fields.push(field_totp(totp));
                }
            }
        }

        entries.push(ParsedEntry {
            category: category.to_string(),
            title,
            fields,
            notes: item.notes.clone().unwrap_or_default(),
            favorite: item.favorite.unwrap_or(false),
        });
    }

    Ok(entries)
}

/// Parsea entradas de 1Password CSV.
/// Formato: Title,Website,Username,Password,Notes,Type
fn parse_onepassword(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let title_val = get_field(record, "Title");
        let website = get_field(record, "Website");
        let username = get_field(record, "Username");
        let password = get_field(record, "Password");
        let notes = get_field(record, "Notes");

        let title = if !title_val.trim().is_empty() {
            title_val.to_string()
        } else {
            format!("Entrada 1Password {}", i + 1)
        };

        let mut fields = Vec::new();
        if !username.is_empty() {
            fields.push(field_usuario(username));
        }
        if !password.is_empty() {
            fields.push(field_password(password));
        }
        if !website.is_empty() {
            fields.push(field_url(website));
        }

        entries.push(ParsedEntry {
            category: "web".to_string(),
            title,
            fields,
            notes: notes.to_string(),
            favorite: false,
        });
    }

    Ok(entries)
}

/// Parsea entradas de LastPass CSV.
/// Formato: url,username,password,totp,extra,name,grouping,fav
fn parse_lastpass(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let url = get_field(record, "url");
        let username = get_field(record, "username");
        let password = get_field(record, "password");
        let totp = get_field(record, "totp");
        let extra = get_field(record, "extra");
        let name = get_field(record, "name");
        let fav = get_field(record, "fav");

        let title = if !name.trim().is_empty() {
            name.to_string()
        } else if !url.trim().is_empty() {
            extract_domain(url)
        } else {
            format!("Entrada LastPass {}", i + 1)
        };

        let mut fields = Vec::new();
        if !username.is_empty() {
            fields.push(field_usuario(username));
        }
        if !password.is_empty() {
            fields.push(field_password(password));
        }
        if !url.is_empty() {
            fields.push(field_url(url));
        }
        if !totp.is_empty() {
            fields.push(field_totp(totp));
        }

        let favorite = fav == "1";

        entries.push(ParsedEntry {
            category: "web".to_string(),
            title,
            fields,
            notes: extra.to_string(),
            favorite,
        });
    }

    Ok(entries)
}

/// Parsea entradas de KeePass CSV.
/// Formato: "Group","Title","Username","Password","URL","Notes"
fn parse_keepass(content: &str) -> Result<Vec<ParsedEntry>, Vec<String>> {
    let mut entries = Vec::new();
    let mut errors = Vec::new();

    let records = match parse_csv_to_maps(content) {
        Ok(r) => r,
        Err(e) => {
            errors.push(e);
            return Err(errors);
        }
    };

    for (i, record) in records.iter().enumerate() {
        let title_val = get_field(record, "Title");
        let username = get_field(record, "Username");
        let password = get_field(record, "Password");
        let url = get_field(record, "URL");
        let notes = get_field(record, "Notes");

        let title = if !title_val.trim().is_empty() {
            title_val.to_string()
        } else {
            format!("Entrada KeePass {}", i + 1)
        };

        let mut fields = Vec::new();
        if !username.is_empty() {
            fields.push(field_usuario(username));
        }
        if !password.is_empty() {
            fields.push(field_password(password));
        }
        if !url.is_empty() {
            fields.push(field_url(url));
        }

        entries.push(ParsedEntry {
            category: "web".to_string(),
            title,
            fields,
            notes: notes.to_string(),
            favorite: false,
        });
    }

    Ok(entries)
}

// ─── Comando de importación ─────────────────────────────────────────────────

/// Importa entradas desde un archivo externo al vault.
///
/// Soporta los formatos: chrome, firefox, edge, bitwarden_csv, bitwarden_json,
/// onepassword, lastpass, keepass.
///
/// # Proceso
/// 1. Lee el archivo desde la ruta proporcionada
/// 2. Parsea según el formato indicado
/// 3. Para cada entrada: serializa a JSON, cifra con XChaCha20-Poly1305, inserta en BD
/// 4. Retorna el conteo de importadas, omitidas y errores encontrados
#[tauri::command]
pub fn import_entries(
    state: tauri::State<'_, AppState>,
    file_path: String,
    format: String,
) -> Result<ImportResult, String> {
    // Validar la ruta del archivo antes de leer (protección contra path traversal)
    let validated_path = validate_file_path(&file_path)?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Leer el contenido del archivo usando la ruta validada
    let mut file = fs::File::open(&validated_path)
        .map_err(|e| format!("Error al abrir el archivo '{}': {}", file_path, e))?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Error al leer el archivo '{}': {}", file_path, e))?;

    // Parsear según el formato indicado
    let parsed_entries = match format.as_str() {
        "chrome" | "edge" => parse_chrome_edge(&content).map_err(|errs| errs.join("; "))?,
        "firefox" => parse_firefox(&content).map_err(|errs| errs.join("; "))?,
        "bitwarden_csv" => parse_bitwarden_csv(&content).map_err(|errs| errs.join("; "))?,
        "bitwarden_json" => parse_bitwarden_json(&content).map_err(|errs| errs.join("; "))?,
        "onepassword" => parse_onepassword(&content).map_err(|errs| errs.join("; "))?,
        "lastpass" => parse_lastpass(&content).map_err(|errs| errs.join("; "))?,
        "keepass" => parse_keepass(&content).map_err(|errs| errs.join("; "))?,
        _ => return Err(format!("Formato de importación no soportado: '{}'", format)),
    };

    // Obtener la clave de cifrado
    let enc_key = &vault.enc_key.expose_secret().0;
    let now = Utc::now().to_rfc3339();

    let mut imported: u32 = 0;
    let mut skipped: u32 = 0;
    let mut errors: Vec<String> = Vec::new();

    // Procesar cada entrada parseada
    for (i, entry) in parsed_entries.into_iter().enumerate() {
        // Omitir entradas vacías (sin título ni credenciales)
        if should_skip(&entry) {
            skipped += 1;
            continue;
        }

        // Construir los datos a cifrar
        let entry_data = EntryData {
            fields: entry.fields,
            notes: entry.notes,
        };

        // Serializar a JSON
        let json_data = match serde_json::to_vec(&entry_data) {
            Ok(data) => data,
            Err(e) => {
                errors.push(format!("Fila {}: error al serializar datos - {}", i + 1, e));
                continue;
            }
        };

        // Cifrar con XChaCha20-Poly1305
        let encrypted_data = match cipher::encrypt(enc_key, &json_data) {
            Ok(data) => data,
            Err(e) => {
                errors.push(format!("Fila {}: error al cifrar datos - {}", i + 1, e));
                continue;
            }
        };

        // Generar ID único para la entrada
        let id = Uuid::new_v4().to_string();

        // Insertar en la base de datos
        match repository::insert_entry(
            &vault.connection,
            &id,
            &entry.category,
            &entry.title,
            &encrypted_data,
            entry.favorite,
            &now,
            &now,
        ) {
            Ok(()) => imported += 1,
            Err(e) => {
                errors.push(format!(
                    "Fila {}: error al insertar '{}' - {}",
                    i + 1,
                    entry.title,
                    e
                ));
            }
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        errors,
    })
}

// ─── Comando de exportación ─────────────────────────────────────────────────

/// Exporta todas las entradas del vault a un archivo.
/// Requiere re-autenticación con la contraseña maestra para proteger los datos exportados.
///
/// Formatos soportados: "csv" y "json".
///
/// # CSV
/// Genera un archivo con columnas: nombre, categoria, usuario, contraseña, url, notas
///
/// # JSON
/// Genera un archivo JSON con la estructura propia de Vault Local,
/// incluyendo metadatos de versión y fecha de exportación.
#[tauri::command]
pub fn export_entries(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    file_path: String,
    format: String,
    password: String,
) -> Result<u32, String> {
    // Validar la ruta del archivo antes de escribir (protección contra path traversal)
    let validated_path = validate_file_path(&file_path)?;

    // Re-autenticación: leer salt, derivar claves y verificar contraseña
    let salt_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("vault.salt");
    let salt = fs::read(&salt_path).map_err(|e| format!("Error al leer salt: {}", e))?;
    let (mut db_key, enc_key_verify) = kdf::derive_keys_from_password(password.as_bytes(), &salt)?;

    // No necesitamos db_key para la verificación, solo verificamos enc_key
    db_key.zeroize();

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Verificar descifrando el token de verificación
    let encrypted_token = repository::get_config(&vault.connection, "verify_token")?
        .ok_or("Token de verificación no encontrado")?;
    cipher::decrypt(&enc_key_verify, &encrypted_token)
        .map_err(|_| "Contraseña incorrecta".to_string())?;

    // Zeroizar la contraseña
    let mut password = password;
    password.zeroize();

    // Obtener todas las entradas (sin filtros)
    let all_entries = repository::list_entries(&vault.connection, None, None)?;
    let enc_key = &vault.enc_key.expose_secret().0;

    // Descifrar todas las entradas
    let mut decrypted_entries: Vec<ExportEntry> = Vec::new();

    for meta in &all_entries {
        // Obtener datos raw de la base de datos
        let (category, title, encrypted_data, favorite, _created_at, _updated_at) =
            repository::get_entry_raw(&vault.connection, &meta.id)?;

        // Descifrar los datos
        let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;

        // Deserializar los datos JSON
        let entry_data: EntryData = serde_json::from_slice(&decrypted)
            .map_err(|e| format!("Error al deserializar entrada '{}': {}", title, e))?;

        decrypted_entries.push(ExportEntry {
            category,
            title,
            fields: entry_data.fields,
            notes: entry_data.notes,
            favorite,
        });
    }

    let count = decrypted_entries.len() as u32;

    // Exportar según el formato usando la ruta validada
    let validated_path_str = validated_path.to_string_lossy().to_string();
    match format.as_str() {
        "csv" => export_csv(&validated_path_str, &decrypted_entries)?,
        "json" => export_json(&validated_path_str, &decrypted_entries)?,
        _ => return Err(format!("Formato de exportación no soportado: '{}'", format)),
    }

    Ok(count)
}

// ─── Estructuras y funciones auxiliares de exportación ───────────────────────

/// Entrada descifrada lista para exportar.
struct ExportEntry {
    category: String,
    title: String,
    fields: Vec<EntryField>,
    notes: String,
    favorite: bool,
}

/// Busca el primer campo cuyo nombre coincida con alguno de los patrones dados.
/// La búsqueda es insensible a mayúsculas/minúsculas.
fn find_field_value<'a>(fields: &'a [EntryField], patterns: &[&str]) -> &'a str {
    for field in fields {
        let name_lower = field.name.to_lowercase();
        for pattern in patterns {
            if name_lower.contains(&pattern.to_lowercase()) {
                return &field.value;
            }
        }
    }
    ""
}

/// Exporta las entradas en formato CSV.
/// Columnas: nombre, categoria, usuario, contraseña, url, notas
fn export_csv(file_path: &str, entries: &[ExportEntry]) -> Result<(), String> {
    let mut writer = csv::Writer::from_path(file_path)
        .map_err(|e| format!("Error al crear archivo CSV '{}': {}", file_path, e))?;

    // Escribir encabezados
    writer
        .write_record([
            "nombre",
            "categoria",
            "usuario",
            "contraseña",
            "url",
            "notas",
        ])
        .map_err(|e| format!("Error al escribir encabezados CSV: {}", e))?;

    // Escribir cada entrada
    for entry in entries {
        let usuario = find_field_value(&entry.fields, &["usuario", "user", "username"]);
        let password = find_field_value(&entry.fields, &["contraseña", "password", "pass"]);
        let url = find_field_value(&entry.fields, &["url", "website", "uri"]);

        writer
            .write_record([
                &entry.title,
                &entry.category,
                usuario,
                password,
                url,
                &entry.notes,
            ])
            .map_err(|e| format!("Error al escribir fila CSV: {}", e))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Error al finalizar archivo CSV: {}", e))?;

    Ok(())
}

/// Estructura del JSON de exportación de Vault Local.
#[derive(Serialize)]
struct ExportJson {
    vault: String,
    version: String,
    exported_at: String,
    entries: Vec<ExportJsonEntry>,
}

/// Entrada individual en el JSON de exportación.
#[derive(Serialize)]
struct ExportJsonEntry {
    category: String,
    title: String,
    fields: Vec<EntryField>,
    notes: String,
    favorite: bool,
}

/// Exporta las entradas en formato JSON propio de Vault Local.
fn export_json(file_path: &str, entries: &[ExportEntry]) -> Result<(), String> {
    let export = ExportJson {
        vault: "Vault Local".to_string(),
        version: "0.1.0".to_string(),
        exported_at: Utc::now().to_rfc3339(),
        entries: entries
            .iter()
            .map(|e| ExportJsonEntry {
                category: e.category.clone(),
                title: e.title.clone(),
                fields: e.fields.clone(),
                notes: e.notes.clone(),
                favorite: e.favorite,
            })
            .collect(),
    };

    let json = serde_json::to_string_pretty(&export)
        .map_err(|e| format!("Error al serializar JSON de exportación: {}", e))?;

    fs::write(file_path, json)
        .map_err(|e| format!("Error al escribir archivo JSON '{}': {}", file_path, e))?;

    Ok(())
}

// ─── Importación directa de archivos KDBX ─────────────────────────────────────

/// Configura un Command para no mostrar ventana de consola en Windows.
#[cfg(windows)]
fn spawn_hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
}

/// En plataformas no-Windows, no se necesita configuración especial.
#[cfg(not(windows))]
fn spawn_hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

/// Busca el ejecutable keepassxc-cli en el sistema.
/// Verifica primero el PATH del sistema y luego ubicaciones comunes en Windows.
fn find_keepassxc_cli() -> Option<PathBuf> {
    // Verificar si está en el PATH del sistema
    let mut check_cmd = Command::new("keepassxc-cli");
    check_cmd.arg("--version");
    if let Ok(output) = spawn_hidden(&mut check_cmd).output() {
        if output.status.success() {
            return Some(PathBuf::from("keepassxc-cli"));
        }
    }

    // Ubicaciones comunes en Windows
    #[cfg(windows)]
    {
        let paths = [
            r"C:\Program Files\KeePassXC\keepassxc-cli.exe",
            r"C:\Program Files (x86)\KeePassXC\keepassxc-cli.exe",
        ];

        for p in &paths {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

/// Ejecuta keepassxc-cli para exportar un archivo .kdbx a formato CSV.
/// La contraseña se envía a través de stdin para evitar exposición en la línea de comandos.
fn export_kdbx_to_csv(cli_path: &Path, kdbx_path: &str, password: &str) -> Result<String, String> {
    use std::io::Write as IoWrite;

    let mut cmd = Command::new(cli_path);
    cmd.args(["export", "--format", "csv", kdbx_path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = spawn_hidden(&mut cmd)
        .spawn()
        .map_err(|e| format!("Error al ejecutar keepassxc-cli: {}", e))?;

    // Enviar la contraseña a través de stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(password.as_bytes()).ok();
        stdin.write_all(b"\n").ok();
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Error al esperar keepassxc-cli: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Error de KeePassXC: {}", stderr.trim()));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Error al leer salida de keepassxc-cli: {}", e))
}

/// Importa directamente un archivo .kdbx usando keepassxc-cli.
/// Requiere que KeePassXC esté instalado en el sistema.
///
/// # Proceso
/// 1. Busca keepassxc-cli en el sistema
/// 2. Exporta el .kdbx a CSV usando keepassxc-cli
/// 3. Parsea el CSV resultante con el parser de KeePass existente
/// 4. Cifra e inserta cada entrada en el vault
///
/// Si KeePassXC no está instalado, sugiere al usuario exportar manualmente como CSV.
#[tauri::command]
pub fn import_kdbx(
    state: tauri::State<'_, AppState>,
    file_path: String,
    kdbx_password: String,
) -> Result<ImportResult, String> {
    // Validar la ruta del archivo
    let validated_path = validate_file_path(&file_path)?;

    // Buscar keepassxc-cli en el sistema
    let cli_path = find_keepassxc_cli().ok_or_else(|| {
        "KeePassXC no está instalado. Exporta tu bóveda como CSV desde KeePassXC \
         e impórtala usando el formato 'KeePass (CSV)'."
            .to_string()
    })?;

    let guard = with_vault!(state);
    let vault = guard.as_ref().unwrap();

    // Exportar el .kdbx a CSV mediante keepassxc-cli
    let csv_content =
        export_kdbx_to_csv(&cli_path, &validated_path.to_string_lossy(), &kdbx_password)?;

    // Zeroizar la contraseña del archivo KDBX
    let mut kdbx_password = kdbx_password;
    kdbx_password.zeroize();

    // Parsear el CSV resultante usando el parser de KeePass existente
    let parsed_entries = parse_keepass(&csv_content).map_err(|errs| errs.join("; "))?;

    // Obtener la clave de cifrado
    let enc_key = &vault.enc_key.expose_secret().0;
    let now = Utc::now().to_rfc3339();

    let mut imported: u32 = 0;
    let mut skipped: u32 = 0;
    let mut errors: Vec<String> = Vec::new();

    // Procesar cada entrada parseada
    for (i, entry) in parsed_entries.into_iter().enumerate() {
        // Omitir entradas vacías
        if should_skip(&entry) {
            skipped += 1;
            continue;
        }

        // Construir los datos a cifrar
        let entry_data = EntryData {
            fields: entry.fields,
            notes: entry.notes,
        };

        // Serializar a JSON
        let json_data = match serde_json::to_vec(&entry_data) {
            Ok(data) => data,
            Err(e) => {
                errors.push(format!("Fila {}: error al serializar datos - {}", i + 1, e));
                continue;
            }
        };

        // Cifrar con XChaCha20-Poly1305
        let encrypted_data = match cipher::encrypt(enc_key, &json_data) {
            Ok(data) => data,
            Err(e) => {
                errors.push(format!("Fila {}: error al cifrar datos - {}", i + 1, e));
                continue;
            }
        };

        // Generar ID único
        let id = Uuid::new_v4().to_string();

        // Insertar en la base de datos
        match repository::insert_entry(
            &vault.connection,
            &id,
            &entry.category,
            &entry.title,
            &encrypted_data,
            entry.favorite,
            &now,
            &now,
        ) {
            Ok(()) => imported += 1,
            Err(e) => {
                errors.push(format!(
                    "Fila {}: error al insertar '{}' - {}",
                    i + 1,
                    entry.title,
                    e
                ));
            }
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        errors,
    })
}
