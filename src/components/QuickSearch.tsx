import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTheme } from '../hooks/useTheme';
import type { EntryCategory, EntryMeta } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useI18n, useTr } from '../i18n';
import { I18nProvider } from '../i18n/I18nProvider';
import '../App.css';

type What = 'username' | 'password' | 'totp';

/**
 * Ventana flotante de búsqueda rápida (se abre con el atajo global).
 * Enter: copiar contraseña · Ctrl+U: copiar usuario · Ctrl+T: copiar TOTP
 * Ctrl+Enter: escritura automática · Esc: cerrar
 */
export function QuickSearch() {
  // Esta ventana se monta fuera de App, así que necesita su propio proveedor de idioma.
  return (
    <I18nProvider>
      <QuickSearchInner />
    </I18nProvider>
  );
}

function QuickSearchInner() {
  useTheme();
  const tr = useTr();
  const { t, locale, setLocale } = useI18n();
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [locked, setLocked] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    // La ventana queda viva entre aperturas: tomar el idioma elegido en la ventana principal.
    try {
      const saved = localStorage.getItem('vault-local-locale');
      if ((saved === 'es' || saved === 'en') && saved !== locale) setLocale(saved);
    } catch {
      // localStorage no disponible
    }
    setQuery('');
    setSelected(0);
    setMessage(null);
    try {
      const list = await invoke<EntryMeta[]>('get_entries', { category: null, search: null });
      // Favoritas primero, luego las más usadas y las usadas más recientemente
      list.sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          b.use_count - a.use_count ||
          (b.last_used_at || '').localeCompare(a.last_used_at || '')
      );
      setEntries(list);
      setLocked(false);
    } catch {
      setEntries([]);
      setLocked(true);
    }
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [locale, setLocale]);

  useEffect(() => {
    load();
    const un = listen('quick-opened', () => load());
    // Al perder el foco, ocultar la ventana
    const unFocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) invoke('hide_quick_window');
    });
    return () => {
      un.then((f) => f());
      unFocus.then((f) => f());
    };
  }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q))
        )
      : entries;
    return list.slice(0, 9);
  }, [entries, query]);

  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1));
  }, [results, selected]);

  const close = () => invoke('hide_quick_window');

  const copy = async (what: What) => {
    const entry = results[selected];
    if (!entry) return;
    try {
      await invoke('quick_copy', { entryId: entry.id, what });
      close();
    } catch (e) {
      setMessage(typeof e === 'string' ? e : tr('No se pudo copiar', 'Could not copy'));
    }
  };

  const autoType = async () => {
    const entry = results[selected];
    if (!entry) return;
    try {
      await invoke('quick_auto_type', { entryId: entry.id, sequence: null });
    } catch (e) {
      setMessage(typeof e === 'string' ? e : tr('No se pudo escribir', 'Could not type'));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && ctrl) {
      e.preventDefault();
      autoType();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      copy('password');
    } else if (ctrl && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      copy('username');
    } else if (ctrl && e.key.toLowerCase() === 't') {
      e.preventDefault();
      copy('totp');
    }
  };

  if (locked) {
    return (
      <div className="quick-root">
        <div className="quick-locked">
          <p>{tr('La bóveda está bloqueada.', 'The vault is locked.')}</p>
          <button className="btn btn-primary" onClick={() => invoke('show_main_window')}>
            {tr('Abrir Vault Local para desbloquear', 'Open Vault Local to unlock')}
          </button>
          <p className="quick-hint">{tr('Esc para cerrar', 'Esc to close')}</p>
        </div>
        <input ref={inputRef} onKeyDown={onKeyDown} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} aria-hidden />
      </div>
    );
  }

  return (
    <div className="quick-root" onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        className="quick-input"
        placeholder={tr('Buscar en la bóveda…', 'Search the vault…')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
          setMessage(null);
        }}
        spellCheck={false}
        autoFocus
      />
      <ul className="quick-list" role="listbox">
        {results.map((e, i) => (
          <li
            key={e.id}
            role="option"
            aria-selected={i === selected}
            className={`quick-item ${i === selected ? 'selected' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onDoubleClick={() => copy('password')}
          >
            <span className="quick-item-title">{e.favorite ? '★ ' : ''}{e.title}</span>
            <span className="quick-item-cat">{t(`category.${e.category}`, CATEGORY_LABELS[e.category as EntryCategory] || e.category)}</span>
          </li>
        ))}
        {results.length === 0 && <li className="quick-empty">{tr('Sin resultados', 'No results')}</li>}
      </ul>
      {message && <div className="quick-message">{message}</div>}
      <div className="quick-hint">
        <b>Enter</b> {tr('contraseña', 'password')} · <b>Ctrl+U</b> {tr('usuario', 'username')} · <b>Ctrl+T</b> TOTP · <b>Ctrl+Enter</b> {tr('escribir automáticamente', 'auto-type')} · <b>Esc</b> {tr('cerrar', 'close')}
      </div>
    </div>
  );
}
