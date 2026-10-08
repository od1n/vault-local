import { useState, useCallback } from 'react';
import type { LicenseInfo } from '../types';
import { tierLabel } from '../hooks/useLicense';
import { useI18n, useTr } from '../i18n';

interface LicenseDialogProps {
  license: LicenseInfo;
  onActivate: (key: string) => Promise<{ success: boolean; error?: string }>;
  onDeactivate: () => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

const SITE_URL = 'https://vault-local.vercel.app';

function formatDate(dateStr: string | null, locale: string): string {
  if (!dateStr) return '---';
  try {
    return new Date(dateStr).toLocaleString(locale === 'en' ? 'en-US' : 'es', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function maskKey(key: string): string {
  if (key.length <= 16) return key;
  return key.slice(0, 8) + '…' + key.slice(-6);
}

const boxStyle = (color: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 16,
  background: `rgba(${color}, 0.08)`,
  border: `1px solid rgba(${color}, 0.2)`,
  borderRadius: 'var(--radius)',
  marginBottom: 20,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

export function LicenseDialog({ license, onActivate, onDeactivate, onClose }: LicenseDialogProps) {
  const tr = useTr();
  const { locale } = useI18n();
  const [inputKey, setInputKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const active = license.status === 'active' && license.is_premium;
  const expired = license.status === 'expired';
  const expiringSoon = active && license.days_left !== null && license.days_left <= 14;

  const handleActivate = useCallback(async () => {
    if (!inputKey.trim()) {
      setError(tr('Pega tu clave de licencia', 'Paste your license key'));
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await onActivate(inputKey.trim());
    setLoading(false);
    if (result.success) {
      setSuccess(tr('Licencia activada correctamente', 'License activated successfully'));
      setInputKey('');
    } else {
      setError(result.error || tr('Error al activar', 'Activation failed'));
    }
  }, [inputKey, onActivate, tr]);

  const handleDeactivate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await onDeactivate();
    setLoading(false);
    setConfirmDeactivate(false);
    if (result.success) {
      setSuccess(tr('Licencia desactivada en este equipo', 'License deactivated on this computer'));
    } else {
      setError(result.error || tr('Error al desactivar', 'Deactivation failed'));
    }
  }, [onDeactivate, tr]);

  const activationForm = (
    <div>
      <label className="form-label">{expired ? tr('Pega tu nueva clave de licencia', 'Paste your new license key') : tr('Clave de licencia', 'License key')}</label>
      <textarea
        className="textarea"
        placeholder="VL2-…"
        value={inputKey}
        onChange={(e) => {
          setInputKey(e.target.value);
          setError(null);
        }}
        rows={3}
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}
      />
      <button
        className="btn btn-primary"
        onClick={handleActivate}
        disabled={loading || !inputKey.trim()}
        style={{ width: '100%', marginTop: 8 }}
      >
        {loading ? tr('Activando...', 'Activating...') : tr('Activar', 'Activate')}
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        {tr('Compra o renueva tu plan (Premium $15/año, Pro $39/año) en', 'Buy or renew your plan (Premium $15/year, Pro $39/year) at')}{' '}
        <span style={{ userSelect: 'all' }}>{SITE_URL}/#pricing</span>.{' '}
        {tr('¿Tienes un código promocional? Canjéalo en', 'Have a promo code? Redeem it at')}{' '}
        <span style={{ userSelect: 'all' }}>{SITE_URL}/#promo</span>{' '}
        {tr(
          'y recibirás por correo una licencia de prueba con todas las funciones (Pro) por 30 días.',
          'and you will receive by email a trial license with all features (Pro) for 30 days.',
        )}
      </p>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2 className="modal-title">{active ? `Vault Local ${tierLabel(license, locale)}` : tr('Actualizar a Premium', 'Upgrade to Premium')}</h2>
          <button className="btn-icon" onClick={onClose} aria-label={tr('Cerrar', 'Close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {active ? (
            <div>
              <div style={boxStyle(expiringSoon ? '255, 170, 0' : '76, 175, 80')}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{tr(`${tierLabel(license, locale)} activo`, `${tierLabel(license, locale)} active`)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {license.expires_at === null
                      ? tr('Sin vencimiento', 'No expiration')
                      : expiringSoon
                        ? tr(
                            `Vence en ${license.days_left} día(s). Renueva para no perder las funciones de pago.`,
                            `Expires in ${license.days_left} day(s). Renew to keep the paid features.`,
                          )
                        : tr(`Vence el ${formatDate(license.expires_at, locale)}`, `Expires on ${formatDate(license.expires_at, locale)}`)}
                  </div>
                </div>
              </div>

              <Row label={tr('Licenciado a', 'Licensed to')} value={license.email || '---'} />
              <Row label={tr('Clave', 'Key')} value={license.license_key ? maskKey(license.license_key) : '---'} />
              <Row label={tr('Activada en este equipo', 'Activated on this computer')} value={formatDate(license.activated_at, locale)} />

              {expiringSoon && <div style={{ marginBottom: 16 }}>{activationForm}</div>}

              {!confirmDeactivate ? (
                <button className="btn btn-secondary" onClick={() => setConfirmDeactivate(true)} disabled={loading} style={{ width: '100%' }}>
                  {tr('Desactivar licencia en este equipo', 'Deactivate license on this computer')}
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={() => setConfirmDeactivate(false)} style={{ flex: 1 }}>
                    {tr('Cancelar', 'Cancel')}
                  </button>
                  <button className="btn btn-danger" onClick={handleDeactivate} disabled={loading} style={{ flex: 1 }}>
                    {loading ? tr('Desactivando...', 'Deactivating...') : tr('Confirmar', 'Confirm')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {expired ? (
                <div style={boxStyle('255, 76, 76')}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{tr(`Tu licencia venció el ${formatDate(license.expires_at, locale)}`, `Your license expired on ${formatDate(license.expires_at, locale)}`)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {tr('Tus datos siguen intactos. Las funciones de pago vuelven al renovar.', 'Your data is intact. Paid features come back when you renew.')}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ ...boxStyle('76, 141, 255'), fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span>
                    {tr(
                      'Premium desbloquea: tiempos de bloqueo y de portapapeles personalizables, búsqueda rápida con atajo global, escritura automática, copia en secuencia, verificación de filtraciones (HIBP), auditoría detallada, archivos adjuntos, historial de contraseñas y más. Pro añade la sincronización cifrada y las bóvedas múltiples (Personal, Trabajo, Familia).',
                      'Premium unlocks: custom lock and clipboard timeouts, quick search with a global shortcut, auto-type, sequential copy, breach checking (HIBP), detailed audit, file attachments, password history and more. Pro adds encrypted sync and multiple vaults (Personal, Work, Family).',
                    )}
                  </span>
                </div>
              )}
              {license.status === 'invalid' && (
                <p style={{ fontSize: 12, color: 'var(--warning, #f0a020)', marginBottom: 12 }}>
                  {tr('La licencia guardada no es válida (las claves del formato anterior ya no se aceptan). Activa una clave nueva.', 'The saved license is not valid (keys in the old format are no longer accepted). Activate a new key.')}
                </p>
              )}
              {activationForm}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(255, 76, 76, 0.08)', border: '1px solid rgba(255, 76, 76, 0.15)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(76, 175, 80, 0.08)', border: '1px solid rgba(76, 175, 80, 0.2)', borderRadius: 'var(--radius)', color: 'var(--success)', fontSize: 13 }}>
              {success}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {tr('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
