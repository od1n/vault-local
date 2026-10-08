import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '../../types';

interface Props {
  onChanged: () => void;
  notify: (m: string, t?: 'success' | 'error' | 'info') => void;
}

/** Entradas eliminadas: restaurar, borrar definitivamente o vaciar. Se borran solas a los 30 días. */
export function TrashPanel({ onChanged, notify }: Props) {
  const [items, setItems] = useState<EntryMeta[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await invoke<EntryMeta[]>('get_trash'));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (cmd: string, args: Record<string, unknown>, msg: string) => {
    try {
      await invoke(cmd, args);
      notify(msg, 'success');
      await load();
      onChanged();
    } catch (e) {
      notify(typeof e === 'string' ? e : 'Ocurrió un error', 'error');
    }
  };

  const daysLeft = (deletedAt: string | null) =>
    deletedAt ? Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000)) : 30;

  return (
    <div className="trash-panel">
      <div className="trash-header">
        <h2 style={{ margin: 0 }}>Papelera</h2>
        {items.length > 0 &&
          (confirmEmpty ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmEmpty(false)}>Cancelar</button>
              <button className="btn btn-danger btn-sm" onClick={() => { setConfirmEmpty(false); act('empty_trash', {}, 'Papelera vaciada'); }}>
                Sí, borrar todo definitivamente
              </button>
            </div>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmEmpty(true)}>Vaciar papelera</button>
          ))}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Las entradas eliminadas se guardan aquí 30 días y luego se borran solas.
      </p>
      {items.length === 0 && <p style={{ color: 'var(--text-muted)' }}>La papelera está vacía.</p>}
      {items.map((e) => (
        <div key={e.id} className="settings-row">
          <div>
            <div className="settings-row-label">{e.title}</div>
            <div className="settings-row-hint">
              Eliminada el {e.deleted_at ? new Date(e.deleted_at).toLocaleDateString('es') : '—'} · se borra en {daysLeft(e.deleted_at)} día(s)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => act('restore_entry', { id: e.id }, 'Entrada restaurada')}>
              Restaurar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => act('delete_entry_permanently', { id: e.id }, 'Entrada borrada definitivamente')}>
              Borrar definitivamente
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
