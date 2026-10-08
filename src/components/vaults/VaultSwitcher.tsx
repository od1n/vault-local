import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VaultList } from '../../types';
import { useTr } from '../../i18n';

interface Props {
  /** La bóveda seleccionada cambió: volver a comprobar si existe */
  onChanged: () => void;
}

function errText(e: unknown) {
  return typeof e === 'string' ? e : 'Error';
}

/**
 * Selector de bóveda en la pantalla de desbloqueo (bóvedas múltiples, Pro).
 * Con una sola bóveda y sin licencia Pro no muestra nada para no estorbar.
 */
export function VaultSwitcher({ onChanged }: Props) {
  const tr = useTr();
  const [list, setList] = useState<VaultList | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke<VaultList>('list_vaults').then(setList).catch(() => setList(null));
  }, []);
  useEffect(load, [load]);

  if (!list) return null;
  const existing = list.vaults.filter((v) => v.exists || v.id === list.active);
  if (existing.length <= 1 && !list.can_create) return null;

  const select = async (id: string) => {
    setError(null);
    try {
      setList(await invoke<VaultList>('select_vault', { id }));
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  const add = async () => {
    setError(null);
    try {
      setList(await invoke<VaultList>('add_vault', { name }));
      setAdding(false);
      setName('');
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="vault-switcher">
      <label className="form-label" htmlFor="vault-select">{tr('Bóveda', 'Vault')}</label>
      <div className="vault-switcher-row">
        <select
          id="vault-select"
          className="input"
          value={list.active}
          onChange={(e) => select(e.target.value)}
        >
          {existing.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {list.can_create && !adding && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} title={tr('Crear otra bóveda con su propia contraseña maestra', 'Create another vault with its own master password')}>
            + {tr('Nueva', 'New')}
          </button>
        )}
        {existing.length > 1 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setManaging(true)}>
            {tr('Administrar', 'Manage')}
          </button>
        )}
      </div>
      {adding && (
        <div className="vault-switcher-row" style={{ marginTop: 8 }}>
          <input
            className="input"
            placeholder={tr('Nombre (p. ej. Trabajo, Familia)', 'Name (e.g. Work, Family)')}
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={!name.trim()}>
            {tr('Crear', 'Create')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>
            {tr('Cancelar', 'Cancel')}
          </button>
        </div>
      )}
      {error && <div className="lock-error" style={{ marginTop: 8 }}>{error}</div>}
      {managing && (
        <ManageVaults
          list={list}
          onClose={() => setManaging(false)}
          onUpdated={(l) => {
            setList(l);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ManageVaults({ list, onClose, onUpdated }: { list: VaultList; onClose: () => void; onUpdated: (l: VaultList) => void }) {
  const tr = useTr();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async (id: string) => {
    setError(null);
    try {
      onUpdated(await invoke<VaultList>('rename_vault', { id, name }));
      setEditing(null);
    } catch (e) {
      setError(errText(e));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      onUpdated(await invoke<VaultList>('delete_vault', { id, password }));
      setDeleting(null);
      setPassword('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2 className="modal-title">{tr('Tus bóvedas', 'Your vaults')}</h2>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
            {tr(
              'Cada bóveda tiene su propia contraseña maestra y su propio archivo. Abrir una no da acceso a las demás.',
              'Each vault has its own master password and file. Opening one gives no access to the others.',
            )}
          </p>
          {list.vaults
            .filter((v) => v.exists)
            .map((v) => (
              <div key={v.id} className="vault-manage-row">
                {editing === v.id ? (
                  <>
                    <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename(v.id)} />
                    <button className="btn btn-primary btn-sm" onClick={() => rename(v.id)}>{tr('Guardar', 'Save')}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>{tr('Cancelar', 'Cancel')}</button>
                  </>
                ) : deleting === v.id ? (
                  <>
                    <input
                      className="input"
                      type="password"
                      placeholder={tr(`Contraseña maestra de «${v.name}»`, `Master password of “${v.name}”`)}
                      value={password}
                      autoFocus
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button className="btn btn-danger btn-sm" disabled={!password || busy} onClick={() => remove(v.id)}>
                      {busy ? '…' : tr('Borrar', 'Delete')}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setDeleting(null); setPassword(''); }}>{tr('Cancelar', 'Cancel')}</button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1 }}>
                      {v.name}
                      {v.id === 'principal' && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> · {tr('principal', 'main')}</span>}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(v.id); setName(v.name); setDeleting(null); }}>{tr('Renombrar', 'Rename')}</button>
                    {v.id !== 'principal' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => { setDeleting(v.id); setEditing(null); setPassword(''); }}>{tr('Borrar', 'Delete')}</button>
                    )}
                  </>
                )}
              </div>
            ))}
          {deleting && (
            <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 0 }}>
              {tr(
                'Borrar una bóveda elimina su archivo de este equipo. No se puede deshacer; los respaldos externos que hayas hecho no se tocan.',
                'Deleting a vault removes its file from this computer. It cannot be undone; external backups you made are not touched.',
              )}
            </p>
          )}
          {error && <div className="lock-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}
