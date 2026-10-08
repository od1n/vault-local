import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useTr } from '../i18n';

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

type ImportFormat = 'vault_local' | 'chrome' | 'firefox' | 'bitwarden_csv' | 'bitwarden_json' | 'onepassword' | 'lastpass' | 'keepass' | 'kdbx';
type ExportFormat = 'csv' | 'json';

// Etiquetas como par [es, en]; se resuelven con tr() dentro del componente.
const IMPORT_FORMATS: { value: ImportFormat; label: [string, string] }[] = [
  { value: 'vault_local', label: ['Vault Local (JSON, con etiquetas)', 'Vault Local (JSON, with tags)'] },
  { value: 'chrome', label: ['Google Chrome / Microsoft Edge', 'Google Chrome / Microsoft Edge'] },
  { value: 'firefox', label: ['Mozilla Firefox', 'Mozilla Firefox'] },
  { value: 'bitwarden_csv', label: ['Bitwarden (CSV)', 'Bitwarden (CSV)'] },
  { value: 'bitwarden_json', label: ['Bitwarden (JSON)', 'Bitwarden (JSON)'] },
  { value: 'onepassword', label: ['1Password (CSV)', '1Password (CSV)'] },
  { value: 'lastpass', label: ['LastPass (CSV)', 'LastPass (CSV)'] },
  { value: 'keepass', label: ['KeePass (CSV)', 'KeePass (CSV)'] },
  { value: 'kdbx', label: ['KeePassXC (.kdbx directo)', 'KeePassXC (direct .kdbx)'] },
];

const EXPORT_FORMATS: { value: ExportFormat; label: [string, string] }[] = [
  { value: 'csv', label: ['CSV (compatible con la mayoría de gestores)', 'CSV (compatible with most password managers)'] },
  { value: 'json', label: ['JSON (formato Vault Local)', 'JSON (Vault Local format)'] },
];

const IMPORT_HELP: Record<ImportFormat, [string, string]> = {
  vault_local: [
    'Archivo JSON exportado desde Vault Local (Exportar → JSON). Conserva etiquetas y fechas de cambio de contraseña.',
    'JSON file exported from Vault Local (Export → JSON). Keeps tags and password change dates.',
  ],
  chrome: [
    'En Chrome, ve a chrome://password-manager/settings → Exportar contraseñas',
    'In Chrome, go to chrome://password-manager/settings → Export passwords',
  ],
  firefox: [
    'En Firefox, ve a about:logins → ⋯ → Exportar credenciales',
    'In Firefox, go to about:logins → ⋯ → Export Passwords',
  ],
  bitwarden_csv: [
    'En Bitwarden, ve a Ajustes → Exportar bóveda → formato CSV',
    'In Bitwarden, go to Settings → Export vault → CSV format',
  ],
  bitwarden_json: [
    'En Bitwarden, ve a Ajustes → Exportar bóveda → formato JSON',
    'In Bitwarden, go to Settings → Export vault → JSON format',
  ],
  onepassword: [
    'En 1Password, ve a Archivo → Exportar → formato CSV',
    'In 1Password, go to File → Export → CSV format',
  ],
  lastpass: [
    'En LastPass, ve a Opciones avanzadas → Exportar',
    'In LastPass, go to Advanced Options → Export',
  ],
  keepass: [
    'En KeePass, ve a Archivo → Exportar → formato CSV',
    'In KeePass, go to File → Export → CSV format',
  ],
  kdbx: [
    'Importación directa de archivos .kdbx. Requiere que KeePassXC esté instalado en el sistema.',
    'Direct import of .kdbx files. Requires KeePassXC to be installed on the system.',
  ],
};

function getImportFileFilters(format: ImportFormat): { name: string; extensions: string[] }[] {
  if (format === 'bitwarden_json' || format === 'vault_local') {
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
  const tr = useTr();
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
      setError(tr(`Error al seleccionar archivo: ${err}`, `Failed to select file: ${err}`));
    }
  }, [importFormat, tr]);

  const handleImport = useCallback(async () => {
    if (!filePath) return;
    if (importFormat === 'kdbx' && !kdbxPassword) {
      setError(tr('Ingresa la contraseña del archivo KeePassXC.', 'Enter the KeePassXC file password.'));
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
      setError(tr(`Error al importar: ${err}`, `Import failed: ${err}`));
    } finally {
      setLoading(false);
    }
  }, [filePath, importFormat, kdbxPassword, onComplete, tr]);

  const handleExport = useCallback(async () => {
    if (!exportPassword) {
      setError(tr('Ingresa tu contraseña maestra para exportar.', 'Enter your master password to export.'));
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
      setError(tr(`Error al exportar: ${err}`, `Export failed: ${err}`));
    } finally {
      setLoading(false);
    }
  }, [exportFormat, exportPassword, tr]);

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
            {mode === 'import' ? tr('Importar credenciales', 'Import credentials') : tr('Exportar bóveda', 'Export vault')}
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
                <label className="form-label">{tr('Origen', 'Source')}</label>
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
                      {tr(...f.label)}
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
                <span>{tr(...IMPORT_HELP[importFormat])}</span>
              </div>

              {/* KDBX password input */}
              {importFormat === 'kdbx' && !importResult && (
                <div className="form-group" style={{ marginTop: 16 }}>
                  <label className="form-label">{tr('Contraseña del archivo KeePassXC', 'KeePassXC file password')}</label>
                  <div className="lock-input-group">
                    <input
                      className="input"
                      type={showKdbxPassword ? 'text' : 'password'}
                      placeholder={tr('Contraseña maestra del archivo .kdbx', 'Master password of the .kdbx file')}
                      value={kdbxPassword}
                      onChange={(e) => { setKdbxPassword(e.target.value); setError(null); }}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="lock-toggle-password"
                      onClick={() => setShowKdbxPassword(!showKdbxPassword)}
                      tabIndex={-1}
                      aria-label={showKdbxPassword ? tr('Ocultar', 'Hide') : tr('Mostrar', 'Show')}
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
                    {tr('Esta es la contraseña del archivo KeePassXC, no la contraseña de Vault Local. Si KeePassXC no está instalado, exporta como CSV desde KeePassXC y usa el formato "KeePass (CSV)".', 'This is the KeePassXC file password, not your Vault Local password. If KeePassXC is not installed, export as CSV from KeePassXC and use the "KeePass (CSV)" format.')}
                  </div>
                </div>
              )}

              {/* File selection */}
              {!importResult && (
                <div className="form-group" style={{ marginTop: 20 }}>
                  <label className="form-label">{tr('Archivo', 'File')}</label>
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
                      {tr('Seleccionar archivo', 'Select file')}
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
                      <span>{tr(`${importResult.imported} entradas importadas`, `${importResult.imported} entries imported`)}</span>
                    </div>
                    {importResult.skipped > 0 && (
                      <div className="ie-result-item ie-result-skipped">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                        </svg>
                        <span>{tr(`${importResult.skipped} omitidas`, `${importResult.skipped} skipped`)}</span>
                      </div>
                    )}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="ie-error-list">
                      <span className="ie-error-list-title">{tr('Errores:', 'Errors:')}</span>
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
                  <span>{tr('Importando...', 'Importing...')}</span>
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
                  {tr('El archivo exportado contendrá todas tus credenciales en texto plano. Guárdalo en un lugar seguro y elimínalo cuando ya no lo necesites.', 'The exported file will contain all your credentials in plain text. Store it somewhere safe and delete it when you no longer need it.')}
                </p>
              </div>

              {/* Re-auth password */}
              {exportCount === null && (
                <div className="form-group" style={{ marginTop: 20 }}>
                  <label className="form-label">{tr('Contraseña maestra', 'Master password')}</label>
                  <div className="lock-input-group">
                    <input
                      className="input"
                      type={showExportPassword ? 'text' : 'password'}
                      placeholder={tr('Ingresa tu contraseña para confirmar', 'Enter your password to confirm')}
                      value={exportPassword}
                      onChange={(e) => { setExportPassword(e.target.value); setError(null); }}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="lock-toggle-password"
                      onClick={() => setShowExportPassword(!showExportPassword)}
                      tabIndex={-1}
                      aria-label={showExportPassword ? tr('Ocultar', 'Hide') : tr('Mostrar', 'Show')}
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
                <label className="form-label">{tr('Formato', 'Format')}</label>
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
                      {tr(...f.label)}
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
                      <span>{tr(`${exportCount} entradas exportadas correctamente`, `${exportCount} entries exported successfully`)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="ie-loading">
                  <div className="loading-spinner" />
                  <span>{tr('Exportando...', 'Exporting...')}</span>
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
              {tr('Cerrar', 'Close')}
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                {tr('Cancelar', 'Cancel')}
              </button>
              {mode === 'import' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!filePath || loading || (importFormat === 'kdbx' && !kdbxPassword)}
                >
                  {loading ? tr('Importando...', 'Importing...') : tr('Importar', 'Import')}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleExport}
                  disabled={loading || !exportPassword}
                >
                  {loading ? tr('Exportando...', 'Exporting...') : tr('Exportar', 'Export')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
