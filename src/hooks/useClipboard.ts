import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useClipboard() {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Limpiar intervalo cuando el componente se desmonte
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startCountdown = useCallback((seconds: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setCountdown(seconds);
    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          setCopiedField(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const copyToClipboard = useCallback(async (text: string, fieldName: string, clearAfterSecs = 15) => {
    try {
      await invoke('copy_to_clipboard', { text, clearAfterSecs });
      setCopiedField(fieldName);
      if (timerRef.current) clearTimeout(timerRef.current);
      startCountdown(clearAfterSecs);
    } catch {
      // Silently fail clipboard operations
    }
  }, [startCountdown]);

  const copyFieldToClipboard = useCallback(async (entryId: string, fieldIndex: number, fieldName: string, clearAfterSecs = 15) => {
    try {
      await invoke('copy_field_to_clipboard', { entryId, fieldIndex, clearAfterSecs });
      setCopiedField(fieldName);
      if (timerRef.current) clearTimeout(timerRef.current);
      startCountdown(clearAfterSecs);
    } catch {
      // Silently fail clipboard operations
    }
  }, [startCountdown]);

  return { copiedField, countdown, copyToClipboard, copyFieldToClipboard };
}
