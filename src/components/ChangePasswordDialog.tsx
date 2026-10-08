import { useState, useCallback, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from './Toast';
import { useTr } from '../i18n';

interface ChangePasswordDialogProps {
  onClose: () => void;
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

export function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
  const tr = useTr();
  const strengthLabels = ['', tr('Muy débil', 'Very weak'), tr('Débil', 'Weak'), tr('Buena', 'Good'), tr('Muy fuerte', 'Very strong')];
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const strength = calcStrength(newPassword);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError(tr('Ingresa tu contraseña actual.', 'Enter your current password.'));
      return;
    }
    if (newPassword.length < 8) {
      setError(tr('La nueva contraseña debe tener al menos 8 caracteres.', 'The new password must be at least 8 characters long.'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(tr('Las contraseñas nuevas no coinciden.', 'The new passwords do not match.'));
      return;
    }

    setLoading(true);
    try {
      await invoke('change_master_password', { currentPassword, newPassword });
      showToast(tr('Contraseña maestra actualizada correctamente', 'Master password updated successfully'), 'success');
      onClose();
    } catch (err) {
      setError(typeof err === 'string' ? err : tr('Error al cambiar la contraseña. Verifica tu contraseña actual.', 'Failed to change the password. Check your current password.'));
    } finally {
      setLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, onClose, showToast, tr]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !loading) {
      onClose();
    }
  }, [onClose, loading]);

  const renderPasswordToggle = (show: boolean, onToggle: () => void) => (
    <button
      type="button"
      className="lock-toggle-password"
      onClick={onToggle}
      tabIndex={-1}
      aria-label={show ? tr('Ocultar', 'Hide') : tr('Mostrar', 'Show')}
    >
      {show ? (
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
  );

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">{tr('Cambiar contraseña maestra', 'Change master password')}</h2>
          <button className="btn-icon" onClick={onClose} disabled={loading} aria-label={tr('Cerrar', 'Close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="change-pw-warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p>{tr('Este proceso re-cifrara toda la bóveda. No cierres la aplicación hasta que termine.', 'This process will re-encrypt the entire vault. Do not close the app until it finishes.')}</p>
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Contraseña actual', 'Current password')}</label>
            <div className="lock-input-group">
              <input
                className="input"
                type={showCurrent ? 'text' : 'password'}
                placeholder={tr('Ingresa tu contraseña actual', 'Enter your current password')}
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
                disabled={loading}
                autoFocus
              />
              {renderPasswordToggle(showCurrent, () => setShowCurrent(!showCurrent))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Nueva contraseña', 'New password')}</label>
            <div className="lock-input-group">
              <input
                className="input"
                type={showNew ? 'text' : 'password'}
                placeholder={tr('Ingresa la nueva contraseña', 'Enter the new password')}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                disabled={loading}
              />
              {renderPasswordToggle(showNew, () => setShowNew(!showNew))}
            </div>
            {newPassword && (
              <div className="strength-bar-container" style={{ marginTop: 8 }}>
                <div className="strength-bar-track">
                  <div
                    className="strength-bar-fill"
                    style={{
                      width: strengthWidths[strength],
                      background: strengthColors[strength],
                    }}
                  />
                </div>
                <div className={`strength-label strength-${strength}`}>
                  {strengthLabels[strength]}
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">{tr('Confirmar nueva contraseña', 'Confirm new password')}</label>
            <div className="lock-input-group">
              <input
                className="input"
                type={showConfirm ? 'text' : 'password'}
                placeholder={tr('Repite la nueva contraseña', 'Repeat the new password')}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                disabled={loading}
              />
              {renderPasswordToggle(showConfirm, () => setShowConfirm(!showConfirm))}
            </div>
          </div>

          {error && <div className="lock-error">{error}</div>}
        </form>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {tr('Cancelar', 'Cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={(e) => handleSubmit(e as unknown as FormEvent)}
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          >
            {loading ? (
              <>
                <span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                {tr('Re-cifrando...', 'Re-encrypting...')}
              </>
            ) : (
              tr('Cambiar contraseña', 'Change password')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
