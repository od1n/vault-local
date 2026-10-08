import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, SettingsLimits, SettingsResponse } from '../types';

const DEFAULTS: AppSettings = {
  auto_lock_minutes: 5,
  lock_warning_secs: 30,
  clipboard_clear_secs: 15,
  lock_on_sleep: true,
  lock_on_session_lock: true,
  lock_on_minimize: false,
  tray_enabled: false,
  close_to_tray: false,
  quick_search_enabled: false,
  quick_search_shortcut: 'CommandOrControl+Shift+Space',
  copy_sequence: false,
  auto_type_sequence: '{USERNAME}{TAB}{PASSWORD}{ENTER}',
  quick_unlock_enabled: false,
  quick_unlock_hours: 8,
  quick_unlock_hello: false,
};

const FREE_LIMITS: SettingsLimits = {
  premium: false,
  max_auto_lock_minutes: 5,
  max_clipboard_secs: 15,
  max_lock_pause_minutes: 0,
};

interface SettingsContextValue {
  /** Valores efectivos (ya limitados por la licencia) */
  settings: AppSettings;
  /** Valores guardados por el usuario */
  saved: AppSettings;
  limits: SettingsLimits;
  refresh: () => Promise<void>;
  update: (s: AppSettings) => Promise<{ success: boolean; error?: string }>;
  /** Marca de tiempo (ms) hasta la que el bloqueo automático está pausado */
  pausedUntil: number | null;
  pauseLock: (minutes: number) => Promise<{ success: boolean; error?: string }>;
  resumeLock: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [saved, setSaved] = useState<AppSettings>(DEFAULTS);
  const [limits, setLimits] = useState<SettingsLimits>(FREE_LIMITS);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);

  const apply = (r: SettingsResponse) => {
    setSettings(r.effective);
    setSaved(r.saved);
    setLimits(r.limits);
    if (!r.limits.premium) setPausedUntil(null);
  };

  const refresh = useCallback(async () => {
    try {
      apply(await invoke<SettingsResponse>('get_settings'));
    } catch {
      // Mantener los valores por defecto
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = useCallback(async (s: AppSettings) => {
    try {
      apply(await invoke<SettingsResponse>('update_settings', { settings: s }));
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'No se pudieron guardar los ajustes' };
    }
  }, []);

  const pauseLock = useCallback(async (minutes: number) => {
    try {
      setPausedUntil(await invoke<number>('request_lock_pause', { minutes }));
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'No se pudo pausar el bloqueo' };
    }
  }, []);

  const resumeLock = useCallback(() => setPausedUntil(null), []);

  return (
    <SettingsContext.Provider value={{ settings, saved, limits, refresh, update, pausedUntil, pauseLock, resumeLock }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings debe usarse dentro de SettingsProvider');
  return ctx;
}
