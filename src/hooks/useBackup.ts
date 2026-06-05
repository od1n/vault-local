import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface BackupConfig {
  enabled: boolean;
  backup_dir: string;
  max_backups: number;
  last_backup: string | null;
}

export interface BackupInfo {
  timestamp: string;
  db_path: string;
  salt_path: string;
  db_size: number;
  salt_size: number;
}

export function useBackup() {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getBackupConfig = useCallback(async () => {
    try {
      const result = await invoke<BackupConfig>('get_backup_config');
      setConfig(result);
      return result;
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al obtener configuración de respaldos.');
      return null;
    }
  }, []);

  const configureBackup = useCallback(async (dir: string, enabled: boolean, maxBackups: number) => {
    setError(null);
    setLoading(true);
    try {
      await invoke('configure_backup', {
        backupDir: dir,
        enabled,
        maxBackups,
      });
      await getBackupConfig();
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al configurar respaldos.');
    } finally {
      setLoading(false);
    }
  }, [getBackupConfig]);

  const performBackup = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const path = await invoke<string>('perform_backup');
      await getBackupConfig();
      return path;
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al realizar respaldo.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [getBackupConfig]);

  const listBackups = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke<BackupInfo[]>('list_backups');
      setBackups(result);
      return result;
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al listar respaldos.');
      return [];
    }
  }, []);

  const restoreBackup = useCallback(async (path: string) => {
    setError(null);
    setLoading(true);
    try {
      await invoke('restore_backup', { backupPath: path });
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al restaurar respaldo.');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    config,
    backups,
    loading,
    error,
    getBackupConfig,
    configureBackup,
    performBackup,
    listBackups,
    restoreBackup,
  };
}
