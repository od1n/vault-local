import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '../../types';
import { useI18n, useTr } from '../../i18n';

interface Props {
  onChanged: () => void;
  notify: (m: string, t?: 'success' | 'error' | 'info') => void;
}

/** Entradas eliminadas: restaurar, borrar definitivamente o vaciar. Se borran solas a los 30 días. */
export function TrashPanel({ onChanged, notify }: Props) {
  const tr = useTr();
  const { locale } = useI18n();
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
      notify(typeof e === 'string' ? e : tr('Ocurrió un error', 'An error occurred'), 'error');
    }
  };

  const daysLeft = (deletedAt: string | null) =>
    deletedAt ? Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000)) : 30;

  return (
    <div className="trash-panel">
      <div className="trash-header">
        <h2 style={{ margin: 0 }}>{tr('Papelera', 'Trash')}</h2>
        {items.length > 0 &&
          (confirmEmpty ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmEmpty(false)}>{tr('Cancelar', 'Cancel')}</button>
              <button className="btn btn-danger btn-sm" onClick={() => { setConfirmEmpty(false); act('empty_trash', {}, tr('Papelera vaciada', 'Trash emptied')); }}>
                {tr('Sí, borrar todo definitivamente', 'Yes, permanently delete everything')}
              </button>
            </div>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmEmpty(true)}>{tr('Vaciar papelera', 'Empty trash')}</button>
          ))}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        {tr('Las entradas eliminadas se guardan aquí 30 días y luego se borran solas.', 'Deleted entries are kept here for 30 days and then removed automatically.')}
      </p>
      {items.length === 0 && <p style={{ color: 'var(--text-muted)' }}>{tr('La papelera está vacía.', 'The trash is empty.')}</p>}
      {items.map((e) => (
        <div key={e.id} className="settings-row">
          <div>
            <div className="settings-row-label">{e.title}</div>
            <div className="settings-row-hint">
              {tr('Eliminada el', 'Deleted on')} {e.deleted_at ? new Date(e.deleted_at).toLocaleDateString(locale === 'en' ? 'en-US' : 'es') : '—'} · {tr(`se borra en ${daysLeft(e.deleted_at)} día(s)`, `removed in ${daysLeft(e.deleted_at)} day(s)`)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => act('restore_entry', { id: e.id }, tr('Entrada restaurada', 'Entry restored'))}>
              {tr('Restaurar', 'Restore')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => act('delete_entry_permanently', { id: e.id }, tr('Entrada borrada definitivamente', 'Entry permanently deleted'))}>
              {tr('Borrar definitivamente', 'Delete permanently')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
