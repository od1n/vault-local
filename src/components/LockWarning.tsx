import { useState } from 'react';
import { useSettings } from '../hooks/useSettings';

interface Props {
  secondsLeft: number;
  onStillHere: () => void;
  onLockNow: () => void;
  onUpgrade?: () => void;
}

/** Aviso que aparece antes del bloqueo automático por inactividad. */
export function LockWarning({ secondsLeft, onStillHere, onLockNow, onUpgrade }: Props) {
  const { limits, pauseLock } = useSettings();
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
      <div className="lock-warning-title">La bóveda se bloqueará en {secondsLeft} s por inactividad</div>
      <div className="lock-warning-actions">
        <button className="btn btn-primary btn-sm" onClick={onStillHere}>Sigo aquí</button>
        <button className="btn btn-secondary btn-sm" onClick={() => pause(15)} title={limits.premium ? '' : 'Disponible con Premium'}>
          Pausar 15 min{!limits.premium && ' ★'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => pause(60)} title={limits.premium ? '' : 'Disponible con Premium'}>
          Pausar 1 h{!limits.premium && ' ★'}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onLockNow}>Bloquear ahora</button>
      </div>
      {error && <div className="lock-warning-error">{error}</div>}
    </div>
  );
}
