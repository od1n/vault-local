// Punto de entrada principal de Vault Local.
// Delega toda la lógica al crate de biblioteca para compatibilidad con Tauri 2.0.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Lanzado por el navegador para la extensión: funcionar solo como puente, sin ventana
    let args: Vec<String> = std::env::args().collect();
    if vault_local_lib::native_host::is_invocation(&args) {
        vault_local_lib::native_host::run();
        return;
    }
    vault_local_lib::run()
}
