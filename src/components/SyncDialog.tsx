import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

interface SyncDialogProps {
  onClose: () => void;
  onComplete: () => void;
}

interface SyncStats {
  entries: number;
  attachments: number;
}

type SyncTab = 'export' | 'import';
type SyncMode = 'merge' | 'replace';

export function SyncDialog({ onClose, onComplete }: SyncDialogProps) {
  const [activeTab, setActiveTab] = useState<SyncTab>('export');

  // Estado de exportación
  const [exportPassword, setExportPassword] = useState('');
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('');
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [exportResult, setExportResult] = useState<SyncStats | null>(null);

  // Estado de importación
  const [importPassword, setImportPassword] = useState('');
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<SyncMode>('merge');
  const [importResult, setImportResult] = useState<SyncStats | null>(null);

  // Estado compartido
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Indicador de fuerza de la contraseña de sincronización
  const getPasswordStrength = (password: string): { level: number; label: string } => {
    if (!password) return { level: 0, label: '' };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) return { level: 1, label: 'Debil' };
    if (score <= 2) return { level: 2, label: 'Regular' };
    if (score <= 3) return { level: 3, label: 'Buena' };
    return { level: 4, label: 'Fuerte' };
  };

  const strength = getPasswordStrength(exportPassword);

  // Exportar archivo de sincronización
  const handleExport = useCallback(async () => {
    if (!exportPassword) {
      setError('Ingresa una contraseña de sincronización.');
      return;
    }
    if (exportPassword !== exportPasswordConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (exportPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    try {
      const savePath = await save({
        defaultPath: 'vault-local-sync.vaultsync',
        filters: [{ name: 'Vault Sync', extensions: ['vaultsync'] }],
      });
      if (!savePath) return;

      setLoading(true);
      setError(null);
      const result = await invoke<SyncStats>('export_sync_file', {
        filePath: savePath,
        syncPassword: exportPassword,
      });
      setExportResult(result);
    } catch (err) {
      setError(`Error al exportar: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [exportPassword, exportPasswordConfirm]);

  // Seleccionar archivo de importación
  const handleSelectFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Vault Sync', extensions: ['vaultsync'] }],
      });
      if (selected) {
        setImportFilePath(selected as string);
        setImportResult(null);
        setError(null);
      }
    } catch (err) {
      setError(`Error al seleccionar archivo: ${err}`);
    }
  }, []);

  // Importar archivo de sincronización
  const handleImport = useCallback(async () => {
    if (!importFilePath) return;
    if (!importPassword) {
      setError('Ingresa la contraseña de sincronización.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SyncStats>('import_sync_file', {
        filePath: importFilePath,
        syncPassword: importPassword,
        mode: importMode,
      });
      setImportResult(result);
      if (result.entries > 0 || result.attachments > 0) {
        onComplete();
      }
    } catch (err) {
      setError(`Error al importar: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [importFilePath, importPassword, importMode, onComplete]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const isFinished = activeTab === 'export' ? exportResult !== null : importResult !== null;

  const strengthColors: Record<number, string> = {
    1: 'var(--danger)',
    2: 'var(--warning)',
    3: 'var(--warning)',
    4: 'var(--success)',
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        {/* Encabezado */}
        <div className="modal-header">
          <h2 className="modal-title">Sincronizar boveda</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Pestañas */}
        <div className="sync-tabs">
          <button
            className={`sync-tab ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => { setActiveTab('export'); setError(null); }}
          >
            Exportar
          </button>
          <button
            className={`sync-tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => { setActiveTab('import'); setError(null); }}
          >
            Importar
          </button>
        </div>

        {/* Cuerpo */}
        <div className="modal-body">
          {activeTab === 'export' ? (
            <>
              {/* Advertencia de exportación */}
              <div className="ie-warning">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p>
                  Este archivo contendrá toda tu boveda cifrada con la contraseña de sincronización.
                  Usalo para transferir a otro dispositivo.
                </p>
              </div>

              {exportResult === null && (
                <>
                  {/* Contraseña de sincronización */}
                  <div className="form-group" style={{ marginTop: 20 }}>
                    <label className="form-label">Contraseña de sincronización</label>
                    <div className="lock-input-group">
                      <input
                        className="input"
                        type={showExportPassword ? 'text' : 'password'}
                        placeholder="Minimo 8 caracteres"
                        value={exportPassword}
                        onChange={(e) => { setExportPassword(e.target.value); setError(null); }}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="lock-toggle-password"
                        onClick={() => setShowExportPassword(!showExportPassword)}
                        tabIndex={-1}
                        aria-label={showExportPassword ? 'Ocultar' : 'Mostrar'}
                      >
                        {showExportPassword ? (
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
                    {/* Indicador de fuerza */}
                    {exportPassword && (
                      <div className="strength-bar-container" style={{ marginTop: 8 }}>
                        <div className="strength-bar-track">
                          <div
                            className="strength-bar-fill"
                            style={{
                              width: `${strength.level * 25}%`,
                              background: strengthColors[strength.level] || 'var(--text-muted)',
                            }}
                          />
                        </div>
                        <div className={`strength-label strength-${strength.level}`}>
                          {strength.label}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirmar contraseña */}
                  <div className="form-group">
                    <label className="form-label">Confirmar contraseña</label>
                    <input
                      className="input"
                      type={showExportPassword ? 'text' : 'password'}
                      placeholder="Repite la contraseña"
                      value={exportPasswordConfirm}
                      onChange={(e) => { setExportPasswordConfirm(e.target.value); setError(null); }}
                      disabled={loading}
                    />
                  </div>
                </>
              )}

              {/* Resultado de exportación */}
              {exportResult && (
                <div className="ie-results" style={{ marginTop: 20 }}>
                  <div className="ie-results-summary">
                    <div className="ie-result-item ie-result-success">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{exportResult.entries} entradas y {exportResult.attachments} adjuntos exportados</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Cargando */}
              {loading && (
                <div className="ie-loading">
                  <div className="loading-spinner" />
                  <span>Exportando...</span>
                </div>
              )}

              {/* Error */}
              {error && <div className="ie-error">{error}</div>}
            </>
          ) : (
            <>
              {/* Contraseña de sincronización para importar */}
              {importResult === null && (
                <>
                  <div className="form-group">
                    <label className="form-label">Contraseña de sincronización</label>
                    <div className="lock-input-group">
                      <input
                        className="input"
                        type={showImportPassword ? 'text' : 'password'}
                        placeholder="Contraseña usada al exportar"
                        value={importPassword}
                        onChange={(e) => { setImportPassword(e.target.value); setError(null); }}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="lock-toggle-password"
                        onClick={() => setShowImportPassword(!showImportPassword)}
                        tabIndex={-1}
                        aria-label={showImportPassword ? 'Ocultar' : 'Mostrar'}
                      >
                        {showImportPassword ? (
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
                  </div>

                  {/* Selección de archivo */}
                  <div className="form-group">
                    <label className="form-label">Archivo</label>
                    <div className="ie-file-row">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleSelectFile}
                        disabled={loading}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        Seleccionar archivo
                      </button>
                      {importFilePath && (
                        <span className="ie-file-path" title={importFilePath}>
                          {importFilePath.split(/[\\/]/).pop()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Modo de importación */}
                  <div className="form-group">
                    <label className="form-label">Modo</label>
                    <select
                      className="select"
                      value={importMode}
                      onChange={(e) => setImportMode(e.target.value as SyncMode)}
                      disabled={loading}
                    >
                      <option value="merge">Combinar (mantener existentes, actualizar si hay cambios)</option>
                      <option value="replace">Reemplazar todo</option>
                    </select>
                  </div>

                  {/* Advertencia para modo reemplazar */}
                  {importMode === 'replace' && (
                    <div className="ie-warning">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <p>Esto eliminará todas las entradas actuales y las reemplazará con las del archivo.</p>
                    </div>
                  )}
                </>
              )}

              {/* Resultado de importación */}
              {importResult && (
                <div className="ie-results">
                  <div className="ie-results-summary">
                    <div className="ie-result-item ie-result-success">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{importResult.entries} entradas y {importResult.attachments} adjuntos importados</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Cargando */}
              {loading && (
                <div className="ie-loading">
                  <div className="loading-spinner" />
                  <span>Importando...</span>
                </div>
              )}

              {/* Error */}
              {error && <div className="ie-error">{error}</div>}
            </>
          )}
        </div>

        {/* Pie */}
        <div className="modal-footer">
          {isFinished ? (
            <button className="btn btn-primary" onClick={onClose}>
              Cerrar
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              {activeTab === 'export' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleExport}
                  disabled={loading || !exportPassword || !exportPasswordConfirm}
                >
                  {loading ? 'Exportando...' : 'Exportar archivo de sync'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={loading || !importFilePath || !importPassword}
                >
                  {loading ? 'Importando...' : 'Importar'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
