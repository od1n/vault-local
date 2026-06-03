import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useClipboard } from '../hooks/useClipboard';

interface PasswordGeneratorProps {
  onSelect?: (password: string) => void;
  standalone?: boolean;
}

function calcPasswordStrength(length: number, options: { uppercase: boolean; lowercase: boolean; numbers: boolean; symbols: boolean }): { score: number; label: string; color: string; width: string } {
  const activeOptions = [options.uppercase, options.lowercase, options.numbers, options.symbols].filter(Boolean).length;
  let score = 0;
  if (length >= 8) score++;
  if (length >= 14) score++;
  if (length >= 20) score++;
  if (activeOptions >= 3) score++;
  if (activeOptions >= 4 && length >= 16) score++;
  score = Math.min(4, score);
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'];
  const colors = ['#ff4c4c', '#ff4c4c', '#ffb74d', '#ffb74d', '#4caf50'];
  const widths = ['10%', '25%', '50%', '75%', '100%'];
  return { score, label: labels[score], color: colors[score], width: widths[score] };
}

export function PasswordGenerator({ onSelect, standalone }: PasswordGeneratorProps) {
  const [password, setPassword] = useState('');
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const { copiedField, copyToClipboard } = useClipboard();

  const generate = useCallback(async () => {
    if (!uppercase && !lowercase && !numbers && !symbols) return;
    try {
      const result = await invoke<string>('generate_password', {
        length,
        uppercase,
        lowercase,
        numbers,
        symbols,
      });
      setPassword(result);
    } catch {
      // Fallback: simple local generation
      let chars = '';
      if (uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
      if (numbers) chars += '0123456789';
      if (symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
      if (!chars) return;
      let pw = '';
      for (let i = 0; i < length; i++) {
        pw += chars[Math.floor(Math.random() * chars.length)];
      }
      setPassword(pw);
    }
  }, [length, uppercase, lowercase, numbers, symbols]);

  useEffect(() => {
    generate();
  }, [generate]);

  const strength = calcPasswordStrength(length, { uppercase, lowercase, numbers, symbols });

  return (
    <div className={`password-generator ${standalone ? 'password-generator-standalone' : ''}`}>
      <div className="pwgen-display">
        <div className="pwgen-value">{password || '...'}</div>
        <div className="pwgen-actions">
          {copiedField === 'pwgen' ? (
            <span className="copied-badge">Copiado</span>
          ) : (
            <button className="btn-icon" onClick={() => copyToClipboard(password, 'pwgen')} aria-label="Copiar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
          )}
          <button className="btn-icon" onClick={generate} aria-label="Regenerar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23,4 23,10 17,10" />
              <polyline points="1,20 1,14 7,14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="pwgen-strength">
        <div className="pwgen-strength-bar-track">
          <div
            className="pwgen-strength-bar-fill"
            style={{ width: strength.width, background: strength.color }}
          />
        </div>
        <div className="pwgen-strength-label">
          <span style={{ color: strength.color }}>{strength.label}</span>
          <span style={{ color: 'var(--text-muted)' }}>{length} caracteres</span>
        </div>
      </div>

      <div className="pwgen-option">
        <span className="pwgen-option-label">Longitud</span>
        <div className="pwgen-length-control">
          <input
            type="range"
            className="pwgen-slider"
            min={8}
            max={128}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
          />
          <span className="pwgen-length-value">{length}</span>
        </div>
      </div>

      <div className="pwgen-option">
        <span className="pwgen-option-label">Mayúsculas (A-Z)</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>

      <div className="pwgen-option">
        <span className="pwgen-option-label">Minúsculas (a-z)</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={lowercase} onChange={(e) => setLowercase(e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>

      <div className="pwgen-option">
        <span className="pwgen-option-label">Números (0-9)</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>

      <div className="pwgen-option">
        <span className="pwgen-option-label">Símbolos (!@#$)</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={symbols} onChange={(e) => setSymbols(e.target.checked)} />
          <span className="toggle-track" />
        </label>
      </div>

      {onSelect && (
        <div className="pwgen-footer">
          <button className="btn btn-primary btn-sm" onClick={() => onSelect(password)}>
            Usar contraseña
          </button>
        </div>
      )}
    </div>
  );
}
