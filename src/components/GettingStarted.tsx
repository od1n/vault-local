import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTr } from '../i18n';

const HIDE_KEY = 'vault-local-getting-started-hidden';
const KIT_KEY = 'vault-local-kit-opened';
const EXT_KEY = 'vault-local-extension-done';
const QUICK_KEY = 'vault-local-quick-tried';

function flag(key: string) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function setFlag(key: 'kit' | 'extension' | 'quick') {
  const k = key === 'kit' ? KIT_KEY : key === 'extension' ? EXT_KEY : QUICK_KEY;
  try {
    localStorage.setItem(k, 'true');
  } catch {
    // sin almacenamiento
  }
  window.dispatchEvent(new Event('vault-getting-started'));
}

export function gettingStartedHidden() {
  return flag(HIDE_KEY);
}

export function showGettingStarted() {
  try {
    localStorage.removeItem(HIDE_KEY);
  } catch {
    // sin almacenamiento
  }
  window.dispatchEvent(new Event('vault-getting-started'));
}

interface Props {
  entryCount: number;
  quickSearchEnabled: boolean;
  isPremium: boolean;
  onNewEntry: () => void;
  onImport: () => void;
  onBackup: () => void;
  onSettings: () => void;
  onUpgrade: () => void;
  onHide: () => void;
}

/**
 * "Primeros pasos": lista de tareas para que un usuario nuevo deje la bóveda lista y
 * protegida. Cada paso se marca solo cuando se cumple; se puede ocultar.
 */
export function GettingStarted(p: Props) {
  const tr = useTr();
  const [backupOn, setBackupOn] = useState(false);
  const [emergencyOn, setEmergencyOn] = useState(false);
  const [, force] = useState(0);

  const refresh = useCallback(() => {
    invoke<{ enabled: boolean; backup_dir: string }>('get_backup_config')
      .then((c) => setBackupOn(c.enabled && !!c.backup_dir))
      .catch(() => setBackupOn(false));
    invoke<{ configured: boolean }>('emergency_status')
      .then((s) => setEmergencyOn(s.configured))
      .catch(() => setEmergencyOn(false));
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('vault-getting-started', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('vault-getting-started', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const steps = [
    {
      done: p.entryCount > 0,
      title: tr('Guarda tu primera contraseña', 'Save your first password'),
      text: tr(
        'Crea una entrada (Ctrl+N) o trae todas las que tienes en Chrome, Edge, Firefox, Bitwarden, 1Password, LastPass o KeePass.',
        'Create an entry (Ctrl+N) or bring everything from Chrome, Edge, Firefox, Bitwarden, 1Password, LastPass or KeePass.',
      ),
      actions: [
        { label: tr('Nueva entrada', 'New entry'), run: p.onNewEntry },
        { label: tr('Importar', 'Import'), run: p.onImport },
      ],
    },
    {
      done: backupOn,
      title: tr('Activa los respaldos automáticos', 'Turn on automatic backups'),
      text: tr(
        'Cada vez que bloqueas, se guarda una copia cifrada en la carpeta que elijas (mejor si es una USB o un disco externo).',
        'Every time you lock, an encrypted copy is saved to the folder you choose (ideally a USB stick or external drive).',
      ),
      actions: [{ label: tr('Configurar respaldos', 'Set up backups'), run: p.onBackup }],
    },
    {
      done: flag(KIT_KEY),
      title: tr('Imprime el kit de emergencia', 'Print the emergency kit'),
      text: tr(
        'Una hoja donde anotas a mano tu contraseña maestra y dónde están tus respaldos. Si la olvidas, nadie puede recuperarla.',
        'A sheet where you write down your master password and where your backups are. If you forget it, nobody can recover it.',
      ),
      actions: [{ label: tr('Abrir Ajustes → Recuperación', 'Open Settings → Recovery'), run: p.onSettings }],
    },
    {
      done: emergencyOn,
      title: tr('Prepara el acceso de emergencia', 'Set up emergency access'),
      text: tr(
        '3 hojas para tu pareja, familia o socio: con 2 de ellas pueden abrir tu bóveda en solo lectura si a ti te pasa algo.',
        '3 sheets for your partner, family or business partner: any 2 open your vault read-only if something happens to you.',
      ),
      actions: [{ label: tr('Abrir Ajustes → Recuperación', 'Open Settings → Recovery'), run: p.onSettings }],
    },
    {
      done: flag(EXT_KEY),
      title: tr('Instala la extensión del navegador', 'Install the browser extension'),
      text: tr(
        'Rellena usuario y contraseña en las páginas sin copiar y pegar. Descárgala desde https://vault-local.vercel.app (sección Descargas).',
        'Fills in username and password on websites without copy and paste. Get it at https://vault-local.vercel.app (Downloads section).',
      ),
      actions: [{ label: tr('Ya la instalé', 'Done, installed'), run: () => setFlag('extension') }],
    },
    {
      done: p.quickSearchEnabled || flag(QUICK_KEY),
      title: tr('Prueba la búsqueda rápida', 'Try quick search'),
      text: tr(
        'Con Ctrl+Shift+Espacio buscas y copias una contraseña desde cualquier programa, sin abrir la ventana principal.',
        'Press Ctrl+Shift+Space to find and copy a password from any program, without opening the main window.',
      ),
      premium: true,
      actions: p.isPremium
        ? [{ label: tr('Activarla en Ajustes', 'Turn it on in Settings'), run: p.onSettings }]
        : [{ label: tr('Ver planes', 'See plans'), run: p.onUpgrade }],
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  return (
    <div className="getting-started">
      <div className="getting-started-header">
        <div>
          <div className="getting-started-title">{tr('Primeros pasos', 'Getting started')}</div>
          <div className="getting-started-sub">
            {doneCount === steps.length
              ? tr('¡Listo! Tu bóveda está preparada y protegida.', 'All set! Your vault is ready and protected.')
              : tr(`${doneCount} de ${steps.length} completados`, `${doneCount} of ${steps.length} done`)}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={p.onHide}>
          {doneCount === steps.length ? tr('Cerrar', 'Close') : tr('Ocultar', 'Hide')}
        </button>
      </div>
      <div className="getting-started-bar">
        <div style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="getting-started-list">
        {steps.map((s, i) => (
          <li key={i} className={`gs-step ${s.done ? 'done' : ''} ${i === next ? 'next' : ''}`}>
            <span className="gs-check" aria-hidden>
              {s.done ? '✓' : i + 1}
            </span>
            <div className="gs-body">
              <div className="gs-title">
                {s.title}
                {s.premium && !p.isPremium && <span className="premium-star">★ Premium</span>}
              </div>
              {!s.done && <div className="gs-text">{s.text}</div>}
              {!s.done && i === next && (
                <div className="gs-actions">
                  {s.actions.map((a) => (
                    <button key={a.label} className="btn btn-primary btn-sm" onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {!s.done && i !== next && (
                <div className="gs-actions">
                  {s.actions.map((a) => (
                    <button key={a.label} className="link-button" onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
