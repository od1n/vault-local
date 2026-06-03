// Punto de entrada principal de Vault Local.
// Delega toda la lógica al crate de biblioteca para compatibilidad con Tauri 2.0.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vault_local_lib::run()
}
