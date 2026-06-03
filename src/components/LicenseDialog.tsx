import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LicenseDialogProps {
  isPremium: boolean;
  licenseKey: string | null;
  activatedAt: string | null;
  onActivate: (key: string) => Promise<{ success: boolean; error?: string }>;
  onDeactivate: () => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('es', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 4) + '-****-****-' + key.slice(-4);
}

export function LicenseDialog({
  isPremium,
  licenseKey,
  activatedAt,
  onActivate,
  onDeactivate,
  onClose,
}: LicenseDialogProps) {
  const [inputKey, setInputKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const handleActivate = useCallback(async () => {
    if (!inputKey.trim()) {
      setError('Ingresa una clave de licencia');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await onActivate(inputKey.trim());
    setLoading(false);
    if (result.success) {
      setSuccess('Licencia activada correctamente');
      setInputKey('');
    } else {
      setError(result.error || 'Error al activar');
    }
  }, [inputKey, onActivate]);

  const handleDeactivate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await onDeactivate();
    setLoading(false);
    setConfirmDeactivate(false);
    if (result.success) {
      setSuccess('Licencia desactivada');
    } else {
      setError(result.error || 'Error al desactivar');
    }
  }, [onDeactivate]);

  const handleGenerateTestKey = useCallback(async () => {
    try {
      const key = await invoke<string>('generate_license_key');
      setGeneratedKey(key);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al generar clave de prueba');
    }
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">
            {isPremium ? 'Vault Local Premium' : 'Actualizar a Premium'}
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {isPremium ? (
            /* Premium active state */
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                background: 'rgba(76, 175, 80, 0.08)',
                border: '1px solid rgba(76, 175, 80, 0.2)',
                borderRadius: 'var(--radius)',
                marginBottom: 20,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22,4 12,14.01 9,11.01" />
                </svg>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Premium activo</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Todas las funciones desbloqueadas
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Clave de licencia
                </div>
                <div style={{ fontSize: 14, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                  {licenseKey ? maskKey(licenseKey) : '---'}
                </div>
              </div>

              {activatedAt && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Fecha de activacion
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    {formatDate(activatedAt)}
                  </div>
                </div>
              )}

              {!confirmDeactivate ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={loading}
                  style={{ width: '100%' }}
                >
                  Desactivar licencia
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setConfirmDeactivate(false)}
                    style={{ flex: 1 }}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={handleDeactivate}
                    disabled={loading}
                    style={{ flex: 1 }}
                  >
                    {loading ? 'Desactivando...' : 'Confirmar'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Not premium - activation form */
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: 14,
                background: 'var(--accent-subtle)',
                borderRadius: 'var(--radius)',
                marginBottom: 20,
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  Desbloquea funciones avanzadas: verificacion de filtraciones (HIBP),
                  analisis detallado de auditorias, archivos adjuntos y mas.
                </span>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Clave de licencia</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={inputKey}
                    onChange={(e) => {
                      setInputKey(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleActivate();
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleActivate}
                    disabled={loading || !inputKey.trim()}
                  >
                    {loading ? 'Activando...' : 'Activar'}
                  </button>
                </div>
              </div>

              {/* DEV ONLY: Test key generator */}
              <div style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px dashed var(--border)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontStyle: 'italic' }}>
                  Solo desarrollo — Generar clave de prueba
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleGenerateTestKey}
                  style={{ width: '100%' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01" />
                  </svg>
                  Generar clave de prueba
                </button>
                {generatedKey && (
                  <div style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: 'var(--accent)',
                    wordBreak: 'break-all',
                    userSelect: 'all',
                  }}>
                    {generatedKey}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feedback messages */}
          {error && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(255, 76, 76, 0.08)',
              border: '1px solid rgba(255, 76, 76, 0.15)',
              borderRadius: 'var(--radius)',
              color: 'var(--danger)',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(76, 175, 80, 0.08)',
              border: '1px solid rgba(76, 175, 80, 0.2)',
              borderRadius: 'var(--radius)',
              color: 'var(--success)',
              fontSize: 13,
            }}>
              {success}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
