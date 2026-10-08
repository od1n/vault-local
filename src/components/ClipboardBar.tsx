import { useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useSettings } from '../hooks/useSettings';
import { useTr } from '../i18n';

/** Barra flotante que muestra lo copiado, la cuenta regresiva y las acciones. */
export function ClipboardBar({ onUpgrade }: { onUpgrade?: () => void }) {
  const { countdown, copiedLabel, extend, clearNow } = useClipboard();
  const { limits } = useSettings();
  const tr = useTr();
  const [msg, setMsg] = useState<string | null>(null);

  if (countdown <= 0) return null;

  const handleExtend = async () => {
    if (!limits.premium) {
      onUpgrade?.();
      return;
    }
    const r = await extend(30);
    setMsg(r.success ? null : r.error ?? null);
  };

  return (
    <div className="clipboard-bar" role="status">
      <span className="clipboard-bar-text">
        {tr('Copiado:', 'Copied:')} <strong>{copiedLabel || tr('contenido', 'content')}</strong> · {tr(`se borrará en ${countdown} s`, `clears in ${countdown} s`)}
      </span>
      <button
        className="btn btn-secondary btn-sm"
        onClick={handleExtend}
        title={limits.premium ? tr('Sumar 30 segundos', 'Add 30 seconds') : tr('Disponible con Premium', 'Available with Premium')}
      >
        +30 s{!limits.premium && ' ★'}
      </button>
      <button className="btn btn-secondary btn-sm" onClick={clearNow}>
        {tr('Borrar ahora', 'Clear now')}
      </button>
      {msg && <span className="clipboard-bar-error">{msg}</span>}
    </div>
  );
}
