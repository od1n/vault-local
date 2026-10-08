import { useI18n, useTr } from '../i18n';
import { useState, useCallback, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Entry, EntryField, EntryCategory, NewEntry, UpdateEntry, AttachmentMeta } from '../types';
import { CATEGORY_LABELS, CATEGORY_DEFAULTS } from '../types';
import { PasswordGenerator } from './PasswordGenerator';

interface EntryFormProps {
  entry?: Entry;
  onSave: (data: NewEntry | { id: string; entry: UpdateEntry }) => void;
  onCancel: () => void;
  isPremium?: boolean;
  onUpgrade?: () => void;
}

const categories: EntryCategory[] = ['web', 'bank', 'wallet', 'passkey', 'note', 'other'];

// Etiquetas como par [es, en]; se resuelven con tr() dentro del componente.
const FIELD_TYPE_OPTIONS: { value: string; label: [string, string] }[] = [
  { value: 'text', label: ['Texto', 'Text'] },
  { value: 'password', label: ['Contraseña', 'Password'] },
  { value: 'textarea', label: ['Área de texto', 'Text area'] },
  { value: 'seed_phrase', label: ['Frase semilla', 'Seed phrase'] },
  { value: 'security_qa', label: ['Pregunta de seguridad', 'Security question'] },
  { value: 'totp', label: ['TOTP', 'TOTP'] },
  { value: 'ssh_key', label: ['Clave SSH', 'SSH key'] },
];

function getEffectiveFieldType(field: EntryField): string {
  if (field.field_type) return field.field_type;
  return field.sensitive ? 'password' : 'text';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EntryForm({ entry, onSave, onCancel, isPremium = false, onUpgrade }: EntryFormProps) {
  const { t } = useI18n();
  const tr = useTr();
  const isEditing = !!entry;

  const [category, setCategory] = useState<EntryCategory>(
    (entry?.category as EntryCategory) || 'web'
  );
  const [title, setTitle] = useState(entry?.title || '');
  const [fields, setFields] = useState<EntryField[]>(
    entry?.fields || [...CATEGORY_DEFAULTS.web]
  );
  const [notes, setNotes] = useState(entry?.notes || '');
  const [favorite, setFavorite] = useState(entry?.favorite || false);
  const [titleError, setTitleError] = useState(false);
  const [pwgenFieldIndex, setPwgenFieldIndex] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setFields([...CATEGORY_DEFAULTS[category].map((f) => ({ ...f }))]);
    }
  }, [category, isEditing]);

  useEffect(() => {
    if (isEditing && entry) {
      invoke<AttachmentMeta[]>('list_attachments', { entryId: entry.id })
        .then(setAttachments)
        .catch(() => setAttachments([]));
    }
  }, [isEditing, entry]);

  const handleFieldChange = useCallback((index: number, key: keyof EntryField, value: string | boolean) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [key]: value } : f))
    );
  }, []);

  const handleFieldTypeChange = useCallback((index: number, newType: string) => {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const sensitive = newType === 'password' || newType === 'seed_phrase' || newType === 'security_qa' || newType === 'totp' || newType === 'ssh_key'
          ? true
          : f.sensitive;
        return { ...f, field_type: newType, sensitive };
      })
    );
  }, []);

  const addField = useCallback(() => {
    setFields((prev) => [...prev, { name: '', value: '', sensitive: false, field_type: 'text' }]);
  }, []);

  const removeField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
    if (pwgenFieldIndex === index) {
      setPwgenFieldIndex(null);
    }
  }, [pwgenFieldIndex]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!title.trim()) {
        setTitleError(true);
        return;
      }
      setTitleError(false);

      const cleanFields = fields.filter((f) => f.name.trim() !== '');

      if (isEditing && entry) {
        onSave({
          id: entry.id,
          entry: { category, title: title.trim(), fields: cleanFields, notes, favorite },
        });
      } else {
        onSave({ category, title: title.trim(), fields: cleanFields, notes, favorite });
      }
    },
    [title, fields, category, notes, favorite, isEditing, entry, onSave]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  const handlePasswordSelect = useCallback(
    (password: string) => {
      if (pwgenFieldIndex !== null) {
        handleFieldChange(pwgenFieldIndex, 'value', password);
        setPwgenFieldIndex(null);
      }
    },
    [pwgenFieldIndex, handleFieldChange]
  );

  const handleAddAttachment = useCallback(async () => {
    if (!entry) return;
    try {
      const selected = await open({ multiple: false });
      if (selected) {
        setAttachmentLoading(true);
        await invoke('add_attachment', { entryId: entry.id, filePath: selected });
        const updated = await invoke<AttachmentMeta[]>('list_attachments', { entryId: entry.id });
        setAttachments(updated);
      }
    } catch (err) {
      console.error('Error adding attachment:', err);
    } finally {
      setAttachmentLoading(false);
    }
  }, [entry]);

  const handleDeleteAttachment = useCallback(async (attachmentId: string) => {
    if (!entry) return;
    try {
      await invoke('delete_attachment', { attachmentId });
      const updated = await invoke<AttachmentMeta[]>('list_attachments', { entryId: entry.id });
      setAttachments(updated);
    } catch (err) {
      console.error('Error deleting attachment:', err);
    }
  }, [entry]);

  const renderFieldValueInput = (field: EntryField, index: number) => {
    const fieldType = getEffectiveFieldType(field);

    switch (fieldType) {
      case 'textarea':
        return (
          <textarea
            className="field-textarea"
            placeholder={tr('Valor', 'Value')}
            value={field.value}
            onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
            rows={4}
          />
        );

      case 'seed_phrase':
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <textarea
              className="field-textarea seed-phrase-input"
              placeholder={tr('Ingresa la frase semilla (palabras separadas por espacios)', 'Enter the seed phrase (words separated by spaces)')}
              value={field.value}
              onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
              rows={3}
            />
            {field.value.trim() && (
              <div className="seed-phrase-grid">
                {field.value.trim().split(/\s+/).map((word, wi) => (
                  <div className="seed-word" key={wi}>
                    <span className="seed-word-num">{wi + 1}.</span>
                    <span className="seed-word-text">{word}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'security_qa':
        return (
          <div className="security-qa-field" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>{tr('Pregunta', 'Question')}</label>
              <input
                className="input"
                type="text"
                placeholder={tr('Escribe la pregunta de seguridad', 'Type the security question')}
                value={field.name}
                onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>{tr('Respuesta', 'Answer')}</label>
              <input
                className="input"
                type="password"
                placeholder={tr('Escribe la respuesta', 'Type the answer')}
                value={field.value}
                onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
              />
            </div>
          </div>
        );

      case 'totp':
        return (
          <input
            className="input"
            type="password"
            placeholder={tr('Clave secreta (base32)', 'Secret key (base32)')}
            value={field.value}
            onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
        );

      case 'ssh_key':
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <textarea
              className="field-textarea"
              placeholder={tr('Pega tu clave privada SSH (PEM o OpenSSH format)', 'Paste your SSH private key (PEM or OpenSSH format)')}
              value={field.value}
              onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
              rows={5}
              style={{ fontFamily: "'Courier New', monospace", fontSize: '12px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              {tr('La clave se cifrara y podrá ser enviada al SSH Agent del sistema.', 'The key will be encrypted and can be sent to the system SSH agent.')}
            </div>
          </div>
        );

      case 'password':
        return (
          <input
            className="input"
            type="password"
            placeholder={tr('Valor', 'Value')}
            value={field.value}
            onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
        );

      default: // "text"
        return (
          <input
            className="input"
            type="text"
            placeholder={tr('Valor', 'Value')}
            value={field.value}
            onChange={(e) => handleFieldChange(index, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
        );
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEditing ? tr('Editar entrada', 'Edit entry') : tr('Nueva entrada', 'New entry')}</h2>
          <button className="btn-icon" onClick={onCancel} aria-label={tr('Cerrar', 'Close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{tr('Categoría', 'Category')}</label>
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value as EntryCategory)}
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {t(`category.${cat}`, CATEGORY_LABELS[cat])}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Título', 'Title')}</label>
            <input
              className="input"
              type="text"
              placeholder={tr('Nombre de la entrada', 'Entry name')}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim()) setTitleError(false);
              }}
              autoFocus
              style={titleError ? { borderColor: 'var(--danger)' } : undefined}
            />
            {titleError && (
              <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>
                {tr('El título es obligatorio', 'Title is required')}
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Campos', 'Fields')}</label>
            {fields.map((field, index) => {
              const fieldType = getEffectiveFieldType(field);
              const isSecurityQA = fieldType === 'security_qa';

              return (
                <div key={index}>
                  <div className="field-editor">
                    {/* Field type selector */}
                    <div className="field-type-selector">
                      {FIELD_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`field-type-option ${fieldType === opt.value ? 'active' : ''}`}
                          onClick={() => handleFieldTypeChange(index, opt.value)}
                        >
                          {tr(...opt.label)}
                        </button>
                      ))}
                    </div>

                    {isSecurityQA ? (
                      /* Security Q&A has its own layout */
                      <div className="field-editor-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                        {renderFieldValueInput(field, index)}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                          <button
                            type="button"
                            className={`field-sensitive-toggle active`}
                            title={tr('Campo sensible', 'Sensitive field')}
                            style={{ cursor: 'default', opacity: 0.6 }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0110 0v4" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => removeField(index)}
                            aria-label={tr('Eliminar campo', 'Remove field')}
                            style={{ color: 'var(--danger)' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : fieldType === 'textarea' || fieldType === 'seed_phrase' || fieldType === 'ssh_key' ? (
                      /* Textarea / Seed phrase: name on top, value below */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="field-editor-row">
                          <input
                            className="input"
                            type="text"
                            placeholder={tr('Nombre del campo', 'Field name')}
                            value={field.name}
                            onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className={`field-sensitive-toggle ${field.sensitive ? 'active' : ''}`}
                            onClick={() => handleFieldChange(index, 'sensitive', !field.sensitive)}
                            title={field.sensitive ? tr('Campo sensible', 'Sensitive field') : tr('Campo visible', 'Visible field')}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0110 0v4" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => removeField(index)}
                            aria-label={tr('Eliminar campo', 'Remove field')}
                            style={{ color: 'var(--danger)' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                        {renderFieldValueInput(field, index)}
                      </div>
                    ) : (
                      /* Text / Password: single row */
                      <div className="field-editor-row">
                        <input
                          className="input"
                          type="text"
                          placeholder={tr('Nombre del campo', 'Field name')}
                          value={field.name}
                          onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                          style={{ flex: '0 0 40%' }}
                        />
                        {renderFieldValueInput(field, index)}
                        {field.sensitive && (
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() =>
                              setPwgenFieldIndex(pwgenFieldIndex === index ? null : index)
                            }
                            aria-label={tr('Generar contraseña', 'Generate password')}
                            title={tr('Generar contraseña', 'Generate password')}
                            style={pwgenFieldIndex === index ? { color: 'var(--accent)' } : undefined}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01" />
                            </svg>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`field-sensitive-toggle ${field.sensitive ? 'active' : ''}`}
                          onClick={() => handleFieldChange(index, 'sensitive', !field.sensitive)}
                          title={field.sensitive ? tr('Campo sensible', 'Sensitive field') : tr('Campo visible', 'Visible field')}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeField(index)}
                          aria-label={tr('Eliminar campo', 'Remove field')}
                          style={{ color: 'var(--danger)' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {pwgenFieldIndex === index && (
                    <PasswordGenerator onSelect={handlePasswordSelect} />
                  )}
                </div>
              );
            })}

            <button type="button" className="add-field-btn" onClick={addField}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {tr('Agregar campo', 'Add field')}
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Notas', 'Notes')}</label>
            <textarea
              className="textarea"
              placeholder={tr('Notas adicionales (opcional)', 'Additional notes (optional)')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Attachments Section */}
          <div className="attachments-section">
            <h3>{tr('Archivos adjuntos', 'Attachments')}</h3>
            {!isPremium ? (
              <div className="premium-gate" style={{ padding: 20 }}>
                <div className="premium-gate-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <div className="premium-gate-text">
                  {tr('Adjuntos disponibles en Premium', 'Attachments available in Premium')}
                </div>
                {onUpgrade && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={onUpgrade}>
                    {tr('Actualizar a Premium', 'Upgrade to Premium')}
                  </button>
                )}
              </div>
            ) : isEditing && entry ? (
              <>
                {attachments.length > 0 && (
                  <div className="attachment-list">
                    {attachments.map((att) => (
                      <div className="attachment-item" key={att.id}>
                        <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14,2 14,8 20,8" />
                        </svg>
                        <div className="attachment-info">
                          <div className="attachment-name">{att.filename}</div>
                          <div className="attachment-size">{formatFileSize(att.size)}</div>
                        </div>
                        <div className="attachment-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => handleDeleteAttachment(att.id)}
                            aria-label={tr('Eliminar adjunto', 'Delete attachment')}
                            style={{ color: 'var(--danger)' }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="add-attachment-btn"
                  onClick={handleAddAttachment}
                  disabled={attachmentLoading}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  {attachmentLoading ? tr('Adjuntando...', 'Attaching...') : tr('Adjuntar archivo', 'Attach file')}
                </button>
              </>
            ) : (
              <p className="attachment-hint">{tr('Guarda la entrada primero para adjuntar archivos.', 'Save the entry first to attach files.')}</p>
            )}
          </div>

          <button
            type="button"
            className={`favorite-toggle ${favorite ? 'active' : ''}`}
            onClick={() => setFavorite(!favorite)}
          >
            {favorite ? (
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            )}
            {tr('Marcar como favorito', 'Mark as favorite')}
          </button>
        </form>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {tr('Cancelar', 'Cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={(e) => {
            handleSubmit(e as unknown as FormEvent);
          }}>
            {isEditing ? tr('Guardar cambios', 'Save changes') : tr('Crear entrada', 'Create entry')}
          </button>
        </div>
      </div>
    </div>
  );
}
