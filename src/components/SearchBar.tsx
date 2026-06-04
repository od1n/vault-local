import { useState, useEffect, useRef, useCallback } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function SearchBar({ value, onChange, inputRef }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onChange(newValue);
        timerRef.current = null;
      }, 300);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    onChange('');
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="search-container">
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Buscar en la boveda..."
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
      />
      {localValue ? (
        <button className="search-clear" onClick={handleClear} aria-label="Limpiar busqueda">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : (
        <span className="search-shortcut-hint">Ctrl+K</span>
      )}
    </div>
  );
}
