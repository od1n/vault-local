import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Entry, HistoryItem } from '../../types';
import { useClipboard } from '../../hooks/useClipboard';

/** Valores anteriores de los campos sensibles de una entrada. */
export function HistoryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const { copyToClipboard } = useClipboard();

  useEffect(() => {
    invoke<HistoryItem[]>('get_password_history', { id: entry.id })
      .then(setItems)
      .catch((e) => setError(typeof e === 'string' ? e : 'No se pudo cargar el historial'));
  }, [entry.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 className="modal-title">Historial de «{entry.title}»</h2>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          {items && items.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              Todavía no hay valores anteriores. Cada vez que cambies una contraseña de esta entrada, la anterior se guardará aquí (hasta 20).
            </p>
          )}
          {items?.map((it, i) => (
            <div key={i} className="settings-row">
              <div>
                <div className="settings-row-label">{it.field}</div>
                <div className="settings-row-hint">Reemplazada el {new Date(it.changed_at).toLocaleString('es')}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                  {revealed.has(i) ? it.value : '••••••••••'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRevealed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                >
                  {revealed.has(i) ? 'Ocultar' : 'Mostrar'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(it.value, `hist-${i}`, `${it.field} anterior`)}>
                  Copiar
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
