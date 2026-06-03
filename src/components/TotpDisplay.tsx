import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface TotpDisplayProps {
  secret: string;
  onCopy: (code: string) => void;
}

interface TotpResponse {
  code: string;
  remaining_secs: number;
}

export function TotpDisplay({ secret, onCopy }: TotpDisplayProps) {
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevCodeRef = useRef<string | null>(null);

  const fetchCode = useCallback(async () => {
    try {
      const result = await invoke<TotpResponse>('generate_totp', { secret });
      if (prevCodeRef.current && prevCodeRef.current !== result.code) {
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
      }
      prevCodeRef.current = result.code;
      setCode(result.code);
      setRemaining(result.remaining_secs);
      setError(null);
      setLoading(false);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al generar TOTP');
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    fetchCode();

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          fetchCode();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCode]);

  const formatCode = (c: string): string => {
    if (c.length === 6) return `${c.slice(0, 3)} ${c.slice(3)}`;
    if (c.length === 8) return `${c.slice(0, 4)} ${c.slice(4)}`;
    return c;
  };

  const isWarning = remaining <= 5;
  const circumference = 2 * Math.PI * 16;
  const progress = (remaining / 30) * circumference;

  if (loading) {
    return (
      <div className="totp-display">
        <span className="totp-code" style={{ opacity: 0.4 }}>--- ---</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="totp-display">
        <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>
      </div>
    );
  }

  return (
    <div className="totp-display">
      <span
        className={`totp-code ${flash ? 'totp-flash' : ''}`}
        style={isWarning ? { color: 'var(--warning)' } : undefined}
      >
        {code ? formatCode(code) : '--- ---'}
      </span>

      <div className="totp-countdown">
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          className="totp-countdown-circle"
        >
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="var(--bg-tertiary)"
            strokeWidth="3"
          />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke={isWarning ? 'var(--warning)' : 'var(--accent)'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
          />
        </svg>
        <span className={`totp-countdown-text ${isWarning ? 'totp-warning' : ''}`}>
          {remaining}
        </span>
      </div>

      <div className="totp-actions">
        <button
          className="btn-icon"
          onClick={() => code && onCopy(code)}
          aria-label="Copiar codigo TOTP"
          title="Copiar codigo"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
