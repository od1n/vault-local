import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useTr } from '../i18n';

interface Props {
  secondsLeft: number;
  onStillHere: () => void;
  onLockNow: () => void;
  onUpgrade?: () => void;
}

/** Aviso que aparece antes del bloqueo automático por inactividad. */
export function LockWarning({ secondsLeft, onStillHere, onLockNow, onUpgrade }: Props) {
  const { limits, pauseLock } = useSettings();
  const tr = useTr();
  const [error, setError] = useState<string | null>(null);

  const pause = async (minutes: number) => {
    if (!limits.premium) {
      onUpgrade?.();
      return;
    }
    const r = await pauseLock(minutes);
    if (r.success) onStillHere();
    else setError(r.error ?? null);
  };

  return (
    <div className="lock-warning" role="alertdialog" aria-live="assertive">
      <div className="lock-warning-title">{tr(`La bóveda se bloqueará en ${secondsLeft} s por inactividad`, `The vault will lock in ${secondsLeft} s due to inactivity`)}</div>
      <div className="lock-warning-actions">
        <button className="btn btn-primary btn-sm" onClick={onStillHere}>{tr('Sigo aquí', "I'm still here")}</button>
        <button className="btn btn-secondary btn-sm" onClick={() => pause(15)} title={limits.premium ? '' : tr('Disponible con Premium', 'Available with Premium')}>
          {tr('Pausar 15 min', 'Pause 15 min')}{!limits.premium && ' ★'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => pause(60)} title={limits.premium ? '' : tr('Disponible con Premium', 'Available with Premium')}>
          {tr('Pausar 1 h', 'Pause 1 h')}{!limits.premium && ' ★'}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onLockNow}>{tr('Bloquear ahora', 'Lock now')}</button>
      </div>
      {error && <div className="lock-warning-error">{error}</div>}
    </div>
  );
}
