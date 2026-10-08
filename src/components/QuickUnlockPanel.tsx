import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { QuickStatus } from '../types';
import { useTr } from '../i18n';

/** Desbloqueo rápido en la pantalla de bloqueo: PIN y/o Windows Hello. */
export function QuickUnlockPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const tr = useTr();
  const [status, setStatus] = useState<QuickStatus | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    invoke<QuickStatus>('quick_unlock_status').then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    refresh();
  }, []);

  if (!status || (!status.pin && !status.hello)) return null;

  const withPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('quick_unlock_with_pin', { pin });
      onUnlocked();
    } catch (err) {
      setError(typeof err === 'string' ? err : tr('No se pudo desbloquear', 'Could not unlock'));
      refresh();
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  const withHello = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke('quick_unlock_with_hello');
      onUnlocked();
    } catch (err) {
      setError(typeof err === 'string' ? err : tr('No se pudo desbloquear', 'Could not unlock'));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick-unlock">
      {status.pin && (
        <form onSubmit={withPin} className="quick-unlock-pin">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder={tr('PIN de desbloqueo rápido', 'Quick unlock PIN')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !pin}>
            {tr('Desbloquear', 'Unlock')}
          </button>
        </form>
      )}
      {status.hello && (
        <button className="btn btn-secondary" onClick={withHello} disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {tr('Desbloquear con Windows Hello', 'Unlock with Windows Hello')}
        </button>
      )}
      {error && <div className="quick-unlock-error">{error}</div>}
      <div className="quick-unlock-divider">{tr('o usa tu contraseña maestra', 'or use your master password')}</div>
    </div>
  );
}
