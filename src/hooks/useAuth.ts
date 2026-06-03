import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type AuthState = 'loading' | 'setup' | 'locked' | 'unlocked';

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    async function checkVault() {
      try {
        const created = await invoke<boolean>('is_vault_created');
        setAuthState(created ? 'locked' : 'setup');
      } catch {
        setError('No se pudo verificar el estado de la bóveda.');
        setAuthState('setup');
      }
    }
    checkVault();
  }, []);

  const createVault = useCallback(async (password: string, confirmPassword: string) => {
    setError(null);
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setProcessing(true);
    try {
      await invoke('create_vault', { password });
      setAuthState('unlocked');
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al crear la bóveda.');
    } finally {
      setProcessing(false);
    }
  }, []);

  const unlock = useCallback(async (password: string) => {
    setError(null);
    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }
    setProcessing(true);
    try {
      await invoke('unlock_vault', { password });
      setAuthState('unlocked');
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Contraseña incorrecta.');
    } finally {
      setProcessing(false);
    }
  }, []);

  const lock = useCallback(async () => {
    try {
      await invoke('lock_vault');
    } catch {
      // Ignore errors on lock
    }
    setAuthState('locked');
    setError(null);
  }, []);

  return { authState, error, processing, createVault, unlock, lock };
}
