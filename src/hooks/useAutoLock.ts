import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  enabled: boolean;
  minutes: number;
  warningSecs: number;
  /** Mientras Date.now() < pausedUntil no se bloquea */
  pausedUntil: number | null;
  onLock: () => void;
}

/**
 * Bloqueo automático por inactividad con aviso previo.
 * Devuelve los segundos que faltan cuando el aviso está visible (o null) y una
 * función para registrar actividad ("Sigo aquí").
 */
export function useAutoLock({ enabled, minutes, warningSecs, pausedUntil, onLock }: Options) {
  const lastActivity = useRef(Date.now());
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  const [warningLeft, setWarningLeft] = useState<number | null>(null);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    setWarningLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    lastActivity.current = Date.now();
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    const handler = () => {
      lastActivity.current = Date.now();
    };
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    const tick = setInterval(() => {
      const now = Date.now();
      if (pausedUntil && now < pausedUntil) {
        lastActivity.current = now;
        setWarningLeft(null);
        return;
      }
      const lockAt = lastActivity.current + minutes * 60_000;
      const left = Math.ceil((lockAt - now) / 1000);
      if (left <= 0) {
        setWarningLeft(null);
        onLockRef.current();
      } else if (left <= warningSecs) {
        setWarningLeft(left);
      } else {
        setWarningLeft(null);
      }
    }, 1000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearInterval(tick);
      setWarningLeft(null);
    };
  }, [enabled, minutes, warningSecs, pausedUntil]);

  return { warningLeft, touch };
}
