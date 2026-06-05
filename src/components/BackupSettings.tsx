import { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useBackup, type BackupInfo } from '../hooks/useBackup';
import { useI18n } from '../i18n';

interface BackupSettingsProps {
  onClose: () => void;
}

function formatTimestamp(ts: string): string {
  // Formato: YYYYMMDD_HHMMSS
  try {
    const year = ts.slice(0, 4);
    const month = ts.slice(4, 6);
    const day = ts.slice(6, 8);
    const hour = ts.slice(9, 11);
    const min = ts.slice(11, 13);
    const sec = ts.slice(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`).toLocaleString();
  } catch {
    return ts;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLastBackup(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BackupSettings({ onClose }: BackupSettingsProps) {
  const { t } = useI18n();
  const {
    config,
    backups,
    loading,
    error,
    getBackupConfig,
    configureBackup,
    performBackup,
    listBackups,
    restoreBackup,
  } = useBackup();

  const [enabled, setEnabled] = useState(false);
  const [backupDir, setBackupDir] = useState('');
  const [maxBackups, setMaxBackups] = useState(5);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<BackupInfo | null>(null);

  // Cargar configuración y respaldos al montar
  useEffect(() => {
    getBackupConfig().then((cfg) => {
      if (cfg) {
        setEnabled(cfg.enabled);
        setBackupDir(cfg.backup_dir);
        setMaxBackups(cfg.max_backups);
      }
    });
    listBackups();
  }, [getBackupConfig, listBackups]);

  const handleSelectDir = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected) {
        setBackupDir(selected as string);
      }
    } catch {
      // Cancelado por el usuario
    }
  }, []);

  const handleSaveConfig = useCallback(async () => {
    setSuccessMsg(null);
    await configureBackup(backupDir, enabled, maxBackups);
    setSuccessMsg(t('backup.config_saved'));
    setTimeout(() => setSuccessMsg(null), 3000);
  }, [backupDir, enabled, maxBackups, configureBackup, t]);

  const handleBackupNow = useCallback(async () => {
    setSuccessMsg(null);
    const path = await performBackup();
    if (path) {
      setSuccessMsg(t('backup.backup_success'));
      listBackups();
      setTimeout(() => setSuccessMsg(null), 3000);
    }
  }, [performBackup, listBackups, t]);

  const handleRestore = useCallback(async (backup: BackupInfo) => {
    setSuccessMsg(null);
    try {
      await restoreBackup(backup.db_path);
      setSuccessMsg(t('backup.restore_success'));
      setConfirmRestore(null);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      // Error ya manejado por el hook
    }
  }, [restoreBackup, t]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" style={{ maxWidth: 560 }}>
        {/* Encabezado */}
        <div className="modal-header">
          <h2 className="modal-title">{t('backup.title')}</h2>
          <button className="btn-icon" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Cuerpo */}
        <div className="modal-body">
          {/* Descripción */}
          <div className="ie-warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p>{t('backup.description')}</p>
          </div>

          {/* Toggle habilitado */}
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
              {t('backup.enable_auto')}
            </label>
          </div>

          {/* Directorio de respaldos */}
          <div className="form-group">
            <label className="form-label">{t('backup.directory')}</label>
            <div className="ie-file-row">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSelectDir}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                {t('backup.select_dir')}
              </button>
              {backupDir && (
                <span className="ie-file-path" title={backupDir}>
                  {backupDir}
                </span>
              )}
            </div>
          </div>

          {/* Máximo de respaldos */}
          <div className="form-group">
            <label className="form-label">{t('backup.max_backups')}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={maxBackups}
              onChange={(e) => setMaxBackups(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ maxWidth: 120 }}
            />
          </div>

          {/* Último respaldo */}
          {config?.last_backup && (
            <div className="form-group">
              <label className="form-label">{t('backup.last_backup')}</label>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                {formatLastBackup(config.last_backup)}
              </span>
            </div>
          )}

          {/* Mensajes de éxito y error */}
          {successMsg && (
            <div className="ie-results" style={{ marginTop: 12 }}>
              <div className="ie-results-summary">
                <div className="ie-result-item ie-result-success">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{successMsg}</span>
                </div>
              </div>
            </div>
          )}
          {error && <div className="ie-error" style={{ marginTop: 12 }}>{error}</div>}

          {/* Lista de respaldos */}
          {backups.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <label className="form-label">{t('backup.existing_backups')}</label>
              <div style={{
                maxHeight: 200,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}>
                {backups.map((backup) => (
                  <div
                    key={backup.timestamp}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {formatTimestamp(backup.timestamp)}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                        {formatSize(backup.db_size + backup.salt_size)}
                      </div>
                    </div>
                    {confirmRestore?.timestamp === backup.timestamp ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--danger)', color: '#fff', fontSize: 12 }}
                          onClick={() => handleRestore(backup)}
                          disabled={loading}
                        >
                          {t('backup.confirm_restore')}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setConfirmRestore(null)}
                          style={{ fontSize: 12 }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setConfirmRestore(backup)}
                        style={{ fontSize: 12 }}
                      >
                        {t('backup.restore')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="ie-loading" style={{ marginTop: 12 }}>
              <div className="loading-spinner" />
              <span>{t('common.loading')}</span>
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleBackupNow}
            disabled={loading || !backupDir}
          >
            {t('backup.backup_now')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveConfig}
            disabled={loading}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
