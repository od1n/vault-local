import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SshKeyInfo } from '../types';

interface SshAgentPanelProps {
  onClose: () => void;
  onViewEntry: (id: string) => void;
}

function getKeyTypeClass(keyType: string): string {
  const normalized = keyType.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('ed25519')) return 'ssh-key-type-ed25519';
  if (normalized.includes('rsa')) return 'ssh-key-type-rsa';
  if (normalized.includes('ecdsa')) return 'ssh-key-type-ecdsa';
  return 'ssh-key-type-unknown';
}

export function SshAgentPanel({ onClose, onViewEntry }: SshAgentPanelProps) {
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SshKeyInfo[]>('list_ssh_keys');
      setKeys(result);
    } catch (err) {
      setError(`Error al cargar claves SSH: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleToggle = useCallback(async (key: SshKeyInfo) => {
    try {
      if (key.added_to_agent) {
        await invoke('remove_key_from_agent', { entryId: key.entry_id, fieldIndex: 0 });
      } else {
        await invoke('add_key_to_agent', { entryId: key.entry_id, fieldIndex: 0 });
      }
      setKeys((prev) =>
        prev.map((k) =>
          k.entry_id === key.entry_id ? { ...k, added_to_agent: !k.added_to_agent } : k
        )
      );
    } catch (err) {
      console.error('Error toggling SSH agent:', err);
    }
  }, []);

  const handleAddAll = useCallback(async () => {
    try {
      for (const key of keys) {
        if (!key.added_to_agent) {
          await invoke('add_key_to_agent', { entryId: key.entry_id, fieldIndex: 0 });
        }
      }
      setKeys((prev) => prev.map((k) => ({ ...k, added_to_agent: true })));
    } catch (err) {
      console.error('Error adding all keys:', err);
    }
  }, [keys]);

  return (
    <div className="ssh-panel" style={{ flex: 1 }}>
      <div className="ssh-header">
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>SSH Agent</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {keys.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={handleAddAll}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Agregar todas
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <p className="ssh-description">
        Gestiona tus claves SSH. Las claves se pueden agregar al agente SSH del sistema para autenticacion sin contrasena.
      </p>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', gap: '12px' }}>
          <div className="loading-spinner" style={{ width: '24px', height: '24px' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Cargando claves SSH...</span>
        </div>
      )}

      {error && (
        <div className="ie-error" style={{ marginTop: '12px' }}>{error}</div>
      )}

      {!loading && !error && keys.length === 0 && (
        <div className="empty-state" style={{ padding: '40px 24px' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M7 15h0M2 8h20" />
          </svg>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '12px' }}>
            No hay claves SSH en tu boveda.
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Crea una entrada con un campo tipo "Clave SSH".
          </p>
        </div>
      )}

      {!loading && !error && keys.length > 0 && (
        <div>
          {keys.map((key) => (
            <div className="ssh-key-card" key={key.entry_id}>
              <span className={`ssh-key-type ${getKeyTypeClass(key.key_type)}`}>
                {key.key_type.toUpperCase()}
              </span>
              <div className="ssh-key-info">
                <div className="ssh-key-title">{key.entry_title}</div>
                <div className="ssh-key-meta">{key.fingerprint}</div>
              </div>
              <div className="ssh-key-actions">
                <button
                  className={`ssh-agent-toggle ${key.added_to_agent ? 'active' : ''}`}
                  onClick={() => handleToggle(key)}
                >
                  {key.added_to_agent ? 'Remover' : 'Agregar'}
                </button>
                <button
                  className="btn-icon"
                  onClick={() => onViewEntry(key.entry_id)}
                  aria-label="Ver entrada"
                  title="Ver entrada"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
