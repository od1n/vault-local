// Modelos de datos para las entradas del vault.
// Define las estructuras serializables que se intercambian con el frontend.

use serde::{Deserialize, Serialize};

/// Campo individual de una entrada (usuario, contraseña, URL, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryField {
    /// Nombre descriptivo del campo (ej: "usuario", "contraseña")
    pub name: String,
    /// Valor del campo
    pub value: String,
    /// Indica si el campo contiene información sensible (se oculta en la UI)
    pub sensitive: bool,
    /// Tipo de campo: "text", "password", "textarea", "seed_phrase", "security_qa"
    /// Default: "text" para compatibilidad con entradas existentes
    #[serde(default = "default_field_type")]
    pub field_type: String,
}

/// Valor por defecto para el tipo de campo.
/// Garantiza compatibilidad con entradas existentes que no tienen este campo.
fn default_field_type() -> String {
    "text".to_string()
}

/// Valor anterior de un campo sensible (historial de contraseñas).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    /// Nombre del campo (ej: "Contraseña")
    pub field: String,
    /// Valor que tenía antes del cambio
    pub value: String,
    /// Fecha en que se reemplazó (ISO 8601)
    pub changed_at: String,
}

/// Datos internos de una entrada que se cifran antes de almacenar.
/// Esta estructura se serializa a JSON y luego se cifra con XChaCha20-Poly1305.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryData {
    /// Lista de campos de la entrada
    pub fields: Vec<EntryField>,
    /// Notas adicionales en texto libre
    pub notes: String,
    /// Valores anteriores de los campos sensibles (cifrados junto con la entrada)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<HistoryItem>,
}

/// Metadatos de una entrada para la vista de lista (sin datos sensibles).
/// Se usa para mostrar la lista de entradas sin descifrar los datos.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryMeta {
    pub id: String,
    pub category: String,
    pub title: String,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Etiquetas libres
    #[serde(default)]
    pub tags: Vec<String>,
    /// Última vez que se copió o escribió algo de esta entrada
    #[serde(default)]
    pub last_used_at: Option<String>,
    /// Veces que se ha usado
    #[serde(default)]
    pub use_count: u32,
    /// Fecha sugerida para cambiar la contraseña (ISO 8601)
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Fecha en que se envió a la papelera (None = no está en la papelera)
    #[serde(default)]
    pub deleted_at: Option<String>,
}

/// Entrada completa con todos los campos descifrados.
/// Se usa cuando el usuario abre una entrada específica.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub category: String,
    pub title: String,
    pub fields: Vec<EntryField>,
    pub notes: String,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Cantidad de valores anteriores guardados (el contenido requiere Premium)
    #[serde(default)]
    pub history_count: usize,
}

/// Datos para crear una nueva entrada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntry {
    pub category: String,
    pub title: String,
    pub fields: Vec<EntryField>,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// Datos para actualizar una entrada existente.
/// Todos los campos son opcionales: solo se actualizan los que tienen valor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEntry {
    pub category: Option<String>,
    pub title: Option<String>,
    pub fields: Option<Vec<EntryField>>,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
}

/// Metadatos de un archivo adjunto cifrado.
/// Se usa para listar adjuntos sin cargar los datos binarios en memoria.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentMeta {
    /// Identificador único del adjunto (UUID v4)
    pub id: String,
    /// ID de la entrada a la que pertenece el adjunto
    pub entry_id: String,
    /// Nombre original del archivo
    pub filename: String,
    /// Tipo MIME del archivo (ej: "application/pdf", "image/png")
    pub mime_type: String,
    /// Tamaño original del archivo en bytes (antes de cifrar)
    pub size: u64,
    /// Fecha de creación en formato ISO 8601
    pub created_at: String,
}
