import { useState, type ReactNode } from 'react';
import { useSettings } from '../hooks/useSettings';
import type { AppSettings } from '../types';

interface Props {
  onClose: () => void;
  onUpgrade: () => void;
}

const AUTO_LOCK_OPTIONS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480];
const CLIPBOARD_OPTIONS = [5, 10, 15, 30, 60, 120, 300];
const WARNING_OPTIONS = [15, 30, 60];

function minutesLabel(m: number) {
  return m < 60 ? `${m} min` : `${m / 60} h`;
}

function secondsLabel(s: number) {
  return s < 60 ? `${s} s` : `${s / 60} min`;
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch" style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
    </label>
  );
}

function Row({ label, hint, premium, children }: { label: string; hint?: string; premium?: boolean; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">
          {label}
          {premium && <span className="premium-star">★ Premium</span>}
        </div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({ onClose, onUpgrade }: Props) {
  const { saved, settings, limits, update } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState(saved.quick_search_shortcut);
  const [sequence, setSequence] = useState(saved.auto_type_sequence);
  const premium = limits.premium;

  // Partimos de los valores efectivos para no reenviar valores de pago guardados
  // cuando la licencia ya no los permite.
  const base: AppSettings = premium ? saved : settings;

  const save = async (patch: Partial<AppSettings>) => {
    setError(null);
    const r = await update({ ...base, ...patch });
    if (!r.success) setError(r.error ?? 'No se pudo guardar');
  };

  const premiumOnly = (fn: () => void) => () => (premium ? fn() : onUpgrade());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2 className="modal-title">Ajustes</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {!premium && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
              En el plan gratuito puedes hacer los tiempos más cortos. Las opciones marcadas con ★ requieren Premium.{' '}
              <button className="btn btn-primary btn-sm" onClick={onUpgrade}>Ver planes</button>
            </p>
          )}

          <div className="settings-section">
            <h3>Bloqueo</h3>
            <Row label="Bloquear tras inactividad" hint={`Gratis: hasta ${limits.max_auto_lock_minutes} min.`}>
              <select
                className="select"
                value={settings.auto_lock_minutes}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > limits.max_auto_lock_minutes) onUpgrade();
                  else save({ auto_lock_minutes: v });
                }}
              >
                {AUTO_LOCK_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}{m > limits.max_auto_lock_minutes ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Aviso antes de bloquear" hint="Muestra «Sigo aquí» y, con Premium, «Pausar».">
              <select className="select" value={settings.lock_warning_secs} onChange={(e) => save({ lock_warning_secs: Number(e.target.value) })}>
                {WARNING_OPTIONS.map((s) => (
                  <option key={s} value={s}>{secondsLabel(s)}</option>
                ))}
              </select>
            </Row>
            <Row label="Bloquear al suspender o hibernar el equipo">
              <Toggle checked={settings.lock_on_sleep} onChange={(v) => save({ lock_on_sleep: v })} />
            </Row>
            <Row label="Bloquear al bloquear la sesión del sistema" hint="Por ejemplo, al pulsar Windows + L.">
              <Toggle checked={settings.lock_on_session_lock} onChange={(v) => save({ lock_on_session_lock: v })} />
            </Row>
            <Row label="Bloquear al minimizar la ventana">
              <Toggle checked={settings.lock_on_minimize} onChange={(v) => save({ lock_on_minimize: v })} />
            </Row>
          </div>

          <div className="settings-section">
            <h3>Portapapeles</h3>
            <Row
              label="Borrar lo copiado después de"
              hint={`Gratis: hasta ${limits.max_clipboard_secs} s. Lo copiado nunca entra al historial del portapapeles del sistema.`}
            >
              <select
                className="select"
                value={settings.clipboard_clear_secs}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > limits.max_clipboard_secs) onUpgrade();
                  else save({ clipboard_clear_secs: v });
                }}
              >
                {CLIPBOARD_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {secondsLabel(s)}{s > limits.max_clipboard_secs ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label="Copia en secuencia"
              hint="Después de copiar el usuario (Ctrl+U en la búsqueda rápida o Ctrl+B en la ventana principal), pulsa el atajo global de nuevo y se copia la contraseña sin abrir ninguna ventana; una tercera vez copia el código TOTP. Dura 2 minutos."
              premium={!premium}
            >
              <Toggle checked={settings.copy_sequence} onChange={(v) => (premium ? save({ copy_sequence: v }) : onUpgrade())} />
            </Row>
          </div>

          <div className="settings-section">
            <h3>Acceso rápido</h3>
            <Row label="Ícono en la bandeja del sistema" hint="Bloquear, abrir la búsqueda rápida y mostrar la ventana desde la bandeja." premium={!premium}>
              <Toggle checked={settings.tray_enabled} onChange={(v) => (premium ? save({ tray_enabled: v, close_to_tray: v && settings.close_to_tray }) : onUpgrade())} />
            </Row>
            <Row label="Al cerrar la ventana, dejar la app en la bandeja" premium={!premium}>
              <Toggle
                checked={settings.close_to_tray}
                disabled={premium && !settings.tray_enabled}
                onChange={(v) => (premium ? save({ close_to_tray: v }) : onUpgrade())}
              />
            </Row>
            <Row label="Búsqueda rápida con atajo global" hint="Abre un buscador flotante desde cualquier programa." premium={!premium}>
              <Toggle checked={settings.quick_search_enabled} onChange={(v) => (premium ? save({ quick_search_enabled: v }) : onUpgrade())} />
            </Row>
            <Row label="Atajo de búsqueda rápida" hint="Formato: CommandOrControl+Shift+Space, Alt+Shift+K, etc.">
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={shortcut} onChange={(e) => setShortcut(e.target.value)} spellCheck={false} />
                <button className="btn btn-secondary btn-sm" onClick={premiumOnly(() => save({ quick_search_shortcut: shortcut.trim() }))}>
                  Guardar
                </button>
              </div>
            </Row>
          </div>

          <div className="settings-section">
            <h3>Escritura automática</h3>
            <Row
              label="Secuencia por defecto"
              hint="Se escribe en la ventana activa desde la búsqueda rápida. Marcadores: {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY 500}"
              premium={!premium}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={sequence} onChange={(e) => setSequence(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                <button className="btn btn-secondary btn-sm" onClick={premiumOnly(() => save({ auto_type_sequence: sequence }))}>
                  Guardar
                </button>
              </div>
            </Row>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(255, 76, 76, 0.08)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
