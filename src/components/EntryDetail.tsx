import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { Entry, EntryCategory, AttachmentMeta, SshKeyInfo } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useClipboard } from '../hooks/useClipboard';
import { TotpDisplay } from './TotpDisplay';

interface EntryDetailProps {
  entry: Entry;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
}

const categoryIcons: Record<string, JSX.Element> = {
  web: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" /><path d="M3 10h18" /><path d="M12 3l9 7H3l9-7z" />
      <path d="M5 10v8" /><path d="M9.5 10v8" /><path d="M14.5 10v8" /><path d="M19 10v8" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M16 14h2" />
      <path d="M22 6V5a2 2 0 00-2-2H6a2 2 0 00-2 2v1" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  ),
  passkey: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 10-4-4Z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('es', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getEffectiveFieldType(field: { sensitive: boolean; field_type?: string }): string {
  if (field.field_type) return field.field_type;
  return field.sensitive ? 'password' : 'text';
}

function getFileIcon(mimeType: string): JSX.Element {
  if (mimeType.startsWith('image/')) {
    return (
      <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21,15 16,10 5,21" />
      </svg>
    );
  }
  if (mimeType.startsWith('application/pdf')) {
    return (
      <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14,2 14,8 20,8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>
    );
  }
  return (
    <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

export function EntryDetail({ entry, onEdit, onDelete, onClose, onToggleFavorite }: EntryDetailProps) {
  const [revealedFields, setRevealedFields] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<string | null>(null);
  const [sshKeyInfoMap, setSshKeyInfoMap] = useState<Record<number, { key_type: string; fingerprint: string; added_to_agent: boolean }>>({});
  const { copiedField, countdown, copyToClipboard, copyFieldToClipboard } = useClipboard();

  useEffect(() => {
    invoke<AttachmentMeta[]>('list_attachments', { entryId: entry.id })
      .then(setAttachments)
      .catch(() => setAttachments([]));
  }, [entry.id]);

  // Cargar info de claves SSH
  useEffect(() => {
    const sshFields = entry.fields
      .map((f, i) => ({ field: f, index: i }))
      .filter((item) => item.field.field_type === 'ssh_key' && item.field.value);
    if (sshFields.length === 0) {
      setSshKeyInfoMap({});
      return;
    }
    invoke<SshKeyInfo[]>('list_ssh_keys')
      .then((keys) => {
        const map: Record<number, { key_type: string; fingerprint: string; added_to_agent: boolean }> = {};
        for (const sf of sshFields) {
          const match = keys.find((k) => k.entry_id === entry.id);
          if (match) {
            map[sf.index] = { key_type: match.key_type, fingerprint: match.fingerprint, added_to_agent: match.added_to_agent };
          }
        }
        setSshKeyInfoMap(map);
      })
      .catch(() => setSshKeyInfoMap({}));
  }, [entry.id, entry.fields]);

  const toggleReveal = useCallback((index: number) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleDelete = useCallback(() => {
    onDelete(entry.id);
    setShowDeleteConfirm(false);
  }, [entry.id, onDelete]);

  const handleDownloadAttachment = useCallback(async (att: AttachmentMeta) => {
    try {
      const savePath = await save({ defaultPath: att.filename });
      if (savePath) {
        await invoke('download_attachment', { attachmentId: att.id, savePath });
      }
    } catch (err) {
      console.error('Error downloading attachment:', err);
    }
  }, []);

  const handleDeleteAttachment = useCallback(async (attachmentId: string) => {
    try {
      await invoke('delete_attachment', { attachmentId });
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      setDeleteAttachmentId(null);
    } catch (err) {
      console.error('Error deleting attachment:', err);
    }
  }, []);

  const handleSshAgentToggle = useCallback(async (fieldIndex: number, currentlyAdded: boolean) => {
    try {
      if (currentlyAdded) {
        await invoke('remove_key_from_agent', { entryId: entry.id, fieldIndex });
      } else {
        await invoke('add_key_to_agent', { entryId: entry.id, fieldIndex });
      }
      setSshKeyInfoMap((prev) => ({
        ...prev,
        [fieldIndex]: { ...prev[fieldIndex], added_to_agent: !currentlyAdded },
      }));
    } catch (err) {
      console.error('Error toggling SSH agent:', err);
    }
  }, [entry.id]);

  const renderField = (field: Entry['fields'][0], index: number) => {
    const fieldType = getEffectiveFieldType(field);
    const isRevealed = revealedFields.has(index);
    const fieldId = `${entry.id}-${field.name}-${index}`;

    switch (fieldType) {
      case 'textarea':
        return (
          <div className="field-row" key={index}>
            <div className="field-info">
              <div className="field-name">{field.name}</div>
              {field.sensitive && !isRevealed ? (
                <div className="field-value masked">{'••••••••••••'}</div>
              ) : (
                <div className="field-value-textarea">{field.value || ' '}</div>
              )}
            </div>
            <div className="field-actions">
              {copiedField === fieldId ? (
                <span className="copied-badge">Copiado{countdown > 0 ? ` (${countdown}s)` : ''}</span>
              ) : (
                <button
                  className="btn-icon"
                  onClick={() => field.sensitive ? copyFieldToClipboard(entry.id, index, fieldId) : copyToClipboard(field.value, fieldId)}
                  aria-label="Copiar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              {field.sensitive && (
                <button
                  className="btn-icon"
                  onClick={() => toggleReveal(index)}
                  aria-label={isRevealed ? 'Ocultar' : 'Mostrar'}
                >
                  {isRevealed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        );

      case 'seed_phrase': {
        const words = field.value.trim().split(/\s+/).filter(Boolean);
        const showMasked = !isRevealed;
        return (
          <div className="field-row" key={index} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="field-info" style={{ flex: 1 }}>
                <div className="field-name">{field.name}</div>
              </div>
              <div className="field-actions">
                {copiedField === fieldId ? (
                  <span className="copied-badge">Copiado{countdown > 0 ? ` (${countdown}s)` : ''}</span>
                ) : (
                  <button
                    className="btn-icon"
                    onClick={() => copyFieldToClipboard(entry.id, index, fieldId)}
                    aria-label="Copiar frase completa"
                    title="Copiar frase completa"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  </button>
                )}
                <button
                  className="btn-icon"
                  onClick={() => toggleReveal(index)}
                  aria-label={isRevealed ? 'Ocultar' : 'Mostrar'}
                >
                  {isRevealed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="seed-phrase-grid">
              {words.map((word, wi) => (
                <div className={`seed-word ${showMasked ? 'seed-word-hidden' : ''}`} key={wi}>
                  <span className="seed-word-num">{wi + 1}.</span>
                  <span className="seed-word-text">{showMasked ? '••••' : word}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case 'security_qa': {
        const showMasked = !isRevealed;
        return (
          <div className="field-row" key={index}>
            <div className="field-info">
              <div className="field-name" style={{ color: 'var(--accent)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 'normal', fontSize: '13px' }}>
                {field.name}
              </div>
              <div className={`field-value ${showMasked ? 'masked' : ''}`}>
                {showMasked ? '••••••••••••' : field.value || ' '}
              </div>
            </div>
            <div className="field-actions">
              {copiedField === fieldId ? (
                <span className="copied-badge">Copiado{countdown > 0 ? ` (${countdown}s)` : ''}</span>
              ) : (
                <button
                  className="btn-icon"
                  onClick={() => copyFieldToClipboard(entry.id, index, fieldId)}
                  aria-label="Copiar respuesta"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              <button
                className="btn-icon"
                onClick={() => toggleReveal(index)}
                aria-label={isRevealed ? 'Ocultar' : 'Mostrar'}
              >
                {isRevealed ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        );
      }

      case 'totp': {
        if (!field.value) {
          return (
            <div className="field-row" key={index}>
              <div className="field-info">
                <div className="field-name">{field.name}</div>
                <div className="field-value" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Sin configurar
                </div>
              </div>
            </div>
          );
        }
        return (
          <div className="field-row" key={index}>
            <div className="field-info">
              <div className="field-name">{field.name}</div>
              <TotpDisplay
                secret={field.value}
                onCopy={(code) => copyToClipboard(code, fieldId)}
              />
            </div>
          </div>
        );
      }

      case 'ssh_key': {
        const showMasked = !isRevealed;
        const sshInfo = sshKeyInfoMap[index];
        const keyType = sshInfo?.key_type || 'unknown';
        const fingerprint = sshInfo?.fingerprint || '';
        const addedToAgent = sshInfo?.added_to_agent || false;
        const typeClass = `ssh-key-type ssh-key-type-${keyType.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        return (
          <div className="field-row" key={index} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="field-info" style={{ flex: 1 }}>
                <div className="field-name">{field.name}</div>
              </div>
              <div className="field-actions">
                {copiedField === fieldId ? (
                  <span className="copied-badge">Copiado{countdown > 0 ? ` (${countdown}s)` : ''}</span>
                ) : (
                  <button
                    className="btn-icon"
                    onClick={() => copyFieldToClipboard(entry.id, index, fieldId)}
                    aria-label="Copiar clave"
                    title="Copiar clave"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  </button>
                )}
                <button
                  className="btn-icon"
                  onClick={() => toggleReveal(index)}
                  aria-label={isRevealed ? 'Ocultar' : 'Mostrar'}
                >
                  {isRevealed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {/* Metadatos de la clave SSH */}
            <div className="ssh-key-field-meta">
              <span className={typeClass}>{keyType.toUpperCase()}</span>
              {fingerprint && (
                <span style={{ fontSize: '11px', fontFamily: "'Courier New', monospace", color: 'var(--text-muted)' }}>
                  {fingerprint.length > 30 ? fingerprint.substring(0, 30) + '...' : fingerprint}
                </span>
              )}
              <button
                className={`ssh-key-agent-btn ${addedToAgent ? 'added' : ''}`}
                onClick={() => handleSshAgentToggle(index, addedToAgent)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M7 15h0M2 8h20" />
                </svg>
                {addedToAgent ? 'Remover del agente' : 'Agregar al agente'}
              </button>
            </div>
            {/* Valor de la clave */}
            {showMasked ? (
              <div className="field-value masked" style={{ fontFamily: "'Courier New', monospace" }}>{'••••••••••••••••••••'}</div>
            ) : (
              <div className="field-value-textarea" style={{ fontFamily: "'Courier New', monospace", fontSize: '11px' }}>
                {field.value || ' '}
              </div>
            )}
          </div>
        );
      }

      default: {
        // text / password — original behavior
        const showMasked = field.sensitive && !isRevealed;
        return (
          <div className="field-row" key={index}>
            <div className="field-info">
              <div className="field-name">{field.name}</div>
              <div className={`field-value ${showMasked ? 'masked' : ''}`}>
                {showMasked ? '••••••••••••' : field.value || ' '}
              </div>
            </div>
            <div className="field-actions">
              {copiedField === fieldId ? (
                <span className="copied-badge">Copiado{countdown > 0 ? ` (${countdown}s)` : ''}</span>
              ) : (
                <button
                  className="btn-icon"
                  onClick={() => field.sensitive ? copyFieldToClipboard(entry.id, index, fieldId) : copyToClipboard(field.value, fieldId)}
                  aria-label="Copiar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              {field.sensitive && (
                <button
                  className="btn-icon"
                  onClick={() => toggleReveal(index)}
                  aria-label={isRevealed ? 'Ocultar' : 'Mostrar'}
                >
                  {isRevealed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <>
      <div className="detail-panel">
        <div className="detail-header">
          <div className="detail-header-icon">
            {categoryIcons[entry.category] || categoryIcons.other}
          </div>
          <div className="detail-header-info">
            <div className="detail-title">{entry.title}</div>
            <div className="detail-category-badge">
              {CATEGORY_LABELS[entry.category as EntryCategory] || entry.category}
            </div>
          </div>
          <div className="detail-header-actions">
            <button
              className={`btn-icon ${entry.favorite ? 'active' : ''}`}
              onClick={() => onToggleFavorite(entry.id)}
              aria-label={entry.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              style={entry.favorite ? { color: 'var(--warning)' } : undefined}
            >
              {entry.favorite ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
              )}
            </button>
            <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="detail-body">
          {entry.fields.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">Campos</div>
              {entry.fields.map((field, index) => renderField(field, index))}
            </div>
          )}

          {entry.notes && (
            <div className="detail-section">
              <div className="detail-section-title">Notas</div>
              <div className="detail-notes">{entry.notes}</div>
            </div>
          )}

          {/* Attachments Section */}
          {attachments.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">Archivos adjuntos</div>
              <div className="attachment-list">
                {attachments.map((att) => (
                  <div className="attachment-item" key={att.id}>
                    {getFileIcon(att.mime_type)}
                    <div className="attachment-info">
                      <div className="attachment-name">{att.filename}</div>
                      <div className="attachment-size">{formatFileSize(att.size)}</div>
                    </div>
                    <div className="attachment-actions">
                      <button
                        className="btn-icon"
                        onClick={() => handleDownloadAttachment(att)}
                        aria-label="Descargar"
                        title="Descargar"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                          <polyline points="7,10 12,15 17,10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => setDeleteAttachmentId(att.id)}
                        aria-label="Eliminar adjunto"
                        title="Eliminar"
                        style={{ color: 'var(--danger)' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,6 5,6 21,6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="detail-timestamps">
            <span>Creado: {formatDate(entry.created_at)}</span>
            <span>Modificado: {formatDate(entry.updated_at)}</span>
          </div>
        </div>

        <div className="detail-footer">
          <button className="btn btn-secondary" onClick={onEdit}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Editar
          </button>
          <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3,6 5,6 21,6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Eliminar
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-body">
              <div className="confirm-dialog">
                <svg className="confirm-dialog-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="confirm-dialog-title">Eliminar entrada</div>
                <div className="confirm-dialog-text">
                  ¿Estás seguro de que deseas eliminar "{entry.title}"? Esta acción no se puede deshacer.
                </div>
                <div className="confirm-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>
                    Cancelar
                  </button>
                  <button className="btn btn-danger" onClick={handleDelete}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteAttachmentId && (
        <div className="modal-overlay" onClick={() => setDeleteAttachmentId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-body">
              <div className="confirm-dialog">
                <svg className="confirm-dialog-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="confirm-dialog-title">Eliminar adjunto</div>
                <div className="confirm-dialog-text">
                  ¿Estás seguro de que deseas eliminar este archivo adjunto? Esta acción no se puede deshacer.
                </div>
                <div className="confirm-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setDeleteAttachmentId(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDeleteAttachment(deleteAttachmentId)}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
