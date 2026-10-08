import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import type { EmergencySetup, EmergencyShare, EmergencyStatus } from '../../types';
import { useTr, useI18n } from '../../i18n';

/**
 * Preparar el acceso de emergencia (gratis): genera 3 partes, de las que 2 abren la
 * bóveda en solo lectura. Las partes se muestran UNA vez y se imprimen por separado.
 */
export function EmergencySetupDialog({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const { locale } = useI18n();
  const [status, setStatus] = useState<EmergencyStatus | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EmergencySetup | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [printPart, setPrintPart] = useState<number | null>(null);

  const loadStatus = () => invoke<EmergencyStatus>('emergency_status').then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    loadStatus();
  }, []);

  // Imprimir solo la hoja elegida: cada parte va a una persona distinta
  useEffect(() => {
    if (printPart === null) return;
    const t = setTimeout(() => {
      window.print();
      setPrintPart(null);
    }, 100);
    return () => clearTimeout(t);
  }, [printPart]);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      setResult(await invoke<EmergencySetup>('emergency_setup', { password }));
      setPassword('');
      loadStatus();
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    setBusy(true);
    try {
      await invoke('emergency_disable', { password });
      setPassword('');
      setConfirmDisable(false);
      loadStatus();
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="modal-overlay" onClick={result ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-header no-print">
          <h2 className="modal-title">{tr('Acceso de emergencia', 'Emergency access')}</h2>
        </div>

        {!result ? (
          <div className="modal-body">
            <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
              {tr(
                'Para que tu pareja, familia o socio puedan abrir esta bóveda si a ti te pasa algo, sin darles tu contraseña maestra.',
                'So your partner, family or business partner can open this vault if something happens to you, without giving them your master password.',
              )}
            </p>
            <ol style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
              <li>{tr('Se generan 3 hojas: «Parte 1», «Parte 2» y «Parte 3».', '3 sheets are created: "Part 1", "Part 2" and "Part 3".')}</li>
              <li>
                {tr(
                  'Con 2 hojas cualesquiera se abre la bóveda en modo solo lectura. Con 1 sola no se puede hacer nada (no revela ni una letra).',
                  'Any 2 sheets open the vault in read-only mode. A single sheet is useless (it reveals nothing).',
                )}
              </li>
              <li>
                {tr(
                  'Ejemplo: una para tu pareja, otra para un familiar o tu abogado y otra en una caja fuerte. Nunca guardes dos juntas.',
                  'Example: one for your partner, one for a relative or your lawyer and one in a safe. Never keep two together.',
                )}
              </li>
              <li>
                {tr(
                  'Además hace falta el archivo de la bóveda: este equipo o un respaldo (los respaldos ya incluyen lo necesario).',
                  'The vault file is also needed: this computer or a backup (backups already include what is needed).',
                )}
              </li>
              <li>
                {tr(
                  'Si cambias tu contraseña maestra, las hojas siguen sirviendo. Si generas hojas nuevas, las anteriores dejan de servir para esta bóveda (pero sí abrirían respaldos antiguos hechos antes del cambio).',
                  'If you change your master password, the sheets keep working. If you create new sheets, the old ones stop working for this vault (but would still open old backups made before the change).',
                )}
              </li>
            </ol>

            {status?.configured ? (
              <div style={{ padding: 12, borderRadius: 'var(--radius)', background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.25)', fontSize: 13, marginBottom: 12 }}>
                {tr('Activo desde', 'Active since')} {fmtDate(status.created_at)} · {tr('código de las hojas', 'sheet code')} <strong>{status.key_id}</strong>
              </div>
            ) : (
              <div style={{ padding: 12, borderRadius: 'var(--radius)', background: 'rgba(255,170,0,0.08)', border: '1px solid rgba(255,170,0,0.25)', fontSize: 13, marginBottom: 12 }}>
                {tr('Todavía no está configurado para esta bóveda.', 'Not set up yet for this vault.')}
              </div>
            )}

            <label className="form-label">{tr('Tu contraseña maestra (para confirmar que eres tú)', 'Your master password (to confirm it is you)')}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />

            {error && <div className="lock-error" style={{ marginTop: 10 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={generate} disabled={!password || busy}>
                {busy ? tr('Generando…', 'Generating…') : status?.configured ? tr('Generar hojas nuevas (anula las anteriores)', 'Create new sheets (revokes the old ones)') : tr('Generar las 3 hojas', 'Create the 3 sheets')}
              </button>
              {status?.configured &&
                (confirmDisable ? (
                  <button className="btn btn-danger" onClick={disable} disabled={!password || busy}>
                    {tr('Confirmar: desactivar', 'Confirm: turn off')}
                  </button>
                ) : (
                  <button className="btn btn-secondary" onClick={() => setConfirmDisable(true)} disabled={busy}>
                    {tr('Desactivar', 'Turn off')}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div className="no-print" style={{ padding: 12, borderRadius: 'var(--radius)', background: 'rgba(255,76,76,0.08)', border: '1px solid rgba(255,76,76,0.25)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              {tr(
                'Estas hojas se muestran UNA sola vez. Imprime cada parte por separado (botón «Imprimir» de cada una) y entrégala a una persona distinta. No las guardes como foto ni en la nube.',
                'These sheets are shown ONLY once. Print each part separately ("Print" button on each) and give it to a different person. Do not keep them as photos or in the cloud.',
              )}
            </div>
            {result.shares.map((s) => (
              <ShareCard
                key={s.part}
                share={s}
                setup={result}
                printable={printPart === s.part}
                onPrint={() => setPrintPart(s.part)}
                dateText={fmtDate(result.created_at)}
              />
            ))}
          </div>
        )}

        <div className="modal-footer no-print">
          <button className="btn btn-secondary" onClick={onClose}>
            {result ? tr('Ya imprimí las 3 partes', 'I printed all 3 parts') : tr('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareCard({
  share,
  setup,
  printable,
  onPrint,
  dateText,
}: {
  share: EmergencyShare;
  setup: EmergencySetup;
  printable: boolean;
  onPrint: () => void;
  dateText: string;
}) {
  const tr = useTr();
  const [svg, setSvg] = useState<string>('');
  useEffect(() => {
    QRCode.toString(share.code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg);
  }, [share.code]);

  return (
    <div className={`share-card ${printable ? 'emergency-kit' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 4px' }}>
            Vault Local · {tr('Acceso de emergencia', 'Emergency access')} · {tr('Parte', 'Part')} {share.part} {tr('de', 'of')} 3
          </h3>
          <div style={{ fontSize: 13 }}>
            {tr('Bóveda', 'Vault')}: <strong>{setup.vault_name}</strong> · {tr('Código de las hojas', 'Sheet code')}: <strong>{setup.key_id}</strong> · {dateText}
          </div>
        </div>
        <div className="share-qr" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <ol className="share-words">
        {share.words.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ol>
      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
        <strong>{tr('Para quien recibe esta hoja:', 'For whoever receives this sheet:')}</strong>{' '}
        {tr(
          'Guárdala en un lugar seguro y no la copies. Sola no sirve para nada. Si el dueño de la bóveda no puede abrirla (fallecimiento o incapacidad), junta esta hoja con OTRA parte distinta (mismo código de hojas), instala Vault Local desde https://vault-local.vercel.app, y en la pantalla de desbloqueo pulsa «Acceso de emergencia». Elige la bóveda (o el archivo de respaldo .db), escribe el número de parte y las 24 palabras de cada hoja, y pulsa «Abrir en solo lectura».',
          'Keep it somewhere safe and do not copy it. On its own it is useless. If the vault owner cannot open it (death or incapacity), bring this sheet together with ANOTHER, different part (same sheet code), install Vault Local from https://vault-local.vercel.app, and on the unlock screen click "Emergency access". Choose the vault (or the .db backup file), enter the part number and the 24 words of each sheet, and click "Open read-only".',
        )}
      </div>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={onPrint}>
          {tr('Imprimir parte', 'Print part')} {share.part}
        </button>
      </div>
    </div>
  );
}
