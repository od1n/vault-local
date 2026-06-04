// Módulo raíz de la biblioteca Vault Local.
// Configura Tauri, registra todos los comandos y gestiona el estado global.

mod commands;
mod crypto;
mod db;
pub mod ipc_server;
mod lockout;
pub mod security;
mod state;

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use state::AppState;

/// Dimensiones mínimas y por defecto de la ventana (en píxeles lógicos).
const MIN_WIDTH: f64 = 1100.0;
const MIN_HEIGHT: f64 = 750.0;
const DEFAULT_WIDTH: f64 = 1400.0;
const DEFAULT_HEIGHT: f64 = 900.0;

/// Estado de la ventana persistido en disco.
#[derive(Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    x: i32,
    y: i32,
    maximized: bool,
}

/// Obtiene la ruta del archivo de estado de la ventana.
fn window_state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("window-state.json"))
}

/// Carga el estado guardado de la ventana desde disco.
fn load_window_state(path: &PathBuf) -> Option<WindowState> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Guarda el estado actual de la ventana a disco.
fn save_window_state(window: &tauri::Window) {
    let app = window.app_handle();
    if let Some(path) = window_state_path(app) {
        if let Some(wv) = app.get_webview_window(window.label()) {
            let scale = wv.scale_factor().unwrap_or(1.0);
            let size = wv.inner_size().unwrap_or_default();
            let pos = wv.outer_position().unwrap_or_default();
            let maximized = wv.is_maximized().unwrap_or(false);

            let state = WindowState {
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
                x: pos.x,
                y: pos.y,
                maximized,
            };

            if let Ok(json) = serde_json::to_string(&state) {
                let _ = fs::write(&path, json);
            }
        }
    }
}

/// Inicializa y ejecuta la aplicación Tauri con todos los plugins y comandos registrados.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("No se encontró la ventana principal");

            // Restaurar estado guardado con enforcement de mínimos
            let mut restored = false;
            if let Some(path) = window_state_path(app.handle()) {
                if let Some(state) = load_window_state(&path) {
                    let w = state.width.max(MIN_WIDTH);
                    let h = state.height.max(MIN_HEIGHT);
                    let _ = window.set_size(tauri::LogicalSize::new(w, h));
                    let _ = window
                        .set_position(tauri::LogicalPosition::new(state.x as f64, state.y as f64));
                    if state.maximized {
                        let _ = window.maximize();
                    }
                    restored = true;
                }
            }

            // Si no hay estado guardado, usar dimensiones por defecto
            if !restored {
                let _ = window.set_size(tauri::LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
                let _ = window.center();
            }

            // Mostrar la ventana (estaba oculta para evitar flash)
            let _ = window.show();

            Ok(())
        })
        .on_window_event(|window, event| {
            // Guardar estado al cerrar, mover o redimensionar
            match event {
                tauri::WindowEvent::CloseRequested { .. }
                | tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_) => {
                    save_window_state(window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Autenticación
            commands::auth::is_vault_created,
            commands::auth::create_vault,
            commands::auth::unlock_vault,
            commands::auth::lock_vault,
            commands::auth::get_lockout_status,
            commands::auth::change_master_password,
            // CRUD de entradas
            commands::vault::get_entries,
            commands::vault::get_entry,
            commands::vault::create_entry,
            commands::vault::update_entry,
            commands::vault::delete_entry,
            commands::vault::toggle_favorite,
            // Portapapeles
            commands::clipboard::copy_to_clipboard,
            commands::clipboard::copy_field_to_clipboard,
            // Importar/Exportar
            commands::import_export::import_entries,
            commands::import_export::export_entries,
            commands::import_export::import_kdbx,
            // Agente SSH
            commands::ssh_agent::list_ssh_keys,
            commands::ssh_agent::add_key_to_agent,
            commands::ssh_agent::remove_key_from_agent,
            commands::ssh_agent::add_all_ssh_keys,
            // Archivos adjuntos
            commands::attachments::add_attachment,
            commands::attachments::list_attachments,
            commands::attachments::download_attachment,
            commands::attachments::delete_attachment,
            // Sincronización cifrada
            commands::sync::export_sync_file,
            commands::sync::import_sync_file,
            // Generador de contraseñas
            crypto::password_gen::generate_password,
            // Token IPC para la extensión del navegador
            commands::auth::get_ipc_token,
            // Auditoría de contraseñas y verificación de filtraciones
            commands::audit::run_password_audit,
            commands::audit::check_hibp,
            // Generador TOTP (RFC 6238)
            commands::totp::generate_totp,
            // Sistema de licencias offline
            commands::license::activate_license,
            commands::license::check_license,
            commands::license::deactivate_license,
            commands::license::generate_license_key,
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar la aplicación Vault Local");
}
