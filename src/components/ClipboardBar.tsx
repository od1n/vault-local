import { useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useSettings } from '../hooks/useSettings';

/** Barra flotante que muestra lo copiado, la cuenta regresiva y las acciones. */
export function ClipboardBar({ onUpgrade }: { onUpgrade?: () => void }) {
  const { countdown, copiedLabel, extend, clearNow } = useClipboard();
  const { limits } = useSettings();
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
        Copiado: <strong>{copiedLabel || 'contenido'}</strong> · se borrará en {countdown} s
      </span>
      <button
        className="btn btn-secondary btn-sm"
        onClick={handleExtend}
        title={limits.premium ? 'Sumar 30 segundos' : 'Disponible con Premium'}
      >
        +30 s{!limits.premium && ' ★'}
      </button>
      <button className="btn btn-secondary btn-sm" onClick={clearNow}>
        Borrar ahora
      </button>
      {msg && <span className="clipboard-bar-error">{msg}</span>}
    </div>
  );
}
