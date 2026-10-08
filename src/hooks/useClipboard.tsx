import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ClipboardStatus } from '../types';

interface ClipboardContextValue {
  /** Identificador del campo copiado (para mostrar "Copiado" junto al botón) */
  copiedField: string | null;
  /** Etiqueta legible de lo copiado (para la barra inferior) */
  copiedLabel: string | null;
  /** Segundos restantes antes del borrado automático */
  countdown: number;
  copyToClipboard: (text: string, fieldId: string, label?: string) => Promise<boolean>;
  copyFieldToClipboard: (entryId: string, fieldIndex: number, fieldId: string, label?: string) => Promise<boolean>;
  /** Copia usuario/contraseña/TOTP de una entrada (el backend elige el campo) */
  quickCopy: (entryId: string, what: 'username' | 'password' | 'totp', label: string) => Promise<{ success: boolean; error?: string }>;
  extend: (secs: number) => Promise<{ success: boolean; error?: string }>;
  clearNow: () => Promise<void>;
}

const ClipboardContext = createContext<ClipboardContextValue | null>(null);

export function ClipboardProvider({ children }: { children: ReactNode }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const deadline = useRef<number>(0);

  const reset = useCallback(() => {
    deadline.current = 0;
    setCountdown(0);
    setCopiedField(null);
    setCopiedLabel(null);
  }, []);

  const applyStatus = useCallback((s: ClipboardStatus) => {
    if (s.active) {
      deadline.current = Date.now() + s.seconds_left * 1000;
      setCountdown(s.seconds_left);
    } else {
      reset();
    }
  }, [reset]);

  // Cuenta regresiva visual (la verdad la tiene el backend)
  useEffect(() => {
    const id = setInterval(() => {
      if (!deadline.current) return;
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setCountdown(left);
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const un = listen('clipboard-cleared', () => reset());
    return () => {
      un.then((f) => f());
    };
  }, [reset]);

  const copyToClipboard = useCallback(async (text: string, fieldId: string, label?: string) => {
    try {
      applyStatus(await invoke<ClipboardStatus>('copy_to_clipboard', { text }));
      setCopiedField(fieldId);
      setCopiedLabel(label ?? null);
      return true;
    } catch {
      return false;
    }
  }, [applyStatus]);

  const copyFieldToClipboard = useCallback(async (entryId: string, fieldIndex: number, fieldId: string, label?: string) => {
    try {
      applyStatus(await invoke<ClipboardStatus>('copy_field_to_clipboard', { entryId, fieldIndex }));
      setCopiedField(fieldId);
      setCopiedLabel(label ?? null);
      return true;
    } catch {
      return false;
    }
  }, [applyStatus]);

  const quickCopy = useCallback(async (entryId: string, what: 'username' | 'password' | 'totp', label: string) => {
    try {
      applyStatus(await invoke<ClipboardStatus>('quick_copy', { entryId, what }));
      setCopiedField(`quick-${what}`);
      setCopiedLabel(label);
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'No se pudo copiar' };
    }
  }, [applyStatus]);

  const extend = useCallback(async (secs: number) => {
    try {
      applyStatus(await invoke<ClipboardStatus>('extend_clipboard', { secs }));
      return { success: true };
    } catch (e) {
      return { success: false, error: typeof e === 'string' ? e : 'No se pudo extender' };
    }
  }, [applyStatus]);

  const clearNow = useCallback(async () => {
    try {
      await invoke('clear_clipboard_now');
    } finally {
      reset();
    }
  }, [reset]);

  return (
    <ClipboardContext.Provider value={{ copiedField, copiedLabel, countdown, copyToClipboard, copyFieldToClipboard, quickCopy, extend, clearNow }}>
      {children}
    </ClipboardContext.Provider>
  );
}

export function useClipboard(): ClipboardContextValue {
  const ctx = useContext(ClipboardContext);
  if (!ctx) throw new Error('useClipboard debe usarse dentro de ClipboardProvider');
  return ctx;
}
