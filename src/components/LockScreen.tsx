import { BrandMark } from './BrandMark';
import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { useI18n, useTr } from '../i18n';

interface LockScreenProps {
  mode: 'setup' | 'unlock';
  onUnlock: (password: string) => void;
  onSetup: (password: string, confirmPassword: string) => void;
  error: string | null;
  processing: boolean;
  /** Panel de desbloqueo rápido (PIN / Windows Hello), si está disponible */
  quickPanel?: React.ReactNode;
  /** Selector de bóveda (bóvedas múltiples) */
  vaultSwitcher?: React.ReactNode;
  /** Enlaces debajo del formulario (acceso de emergencia) */
  footer?: React.ReactNode;
  /** Subtítulo alternativo al crear una bóveda adicional */
  setupSubtitle?: string;
  /** Cancelar la creación de una bóveda adicional */
  onCancelSetup?: () => void;
}

function calcStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(4, score);
}

const strengthColors = ['', '#ff4c4c', '#ffb74d', '#ffb74d', '#4caf50'];
const strengthWidths = ['0%', '25%', '50%', '75%', '100%'];

export function LockScreen({ mode, onUnlock, onSetup, error, processing, quickPanel, vaultSwitcher, footer, setupSubtitle, onCancelSetup }: LockScreenProps) {
  const { t, locale, setLocale } = useI18n();
  const tr = useTr();
  const strengthLabels = ['', t('lock.strength.very_weak'), t('lock.strength.weak'), t('lock.strength.acceptable'), t('lock.strength.very_strong')];
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = calcStrength(password);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (processing) return;
      if (mode === 'setup') {
        onSetup(password, confirmPassword);
      } else {
        onUnlock(password);
      }
    },
    [mode, password, confirmPassword, onUnlock, onSetup, processing]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (processing) return;
        if (mode === 'setup') {
          onSetup(password, confirmPassword);
        } else {
          onUnlock(password);
        }
      }
    },
    [mode, password, confirmPassword, onUnlock, onSetup, processing]
  );

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">
          <BrandMark className="lock-logo-icon" size={64} detailed />
          <span className="lock-logo-title">{t('lock.title')}</span>
          <span className="lock-logo-subtitle">
            {mode === 'setup'
              ? setupSubtitle || t('lock.subtitle.setup')
              : t('lock.subtitle.unlock')}
          </span>
          <button
            type="button"
            className="lang-toggle"
            onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
            style={{ marginTop: '8px' }}
          >
            {locale === 'es' ? 'EN' : 'ES'}
          </button>
        </div>

        {mode === 'unlock' && vaultSwitcher}
        {mode === 'unlock' && quickPanel}
        <form className="lock-form" onSubmit={handleSubmit}>
          <div className="lock-input-group">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder={mode === 'setup' ? t('lock.password_master') : t('lock.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              disabled={processing}
            />
            <button
              type="button"
              className="lock-toggle-password"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? t('lock.hide_password') : t('lock.show_password')}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {mode === 'setup' && (
            <>
              <div className="strength-bar-container">
                <div className="strength-bar-track">
                  <div
                    className="strength-bar-fill"
                    style={{
                      width: strengthWidths[strength],
                      background: strengthColors[strength],
                    }}
                  />
                </div>
                {password && (
                  <div className={`strength-label strength-${strength}`}>
                    {strengthLabels[strength]}
                  </div>
                )}
              </div>

              <div className="lock-input-group">
                <input
                  className="input"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder={t('lock.confirm')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={processing}
                />
                <button
                  type="button"
                  className="lock-toggle-password"
                  onClick={() => setShowConfirm(!showConfirm)}
                  tabIndex={-1}
                  aria-label={showConfirm ? t('lock.hide_password') : t('lock.show_password')}
                >
                  {showConfirm ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )}

          {error && <div className="lock-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary lock-submit"
            disabled={processing}
          >
            {processing ? (
              <span className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            ) : mode === 'setup' ? (
              t('lock.create')
            ) : (
              t('lock.unlock')
            )}
          </button>
          {onCancelSetup && (
            <button type="button" className="btn btn-secondary lock-submit" onClick={onCancelSetup} disabled={processing}>
              {tr('Cancelar', 'Cancel')}
            </button>
          )}
        </form>
        {footer}
      </div>
    </div>
  );
}
