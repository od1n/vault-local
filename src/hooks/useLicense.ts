import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LicenseInfo } from '../types';

const EMPTY: LicenseInfo = {
  is_premium: false,
  is_pro: false,
  tier: 'free',
  status: 'none',
  trial: false,
  email: null,
  license_key: null,
  activated_at: null,
  expires_at: null,
  days_left: null,
};

export function useLicense() {
  const [license, setLicense] = useState<LicenseInfo>(EMPTY);
  const [loading, setLoading] = useState(true);

  const checkLicense = useCallback(async () => {
    try {
      setLoading(true);
      setLicense(await invoke<LicenseInfo>('check_license'));
    } catch {
      setLicense(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkLicense();
    // Revisar el vencimiento cada hora mientras la app está abierta
    const id = setInterval(checkLicense, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [checkLicense]);

  const activate = useCallback(async (key: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await invoke('activate_license', { licenseKey: key });
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

  return {
    license,
    isPremium: license.is_premium,
    isPro: license.is_pro,
    loading,
    activate,
    deactivate,
    refresh: checkLicense,
  };
}

export function tierLabel(license: LicenseInfo): string {
  if (license.tier === 'owner') return 'Owner';
  if (license.tier === 'pro') return 'Pro';
  if (license.tier === 'premium') return license.trial ? 'Premium (prueba)' : 'Premium';
  return 'Gratis';
}
