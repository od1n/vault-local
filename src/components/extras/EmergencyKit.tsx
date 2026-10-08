import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Kit de emergencia para imprimir y guardar en un lugar seguro (gratis).
 * No incluye ningún secreto: deja espacios para escribir a mano.
 */
export function EmergencyKit({ onClose }: { onClose: () => void }) {
  const [location, setLocation] = useState('');

  useEffect(() => {
    invoke<string>('get_vault_location').then(setLocation).catch(() => setLocation(''));
  }, []);

  const today = new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
        <div className="emergency-kit">
          <h1>Kit de emergencia de Vault Local</h1>
          <p>Fecha: {today}</p>
          <p>
            Imprime esta hoja, escribe a mano tu contraseña maestra y guárdala en un lugar físico seguro (por ejemplo, una
            caja fuerte). Sin la contraseña maestra <strong>nadie puede recuperar tus datos</strong>, ni siquiera el autor de
            la aplicación.
          </p>

          <h3>Contraseña maestra</h3>
          <div className="kit-box" />

          <h3>Dónde están tus datos en este equipo</h3>
          <p style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{location || '(no disponible)'}</p>
          <p>Respaldos automáticos: se guardan en la carpeta que elegiste en la sección Respaldos. Si nunca elegiste una, los respaldos automáticos están desactivados: actívalos.</p>

          <h3>Dónde guardas tus respaldos externos (USB, disco, etc.)</h3>
          <div className="kit-box" />

          <h3>Cómo recuperar en un equipo nuevo</h3>
          <ol>
            <li>Descarga Vault Local desde https://vault-local.vercel.app e instálalo.</li>
            <li>Ábrelo una vez y ciérralo, para que cree su carpeta de datos.</li>
            <li>Copia tu respaldo más reciente a la carpeta de datos indicada arriba (o usa Respaldos → Restaurar).</li>
            <li>Abre Vault Local y desbloquea con tu contraseña maestra.</li>
            <li>Si tenías licencia, vuelve a pegar tu clave de licencia (guárdala dentro de tu bóveda).</li>
          </ol>

          <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
            <button className="btn btn-primary" onClick={() => window.print()}>Imprimir</button>
          </div>
        </div>
      </div>
    </div>
  );
}
