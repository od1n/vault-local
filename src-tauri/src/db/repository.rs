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

    migrate(&conn)?;

    Ok(conn)
}

/// Columnas agregadas después de la versión 0.2.0. Se agregan si faltan.
const ENTRY_COLUMNS_V3: &[(&str, &str)] = &[
    ("tags", "TEXT NOT NULL DEFAULT '[]'"),
    ("deleted_at", "TEXT"),
    ("last_used_at", "TEXT"),
    ("use_count", "INTEGER NOT NULL DEFAULT 0"),
    ("expires_at", "TEXT"),
];

/// Actualiza el esquema de bases de datos creadas con versiones anteriores.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    let table_exists: bool = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='entries'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .map_err(|e| format!("Error al revisar el esquema: {}", e))?;
    if !table_exists {
        return Ok(());
    }

    let mut stmt = conn
        .prepare("PRAGMA table_info(entries)")
        .map_err(|e| format!("Error al revisar columnas: {}", e))?;
    let existing: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("Error al revisar columnas: {}", e))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Error al revisar columnas: {}", e))?;

    for (name, def) in ENTRY_COLUMNS_V3 {
        if !existing.iter().any(|c| c == name) {
            conn.execute_batch(&format!("ALTER TABLE entries ADD COLUMN {} {};", name, def))
                .map_err(|e| format!("Error al migrar la columna {}: {}", name, e))?;
        }
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);")
        .map_err(|e| format!("Error al crear índice: {}", e))?;
    Ok(())
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
    .map_err(|e| format!("Error al crear tablas: {}", e))?;
    migrate(conn)
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

/// Elimina un valor de configuración de vault_config.
pub fn delete_config(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM vault_config WHERE key = ?1", params![key])
        .map_err(|e| format!("Error al borrar configuración '{}': {}", key, e))?;
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

/// Columnas de metadatos que se leen para EntryMeta.
const META_COLUMNS: &str =
    "id, category, title, favorite, created_at, updated_at, tags, last_used_at, use_count, expires_at, deleted_at";

fn row_to_meta(row: &rusqlite::Row) -> rusqlite::Result<EntryMeta> {
    let tags_json: String = row.get(6)?;
    Ok(EntryMeta {
        id: row.get(0)?,
        category: row.get(1)?,
        title: row.get(2)?,
        favorite: row.get::<_, i32>(3)? != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        last_used_at: row.get(7)?,
        use_count: row.get::<_, i64>(8)?.max(0) as u32,
        expires_at: row.get(9)?,
        deleted_at: row.get(10)?,
    })
}

/// Lista las entradas (fuera de la papelera) con filtros opcionales de categoría y búsqueda.
/// La búsqueda revisa el título y las etiquetas. Retorna solo metadatos.
pub fn list_entries(
    conn: &Connection,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<EntryMeta>, String> {
    let mut sql = format!(
        "SELECT {} FROM entries WHERE deleted_at IS NULL",
        META_COLUMNS
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(cat) = category {
        sql.push_str(" AND category = ?");
        param_values.push(Box::new(cat.to_string()));
    }

    if let Some(query) = search {
        sql.push_str(" AND (title LIKE ? OR tags LIKE ?)");
        param_values.push(Box::new(format!("%{}%", query)));
        param_values.push(Box::new(format!("%{}%", query)));
    }

    sql.push_str(" ORDER BY updated_at DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Error al preparar consulta de entradas: {}", e))?;

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let entries = stmt
        .query_map(params_refs.as_slice(), row_to_meta)
        .map_err(|e| format!("Error al consultar entradas: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al leer entradas: {}", e))?;

    Ok(entries)
}

/// Metadatos de una entrada por ID (incluida la papelera).
pub fn get_entry_meta(conn: &Connection, id: &str) -> Result<EntryMeta, String> {
    conn.query_row(
        &format!("SELECT {} FROM entries WHERE id = ?1", META_COLUMNS),
        params![id],
        row_to_meta,
    )
    .map_err(|_| format!("Entrada con ID '{}' no encontrada", id))
}

/// Lista TODAS las entradas, incluidas las de la papelera.
/// Se usa al cambiar la contraseña maestra: todo debe volver a cifrarse.
pub fn list_entries_including_deleted(conn: &Connection) -> Result<Vec<EntryMeta>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM entries", META_COLUMNS))
        .map_err(|e| format!("Error al preparar consulta: {}", e))?;
    let rows = stmt
        .query_map([], row_to_meta)
        .map_err(|e| format!("Error al consultar entradas: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al leer entradas: {}", e))?;
    Ok(rows)
}

/// Lista las entradas que están en la papelera.
pub fn list_trash(conn: &Connection) -> Result<Vec<EntryMeta>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            META_COLUMNS
        ))
        .map_err(|e| format!("Error al preparar consulta: {}", e))?;
    let rows = stmt
        .query_map([], row_to_meta)
        .map_err(|e| format!("Error al consultar la papelera: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al leer la papelera: {}", e))?;
    Ok(rows)
}

/// Envía una entrada a la papelera (borrado reversible).
pub fn soft_delete_entry(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE entries SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )
        .map_err(|e| format!("Error al mover a la papelera: {}", e))?;
    if rows == 0 {
        return Err(format!("Entrada con ID '{}' no encontrada", id));
    }
    Ok(())
}

/// Saca una entrada de la papelera.
pub fn restore_entry(conn: &Connection, id: &str) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE entries SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("Error al restaurar: {}", e))?;
    if rows == 0 {
        return Err(format!("Entrada con ID '{}' no encontrada", id));
    }
    Ok(())
}

/// Borra definitivamente las entradas que llevan en la papelera desde antes de `before`.
/// Con `before = None` vacía toda la papelera. Retorna cuántas se borraron.
pub fn purge_trash(conn: &Connection, before: Option<&str>) -> Result<usize, String> {
    match before {
        Some(b) => conn.execute(
            "DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            params![b],
        ),
        None => conn.execute("DELETE FROM entries WHERE deleted_at IS NOT NULL", []),
    }
    .map_err(|e| format!("Error al vaciar la papelera: {}", e))
}

/// Guarda las etiquetas de una entrada.
pub fn set_tags(conn: &Connection, id: &str, tags: &[String]) -> Result<(), String> {
    let json = serde_json::to_string(tags).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE entries SET tags = ?1 WHERE id = ?2",
        params![json, id],
    )
    .map_err(|e| format!("Error al guardar etiquetas: {}", e))?;
    Ok(())
}

/// Guarda (o quita) la fecha de vencimiento de una entrada.
pub fn set_expiry(conn: &Connection, id: &str, expires_at: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE entries SET expires_at = ?1 WHERE id = ?2",
        params![expires_at, id],
    )
    .map_err(|e| format!("Error al guardar vencimiento: {}", e))?;
    Ok(())
}

/// Registra que una entrada se usó (copiar, escribir automáticamente).
pub fn touch_usage(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE entries SET last_used_at = ?1, use_count = use_count + 1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| format!("Error al registrar uso: {}", e))?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Base con el esquema de la versión 0.2.0 (sin columnas nuevas).
    fn old_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE entries (
                id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL,
                encrypted_data BLOB NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO entries VALUES ('a','web','Banco',x'00',0,'2026-01-01','2026-01-01');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn migra_esquema_anterior_sin_perder_datos() {
        let conn = old_schema();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // idempotente
        let list = list_entries(&conn, None, None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Banco");
        assert!(list[0].tags.is_empty());
        assert_eq!(list[0].use_count, 0);
    }

    #[test]
    fn papelera_etiquetas_y_uso() {
        let conn = old_schema();
        migrate(&conn).unwrap();
        set_tags(&conn, "a", &["trabajo".into()]).unwrap();
        assert_eq!(list_entries(&conn, None, Some("trab")).unwrap().len(), 1);
        touch_usage(&conn, "a", "2026-10-08T00:00:00Z").unwrap();
        assert_eq!(list_entries(&conn, None, None).unwrap()[0].use_count, 1);

        soft_delete_entry(&conn, "a", "2026-10-08T00:00:00Z").unwrap();
        assert!(list_entries(&conn, None, None).unwrap().is_empty());
        assert_eq!(list_trash(&conn).unwrap().len(), 1);
        // El cambio de contraseña debe ver también la papelera
        assert_eq!(list_entries_including_deleted(&conn).unwrap().len(), 1);

        restore_entry(&conn, "a").unwrap();
        assert_eq!(list_entries(&conn, None, None).unwrap().len(), 1);

        soft_delete_entry(&conn, "a", "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(purge_trash(&conn, Some("2026-02-01T00:00:00Z")).unwrap(), 1);
        assert!(list_entries_including_deleted(&conn).unwrap().is_empty());
    }
}
