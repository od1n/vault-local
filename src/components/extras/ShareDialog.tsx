import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Entry } from '../../types';

type Props =
  | { mode: 'export'; entry: Entry; onClose: () => void; notify: (m: string, t?: 'success' | 'error' | 'info') => void }
  | { mode: 'import'; onClose: () => void; onImported: (id: string) => void; notify: (m: string, t?: 'success' | 'error' | 'info') => void };

/** Exportar una entrada a un archivo .vlshare cifrado, o importar uno. */
export function ShareDialog(props: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExport = props.mode === 'export';

  const run = async () => {
    setError(null);
    if (isExport && password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    try {
      if (props.mode === 'export') {
        const safeName = props.entry.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'entrada';
        const filePath = await save({ defaultPath: `${safeName}.vlshare`, filters: [{ name: 'Entrada compartida', extensions: ['vlshare'] }] });
        if (!filePath) return;
        setBusy(true);
        await invoke('export_share', { entryId: props.entry.id, filePath, sharePassword: password });
        props.notify('Archivo creado. Envía la contraseña por otro medio, no junto con el archivo.', 'success');
        props.onClose();
      } else {
        const filePath = await open({ multiple: false, filters: [{ name: 'Entrada compartida', extensions: ['vlshare'] }] });
        if (!filePath || Array.isArray(filePath)) return;
        setBusy(true);
        const id = await invoke<string>('import_share', { filePath, sharePassword: password });
        props.notify('Entrada importada (etiqueta «compartida»)', 'success');
        props.onImported(id);
        props.onClose();
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Ocurrió un error');
    } finally {
      setBusy(false);
      setPassword('');
      setConfirm('');
    }
  };

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">{isExport ? 'Compartir entrada cifrada' : 'Importar entrada compartida'}</h2>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.5 }}>
            {isExport
              ? 'Se creará un archivo .vlshare cifrado con la contraseña que escribas. Envía el archivo por un medio y la contraseña por otro distinto (por ejemplo, el archivo por correo y la contraseña por llamada). El historial de contraseñas no se incluye.'
              : 'Escribe la contraseña que te dio quien compartió la entrada y luego elige el archivo .vlshare.'}
          </p>
          <label className="form-label">Contraseña para {isExport ? 'proteger' : 'abrir'} el archivo</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {isExport && (
            <>
              <label className="form-label" style={{ marginTop: 10 }}>Repite la contraseña</label>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </>
          )}
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={props.onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || password.length < (isExport ? 8 : 1)}>
            {busy ? 'Procesando…' : isExport ? 'Elegir dónde guardar' : 'Elegir archivo'}
          </button>
        </div>
      </div>
    </div>
  );
}
