// Puente de la extensión del navegador (Native Messaging) integrado en la app.
//
// Antes hacía falta instalar Node.js y ejecutar un script a mano. Ahora:
// - Al abrirse, la app registra su propio ejecutable como "native messaging host" de
//   Chrome, Edge, Brave, Chromium y Firefox (solo para el usuario actual, sin permisos de
//   administrador).
// - Cuando el navegador lanza el ejecutable para la extensión, este detecta los argumentos
//   del navegador y funciona como puente: lee mensajes de stdin (4 bytes de longitud +
//   JSON), los reenvía al servidor IPC local (127.0.0.1:51820) con el token de la sesión y
//   devuelve la respuesta por stdout. No abre ventanas ni carga la bóveda.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
#[cfg(windows)]
use tauri::Manager;

const HOST_NAME: &str = "com.vaultlocal.app";
/// Extensión publicada en Chrome Web Store
const CHROME_EXTENSION_ID: &str = "honffihiebfeephklbgnolejabdfocnp";
/// Extensión de Firefox (manifest.firefox.json → browser_specific_settings.gecko.id)
const FIREFOX_EXTENSION_ID: &str = "vault-local@vaultlocal.com";
const IPC_PORT: u16 = 51820;
const MAX_MESSAGE: usize = 1024 * 1024;

/// El navegador lanza el host con el origen de la extensión (Chrome/Edge/Brave) o con la
/// ruta del manifiesto y el id de la extensión (Firefox).
pub fn is_invocation(args: &[String]) -> bool {
    args.iter()
        .skip(1)
        .any(|a| a.starts_with("chrome-extension://") || a == FIREFOX_EXTENSION_ID)
}

// ---------------------------------------------------------------------------
// Modo puente
// ---------------------------------------------------------------------------

fn token_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(HOST_NAME).join("ipc.token"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library/Application Support")
                .join(HOST_NAME)
                .join("ipc.token")
        })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        base.map(|b| b.join(HOST_NAME).join("ipc.token"))
    }
}

fn read_token() -> String {
    token_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| t.trim().to_string())
        .unwrap_or_default()
}

fn forward(request: &Value) -> Value {
    let error = |msg: &str| json!({ "success": false, "data": null, "error": msg });
    let ipc_request = json!({
        "method": request.get("method").cloned().unwrap_or(Value::Null),
        "params": request.get("params").cloned().unwrap_or_else(|| json!({})),
        "token": read_token(),
    });
    let addr = SocketAddr::from(([127, 0, 0, 1], IPC_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(3)) else {
        return error("Vault Local no está abierto o la bóveda está bloqueada");
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let mut line = ipc_request.to_string();
    line.push('\n');
    if stream.write_all(line.as_bytes()).is_err() {
        return error("No se pudo enviar la solicitud a Vault Local");
    }
    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    match reader.read_line(&mut response) {
        Ok(n) if n > 0 => serde_json::from_str(response.trim())
            .unwrap_or_else(|_| error("Respuesta inválida de Vault Local")),
        _ => error("Timeout: Vault Local no respondió"),
    }
}

fn write_message(out: &mut impl Write, msg: &Value) -> io::Result<()> {
    let body = msg.to_string();
    out.write_all(&(body.len() as u32).to_le_bytes())?;
    out.write_all(body.as_bytes())?;
    out.flush()
}

/// Bucle del puente: termina cuando el navegador cierra stdin.
pub fn run() {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    loop {
        let mut len = [0u8; 4];
        if input.read_exact(&mut len).is_err() {
            return;
        }
        let len = u32::from_le_bytes(len) as usize;
        if len > MAX_MESSAGE {
            let _ = write_message(
                &mut output,
                &json!({ "success": false, "error": "Mensaje demasiado grande" }),
            );
            return;
        }
        let mut buf = vec![0u8; len];
        if input.read_exact(&mut buf).is_err() {
            return;
        }
        let reply = match serde_json::from_slice::<Value>(&buf) {
            Ok(request) => {
                let mut r = forward(&request);
                // Conservar el identificador para que el service worker enrute la respuesta
                if let (Some(id), Some(obj)) = (request.get("_reqId"), r.as_object_mut()) {
                    obj.insert("_reqId".to_string(), id.clone());
                }
                r
            }
            Err(_) => {
                json!({ "success": false, "data": null, "error": "JSON inválido en mensaje" })
            }
        };
        if write_message(&mut output, &reply).is_err() {
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Registro en los navegadores
// ---------------------------------------------------------------------------

/// Ruta estable del ejecutable (en Linux AppImage, la del archivo .AppImage).
fn host_executable() -> Option<PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Some(PathBuf::from(appimage));
    }
    std::env::current_exe().ok()
}

fn chromium_manifest(exe: &Path) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Vault Local",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{}/", CHROME_EXTENSION_ID)],
    })
}

fn firefox_manifest(exe: &Path) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Vault Local",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [FIREFOX_EXTENSION_ID],
    })
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // No reescribir si no cambió (evita tocar el disco en cada inicio)
    if std::fs::read_to_string(path).ok().as_deref() == Some(text.as_str()) {
        return Ok(());
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Registra el puente para el usuario actual. Errores: solo se registran en el log.
pub fn register(app: &tauri::AppHandle) {
    let Some(exe) = host_executable() else {
        return;
    };
    if let Err(e) = register_impl(app, &exe) {
        eprintln!("[Extensión] No se pudo registrar el puente: {}", e);
    }
}

#[cfg(windows)]
fn register_impl(app: &tauri::AppHandle, exe: &Path) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("native-host");
    let chrome_json = dir.join("com.vaultlocal.app.json");
    let firefox_json = dir.join("com.vaultlocal.app.firefox.json");
    write_json(&chrome_json, &chromium_manifest(exe))?;
    write_json(&firefox_json, &firefox_manifest(exe))?;

    let chromium_keys = [
        r"Software\Google\Chrome\NativeMessagingHosts\com.vaultlocal.app",
        r"Software\Microsoft\Edge\NativeMessagingHosts\com.vaultlocal.app",
        r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.vaultlocal.app",
        r"Software\Chromium\NativeMessagingHosts\com.vaultlocal.app",
    ];
    for key in chromium_keys {
        win_registry::set_default_value(key, &chrome_json.to_string_lossy())?;
    }
    win_registry::set_default_value(
        r"Software\Mozilla\NativeMessagingHosts\com.vaultlocal.app",
        &firefox_json.to_string_lossy(),
    )?;
    Ok(())
}

#[cfg(not(windows))]
fn register_impl(_app: &tauri::AppHandle, exe: &Path) -> Result<(), String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("Sin HOME")?);
    let file = format!("{}.json", HOST_NAME);
    #[cfg(target_os = "macos")]
    let (chromium_bases, firefox_dir) = {
        let sup = home.join("Library/Application Support");
        (
            vec![
                sup.join("Google/Chrome"),
                sup.join("Microsoft Edge"),
                sup.join("BraveSoftware/Brave-Browser"),
                sup.join("Chromium"),
            ],
            sup.join("Mozilla/NativeMessagingHosts"),
        )
    };
    #[cfg(not(target_os = "macos"))]
    let (chromium_bases, firefox_dir) = {
        let cfg = home.join(".config");
        (
            vec![
                cfg.join("google-chrome"),
                cfg.join("microsoft-edge"),
                cfg.join("BraveSoftware/Brave-Browser"),
                cfg.join("chromium"),
            ],
            home.join(".mozilla/native-messaging-hosts"),
        )
    };
    // Solo en los navegadores instalados (su carpeta de perfil existe)
    for base in chromium_bases.iter().filter(|b| b.is_dir()) {
        write_json(
            &base.join("NativeMessagingHosts").join(&file),
            &chromium_manifest(exe),
        )?;
    }
    if firefox_dir.parent().map(|p| p.is_dir()).unwrap_or(false) {
        write_json(&firefox_dir.join(&file), &firefox_manifest(exe))?;
    }
    Ok(())
}

#[cfg(windows)]
mod win_registry {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Crea la clave en HKEY_CURRENT_USER y fija su valor predeterminado (REG_SZ).
    pub fn set_default_value(subkey: &str, value: &str) -> Result<(), String> {
        let subkey_w = wide(subkey);
        let value_w = wide(value);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: punteros válidos a búferes terminados en cero que viven durante la llamada
        let rc = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey_w.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if rc != ERROR_SUCCESS {
            return Err(format!("RegCreateKeyExW {}: {}", subkey, rc));
        }
        let bytes = (value_w.len() * 2) as u32;
        // SAFETY: key es válida; value_w vive durante la llamada
        let rc = unsafe {
            RegSetValueExW(
                key,
                std::ptr::null(),
                0,
                REG_SZ,
                value_w.as_ptr() as *const u8,
                bytes,
            )
        };
        // SAFETY: key fue abierta arriba
        unsafe { RegCloseKey(key) };
        if rc != ERROR_SUCCESS {
            return Err(format!("RegSetValueExW {}: {}", subkey, rc));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_lanzamiento_desde_el_navegador() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(is_invocation(&s(&[
            "vault-local.exe",
            "chrome-extension://abc/",
            "--parent-window=0"
        ])));
        assert!(is_invocation(&s(&[
            "vault-local",
            "/x/com.vaultlocal.app.json",
            "vault-local@vaultlocal.com"
        ])));
        assert!(!is_invocation(&s(&["vault-local.exe"])));
        assert!(!is_invocation(&s(&["vault-local.exe", "--algo"])));
    }

    #[test]
    fn mensajes_con_longitud_prefijada() {
        let mut out = Vec::new();
        write_message(&mut out, &json!({"a": 1})).unwrap();
        assert_eq!(&out[..4], &7u32.to_le_bytes());
        assert_eq!(&out[4..], br#"{"a":1}"#);
    }

    #[test]
    fn sin_app_abierta_responde_error_claro() {
        // Si nadie escucha en el puerto (caso normal en CI), debe devolver un error, no colgarse
        let r = forward(&json!({"method": "ping"}));
        if r.get("success") == Some(&json!(false)) {
            assert!(r.get("error").and_then(|e| e.as_str()).is_some());
        }
    }
}
