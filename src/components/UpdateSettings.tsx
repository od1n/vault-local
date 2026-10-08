import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useTr } from '../i18n';
import { CHECK_EVENT, CHECK_RESULT_EVENT, getUpdateMode, setUpdateMode, type UpdateMode } from './UpdateManager';

/** Sección "Actualizaciones" de Ajustes. */
export function UpdateSettings() {
  const tr = useTr();
  const [mode, setMode] = useState<UpdateMode>(getUpdateMode);
  const [version, setVersion] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''));
    const onResult = (e: Event) => {
      setChecking(false);
      const d = String((e as CustomEvent).detail);
      if (d === 'none') setResult(tr('Tienes la versión más reciente.', 'You have the latest version.'));
      else if (d.startsWith('error:')) setResult(tr('No se pudo comprobar (¿sin conexión?).', 'Could not check (offline?).'));
      else setResult(tr(`Hay una versión nueva: ${d}. Mira el aviso abajo a la derecha.`, `New version available: ${d}. See the notice at the bottom right.`));
    };
    window.addEventListener(CHECK_RESULT_EVENT, onResult);
    return () => window.removeEventListener(CHECK_RESULT_EVENT, onResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-section">
      <h3>{tr('Actualizaciones', 'Updates')}</h3>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{tr('Cuando haya una versión nueva', 'When a new version is out')}</div>
          <div className="settings-row-hint">
            {tr(
              'Las actualizaciones vienen firmadas: la app comprueba la firma antes de instalar.',
              'Updates are signed: the app checks the signature before installing.',
            )}
            {version && ` ${tr('Versión instalada', 'Installed version')}: ${version}.`}
          </div>
        </div>
        <select
          className="input"
          style={{ width: 230 }}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as UpdateMode;
            setMode(m);
            setUpdateMode(m);
          }}
        >
          <option value="notify">{tr('Avisarme y preguntar', 'Notify me and ask')}</option>
          <option value="auto">{tr('Instalar sola al bloquear', 'Install when I lock')}</option>
        </select>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{tr('Buscar ahora', 'Check now')}</div>
          {result && <div className="settings-row-hint">{result}</div>}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          disabled={checking}
          onClick={() => {
            setResult(null);
            setChecking(true);
            window.dispatchEvent(new Event(CHECK_EVENT));
            setTimeout(() => setChecking(false), 20000);
          }}
        >
          {checking ? tr('Buscando…', 'Checking…') : tr('Buscar actualización', 'Check for update')}
        </button>
      </div>
    </div>
  );
}
