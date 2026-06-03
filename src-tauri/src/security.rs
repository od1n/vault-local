// Módulo de validaciones de seguridad.
// Contiene funciones para validar rutas de archivos y prevenir ataques de path traversal.

use std::path::PathBuf;

/// Valida que una ruta de archivo sea segura.
///
/// Protecciones:
/// - Rechaza rutas con ".." (path traversal)
/// - Verifica que el directorio padre exista
/// - Canonicaliza la ruta para resolver symlinks
///
/// La ruta proviene del diálogo de archivos del OS (que el usuario eligió explícitamente),
/// por lo que no se restringe a un directorio específico — el usuario puede guardar
/// en cualquier ubicación a la que tenga acceso.
pub fn validate_file_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);

    // Rechazar rutas con traversal de directorios
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Ruta no permitida: contiene '..'".to_string());
    }

    // Rechazar rutas vacías
    if path_str.trim().is_empty() {
        return Err("Ruta vacía".to_string());
    }

    // Para archivos existentes, canonicalizar
    if path.exists() {
        let canonical = path.canonicalize()
            .map_err(|e| format!("Ruta inválida: {}", e))?;
        return Ok(canonical);
    }

    // Para archivos nuevos, verificar que el directorio padre exista
    let parent = path
        .parent()
        .ok_or_else(|| "Ruta inválida: sin directorio padre".to_string())?;

    if !parent.exists() {
        return Err("El directorio destino no existe".to_string());
    }

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Ruta inválida: {}", e))?;

    let filename = path
        .file_name()
        .ok_or("Nombre de archivo inválido")?;

    Ok(canonical_parent.join(filename))
}
