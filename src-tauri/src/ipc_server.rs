// Servidor IPC local para comunicación con la extensión del navegador.
// Escucha en 127.0.0.1:51820 y responde solicitudes JSON-RPC.
// Solo acepta conexiones desde localhost con token de autenticación.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::Connection;
use secrecy::{ExposeSecret, Secret};
use serde::{Deserialize, Serialize};

use crate::crypto::cipher;
use crate::db::models::{EntryData, EntryMeta};
use crate::db::repository;
use crate::state::EncKey;

/// Puerto TCP donde escucha el servidor IPC.
const IPC_PORT: u16 = 51820;

/// Solicitud IPC entrante desde la extensión del navegador.
#[derive(Deserialize)]
struct IpcRequest {
    method: String,
    #[serde(default)]
    params: serde_json::Value,
    #[serde(default)]
    token: String,
}

/// Respuesta IPC enviada a la extensión del navegador.
#[derive(Serialize)]
struct IpcResponse {
    success: bool,
    data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Handle del servidor para control de ciclo de vida (iniciar/detener).
struct ServerHandle {
    shutdown: Arc<AtomicBool>,
}

/// Estado interno del servidor IPC con su propia conexión a la base de datos.
/// Las claves se zeroizan automáticamente al destruirse.
struct IpcInternalState {
    /// Conexión propia a la base de datos SQLCipher (solo lectura)
    connection: Connection,
    /// Clave de cifrado para descifrar campos sensibles
    enc_key: Secret<EncKey>,
    /// Token de autenticación para validar solicitudes
    token: String,
}

// SAFETY: Connection de rusqlite no es Send por defecto, pero
// nuestro servidor serializa el acceso a través del Mutex.
unsafe impl Send for IpcInternalState {}

/// Handle global del servidor (para poder detenerlo desde cualquier lugar).
static SERVER_HANDLE: OnceLock<Mutex<Option<ServerHandle>>> = OnceLock::new();

/// Estado compartido del servidor IPC (conexión + claves).
static IPC_STATE: OnceLock<Mutex<Option<Arc<Mutex<IpcInternalState>>>>> = OnceLock::new();

/// Inicializa las variables estáticas del servidor.
fn init_statics() {
    let _ = SERVER_HANDLE.get_or_init(|| Mutex::new(None));
    let _ = IPC_STATE.get_or_init(|| Mutex::new(None));
}

/// Genera un token de autenticación aleatorio de 32 bytes en formato hexadecimal.
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Inicia el servidor IPC. Se llama después de desbloquear el vault.
///
/// # Argumentos
/// - `db_path`: ruta al archivo de la base de datos SQLCipher
/// - `db_key`: clave de 32 bytes para abrir la conexión SQLCipher
/// - `enc_key`: clave de 32 bytes para descifrar campos sensibles
/// - `app_data_dir`: directorio de datos de la aplicación (para guardar el token)
pub fn start(
    db_path: PathBuf,
    db_key: &[u8; 32],
    enc_key: [u8; 32],
    app_data_dir: PathBuf,
) -> Result<(), String> {
    init_statics();

    // Detener servidor anterior si existe
    stop();

    // Abrir conexión propia a la base de datos
    let connection = repository::open_db(&db_path, db_key)?;

    // Generar token de autenticación
    let token = generate_token();

    // Guardar token en archivo para que el native messaging host lo lea
    let token_path = app_data_dir.join("ipc.token");
    std::fs::write(&token_path, &token)
        .map_err(|e| format!("Error al guardar token IPC: {}", e))?;

    // Crear estado interno del servidor
    let internal_state = Arc::new(Mutex::new(IpcInternalState {
        connection,
        enc_key: Secret::new(EncKey(enc_key)),
        token: token.clone(),
    }));

    // Guardar estado compartido
    if let Some(state_lock) = IPC_STATE.get() {
        if let Ok(mut guard) = state_lock.lock() {
            *guard = Some(Arc::clone(&internal_state));
        }
    }

    // Flag de apagado
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);

    // Guardar handle del servidor
    if let Some(handle_lock) = SERVER_HANDLE.get() {
        if let Ok(mut guard) = handle_lock.lock() {
            *guard = Some(ServerHandle {
                shutdown: Arc::clone(&shutdown),
            });
        }
    }

    // Iniciar hilo del servidor TCP
    thread::Builder::new()
        .name("ipc-server".to_string())
        .spawn(move || {
            run_server(internal_state, shutdown_clone);
        })
        .map_err(|e| format!("Error al iniciar hilo del servidor IPC: {}", e))?;

    Ok(())
}

/// Detiene el servidor IPC. Se llama al bloquear el vault.
pub fn stop() {
    init_statics();

    // Señalar al hilo que debe detenerse
    if let Some(handle_lock) = SERVER_HANDLE.get() {
        if let Ok(mut guard) = handle_lock.lock() {
            if let Some(handle) = guard.take() {
                handle.shutdown.store(true, Ordering::SeqCst);
            }
        }
    }

    // Limpiar estado compartido (las claves se zeroizan automáticamente por Secret/ZeroizeOnDrop)
    if let Some(state_lock) = IPC_STATE.get() {
        if let Ok(mut guard) = state_lock.lock() {
            *guard = None;
        }
    }

    // Eliminar archivo de token
    // No tenemos app_data_dir aquí, así que la limpieza del archivo
    // se delega al caller (lock_vault)
}

/// Elimina el archivo de token IPC del disco.
pub fn cleanup_token(app_data_dir: &PathBuf) {
    let token_path = app_data_dir.join("ipc.token");
    let _ = std::fs::remove_file(&token_path);
}

/// Bucle principal del servidor TCP.
fn run_server(state: Arc<Mutex<IpcInternalState>>, shutdown: Arc<AtomicBool>) {
    // Bind solo a localhost (127.0.0.1), nunca a 0.0.0.0
    let listener = match TcpListener::bind(format!("127.0.0.1:{}", IPC_PORT)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "[IPC] Error al iniciar servidor en puerto {}: {}",
                IPC_PORT, e
            );
            return;
        }
    };

    // Timeout no bloqueante para poder verificar el flag de shutdown
    listener
        .set_nonblocking(true)
        .expect("No se pudo configurar TcpListener como no-bloqueante");

    eprintln!("[IPC] Servidor iniciado en 127.0.0.1:{}", IPC_PORT);

    while !shutdown.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, addr)) => {
                // Verificar que la conexión viene de localhost
                if !addr.ip().is_loopback() {
                    eprintln!("[IPC] Conexión rechazada desde IP no-local: {}", addr);
                    continue;
                }

                let state_clone = Arc::clone(&state);
                let shutdown_clone = Arc::clone(&shutdown);

                thread::Builder::new()
                    .name("ipc-handler".to_string())
                    .spawn(move || {
                        handle_connection(stream, state_clone, shutdown_clone);
                    })
                    .ok();
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // No hay conexiones pendientes, esperar un poco
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                eprintln!("[IPC] Error al aceptar conexión: {}", e);
                thread::sleep(Duration::from_millis(100));
            }
        }
    }

    eprintln!("[IPC] Servidor detenido.");
}

/// Maneja una conexión TCP individual.
/// Lee una línea JSON, procesa la solicitud y escribe una línea JSON de respuesta.
fn handle_connection(
    mut stream: TcpStream,
    state: Arc<Mutex<IpcInternalState>>,
    _shutdown: Arc<AtomicBool>,
) {
    // Timeout de lectura para evitar conexiones colgadas
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let reader = BufReader::new(stream.try_clone().unwrap_or_else(|_| {
        // Si no podemos clonar el stream, usamos el original para leer
        // y no podremos escribir. Esto no debería pasar en la práctica.
        panic!("No se pudo clonar TcpStream");
    }));

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        // Parsear solicitud JSON
        let request: IpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let response = IpcResponse {
                    success: false,
                    data: serde_json::Value::Null,
                    error: Some(format!("JSON inválido: {}", e)),
                };
                let _ = write_response(&mut stream, &response);
                break;
            }
        };

        // Procesar solicitud
        let response = process_request(&request, &state);

        // Escribir respuesta
        if write_response(&mut stream, &response).is_err() {
            break;
        }

        // Una solicitud por conexión (simplifica el protocolo)
        break;
    }
}

/// Escribe una respuesta JSON seguida de un salto de línea.
fn write_response(stream: &mut TcpStream, response: &IpcResponse) -> Result<(), std::io::Error> {
    let json = serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"success":false,"data":null,"error":"Error al serializar respuesta"}"#.to_string()
    });
    stream.write_all(json.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    Ok(())
}

/// Procesa una solicitud IPC y retorna la respuesta.
fn process_request(request: &IpcRequest, state: &Arc<Mutex<IpcInternalState>>) -> IpcResponse {
    // El método "ping" no requiere autenticación
    if request.method == "ping" {
        return IpcResponse {
            success: true,
            data: serde_json::json!("pong"),
            error: None,
        };
    }

    // Verificar token de autenticación para todos los demás métodos
    let state_guard = match state.lock() {
        Ok(g) => g,
        Err(_) => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some("Error interno del servidor".to_string()),
            };
        }
    };

    if request.token.is_empty() || request.token != state_guard.token {
        return IpcResponse {
            success: false,
            data: serde_json::Value::Null,
            error: Some("Token de autenticación inválido".to_string()),
        };
    }

    // Despachar según el método solicitado
    match request.method.as_str() {
        "status" => handle_status(),
        "search" => handle_search(&request.params, &state_guard),
        "get_credentials" => handle_get_credentials(&request.params, &state_guard),
        "list_for_url" => handle_list_for_url(&request.params, &state_guard),
        _ => IpcResponse {
            success: false,
            data: serde_json::Value::Null,
            error: Some(format!("Método desconocido: {}", request.method)),
        },
    }
}

/// Maneja el método "status": indica que el vault está desbloqueado.
/// Si el servidor está corriendo, el vault está desbloqueado por definición.
fn handle_status() -> IpcResponse {
    IpcResponse {
        success: true,
        data: serde_json::json!({ "locked": false }),
        error: None,
    }
}

/// Maneja el método "search": busca entradas por título.
fn handle_search(params: &serde_json::Value, state: &IpcInternalState) -> IpcResponse {
    let query = match params.get("query").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some("Parámetro 'query' requerido".to_string()),
            };
        }
    };

    match repository::list_entries(&state.connection, None, Some(query)) {
        Ok(entries) => {
            // Limitar a 20 resultados para rendimiento
            let limited: Vec<&EntryMeta> = entries.iter().take(20).collect();
            IpcResponse {
                success: true,
                data: serde_json::to_value(&limited).unwrap_or(serde_json::Value::Null),
                error: None,
            }
        }
        Err(e) => IpcResponse {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

/// Maneja el método "get_credentials": obtiene usuario y contraseña de una entrada.
/// Descifra la entrada y extrae los campos relevantes.
fn handle_get_credentials(params: &serde_json::Value, state: &IpcInternalState) -> IpcResponse {
    let id = match params.get("id").and_then(|v| v.as_str()) {
        Some(i) => i,
        None => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some("Parámetro 'id' requerido".to_string()),
            };
        }
    };

    // Obtener entrada raw de la base de datos
    let (_, title, encrypted_data, _, _, _) = match repository::get_entry_raw(&state.connection, id)
    {
        Ok(data) => data,
        Err(e) => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some(e),
            };
        }
    };

    // Descifrar los datos
    let enc_key = &state.enc_key.expose_secret().0;
    let decrypted = match cipher::decrypt(enc_key, &encrypted_data) {
        Ok(d) => d,
        Err(e) => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some(format!("Error al descifrar: {}", e)),
            };
        }
    };

    // Deserializar los datos JSON
    let entry_data: EntryData = match serde_json::from_slice(&decrypted) {
        Ok(d) => d,
        Err(e) => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some(format!("Error al deserializar entrada: {}", e)),
            };
        }
    };

    // Extraer campos de usuario y contraseña
    let mut username = String::new();
    let mut password = String::new();
    let mut url = String::new();

    // Nombres comunes para campos de usuario
    let user_names = [
        "usuario",
        "user",
        "username",
        "email",
        "correo",
        "e-mail",
        "nombre de usuario",
        "login",
        "cuenta",
    ];
    // Nombres comunes para campos de contraseña
    let pass_names = ["contraseña", "password", "pass", "clave", "pin", "secret"];
    // Nombres comunes para campos de URL
    let url_names = [
        "url",
        "sitio",
        "website",
        "web",
        "dirección",
        "enlace",
        "link",
        "sitio web",
        "página",
    ];

    for field in &entry_data.fields {
        let name_lower = field.name.to_lowercase();

        // Buscar campo de usuario (priorizar el primero encontrado)
        if username.is_empty() {
            for pattern in &user_names {
                if name_lower.contains(pattern) {
                    username = field.value.clone();
                    break;
                }
            }
        }

        // Buscar campo de contraseña
        if password.is_empty() {
            // Priorizar campo con sensitive=true o field_type="password"
            if field.sensitive || field.field_type == "password" {
                for pattern in &pass_names {
                    if name_lower.contains(pattern) {
                        password = field.value.clone();
                        break;
                    }
                }
                // Si es sensible y no coincidió con nombres de contraseña,
                // usarlo como contraseña si aún no tenemos una
                if password.is_empty() && field.sensitive {
                    password = field.value.clone();
                }
            }
        }

        // Buscar campo de URL
        if url.is_empty() {
            for pattern in &url_names {
                if name_lower.contains(pattern) {
                    url = field.value.clone();
                    break;
                }
            }
        }
    }

    // Fallback: si no encontramos usuario por nombre, usar el primer campo no-sensible
    if username.is_empty() {
        for field in &entry_data.fields {
            if !field.sensitive && field.field_type != "password" && field.field_type != "textarea"
            {
                username = field.value.clone();
                break;
            }
        }
    }

    // Fallback: si no encontramos contraseña por nombre, usar el primer campo sensible
    if password.is_empty() {
        for field in &entry_data.fields {
            if field.sensitive || field.field_type == "password" {
                password = field.value.clone();
                break;
            }
        }
    }

    IpcResponse {
        success: true,
        data: serde_json::json!({
            "title": title,
            "username": username,
            "password": password,
            "url": url,
        }),
        error: None,
    }
}

/// Maneja el método "list_for_url": busca entradas cuyo campo URL coincida con el dominio.
fn handle_list_for_url(params: &serde_json::Value, state: &IpcInternalState) -> IpcResponse {
    let url = match params.get("url").and_then(|v| v.as_str()) {
        Some(u) => u,
        None => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some("Parámetro 'url' requerido".to_string()),
            };
        }
    };

    // Extraer dominio de la URL proporcionada
    let target_domain = extract_domain(url);
    if target_domain.is_empty() {
        return IpcResponse {
            success: true,
            data: serde_json::json!([]),
            error: None,
        };
    }

    // Obtener todas las entradas (solo metadatos)
    let entries = match repository::list_entries(&state.connection, None, None) {
        Ok(e) => e,
        Err(e) => {
            return IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some(e),
            };
        }
    };

    let enc_key = &state.enc_key.expose_secret().0;
    let mut matching_entries: Vec<EntryMeta> = Vec::new();

    // Nombres comunes para campos de URL
    let url_names = [
        "url",
        "sitio",
        "website",
        "web",
        "dirección",
        "enlace",
        "link",
        "sitio web",
        "página",
    ];

    // Para cada entrada, descifrar y buscar campos de URL que coincidan
    for entry in entries {
        let raw = match repository::get_entry_raw(&state.connection, &entry.id) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let decrypted = match cipher::decrypt(enc_key, &raw.2) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let entry_data: EntryData = match serde_json::from_slice(&decrypted) {
            Ok(d) => d,
            Err(_) => continue,
        };

        // Buscar campo de URL y comparar dominios
        let mut found = false;
        for field in &entry_data.fields {
            let name_lower = field.name.to_lowercase();
            for pattern in &url_names {
                if name_lower.contains(pattern) {
                    let entry_domain = extract_domain(&field.value);
                    if !entry_domain.is_empty() && domains_match(&target_domain, &entry_domain) {
                        found = true;
                        break;
                    }
                }
            }
            if found {
                break;
            }
        }

        // También buscar coincidencia en el título de la entrada
        if !found {
            let title_lower = entry.title.to_lowercase();
            let domain_lower = target_domain.to_lowercase();
            // Extraer nombre base del dominio (sin TLD)
            let domain_base = domain_lower.split('.').next().unwrap_or(&domain_lower);
            if !domain_base.is_empty() && title_lower.contains(domain_base) {
                found = true;
            }
        }

        if found {
            matching_entries.push(entry);
        }

        // Limitar resultados
        if matching_entries.len() >= 10 {
            break;
        }
    }

    IpcResponse {
        success: true,
        data: serde_json::to_value(&matching_entries).unwrap_or(serde_json::json!([])),
        error: None,
    }
}

/// Extrae el dominio de una URL, eliminando protocolo, www. y path.
fn extract_domain(url: &str) -> String {
    let url = url.trim();

    // Eliminar protocolo
    let without_protocol = if let Some(pos) = url.find("://") {
        &url[pos + 3..]
    } else {
        url
    };

    // Tomar solo el host (antes del primer '/')
    let host = without_protocol.split('/').next().unwrap_or("");

    // Eliminar puerto si existe
    let host = host.split(':').next().unwrap_or(host);

    // Eliminar www.
    let host = host.strip_prefix("www.").unwrap_or(host);

    host.to_lowercase()
}

/// Compara dos dominios, considerando coincidencia exacta y subdominios.
/// Por ejemplo: "login.example.com" coincide con "example.com".
fn domains_match(target: &str, entry: &str) -> bool {
    let target = target.to_lowercase();
    let entry = entry.to_lowercase();

    if target == entry {
        return true;
    }

    // Verificar si uno es subdominio del otro
    target.ends_with(&format!(".{}", entry)) || entry.ends_with(&format!(".{}", target))
}
