import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTr } from '../i18n';

/** Preferencia de actualización (no es un secreto: se guarda en el navegador de la app). */
export type UpdateMode = 'notify' | 'auto';
const MODE_KEY = 'vault-local-update-mode';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Evento para pedir una búsqueda manual desde Ajustes */
export const CHECK_EVENT = 'vault-check-update';
/** Evento con el resultado de la búsqueda manual */
export const CHECK_RESULT_EVENT = 'vault-check-update-result';

export function getUpdateMode(): UpdateMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'auto' ? 'auto' : 'notify';
  } catch {
    return 'notify';
  }
}

export function setUpdateMode(mode: UpdateMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // sin almacenamiento: se queda en "avisar"
  }
}

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

/**
 * Busca versiones nuevas en GitHub Releases (firmadas; el plugin verifica la firma con la
 * clave pública de tauri.conf.json antes de instalar).
 * - "Avisarme": muestra un aviso con «Actualizar ahora».
 * - "Instalar solas": descarga en segundo plano e instala cuando la bóveda está bloqueada,
 *   para no interrumpir el trabajo.
 */
export function UpdateManager({ locked }: { locked: boolean }) {
  const tr = useTr();
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const busy = useRef(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const download = useCallback(async (u: Update) => {
    let total = 0;
    let done = 0;
    setPhase('downloading');
    await u.download((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      if (ev.event === 'Progress') {
        done += ev.data.chunkLength;
        if (total > 0) setProgress(Math.min(100, Math.round((done / total) * 100)));
      }
    });
    setPhase('ready');
  }, []);

  const install = useCallback(async (u: Update) => {
    setPhase('installing');
    try {
      // Bloquear antes: hace el respaldo automático y borra las claves de la memoria
      await invoke('lock_vault').catch(() => {});
      await u.install();
      await relaunch();
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
      setPhase('error');
    }
  }, []);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const u = await check();
        if (!u) {
          if (manual) window.dispatchEvent(new CustomEvent(CHECK_RESULT_EVENT, { detail: 'none' }));
          return;
        }
        setUpdate(u);
        setHidden(false);
        if (manual) window.dispatchEvent(new CustomEvent(CHECK_RESULT_EVENT, { detail: u.version }));
        if (getUpdateMode() === 'auto') {
          await download(u);
          if (lockedRef.current) await install(u);
        } else {
          setPhase('available');
        }
      } catch (e) {
        // Sin conexión o GitHub no responde: no molestar, salvo si se pidió a mano
        if (manual) window.dispatchEvent(new CustomEvent(CHECK_RESULT_EVENT, { detail: `error:${String(e)}` }));
      } finally {
        busy.current = false;
      }
    },
    [download, install],
  );

  // Al abrir la app y cada 6 horas
  useEffect(() => {
    const first = setTimeout(() => runCheck(false), 5000);
    const every = setInterval(() => runCheck(false), CHECK_EVERY_MS);
    const onManual = () => runCheck(true);
    window.addEventListener(CHECK_EVENT, onManual);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener(CHECK_EVENT, onManual);
    };
  }, [runCheck]);

  // Modo automático: instalar en cuanto la bóveda quede bloqueada
  useEffect(() => {
    if (locked && phase === 'ready' && update && getUpdateMode() === 'auto') {
      install(update);
    }
  }, [locked, phase, update, install]);

  if (!update || hidden || phase === 'idle') return null;

  const updateNow = async () => {
    try {
      if (phase !== 'ready') await download(update);
      await install(update);
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  return (
    <div className="update-card" role="status">
      <div className="update-card-title">
        {phase === 'installing'
          ? tr('Instalando la actualización…', 'Installing the update…')
          : phase === 'error'
            ? tr('No se pudo actualizar', 'Update failed')
            : tr(`Vault Local ${update.version} disponible`, `Vault Local ${update.version} available`)}
      </div>
      <div className="update-card-text">
        {phase === 'available' &&
          tr(
            'La app se cerrará, se instalará la versión nueva y se abrirá sola. Tus datos no se tocan.',
            'The app will close, install the new version and reopen. Your data is not touched.',
          )}
        {phase === 'downloading' && `${tr('Descargando', 'Downloading')}${progress !== null ? ` · ${progress}%` : '…'}`}
        {phase === 'ready' &&
          tr(
            'Descargada. Se instalará sola la próxima vez que bloquees la bóveda.',
            'Downloaded. It will install the next time you lock the vault.',
          )}
        {phase === 'installing' && tr('La app se reiniciará en unos segundos.', 'The app will restart in a few seconds.')}
        {phase === 'error' && (error || '')}
      </div>
      {(phase === 'available' || phase === 'ready' || phase === 'error') && (
        <div className="update-card-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setHidden(true)}>
            {tr('Más tarde', 'Later')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={updateNow}>
            {phase === 'error' ? tr('Reintentar', 'Retry') : tr('Actualizar ahora', 'Update now')}
          </button>
        </div>
      )}
    </div>
  );
}
