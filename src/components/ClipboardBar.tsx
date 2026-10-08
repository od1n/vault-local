import { useEffect, useState } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { useSettings } from '../hooks/useSettings';
import { useTr } from '../i18n';

/** Barra flotante que muestra lo copiado, la cuenta regresiva y las acciones. */
export function ClipboardBar({ onUpgrade }: { onUpgrade?: () => void }) {
  const { countdown, copiedLabel, extend, clearNow } = useClipboard();
  const { limits } = useSettings();
  const tr = useTr();
  const [msg, setMsg] = useState<string | null>(null);
  // Consejo que se muestra solo la primera vez que se copia algo
  const [tip, setTip] = useState(false);
  const active = countdown > 0;
  useEffect(() => {
    if (!active) return;
    try {
      if (localStorage.getItem('vault-local-tip-clipboard') !== 'true') {
        setTip(true);
        localStorage.setItem('vault-local-tip-clipboard', 'true');
      }
    } catch {
      // sin almacenamiento: sin consejo
    }
  }, [active]);

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
      {tip && (
        <span className="clipboard-bar-tip">
          {tr(
            'Consejo: lo copiado se borra solo y no queda en el historial del portapapeles de Windows (Win+V) ni en la nube.',
            'Tip: copied content clears itself and is kept out of Windows clipboard history (Win+V) and the cloud.',
          )}
        </span>
      )}
    </div>
  );
}
