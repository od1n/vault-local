// Bóvedas múltiples (Pro).
//
// Cada bóveda es un directorio con sus propios archivos (vault.db, vault.salt, vault.lock
// y, si existe, vault.recovery) y su propia contraseña maestra. Ninguna clave se comparte
// entre bóvedas: abrir una no da acceso a las demás.
//
// Distribución en disco (directorio de datos de la app):
//   vault.db, vault.salt, ...      -> bóveda "principal" (la de siempre; compatibilidad)
//   vaults/<id>/vault.db, ...      -> bóvedas adicionales
//   vaults.json                    -> nombres y bóveda seleccionada (no contiene secretos)
//
// Licencia: crear una bóveda adicional requiere Pro. Abrir, renombrar o borrar bóvedas que
// ya existen NO requiere licencia: si la licencia vence, el usuario nunca pierde acceso a
// sus datos.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::license::{require_tier, Tier};
use crate::state::AppState;

pub const MAIN_ID: &str = "principal";
const REGISTRY_FILE: &str = "vaults.json";
const MAX_NAME_LEN: usize = 40;
const MAX_VAULTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    active: String,
    #[serde(default)]
    vaults: Vec<VaultInfo>,
}

#[derive(Serialize)]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    pub created_at: String,
    /// La bóveda tiene archivos creados (la principal puede no existir todavía)
    pub exists: bool,
}

#[derive(Serialize)]
pub struct VaultList {
    pub active: String,
    pub vaults: Vec<VaultEntry>,
    /// La licencia actual permite crear bóvedas adicionales
    pub can_create: bool,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Error al obtener directorio de datos: {}", e))
}

fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(REGISTRY_FILE))
}

fn main_entry() -> VaultInfo {
    VaultInfo {
        id: MAIN_ID.to_string(),
        name: "Principal".to_string(),
        created_at: String::new(),
    }
}

/// Lee el registro y garantiza que la bóveda principal siempre esté y que `active` sea válida.
fn load(app: &tauri::AppHandle) -> Registry {
    let mut reg: Registry = registry_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    normalize(&mut reg);
    reg
}

fn normalize(reg: &mut Registry) {
    reg.vaults.retain(|v| valid_id(&v.id));
    if !reg.vaults.iter().any(|v| v.id == MAIN_ID) {
        reg.vaults.insert(0, main_entry());
    }
    let mut seen = std::collections::HashSet::new();
    reg.vaults.retain(|v| seen.insert(v.id.clone()));
    if !reg.vaults.iter().any(|v| v.id == reg.active) {
        reg.active = MAIN_ID.to_string();
    }
}

fn save(app: &tauri::AppHandle, reg: &Registry) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Error al crear directorio: {}", e))?;
    }
    let json = serde_json::to_string_pretty(reg)
        .map_err(|e| format!("Error al guardar la lista de bóvedas: {}", e))?;
    // Escritura atómica: primero a un temporal y luego renombrar
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Error al guardar la lista de bóvedas: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Error al guardar la lista de bóvedas: {}", e))
}

/// Los identificadores solo contienen letras minúsculas, números y guiones (sin rutas).
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn clean_name(name: &str) -> Result<String, String> {
    let n: String = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if n.is_empty() {
        return Err("Escribe un nombre para la bóveda".to_string());
    }
    if n.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "El nombre puede tener como máximo {} caracteres",
            MAX_NAME_LEN
        ));
    }
    Ok(n)
}

/// Directorio de una bóveda por su id.
pub fn dir_for(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let base = app_data_dir(app)?;
    if id == MAIN_ID {
        Ok(base)
    } else if valid_id(id) {
        Ok(base.join("vaults").join(id))
    } else {
        Err("Identificador de bóveda no válido".to_string())
    }
}

/// Id de la bóveda seleccionada.
pub fn active_id(app: &tauri::AppHandle) -> String {
    load(app).active
}

/// Nombre de la bóveda seleccionada.
pub fn active_name(app: &tauri::AppHandle) -> String {
    let reg = load(app);
    reg.vaults
        .iter()
        .find(|v| v.id == reg.active)
        .map(|v| v.name.clone())
        .unwrap_or_else(|| "Principal".to_string())
}

/// Directorio de la bóveda seleccionada.
pub fn active_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    dir_for(app, &active_id(app))
}

fn exists_in(dir: &std::path::Path) -> bool {
    dir.join("vault.db").exists() && dir.join("vault.salt").exists()
}

fn vault_is_open(state: &AppState) -> bool {
    state.vault.lock().map(|g| g.is_some()).unwrap_or(true)
}

fn list(app: &tauri::AppHandle) -> VaultList {
    let reg = load(app);
    let vaults = reg
        .vaults
        .iter()
        .map(|v| VaultEntry {
            id: v.id.clone(),
            name: v.name.clone(),
            created_at: v.created_at.clone(),
            exists: dir_for(app, &v.id).map(|d| exists_in(&d)).unwrap_or(false),
        })
        .collect();
    VaultList {
        active: reg.active,
        vaults,
        can_create: require_tier(app, Tier::Pro).is_ok(),
    }
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub name: String,
    pub read_only: bool,
    pub vault_count: usize,
}

/// Datos de la bóveda abierta para la interfaz.
#[tauri::command]
pub fn get_session_info(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<SessionInfo, String> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| "Error al acceder al estado del vault".to_string())?;
    let vault = guard.as_ref().ok_or("El vault está bloqueado")?;
    let vault_count = list(&app).vaults.iter().filter(|v| v.exists).count();
    Ok(SessionInfo {
        name: vault.name.clone(),
        read_only: vault.read_only,
        vault_count,
    })
}

#[tauri::command]
pub fn list_vaults(app: tauri::AppHandle) -> VaultList {
    list(&app)
}

/// Cambia la bóveda seleccionada. Solo con la bóveda actual bloqueada.
#[tauri::command]
pub fn select_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<VaultList, String> {
    if vault_is_open(&state) {
        return Err("Bloquea la bóveda actual antes de cambiar de bóveda".to_string());
    }
    let mut reg = load(&app);
    if !reg.vaults.iter().any(|v| v.id == id) {
        return Err("Esa bóveda no existe".to_string());
    }
    if reg.active != id {
        reg.active = id;
        save(&app, &reg)?;
        // El desbloqueo rápido pertenece a la bóveda anterior
        crate::quick_unlock::disarm(&state);
    }
    Ok(list(&app))
}

/// Registra una bóveda adicional nueva (vacía) y la deja seleccionada.
/// Después el frontend llama a `create_vault` para crearla con su contraseña maestra.
#[tauri::command]
pub fn add_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<VaultList, String> {
    require_tier(&app, Tier::Pro)?;
    if vault_is_open(&state) {
        return Err("Bloquea la bóveda actual antes de crear otra".to_string());
    }
    let name = clean_name(&name)?;
    let mut reg = load(&app);
    // Quitar del registro las bóvedas adicionales que se registraron pero nunca se crearon
    reg.vaults.retain(|v| {
        v.id == MAIN_ID || dir_for(&app, &v.id).map(|d| exists_in(&d)).unwrap_or(false)
    });
    if reg.vaults.len() >= MAX_VAULTS {
        return Err(format!("Puedes tener como máximo {} bóvedas", MAX_VAULTS));
    }
    if reg
        .vaults
        .iter()
        .any(|v| v.name.to_lowercase() == name.to_lowercase())
    {
        return Err("Ya tienes una bóveda con ese nombre".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let dir = dir_for(&app, &id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Error al crear la bóveda: {}", e))?;
    reg.vaults.push(VaultInfo {
        id: id.clone(),
        name,
        created_at: chrono::Utc::now().to_rfc3339(),
    });
    reg.active = id;
    normalize(&mut reg);
    save(&app, &reg)?;
    crate::quick_unlock::disarm(&state);
    Ok(list(&app))
}

#[tauri::command]
pub fn rename_vault(app: tauri::AppHandle, id: String, name: String) -> Result<VaultList, String> {
    let name = clean_name(&name)?;
    let mut reg = load(&app);
    if reg
        .vaults
        .iter()
        .any(|v| v.id != id && v.name.to_lowercase() == name.to_lowercase())
    {
        return Err("Ya tienes una bóveda con ese nombre".to_string());
    }
    let v = reg
        .vaults
        .iter_mut()
        .find(|v| v.id == id)
        .ok_or("Esa bóveda no existe")?;
    v.name = name;
    save(&app, &reg)?;
    Ok(list(&app))
}

/// Borra una bóveda adicional. Pide su contraseña maestra para evitar borrados por error
/// o por otra persona con acceso al equipo. La principal no se puede borrar.
#[tauri::command]
pub fn delete_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    password: String,
) -> Result<VaultList, String> {
    if id == MAIN_ID {
        return Err("La bóveda principal no se puede borrar".to_string());
    }
    if vault_is_open(&state) {
        return Err("Bloquea la bóveda antes de borrar una".to_string());
    }
    let mut reg = load(&app);
    if !reg.vaults.iter().any(|v| v.id == id) {
        return Err("Esa bóveda no existe".to_string());
    }
    let dir = dir_for(&app, &id)?;
    // Sin contraseña solo se borra un registro vacío (sin vault.db)
    if dir.join("vault.db").exists() {
        let lock_path = dir.join("vault.lock");
        let mut lockout = crate::lockout::LockoutState::load(&lock_path);
        if let Err(secs) = lockout.check_allowed() {
            return Err(format!(
                "Demasiados intentos fallidos. Espera {} segundos.",
                secs
            ));
        }
        if let Err(e) = crate::commands::auth::check_password_at(&dir, &password) {
            if e == "Contraseña incorrecta" {
                lockout.record_failure();
                let _ = lockout.save(&lock_path);
            }
            return Err(e);
        }
    }
    let mut password = password;
    zeroize::Zeroize::zeroize(&mut password);

    fs::remove_dir_all(&dir).map_err(|e| format!("Error al borrar la bóveda: {}", e))?;
    reg.vaults.retain(|v| v.id != id);
    if reg.active == id {
        reg.active = MAIN_ID.to_string();
        crate::quick_unlock::disarm(&state);
    }
    normalize(&mut reg);
    save(&app, &reg)?;
    Ok(list(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_validos() {
        assert!(valid_id("principal"));
        assert!(valid_id("3f2a-11"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("A"));
    }

    #[test]
    fn registro_siempre_tiene_principal_y_activa_valida() {
        let mut reg = Registry {
            active: "no-existe".into(),
            vaults: vec![
                VaultInfo {
                    id: "trabajo".into(),
                    name: "Trabajo".into(),
                    created_at: String::new(),
                },
                VaultInfo {
                    id: "../malo".into(),
                    name: "x".into(),
                    created_at: String::new(),
                },
                VaultInfo {
                    id: "trabajo".into(),
                    name: "Repetida".into(),
                    created_at: String::new(),
                },
            ],
        };
        normalize(&mut reg);
        assert_eq!(reg.active, MAIN_ID);
        let ids: Vec<_> = reg.vaults.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, vec![MAIN_ID, "trabajo"]);
    }

    #[test]
    fn nombres() {
        assert_eq!(clean_name("  Mi   bóveda ").unwrap(), "Mi bóveda");
        assert!(clean_name("   ").is_err());
        assert!(clean_name(&"x".repeat(41)).is_err());
    }
}
