// Búsqueda rápida, copia en secuencia y escritura automática.
//
// Copia en secuencia (pago):
//   En la búsqueda rápida, "Copiar usuario" deja preparada la secuencia
//   contraseña -> TOTP. Mientras esté preparada (máximo 2 minutos), cada vez que
//   pulses el atajo global NO se abre la ventana: se copia el siguiente elemento.
//   Así puedes: atajo -> buscar -> Enter (usuario) -> pegar -> atajo (contraseña)
//   -> pegar -> atajo (TOTP) -> pegar, sin volver a la app.
//
// Escritura automática (pago):
//   Escribe en la ventana activa una secuencia como
//   "{USERNAME}{TAB}{PASSWORD}{ENTER}". Marcadores admitidos:
//   {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY n} y texto literal.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use crate::commands::clipboard::{copy_secret, read_entry, ClipboardStatus};
use crate::commands::totp;
use crate::db::models::EntryData;
use crate::settings;
use crate::state::AppState;

const SEQUENCE_TTL: Duration = Duration::from_secs(120);
/// Tiempo para que el foco vuelva a la ventana anterior antes de escribir
const AUTO_TYPE_FOCUS_DELAY: Duration = Duration::from_millis(400);
const MAX_DELAY_MS: u64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum What {
    Username,
    Password,
    Totp,
}

impl What {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "username" => Ok(Self::Username),
            "password" => Ok(Self::Password),
            "totp" => Ok(Self::Totp),
            _ => Err(format!("Tipo de dato desconocido: {}", s)),
        }
    }
}

struct Sequence {
    entry_id: String,
    pending: Vec<What>,
    expires: Instant,
}

static SEQUENCE: Mutex<Option<Sequence>> = Mutex::new(None);

fn is_username_name(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "usuario", "user", "email", "e-mail", "correo", "login", "cuenta", "account",
    ]
    .iter()
    .any(|k| n.contains(k))
}

/// Obtiene el valor pedido de una entrada descifrada.
pub fn resolve(entry: &EntryData, what: What) -> Option<String> {
    match what {
        What::Username => entry
            .fields
            .iter()
            .find(|f| f.field_type == "text" && !f.sensitive && is_username_name(&f.name))
            .or_else(|| {
                entry.fields.iter().find(|f| {
                    f.field_type == "text"
                        && !f.sensitive
                        && !f.value.contains("://")
                        && !f.value.trim().is_empty()
                })
            })
            .map(|f| f.value.clone()),
        What::Password => entry
            .fields
            .iter()
            .find(|f| f.field_type == "password")
            .or_else(|| {
                entry
                    .fields
                    .iter()
                    .find(|f| f.sensitive && f.field_type == "text")
            })
            .map(|f| f.value.clone()),
        What::Totp => entry
            .fields
            .iter()
            .find(|f| f.field_type == "totp" && !f.value.trim().is_empty())
            .and_then(|f| totp::generate_totp(f.value.clone(), None, None).ok())
            .map(|c| c.code),
    }
    .filter(|v| !v.is_empty())
}

fn what_label(w: What) -> &'static str {
    match w {
        What::Username => "usuario",
        What::Password => "contraseña",
        What::Totp => "código TOTP",
    }
}

/// Copia el usuario, la contraseña o el TOTP de una entrada.
#[tauri::command]
pub fn quick_copy(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    what: String,
) -> Result<ClipboardStatus, String> {
    let what = What::parse(&what)?;
    let entry = read_entry(&state, &entry_id)?;
    let value = Zeroizing::new(
        resolve(&entry, what)
            .ok_or_else(|| format!("Esta entrada no tiene {}", what_label(what)))?,
    );
    let status = copy_secret(&app, &value)?;

    // Preparar la copia en secuencia
    let mut seq = SEQUENCE.lock().unwrap_or_else(|e| e.into_inner());
    *seq = None;
    if what == What::Username && settings::effective(&app).copy_sequence {
        let pending: Vec<What> = [What::Password, What::Totp]
            .into_iter()
            .filter(|w| resolve(&entry, *w).is_some())
            .collect();
        if !pending.is_empty() {
            *seq = Some(Sequence {
                entry_id,
                pending,
                expires: Instant::now() + SEQUENCE_TTL,
            });
        }
    }
    Ok(status)
}

/// Si hay una copia en secuencia preparada, copia el siguiente elemento.
/// Devuelve true si consumió la pulsación del atajo.
pub fn advance_sequence(app: &tauri::AppHandle, state: &AppState) -> bool {
    let mut seq = SEQUENCE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(s) = seq.as_mut() else {
        return false;
    };
    if Instant::now() > s.expires || s.pending.is_empty() {
        *seq = None;
        return false;
    }
    let next = s.pending.remove(0);
    let entry_id = s.entry_id.clone();
    if s.pending.is_empty() {
        *seq = None;
    }
    drop(seq);

    if let Ok(entry) = read_entry(state, &entry_id) {
        if let Some(v) = resolve(&entry, next) {
            let v = Zeroizing::new(v);
            return copy_secret(app, &v).is_ok();
        }
    }
    false
}

/// Cancela la secuencia (al bloquear la bóveda).
pub fn cancel_sequence() {
    *SEQUENCE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Paso de una secuencia de escritura automática ya resuelta.
#[derive(Debug, PartialEq)]
pub enum Step {
    Text(String),
    Tab,
    Enter,
    Delay(u64),
}

/// Convierte "{USERNAME}{TAB}{PASSWORD}{ENTER}" en pasos.
/// `lookup` resuelve USERNAME/PASSWORD/TOTP.
pub fn parse_sequence(
    seq: &str,
    lookup: impl Fn(What) -> Option<String>,
) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    let mut rest = seq;
    while !rest.is_empty() {
        if let Some(start) = rest.find('{') {
            if start > 0 {
                steps.push(Step::Text(rest[..start].to_string()));
            }
            let end = rest[start..]
                .find('}')
                .map(|e| start + e)
                .ok_or("Secuencia inválida: falta '}'")?;
            let token = rest[start + 1..end].trim().to_uppercase();
            let mut parts = token.split_whitespace();
            match (parts.next(), parts.next()) {
                (Some("USERNAME"), None) => steps.push(Step::Text(
                    lookup(What::Username).ok_or("La entrada no tiene usuario")?,
                )),
                (Some("PASSWORD"), None) => steps.push(Step::Text(
                    lookup(What::Password).ok_or("La entrada no tiene contraseña")?,
                )),
                (Some("TOTP"), None) => steps.push(Step::Text(
                    lookup(What::Totp).ok_or("La entrada no tiene TOTP")?,
                )),
                (Some("TAB"), None) => steps.push(Step::Tab),
                (Some("ENTER"), None) => steps.push(Step::Enter),
                (Some("DELAY"), Some(ms)) => {
                    let ms: u64 = ms.parse().map_err(|_| "DELAY necesita un número")?;
                    steps.push(Step::Delay(ms.min(MAX_DELAY_MS)));
                }
                _ => return Err(format!("Marcador desconocido: {{{}}}", token)),
            }
            rest = &rest[end + 1..];
        } else {
            steps.push(Step::Text(rest.to_string()));
            break;
        }
    }
    Ok(steps)
}

fn type_steps(steps: Vec<Step>) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("No se pudo simular el teclado: {}", e))?;
    for step in steps {
        match step {
            Step::Text(t) => {
                let t = Zeroizing::new(t);
                enigo
                    .text(&t)
                    .map_err(|e| format!("Error al escribir: {}", e))?;
            }
            Step::Tab => enigo
                .key(Key::Tab, Direction::Click)
                .map_err(|e| format!("Error al pulsar Tab: {}", e))?,
            Step::Enter => enigo
                .key(Key::Return, Direction::Click)
                .map_err(|e| format!("Error al pulsar Enter: {}", e))?,
            Step::Delay(ms) => thread::sleep(Duration::from_millis(ms)),
        }
        thread::sleep(Duration::from_millis(30));
    }
    Ok(())
}

/// Escribe la secuencia en la ventana que estaba activa antes de la búsqueda rápida.
#[tauri::command]
pub fn quick_auto_type(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry_id: String,
    sequence: Option<String>,
) -> Result<(), String> {
    if !settings::is_premium(&app) {
        return Err("La escritura automática requiere una licencia Premium".to_string());
    }
    let seq = sequence
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| settings::effective(&app).auto_type_sequence);
    let entry = read_entry(&state, &entry_id)?;
    let steps = parse_sequence(&seq, |w| resolve(&entry, w))?;
    drop(entry);

    // Ocultar la búsqueda rápida para devolver el foco a la ventana anterior
    crate::desktop::hide_quick(&app);
    thread::spawn(move || {
        thread::sleep(AUTO_TYPE_FOCUS_DELAY);
        if let Err(e) = type_steps(steps) {
            eprintln!("Escritura automática: {}", e);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::EntryField;

    fn field(name: &str, value: &str, t: &str, sensitive: bool) -> EntryField {
        EntryField {
            name: name.into(),
            value: value.into(),
            sensitive,
            field_type: t.into(),
        }
    }

    fn entry() -> EntryData {
        EntryData {
            fields: vec![
                field("URL", "https://ejemplo.com", "text", false),
                field("Correo", "yo@ejemplo.com", "text", false),
                field("Contraseña", "s3creta", "password", true),
            ],
            notes: String::new(),
        }
    }

    #[test]
    fn resuelve_campos() {
        let e = entry();
        assert_eq!(
            resolve(&e, What::Username).as_deref(),
            Some("yo@ejemplo.com")
        );
        assert_eq!(resolve(&e, What::Password).as_deref(), Some("s3creta"));
        assert_eq!(resolve(&e, What::Totp), None);
    }

    #[test]
    fn interpreta_secuencia() {
        let e = entry();
        let pasos = parse_sequence("{USERNAME}{TAB}{PASSWORD}{delay 100}x{ENTER}", |w| {
            resolve(&e, w)
        })
        .unwrap();
        assert_eq!(
            pasos,
            vec![
                Step::Text("yo@ejemplo.com".into()),
                Step::Tab,
                Step::Text("s3creta".into()),
                Step::Delay(100),
                Step::Text("x".into()),
                Step::Enter,
            ]
        );
        assert!(parse_sequence("{TOTP}", |w| resolve(&e, w)).is_err());
        assert!(parse_sequence("{FOO}", |w| resolve(&e, w)).is_err());
        assert!(parse_sequence("{TAB", |w| resolve(&e, w)).is_err());
    }
}
