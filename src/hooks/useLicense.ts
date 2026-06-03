import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LicenseInfo } from '../types';

export function useLicense() {
  const [isPremium, setIsPremium] = useState(false);
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const [activatedAt, setActivatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkLicense = useCallback(async () => {
    try {
      setLoading(true);
      const info = await invoke<LicenseInfo>('check_license');
      setIsPremium(info.is_premium);
      setLicenseKey(info.license_key || null);
      setActivatedAt(info.activated_at || null);
    } catch {
      setIsPremium(false);
      setLicenseKey(null);
      setActivatedAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkLicense();
  }, [checkLicense]);

  const activate = useCallback(async (key: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await invoke('activate_license', { key });
      await checkLicense();
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'Error al activar la licencia' };
    }
  }, [checkLicense]);

  const deactivate = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await invoke('deactivate_license');
      await checkLicense();
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'Error al desactivar la licencia' };
    }
  }, [checkLicense]);

  return { isPremium, licenseKey, activatedAt, loading, activate, deactivate, refresh: checkLicense };
}
