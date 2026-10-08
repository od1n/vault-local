import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Entry, HistoryItem } from '../../types';
import { useClipboard } from '../../hooks/useClipboard';
import { useI18n, useTr } from '../../i18n';

/** Valores anteriores de los campos sensibles de una entrada. */
export function HistoryDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const { copyToClipboard } = useClipboard();
  const tr = useTr();
  const { locale } = useI18n();

  useEffect(() => {
    invoke<HistoryItem[]>('get_password_history', { id: entry.id })
      .then(setItems)
      .catch((e) => setError(typeof e === 'string' ? e : tr('No se pudo cargar el historial', 'Could not load history')));
  }, [entry.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 className="modal-title">{tr(`Historial de «${entry.title}»`, `History of “${entry.title}”`)}</h2>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          {items && items.length === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {tr('Todavía no hay valores anteriores. Cada vez que cambies una contraseña de esta entrada, la anterior se guardará aquí (hasta 20).', 'No previous values yet. Each time you change a password in this entry, the previous one will be saved here (up to 20).')}
            </p>
          )}
          {items?.map((it, i) => (
            <div key={i} className="settings-row">
              <div>
                <div className="settings-row-label">{it.field}</div>
                <div className="settings-row-hint">{tr('Reemplazada el', 'Replaced on')} {new Date(it.changed_at).toLocaleString(locale === 'en' ? 'en-US' : 'es')}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                  {revealed.has(i) ? it.value : '••••••••••'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRevealed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                >
                  {revealed.has(i) ? tr('Ocultar', 'Hide') : tr('Mostrar', 'Show')}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => copyToClipboard(it.value, `hist-${i}`, tr(`${it.field} anterior`, `previous ${it.field}`))}>
                  {tr('Copiar', 'Copy')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}
