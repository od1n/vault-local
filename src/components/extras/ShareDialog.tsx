import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Entry } from '../../types';
import { useTr } from '../../i18n';

type Props =
  | { mode: 'export'; entry: Entry; onClose: () => void; notify: (m: string, t?: 'success' | 'error' | 'info') => void }
  | { mode: 'import'; onClose: () => void; onImported: (id: string) => void; notify: (m: string, t?: 'success' | 'error' | 'info') => void };

/** Exportar una entrada a un archivo .vlshare cifrado, o importar uno. */
export function ShareDialog(props: Props) {
  const tr = useTr();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExport = props.mode === 'export';

  const run = async () => {
    setError(null);
    if (isExport && password !== confirm) {
      setError(tr('Las contraseñas no coinciden', 'Passwords do not match'));
      return;
    }
    try {
      if (props.mode === 'export') {
        const safeName = props.entry.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || tr('entrada', 'entry');
        const filePath = await save({ defaultPath: `${safeName}.vlshare`, filters: [{ name: tr('Entrada compartida', 'Shared entry'), extensions: ['vlshare'] }] });
        if (!filePath) return;
        setBusy(true);
        await invoke('export_share', { entryId: props.entry.id, filePath, sharePassword: password });
        props.notify(tr('Archivo creado. Envía la contraseña por otro medio, no junto con el archivo.', 'File created. Send the password through a different channel, not together with the file.'), 'success');
        props.onClose();
      } else {
        const filePath = await open({ multiple: false, filters: [{ name: tr('Entrada compartida', 'Shared entry'), extensions: ['vlshare'] }] });
        if (!filePath || Array.isArray(filePath)) return;
        setBusy(true);
        const id = await invoke<string>('import_share', { filePath, sharePassword: password });
        props.notify(tr('Entrada importada (etiqueta «compartida»)', 'Entry imported (tag “compartida”)'), 'success');
        props.onImported(id);
        props.onClose();
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : tr('Ocurrió un error', 'An error occurred'));
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
          <h2 className="modal-title">{isExport ? tr('Compartir entrada cifrada', 'Share encrypted entry') : tr('Importar entrada compartida', 'Import shared entry')}</h2>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.5 }}>
            {isExport
              ? tr('Se creará un archivo .vlshare cifrado con la contraseña que escribas. Envía el archivo por un medio y la contraseña por otro distinto (por ejemplo, el archivo por correo y la contraseña por llamada). El historial de contraseñas no se incluye.', 'An encrypted .vlshare file will be created with the password you enter. Send the file through one channel and the password through a different one (for example, the file by email and the password by phone call). Password history is not included.')
              : tr('Escribe la contraseña que te dio quien compartió la entrada y luego elige el archivo .vlshare.', 'Enter the password given to you by whoever shared the entry, then choose the .vlshare file.')}
          </p>
          <label className="form-label">{isExport ? tr('Contraseña para proteger el archivo', 'Password to protect the file') : tr('Contraseña para abrir el archivo', 'Password to open the file')}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {isExport && (
            <>
              <label className="form-label" style={{ marginTop: 10 }}>{tr('Repite la contraseña', 'Repeat the password')}</label>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </>
          )}
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={props.onClose}>{tr('Cancelar', 'Cancel')}</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || password.length < (isExport ? 8 : 1)}>
            {busy ? tr('Procesando…', 'Processing…') : isExport ? tr('Elegir dónde guardar', 'Choose where to save') : tr('Elegir archivo', 'Choose file')}
          </button>
        </div>
      </div>
    </div>
  );
}
