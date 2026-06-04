// Repositorio de operaciones sobre la base de datos SQLCipher.
// Gestiona la apertura, inicialización y todas las consultas CRUD.

use std::path::Path;

use rusqlite::{params, Connection};

use super::models::{AttachmentMeta, EntryMeta};

/// Abre una conexión a la base de datos SQLCipher con la clave proporcionada.
///
/// La clave se proporciona como bytes raw de 32 bytes y se convierte a formato hex
/// para el PRAGMA key de SQLCipher.
pub fn open_db(db_path: &Path, db_key: &[u8; 32]) -> Result<Connection, String> {
    let conn =
        Connection::open(db_path).map_err(|e| format!("Error al abrir la base de datos: {}", e))?;

    // Configurar la clave de SQLCipher en formato hex raw
    let hex_key = hex::encode(db_key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))
        .map_err(|e| format!("Error al configurar clave SQLCipher: {}", e))?;

    // Verificar que la clave es correcta intentando leer la base de datos
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| "Contraseña incorrecta o base de datos corrupta".to_string())?;

    // Habilitar claves foráneas para integridad referencial (ej: CASCADE en adjuntos)
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Error al habilitar claves foráneas: {}", e))?;

    Ok(conn)
}

/// Inicializa las tablas del vault si no existen.
pub fn init_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS vault_config (
            key TEXT PRIMARY KEY,
            value BLOB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            encrypted_data BLOB NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
        CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at DESC);

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            encrypted_data BLOB NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);
        ",
    )
    .map_err(|e| format!("Error al crear tablas: {}", e))
}

/// Guarda un valor de configuración en vault_config.
pub fn save_config(conn: &Connection, key: &str, value: &[u8]) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO vault_config (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| format!("Error al guardar configuración '{}': {}", key, e))?;

    Ok(())
}

/// Obtiene un valor de configuración de vault_config.
/// Retorna None si la clave no existe.
pub fn get_config(conn: &Connection, key: &str) -> Result<Option<Vec<u8>>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM vault_config WHERE key = ?1")
        .map_err(|e| format!("Error al preparar consulta de configuración: {}", e))?;

    let result = stmt
        .query_row(params![key], |row| row.get::<_, Vec<u8>>(0))
        .ok();

    Ok(result)
}

/// Inserta una nueva entrada cifrada en la base de datos.
#[allow(clippy::too_many_arguments)]
pub fn insert_entry(
    conn: &Connection,
    id: &str,
    category: &str,
    title: &str,
    encrypted_data: &[u8],
    favorite: bool,
    created_at: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO entries (id, category, title, encrypted_data, favorite, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            category,
            title,
            encrypted_data,
            favorite as i32,
            created_at,
            updated_at,
        ],
    )
    .map_err(|e| format!("Error al insertar entrada: {}", e))?;

    Ok(())
}

/// Lista las entradas con filtros opcionales de categoría y búsqueda.
/// Retorna solo metadatos (sin datos cifrados) para la vista de lista.
pub fn list_entries(
    conn: &Connection,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<EntryMeta>, String> {
    // Construir consulta dinámicamente según los filtros
    let mut sql = String::from(
        "SELECT id, category, title, favorite, created_at, updated_at FROM entries WHERE 1=1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(cat) = category {
        sql.push_str(" AND category = ?");
        param_values.push(Box::new(cat.to_string()));
    }

    if let Some(query) = search {
        sql.push_str(" AND title LIKE ?");
        param_values.push(Box::new(format!("%{}%", query)));
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Error al preparar consulta de entradas: {}", e))?;

    // Convertir los parámetros a referencias para rusqlite
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let entries = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(EntryMeta {
                id: row.get(0)?,
                category: row.get(1)?,
                title: row.get(2)?,
                favorite: row.get::<_, i32>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Error al consultar entradas: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al leer entradas: {}", e))?;

    Ok(entries)
}

/// Obtiene los datos raw de una entrada por su ID.
/// Retorna (category, title, encrypted_data, favorite, created_at, updated_at).
#[allow(clippy::type_complexity)]
pub fn get_entry_raw(
    conn: &Connection,
    id: &str,
) -> Result<(String, String, Vec<u8>, bool, String, String), String> {
    let mut stmt = conn
        .prepare(
            "SELECT category, title, encrypted_data, favorite, created_at, updated_at
             FROM entries WHERE id = ?1",
        )
        .map_err(|e| format!("Error al preparar consulta: {}", e))?;

    stmt.query_row(params![id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Vec<u8>>(2)?,
            row.get::<_, i32>(3)? != 0,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })
    .map_err(|_| format!("Entrada con ID '{}' no encontrada", id))
}

/// Actualiza una entrada existente con nuevos datos cifrados.
pub fn update_entry_raw(
    conn: &Connection,
    id: &str,
    category: &str,
    title: &str,
    encrypted_data: &[u8],
    favorite: bool,
    updated_at: &str,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE entries SET category = ?1, title = ?2, encrypted_data = ?3,
             favorite = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                category,
                title,
                encrypted_data,
                favorite as i32,
                updated_at,
                id,
            ],
        )
        .map_err(|e| format!("Error al actualizar entrada: {}", e))?;

    if rows == 0 {
        return Err(format!("Entrada con ID '{}' no encontrada", id));
    }

    Ok(())
}

/// Elimina una entrada por su ID.
pub fn delete_entry(conn: &Connection, id: &str) -> Result<(), String> {
    let rows = conn
        .execute("DELETE FROM entries WHERE id = ?1", params![id])
        .map_err(|e| format!("Error al eliminar entrada: {}", e))?;

    if rows == 0 {
        return Err(format!("Entrada con ID '{}' no encontrada", id));
    }

    Ok(())
}

/// Alterna el estado de favorito de una entrada.
/// Retorna el nuevo estado (true = favorito, false = no favorito).
pub fn toggle_favorite(conn: &Connection, id: &str) -> Result<bool, String> {
    // Obtener el estado actual
    let current: i32 = conn
        .query_row(
            "SELECT favorite FROM entries WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Entrada con ID '{}' no encontrada", id))?;

    let new_value = if current != 0 { 0 } else { 1 };

    conn.execute(
        "UPDATE entries SET favorite = ?1 WHERE id = ?2",
        params![new_value, id],
    )
    .map_err(|e| format!("Error al cambiar favorito: {}", e))?;

    Ok(new_value != 0)
}

// --- Funciones CRUD para archivos adjuntos ---

/// Inserta un nuevo archivo adjunto cifrado en la base de datos.
#[allow(clippy::too_many_arguments)]
pub fn insert_attachment(
    conn: &Connection,
    id: &str,
    entry_id: &str,
    filename: &str,
    mime_type: &str,
    encrypted_data: &[u8],
    size: u64,
    created_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO attachments (id, entry_id, filename, mime_type, encrypted_data, size, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, entry_id, filename, mime_type, encrypted_data, size as i64, created_at],
    )
    .map_err(|e| format!("Error al insertar adjunto: {}", e))?;

    Ok(())
}

/// Lista los metadatos de los adjuntos de una entrada (sin datos binarios).
/// Útil para mostrar la lista de adjuntos en la UI sin cargar archivos grandes.
pub fn list_attachments(conn: &Connection, entry_id: &str) -> Result<Vec<AttachmentMeta>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, entry_id, filename, mime_type, size, created_at
             FROM attachments WHERE entry_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Error al preparar consulta de adjuntos: {}", e))?;

    let attachments = stmt
        .query_map(params![entry_id], |row| {
            Ok(AttachmentMeta {
                id: row.get(0)?,
                entry_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get::<_, i64>(4)? as u64,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Error al consultar adjuntos: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al leer adjuntos: {}", e))?;

    Ok(attachments)
}

/// Obtiene los metadatos y los datos cifrados de un adjunto por su ID.
/// Retorna la metadata junto con el blob cifrado para su descifrado posterior.
pub fn get_attachment_data(
    conn: &Connection,
    id: &str,
) -> Result<(AttachmentMeta, Vec<u8>), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, entry_id, filename, mime_type, encrypted_data, size, created_at
             FROM attachments WHERE id = ?1",
        )
        .map_err(|e| format!("Error al preparar consulta de adjunto: {}", e))?;

    stmt.query_row(params![id], |row| {
        let meta = AttachmentMeta {
            id: row.get(0)?,
            entry_id: row.get(1)?,
            filename: row.get(2)?,
            mime_type: row.get(3)?,
            size: row.get::<_, i64>(5)? as u64,
            created_at: row.get(6)?,
        };
        let encrypted_data: Vec<u8> = row.get(4)?;
        Ok((meta, encrypted_data))
    })
    .map_err(|_| format!("Adjunto con ID '{}' no encontrado", id))
}

/// Actualiza solo los datos cifrados de un adjunto (para re-cifrado al cambiar contraseña).
pub fn update_attachment_data(
    conn: &Connection,
    id: &str,
    encrypted_data: &[u8],
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE attachments SET encrypted_data = ?1 WHERE id = ?2",
            params![encrypted_data, id],
        )
        .map_err(|e| format!("Error al actualizar adjunto: {}", e))?;

    if rows == 0 {
        return Err(format!("Adjunto '{}' no encontrado", id));
    }

    Ok(())
}

/// Elimina un adjunto por su ID.
pub fn delete_attachment(conn: &Connection, id: &str) -> Result<(), String> {
    let rows = conn
        .execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| format!("Error al eliminar adjunto: {}", e))?;

    if rows == 0 {
        return Err(format!("Adjunto con ID '{}' no encontrado", id));
    }

    Ok(())
}

/// Cuenta el numero de adjuntos asociados a una entrada.
#[allow(dead_code)]
pub fn count_attachments(conn: &Connection, entry_id: &str) -> Result<u32, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attachments WHERE entry_id = ?1",
            params![entry_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Error al contar adjuntos: {}", e))?;

    Ok(count as u32)
}
