import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from '../hooks/useSettings';
import { EmergencyKit } from './extras/EmergencyKit';
import { EmergencySetupDialog } from './emergency/EmergencySetupDialog';
import type { AppSettings } from '../types';
import { useTr } from '../i18n';

interface Props {
  onClose: () => void;
  onUpgrade: () => void;
}

const AUTO_LOCK_OPTIONS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480];
const CLIPBOARD_OPTIONS = [5, 10, 15, 30, 60, 120, 300];
const WARNING_OPTIONS = [15, 30, 60];
const QUICK_HOURS = [1, 2, 4, 8, 12, 24, 72];

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
  const tr = useTr();
  const [error, setError] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState(saved.quick_search_shortcut);
  const [sequence, setSequence] = useState(saved.auto_type_sequence);
  const premium = limits.premium;
  const [showKit, setShowKit] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [helloAvailable, setHelloAvailable] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>('has_quick_unlock_pin').then(setHasPin).catch(() => setHasPin(false));
    invoke<boolean>('hello_available').then(setHelloAvailable).catch(() => setHelloAvailable(false));
  }, []);

  const savePin = async (pin: string | null) => {
    setPinMsg(null);
    try {
      await invoke('set_quick_unlock_pin', { pin });
      setHasPin(pin !== null);
      setNewPin('');
      setPinMsg(pin ? tr('PIN guardado. Funcionará desde el próximo bloqueo.', 'PIN saved. It will work from the next lock.') : tr('PIN eliminado.', 'PIN removed.'));
    } catch (e) {
      setPinMsg(typeof e === 'string' ? e : tr('No se pudo guardar el PIN', 'Could not save the PIN'));
    }
  };

  // Partimos de los valores efectivos para no reenviar valores de pago guardados
  // cuando la licencia ya no los permite.
  const base: AppSettings = premium ? saved : settings;

  const save = async (patch: Partial<AppSettings>) => {
    setError(null);
    const r = await update({ ...base, ...patch });
    if (!r.success) setError(r.error ?? tr('No se pudo guardar', 'Could not save'));
  };

  const premiumOnly = (fn: () => void) => () => (premium ? fn() : onUpgrade());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2 className="modal-title">{tr('Ajustes', 'Settings')}</h2>
          <button className="btn-icon" onClick={onClose} aria-label={tr('Cerrar', 'Close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {!premium && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
              {tr('En el plan gratuito puedes hacer los tiempos más cortos. Las opciones marcadas con ★ requieren Premium.', 'On the free plan you can only make the times shorter. Options marked with ★ require Premium.')}{' '}
              <button className="btn btn-primary btn-sm" onClick={onUpgrade}>{tr('Ver planes', 'See plans')}</button>
            </p>
          )}

          <div className="settings-section">
            <h3>{tr('Bloqueo', 'Locking')}</h3>
            <Row label={tr('Bloquear tras inactividad', 'Lock after inactivity')} hint={premium ? tr(`Hasta ${minutesLabel(limits.max_auto_lock_minutes)}.`, `Up to ${minutesLabel(limits.max_auto_lock_minutes)}.`) : tr(`Plan gratuito: hasta ${limits.max_auto_lock_minutes} min.`, `Free plan: up to ${limits.max_auto_lock_minutes} min.`)}>
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
            <Row label={tr('Aviso antes de bloquear', 'Warning before locking')} hint={tr('Muestra «Sigo aquí» y, con Premium, «Pausar».', 'Shows “I\'m still here” and, with Premium, “Pause”.')}>
              <select className="select" value={settings.lock_warning_secs} onChange={(e) => save({ lock_warning_secs: Number(e.target.value) })}>
                {WARNING_OPTIONS.map((s) => (
                  <option key={s} value={s}>{secondsLabel(s)}</option>
                ))}
              </select>
            </Row>
            <Row label={tr('Bloquear al suspender o hibernar el equipo', 'Lock when the computer sleeps or hibernates')}>
              <Toggle checked={settings.lock_on_sleep} onChange={(v) => save({ lock_on_sleep: v })} />
            </Row>
            <Row label={tr('Bloquear al bloquear la sesión del sistema', 'Lock when the system session is locked')} hint={tr('Por ejemplo, al pulsar Windows + L.', 'For example, when pressing Windows + L.')}>
              <Toggle checked={settings.lock_on_session_lock} onChange={(v) => save({ lock_on_session_lock: v })} />
            </Row>
            <Row label={tr('Bloquear al minimizar la ventana', 'Lock when the window is minimized')}>
              <Toggle checked={settings.lock_on_minimize} onChange={(v) => save({ lock_on_minimize: v })} />
            </Row>
          </div>

          <div className="settings-section">
            <h3>{tr('Portapapeles', 'Clipboard')}</h3>
            <Row
              label={tr('Borrar lo copiado después de', 'Clear copied content after')}
              hint={tr(
                `${premium ? `Hasta ${secondsLabel(limits.max_clipboard_secs)}` : `Plan gratuito: hasta ${limits.max_clipboard_secs} s`}. Lo copiado nunca entra al historial del portapapeles del sistema.`,
                `${premium ? `Up to ${secondsLabel(limits.max_clipboard_secs)}` : `Free plan: up to ${limits.max_clipboard_secs} s`}. Copied content never goes into the system clipboard history.`,
              )}
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
              label={tr('Copia en secuencia', 'Sequential copy')}
              hint={tr('Después de copiar el usuario (Ctrl+U en la búsqueda rápida o Ctrl+B en la ventana principal), pulsa el atajo global de nuevo y se copia la contraseña sin abrir ninguna ventana; una tercera vez copia el código TOTP. Dura 2 minutos.', 'After copying the username (Ctrl+U in quick search or Ctrl+B in the main window), press the global shortcut again to copy the password without opening any window; a third time copies the TOTP code. Lasts 2 minutes.')}
              premium={!premium}
            >
              <Toggle checked={settings.copy_sequence} onChange={(v) => (premium ? save({ copy_sequence: v }) : onUpgrade())} />
            </Row>
          </div>

          <div className="settings-section">
            <h3>{tr('Acceso rápido', 'Quick access')}</h3>
            <Row label={tr('Ícono en la bandeja del sistema', 'System tray icon')} hint={tr('Bloquear, abrir la búsqueda rápida y mostrar la ventana desde la bandeja.', 'Lock, open quick search and show the window from the tray.')} premium={!premium}>
              <Toggle checked={settings.tray_enabled} onChange={(v) => (premium ? save({ tray_enabled: v, close_to_tray: v && settings.close_to_tray }) : onUpgrade())} />
            </Row>
            <Row label={tr('Al cerrar la ventana, dejar la app en la bandeja', 'When closing the window, keep the app in the tray')} premium={!premium}>
              <Toggle
                checked={settings.close_to_tray}
                disabled={premium && !settings.tray_enabled}
                onChange={(v) => (premium ? save({ close_to_tray: v }) : onUpgrade())}
              />
            </Row>
            <Row label={tr('Búsqueda rápida con atajo global', 'Quick search with global shortcut')} hint={tr('Abre un buscador flotante desde cualquier programa.', 'Opens a floating search box from any program.')} premium={!premium}>
              <Toggle checked={settings.quick_search_enabled} onChange={(v) => (premium ? save({ quick_search_enabled: v }) : onUpgrade())} />
            </Row>
            <Row label={tr('Atajo de búsqueda rápida', 'Quick search shortcut')} hint={tr('Formato: CommandOrControl+Shift+Space, Alt+Shift+K, etc.', 'Format: CommandOrControl+Shift+Space, Alt+Shift+K, etc.')}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={shortcut} onChange={(e) => setShortcut(e.target.value)} spellCheck={false} />
                <button className="btn btn-secondary btn-sm" onClick={premiumOnly(() => save({ quick_search_shortcut: shortcut.trim() }))}>
                  {tr('Guardar', 'Save')}
                </button>
              </div>
            </Row>
          </div>

          <div className="settings-section">
            <h3>{tr('Escritura automática', 'Auto-type')}</h3>
            <Row
              label={tr('Secuencia por defecto', 'Default sequence')}
              hint={tr('Se escribe en la ventana activa desde la búsqueda rápida. Marcadores: {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY 500}', 'Typed into the active window from quick search. Placeholders: {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY 500}')}
              premium={!premium}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={sequence} onChange={(e) => setSequence(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                <button className="btn btn-secondary btn-sm" onClick={premiumOnly(() => save({ auto_type_sequence: sequence }))}>
                  {tr('Guardar', 'Save')}
                </button>
              </div>
            </Row>
          </div>

          <div className="settings-section">
            <h3>{tr('Desbloqueo rápido', 'Quick unlock')}</h3>
            <Row
              label={tr('Desbloquear con PIN o Windows Hello', 'Unlock with PIN or Windows Hello')}
              hint={tr('Solo mientras la app siga abierta. Al cerrarla, o tras 3 PIN incorrectos, se vuelve a pedir la contraseña maestra.', 'Only while the app stays open. When it is closed, or after 3 wrong PINs, the master password is required again.')}
              premium={!premium}
            >
              <Toggle
                checked={settings.quick_unlock_enabled}
                onChange={(v) => (premium ? save({ quick_unlock_enabled: v }) : onUpgrade())}
              />
            </Row>
            {settings.quick_unlock_enabled && (
              <>
                <Row label={tr('Pedir la contraseña maestra cada', 'Ask for the master password every')} hint={tr('Contado desde el último desbloqueo con la contraseña maestra.', 'Counted from the last unlock with the master password.')}>
                  <select className="select" value={settings.quick_unlock_hours} onChange={(e) => save({ quick_unlock_hours: Number(e.target.value) })}>
                    {QUICK_HOURS.map((h) => (
                      <option key={h} value={h}>{h} h</option>
                    ))}
                  </select>
                </Row>
                <Row label={hasPin ? tr('PIN configurado', 'PIN set') : tr('PIN de desbloqueo rápido', 'Quick unlock PIN')} hint={tr('De 4 a 32 caracteres. Se guarda cifrado dentro de tu bóveda.', '4 to 32 characters. Stored encrypted inside your vault.')}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      placeholder={hasPin ? tr('Nuevo PIN', 'New PIN') : 'PIN'}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value)}
                      style={{ minWidth: 110 }}
                    />
                    <button className="btn btn-secondary btn-sm" disabled={newPin.length < 4} onClick={() => savePin(newPin)}>
                      {tr('Guardar', 'Save')}
                    </button>
                    {hasPin && (
                      <button className="btn btn-ghost btn-sm" onClick={() => savePin(null)}>{tr('Quitar', 'Remove')}</button>
                    )}
                  </div>
                </Row>
                {pinMsg && <div className="settings-row-hint" style={{ marginBottom: 8 }}>{pinMsg}</div>}
                {helloAvailable && (
                  <Row label={tr('Permitir Windows Hello', 'Allow Windows Hello')} hint={tr('Huella, rostro o PIN de Windows.', 'Fingerprint, face or Windows PIN.')}>
                    <Toggle checked={settings.quick_unlock_hello} onChange={(v) => save({ quick_unlock_hello: v })} />
                  </Row>
                )}
              </>
            )}
          </div>

          <div className="settings-section">
            <h3>{tr('Recuperación', 'Recovery')}</h3>
            <Row label={tr('Kit de emergencia', 'Emergency kit')} hint={tr('Hoja para imprimir con la ubicación de tus datos y los pasos para recuperarlos. No incluye secretos.', 'Printable sheet with the location of your data and the steps to recover it. Contains no secrets.')}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowKit(true)}>{tr('Abrir e imprimir', 'Open and print')}</button>
            </Row>
            <Row label={tr('Acceso de emergencia (gratis)', 'Emergency access (free)')} hint={tr('3 hojas para tu pareja, familia o socio: con 2 de ellas pueden abrir esta bóveda en solo lectura si a ti te pasa algo. Una sola no sirve.', '3 sheets for your partner, family or business partner: with 2 of them they can open this vault read-only if something happens to you. One alone is not enough.')}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowEmergency(true)}>{tr('Configurar', 'Set up')}</button>
            </Row>
          </div>
          {showKit && <EmergencyKit onClose={() => setShowKit(false)} />}
          {showEmergency && <EmergencySetupDialog onClose={() => setShowEmergency(false)} />}

          {error && (
            <div style={{ padding: '8px 12px', background: 'rgba(255, 76, 76, 0.08)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>{tr('Cerrar', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}
