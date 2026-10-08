// Integración con el escritorio: detección de suspensión y bloqueo de sesión,
// bloqueo al minimizar, bandeja del sistema y atajo global.
//
// Cuando hay que bloquear, se emite el evento "request-lock" a la interfaz,
// que ejecuta el mismo flujo de bloqueo que el botón (incluye el respaldo automático).

use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::settings;

/// Si entre dos lecturas del reloj pasan más de esto, el equipo estuvo suspendido.
const SLEEP_GAP: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone)]
pub struct LockRequest {
    /// "sleep" | "session_lock" | "minimize" | "tray"
    pub reason: String,
}

pub fn request_lock(app: &tauri::AppHandle, reason: &str) {
    // Bloquear en el backend directamente: no depender de que el JavaScript de una
    // ventana oculta o suspendida reciba el evento. El evento solo refresca la interfaz.
    let state = app.state::<crate::state::AppState>();
    let unlocked = state.vault.lock().map(|g| g.is_some()).unwrap_or(false);
    if unlocked {
        let _ = crate::commands::auth::lock_vault(app.clone(), state);
    }
    let _ = app.emit(
        "request-lock",
        LockRequest {
            reason: reason.to_string(),
        },
    );
}

/// true si la sesión de Windows está bloqueada (Win+L) o en la pantalla segura.
#[cfg(target_os = "windows")]
fn session_locked() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_SWITCHDESKTOP,
    };
    // Con la sesión bloqueada, el escritorio de entrada no es accesible para la app.
    unsafe {
        let desk = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
        if desk.is_null() {
            true
        } else {
            CloseDesktop(desk);
            false
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn session_locked() -> bool {
    false
}

/// Hilo que vigila suspensión y bloqueo de sesión.
pub fn start_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last = SystemTime::now();
        let mut was_locked = false;
        loop {
            thread::sleep(POLL);
            let now = SystemTime::now();
            let gap = now.duration_since(last).unwrap_or_default();
            last = now;

            let cfg = settings::effective(&app);

            if gap > SLEEP_GAP && cfg.lock_on_sleep {
                request_lock(&app, "sleep");
            }

            let locked = session_locked();
            if locked && !was_locked && cfg.lock_on_session_lock {
                request_lock(&app, "session_lock");
            }
            was_locked = locked;
        }
    });
}

/// Reacciona a eventos de la ventana principal (minimizar, cerrar).
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle();
    match event {
        tauri::WindowEvent::Resized(_) => {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_minimized().unwrap_or(false) && settings::effective(app).lock_on_minimize {
                    request_lock(app, "minimize");
                }
            }
        }
        tauri::WindowEvent::CloseRequested { api, .. }
            if settings::effective(app).close_to_tray =>
        {
            api.prevent_close();
            let _ = window.hide();
        }
        _ => {}
    }
}

const TRAY_ID: &str = "main-tray";
const QUICK_LABEL: &str = "quick";

/// Muestra y enfoca la ventana principal.
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Oculta la ventana de búsqueda rápida si existe.
pub fn hide_quick(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(QUICK_LABEL) {
        let _ = w.hide();
    }
}

/// Ventana que tenía el foco antes de abrir la búsqueda rápida (solo Windows).
static PREV_FOREGROUND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

#[cfg(target_os = "windows")]
fn foreground_window() -> isize {
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
}

#[cfg(not(target_os = "windows"))]
fn foreground_window() -> isize {
    0
}

/// true si el foco volvió a la ventana que estaba activa antes de la búsqueda rápida.
/// En sistemas donde no se puede comprobar, devuelve true.
pub fn focus_returned_to_previous() -> bool {
    let prev = PREV_FOREGROUND.load(std::sync::atomic::Ordering::SeqCst);
    if cfg!(target_os = "windows") {
        prev != 0 && foreground_window() == prev
    } else {
        true
    }
}

/// Muestra la búsqueda rápida (la crea la primera vez).
pub fn show_quick(app: &tauri::AppHandle) {
    PREV_FOREGROUND.store(foreground_window(), std::sync::atomic::Ordering::SeqCst);
    let window = match app.get_webview_window(QUICK_LABEL) {
        Some(w) => w,
        None => {
            let built = tauri::WebviewWindowBuilder::new(
                app,
                QUICK_LABEL,
                tauri::WebviewUrl::App("index.html#quick".into()),
            )
            .title("Vault Local — Búsqueda rápida")
            .inner_size(640.0, 440.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build();
            match built {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("No se pudo crear la búsqueda rápida: {}", e);
                    return;
                }
            }
        }
    };
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(QUICK_LABEL, "quick-opened", ());
}

/// Acción del atajo global: avanza la copia en secuencia o abre/cierra la búsqueda rápida.
pub fn on_quick_shortcut(app: &tauri::AppHandle) {
    // Si la licencia venció con la app abierta, el atajo deja de funcionar
    if !settings::effective(app).quick_search_enabled {
        apply_settings(app);
        return;
    }
    let state = app.state::<crate::state::AppState>();
    if crate::commands::quick::advance_sequence(app, &state) {
        return;
    }
    let visible = app
        .get_webview_window(QUICK_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_quick(app);
    } else {
        show_quick(app);
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Mostrar Vault Local", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Búsqueda rápida", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Bloquear", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &lock, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Vault Local")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quick" => show_quick(app),
            "lock" => request_lock(app, "tray"),
            "quit" => {
                // Bloquear (respaldo incluido) antes de salir
                let state = app.state::<crate::state::AppState>();
                let unlocked = state.vault.lock().map(|g| g.is_some()).unwrap_or(false);
                if unlocked {
                    let _ = crate::commands::auth::lock_vault(app.clone(), state);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Aplica los ajustes que dependen del sistema (bandeja, atajo global).
pub fn apply_settings(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let cfg = settings::effective(app);

    // Bandeja del sistema
    let exists = app.tray_by_id(TRAY_ID).is_some();
    if cfg.tray_enabled && !exists {
        if let Err(e) = build_tray(app) {
            eprintln!("No se pudo crear el ícono de bandeja: {}", e);
        }
    } else if !cfg.tray_enabled && exists {
        let _ = app.remove_tray_by_id(TRAY_ID);
    }

    // Atajo global
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if cfg.quick_search_enabled {
        if let Err(e) = gs.register(cfg.quick_search_shortcut.as_str()) {
            eprintln!(
                "No se pudo registrar el atajo {}: {}",
                cfg.quick_search_shortcut, e
            );
            let _ = app.emit(
                "shortcut-error",
                format!(
                    "No se pudo registrar el atajo {}. Puede que otro programa ya lo use.",
                    cfg.quick_search_shortcut
                ),
            );
        }
    } else {
        hide_quick(app);
    }
}

#[tauri::command]
pub fn hide_quick_window(app: tauri::AppHandle) {
    hide_quick(&app);
}

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) {
    hide_quick(&app);
    show_main(&app);
}
