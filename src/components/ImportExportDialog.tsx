import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

interface ImportExportDialogProps {
  mode: 'import' | 'export';
  onClose: () => void;
  onComplete: () => void;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

type ImportFormat = 'chrome' | 'firefox' | 'bitwarden_csv' | 'bitwarden_json' | 'onepassword' | 'lastpass' | 'keepass' | 'kdbx';
type ExportFormat = 'csv' | 'json';

const IMPORT_FORMATS: { value: ImportFormat; label: string }[] = [
  { value: 'chrome', label: 'Google Chrome / Microsoft Edge' },
  { value: 'firefox', label: 'Mozilla Firefox' },
  { value: 'bitwarden_csv', label: 'Bitwarden (CSV)' },
  { value: 'bitwarden_json', label: 'Bitwarden (JSON)' },
  { value: 'onepassword', label: '1Password (CSV)' },
  { value: 'lastpass', label: 'LastPass (CSV)' },
  { value: 'keepass', label: 'KeePass (CSV)' },
  { value: 'kdbx', label: 'KeePassXC (.kdbx directo)' },
];

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV (compatible con la mayoría de gestores)' },
  { value: 'json', label: 'JSON (formato Vault Local)' },
];

const IMPORT_HELP: Record<ImportFormat, string> = {
  chrome: 'En Chrome, ve a chrome://password-manager/settings → Exportar contraseñas',
  firefox: 'En Firefox, ve a about:logins → ⋯ → Exportar credenciales',
  bitwarden_csv: 'En Bitwarden, ve a Ajustes → Exportar bóveda → formato CSV',
  bitwarden_json: 'En Bitwarden, ve a Ajustes → Exportar bóveda → formato JSON',
  onepassword: 'En 1Password, ve a Archivo → Exportar → formato CSV',
  lastpass: 'En LastPass, ve a Opciones avanzadas → Exportar',
  keepass: 'En KeePass, ve a Archivo → Exportar → formato CSV',
  kdbx: 'Importacion directa de archivos .kdbx. Requiere que KeePassXC este instalado en el sistema.',
};

function getImportFileFilters(format: ImportFormat): { name: string; extensions: string[] }[] {
  if (format === 'bitwarden_json') {
    return [{ name: 'JSON', extensions: ['json'] }];
  }
  if (format === 'kdbx') {
    return [{ name: 'KeePass Database', extensions: ['kdbx'] }];
  }
  return [{ name: 'CSV', extensions: ['csv'] }];
}

function getExportExtension(format: ExportFormat): string {
  return format === 'json' ? 'json' : 'csv';
}

export function ImportExportDialog({ mode, onClose, onComplete }: ImportExportDialogProps) {
  // Import state
  const [importFormat, setImportFormat] = useState<ImportFormat>('chrome');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [kdbxPassword, setKdbxPassword] = useState('');
  const [showKdbxPassword, setShowKdbxPassword] = useState(false);

  // Export state
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [exportPassword, setExportPassword] = useState('');
  const [showExportPassword, setShowExportPassword] = useState(false);

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: getImportFileFilters(importFormat),
      });
      if (selected) {
        setFilePath(selected as string);
        setImportResult(null);
        setError(null);
      }
    } catch (err) {
      setError(`Error al seleccionar archivo: ${err}`);
    }
  }, [importFormat]);

  const handleImport = useCallback(async () => {
    if (!filePath) return;
    if (importFormat === 'kdbx' && !kdbxPassword) {
      setError('Ingresa la contrasena del archivo KeePassXC.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let result: ImportResult;
      if (importFormat === 'kdbx') {
        result = await invoke<ImportResult>('import_kdbx', {
          filePath,
          kdbxPassword,
        });
      } else {
        result = await invoke<ImportResult>('import_entries', {
          filePath,
          format: importFormat,
        });
      }
      setImportResult(result);
      if (result.imported > 0) {
        onComplete();
      }
    } catch (err) {
      setError(`Error al importar: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [filePath, importFormat, kdbxPassword, onComplete]);

  const handleExport = useCallback(async () => {
    if (!exportPassword) {
      setError('Ingresa tu contrasena maestra para exportar.');
      return;
    }
    try {
      const ext = getExportExtension(exportFormat);
      const savePath = await save({
        defaultPath: `vault-local-export.${ext}`,
        filters: [
          {
            name: ext.toUpperCase(),
            extensions: [ext],
          },
        ],
      });
      if (!savePath) return;

      setLoading(true);
      setError(null);
      const count = await invoke<number>('export_entries', {
        filePath: savePath,
        format: exportFormat,
        password: exportPassword,
      });
      setExportCount(count);
    } catch (err) {
      setError(`Error al exportar: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [exportFormat, exportPassword]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const isFinished = mode === 'import' ? importResult !== null : exportCount !== null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">
            {mode === 'import' ? 'Importar credenciales' : 'Exportar bóveda'}
          </h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {mode === 'import' ? (
            <>
              {/* Import format selector */}
              <div className="form-group">
                <label className="form-label">Origen</label>
                <select
                  className="select"
                  value={importFormat}
                  onChange={(e) => {
                    setImportFormat(e.target.value as ImportFormat);
                    setFilePath(null);
                    setImportResult(null);
                    setError(null);
                    setKdbxPassword('');
                  }}
                  disabled={loading}
                >
                  {IMPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Help text */}
              <div className="ie-help-text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>{IMPORT_HELP[importFormat]}</span>
              </div>

              {/* KDBX password input */}
              {importFormat === 'kdbx' && !importResult && (
                <div className="form-group" style={{ marginTop: 16 }}>
                  <label className="form-label">Contrasena del archivo KeePassXC</label>
                  <div className="lock-input-group">
                    <input
                      className="input"
                      type={showKdbxPassword ? 'text' : 'password'}
                      placeholder="Contrasena maestra del archivo .kdbx"
                      value={kdbxPassword}
                      onChange={(e) => { setKdbxPassword(e.target.value); setError(null); }}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="lock-toggle-password"
                      onClick={() => setShowKdbxPassword(!showKdbxPassword)}
                      tabIndex={-1}
                      aria-label={showKdbxPassword ? 'Ocultar' : 'Mostrar'}
                    >
                      {showKdbxPassword ? (
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
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
                    Esta es la contrasena del archivo KeePassXC, no la contrasena de Vault Local. Si KeePassXC no esta instalado, exporta como CSV desde KeePassXC y usa el formato "KeePass (CSV)".
                  </div>
                </div>
              )}

              {/* File selection */}
              {!importResult && (
                <div className="form-group" style={{ marginTop: 20 }}>
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
                    {filePath && (
                      <span className="ie-file-path" title={filePath}>
                        {filePath.split(/[\\/]/).pop()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Import results */}
              {importResult && (
                <div className="ie-results">
                  <div className="ie-results-summary">
                    <div className="ie-result-item ie-result-success">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{importResult.imported} entradas importadas</span>
                    </div>
                    {importResult.skipped > 0 && (
                      <div className="ie-result-item ie-result-skipped">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                        <span>{importResult.skipped} omitidas</span>
                      </div>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="ie-error-list">
                      <span className="ie-error-list-title">Errores:</span>
                      <ul>
                        {importResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="ie-loading">
                  <div className="loading-spinner" />
                  <span>Importando...</span>
                </div>
              )}

              {/* Error */}
              {error && <div className="ie-error">{error}</div>}
            </>
          ) : (
            <>
              {/* Export warning */}
              <div className="ie-warning">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p>
                  El archivo exportado contendrá todas tus credenciales en texto plano.
                  Guárdalo en un lugar seguro y elimínalo cuando ya no lo necesites.
                </p>
              </div>

              {/* Re-auth password */}
              {exportCount === null && (
                <div className="form-group" style={{ marginTop: 20 }}>
                  <label className="form-label">Contrasena maestra</label>
                  <div className="lock-input-group">
                    <input
                      className="input"
                      type={showExportPassword ? 'text' : 'password'}
                      placeholder="Ingresa tu contrasena para confirmar"
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
                </div>
              )}

              {/* Export format selector */}
              <div className="form-group" style={{ marginTop: 20 }}>
                <label className="form-label">Formato</label>
                <select
                  className="select"
                  value={exportFormat}
                  onChange={(e) => {
                    setExportFormat(e.target.value as ExportFormat);
                    setExportCount(null);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Export success */}
              {exportCount !== null && (
                <div className="ie-results">
                  <div className="ie-results-summary">
                    <div className="ie-result-item ie-result-success">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{exportCount} entradas exportadas correctamente</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="ie-loading">
                  <div className="loading-spinner" />
                  <span>Exportando...</span>
                </div>
              )}

              {/* Error */}
              {error && <div className="ie-error">{error}</div>}
            </>
          )}
        </div>

        {/* Footer */}
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
              {mode === 'import' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!filePath || loading || (importFormat === 'kdbx' && !kdbxPassword)}
                >
                  {loading ? 'Importando...' : 'Importar'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleExport}
                  disabled={loading || !exportPassword}
                >
                  {loading ? 'Exportando...' : 'Exportar'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
