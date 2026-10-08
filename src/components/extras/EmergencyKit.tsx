import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { setFlag } from '../GettingStarted';
import { useI18n, useTr } from '../../i18n';

/**
 * Kit de emergencia para imprimir y guardar en un lugar seguro (gratis).
 * No incluye ningún secreto: deja espacios para escribir a mano.
 */
export function EmergencyKit({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const { locale } = useI18n();
  const [location, setLocation] = useState('');

  useEffect(() => {
    invoke<string>('get_vault_location').then(setLocation).catch(() => setLocation(''));
  }, []);

  const today = new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'es', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
        <div className="emergency-kit">
          <h1>{tr('Kit de emergencia de Vault Local', 'Vault Local Emergency Kit')}</h1>
          <p>{tr('Fecha:', 'Date:')} {today}</p>
          <p>
            {tr(
              'Imprime esta hoja, escribe a mano tu contraseña maestra y guárdala en un lugar físico seguro (por ejemplo, una caja fuerte). Sin la contraseña maestra ',
              'Print this sheet, handwrite your master password and keep it in a safe physical place (for example, a safe). Without the master password ',
            )}
            <strong>{tr('nadie puede recuperar tus datos', 'nobody can recover your data')}</strong>
            {tr(', ni siquiera el autor de la aplicación.', ', not even the author of the app.')}
          </p>

          <h3>{tr('Contraseña maestra', 'Master password')}</h3>
          <div className="kit-box" />

          <h3>{tr('Dónde están tus datos en este equipo', 'Where your data is on this computer')}</h3>
          <p style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{location || tr('(no disponible)', '(not available)')}</p>
          <p>{tr('Respaldos automáticos: se guardan en la carpeta que elegiste en la sección Respaldos. Si nunca elegiste una, los respaldos automáticos están desactivados: actívalos.', 'Automatic backups: they are saved in the folder you chose in the Backups section. If you never chose one, automatic backups are turned off: turn them on.')}</p>

          <h3>{tr('Dónde guardas tus respaldos externos (USB, disco, etc.)', 'Where you keep your external backups (USB, drive, etc.)')}</h3>
          <div className="kit-box" />

          <h3>{tr('Cómo recuperar en un equipo nuevo', 'How to recover on a new computer')}</h3>
          <ol>
            <li>{tr('Descarga Vault Local desde https://vault-local.vercel.app e instálalo.', 'Download Vault Local from https://vault-local.vercel.app and install it.')}</li>
            <li>{tr('Ábrelo una vez y ciérralo, para que cree su carpeta de datos.', 'Open it once and close it, so it creates its data folder.')}</li>
            <li>{tr('Copia tu respaldo más reciente a la carpeta de datos indicada arriba (o usa Respaldos → Restaurar).', 'Copy your most recent backup to the data folder shown above (or use Backups → Restore).')}</li>
            <li>{tr('Abre Vault Local y desbloquea con tu contraseña maestra.', 'Open Vault Local and unlock with your master password.')}</li>
            <li>{tr('Si tenías licencia, vuelve a pegar tu clave de licencia (guárdala dentro de tu bóveda).', 'If you had a license, paste your license key again (keep it inside your vault).')}</li>
          </ol>

          <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
            <button className="btn btn-primary" onClick={() => { setFlag('kit'); window.print(); }}>{tr('Imprimir', 'Print')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
