// Módulo de validaciones de seguridad.
// Contiene funciones para validar rutas de archivos y prevenir ataques de path traversal.

use std::path::PathBuf;

/// Valida que una ruta de archivo sea segura (sin traversal de directorios,
/// dentro de directorios accesibles al usuario).
///
/// # Errores
/// Retorna error si la ruta contiene "..", si el directorio padre no existe,
/// o si la ruta está fuera del directorio home del usuario.
pub fn validate_file_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);

    // Rechazar rutas con traversal de directorios
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Ruta no permitida: contiene '..'".to_string());
    }

    // Canonicalizar para resolver enlaces simbólicos.
    // Para archivos nuevos (exportar/guardar), verificar el directorio padre.
    let check_path = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Ruta inválida: {}", e))?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| "Ruta inválida: sin directorio padre".to_string())?;
        if !parent.exists() {
            return Err("El directorio destino no existe".to_string());
        }
        parent
            .canonicalize()
            .map_err(|e| format!("Ruta inválida: {}", e))?
            .join(
                path.file_name()
                    .ok_or("Nombre de archivo inválido")?,
            )
    };

    // Obtener el directorio home del usuario
    let home = dirs_or_home();

    // Solo permitir rutas dentro del directorio del usuario
    if !check_path.starts_with(&home) {
        return Err("Solo se permiten rutas dentro del directorio del usuario".to_string());
    }

    Ok(check_path)
}

/// Obtiene el directorio home del usuario.
/// Intenta USERPROFILE (Windows) y HOME (Unix) como variables de entorno.
fn dirs_or_home() -> PathBuf {
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        PathBuf::from(home)
    } else {
        // Fallback muy restrictivo
        PathBuf::from(".")
    }
}
