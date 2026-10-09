import { BrandMark } from './BrandMark';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useVault } from '../hooks/useVault';
import { useLicense, tierLabel } from '../hooks/useLicense';
import { useI18n, useTr } from '../i18n';
import { CategoryFilter } from './CategoryFilter';
import { SearchBar } from './SearchBar';
import { EntryList } from './EntryList';
import { EntryDetail } from './EntryDetail';
import { EntryForm } from './EntryForm';
import { ImportExportDialog } from './ImportExportDialog';
import { SyncDialog } from './SyncDialog';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { AuditPanel } from './AuditPanel';
import { SshAgentPanel } from './SshAgentPanel';
import { LicenseDialog } from './LicenseDialog';
import { SettingsDialog } from './SettingsDialog';
import { ClipboardBar } from './ClipboardBar';
import { LockWarning } from './LockWarning';
import { useSettings } from '../hooks/useSettings';
import { useAutoLock } from '../hooks/useAutoLock';
import { useClipboard } from '../hooks/useClipboard';
import { useToast } from './Toast';
import { EntryExtras, daysUntil } from './extras/EntryExtras';
import { TrashPanel } from './extras/TrashPanel';
import { ShareDialog } from './extras/ShareDialog';
import { BackupSettings } from './BackupSettings';
import { Onboarding } from './Onboarding';
import { SecurityAlert } from './SecurityAlert';
import { GettingStarted, gettingStartedHidden, showGettingStarted } from './GettingStarted';
import type { EntryCategory, EntryMeta, NewEntry, SessionInfo, UpdateEntry } from '../types';

interface AuditSummary {
  total_entries: number;
  weak_passwords: number;
  duplicate_passwords: number;
  old_passwords: number;
  score: number;
}

interface DashboardProps {
  onLock: () => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

/** Filtro de la barra lateral: favoritas, recientes, por vencer, papelera o una etiqueta ("tag:nombre") */
type SidebarFilter = 'favorites' | 'recents' | 'expiring' | 'trash' | `tag:${string}` | null;

const ALL_CATEGORIES: EntryCategory[] = ['web', 'bank', 'card', 'wallet', 'wifi', 'identity', 'passkey', 'note', 'other'];

export function Dashboard({ onLock, theme, toggleTheme }: DashboardProps) {
  const {
    entries,
    selectedEntry,
    loading,
    loadEntries,
    getEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    toggleFavorite,
    clearSelected,
  } = useVault();

  const { license, isPremium, isPro, activate: activateLicense, deactivate: deactivateLicense } = useLicense();
  const { settings, pausedUntil, resumeLock, refresh: refreshSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showShareImport, setShowShareImport] = useState(false);
  const { quickCopy } = useClipboard();
  const { showToast } = useToast();
  // Avisar si el atajo global no se pudo registrar
  useEffect(() => {
    const un = listen<string>('shortcut-error', (e) => showToast(e.payload, 'error'));
    const un2 = listen<string>('auto-type-aborted', (e) => showToast(e.payload, 'error'));
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
  }, [showToast]);
  const activate = useCallback(async (key: string) => {
    const r = await activateLicense(key);
    await refreshSettings();
    return r;
  }, [activateLicense, refreshSettings]);
  const deactivate = useCallback(async () => {
    const r = await deactivateLicense();
    await refreshSettings();
    return r;
  }, [deactivateLicense, refreshSettings]);
  // Si la licencia cambia (vence o se activa), recalcular los ajustes efectivos
  useEffect(() => {
    refreshSettings();
  }, [license.tier, refreshSettings]);
  const { warningLeft, touch } = useAutoLock({
    enabled: true,
    minutes: settings.auto_lock_minutes,
    warningSecs: settings.lock_warning_secs,
    pausedUntil,
    onLock,
  });
  const { t, locale, setLocale } = useI18n();
  const tr = useTr();
  // Bóveda abierta (nombre) y si es un acceso de emergencia (solo lectura)
  const [session, setSession] = useState<SessionInfo | null>(null);
  useEffect(() => {
    invoke<SessionInfo>('get_session_info').then(setSession).catch(() => setSession(null));
  }, []);
  const readOnly = session?.read_only ?? false;
  const [gsHidden, setGsHidden] = useState(gettingStartedHidden);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(false);
  const [importExportMode, setImportExportMode] = useState<'import' | 'export' | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showSshAgent, setShowSshAgent] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditDismissed, setAuditDismissed] = useState(false);
  const [allEntries, setAllEntries] = useState<EntryMeta[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<{ category: EntryCategory; count: number }[]>(
    ALL_CATEGORIES.map((cat) => ({ category: cat, count: 0 }))
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Ejecutar auditoría rápida al desbloquear (no bloquea la UI)
  useEffect(() => {
    invoke<AuditSummary>('quick_audit_summary')
      .then((summary) => {
        if (summary.weak_passwords > 0 || summary.duplicate_passwords > 0 || summary.old_passwords > 0) {
          setAuditSummary(summary);
        }
      })
      .catch(() => {
        // Silently fail — the alert is non-critical
      });
  }, []);

  // Cargar conteos de todas las categorias (sin filtros)
  const refreshCounts = useCallback(async () => {
    try {
      const all = await invoke<EntryMeta[]>('get_entries', {});
      setAllEntries(all);
      const counts: Record<string, number> = {};
      for (const cat of ALL_CATEGORIES) counts[cat] = 0;
      for (const e of all) {
        if (e.category in counts) counts[e.category]++;
      }
      setCategoryCounts(ALL_CATEGORIES.map((cat) => ({ category: cat, count: counts[cat] || 0 })));
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (sidebarFilter === null) {
      loadEntries(selectedCategory || undefined, searchTerm || undefined);
    }
    refreshCounts();
  }, [selectedCategory, searchTerm, loadEntries, refreshCounts, sidebarFilter]);

  // Mostrar onboarding si no hay entradas y no se ha completado antes
  useEffect(() => {
    if (readOnly) return;
    if (allEntries.length === 0 && allEntries !== undefined) {
      try {
        if (localStorage.getItem('vault-local-onboarding-done') !== 'true') {
          setShowOnboarding(true);
        }
      } catch {
        // localStorage no disponible
      }
    }
  }, [allEntries, readOnly]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    try {
      localStorage.setItem('vault-local-onboarding-done', 'true');
    } catch {
      // localStorage no disponible
    }
  }, []);

  // Conteo de favoritos
  const favoritesCount = useMemo(() => allEntries.filter(e => e.favorite).length, [allEntries]);
  const expiringCount = useMemo(
    () => allEntries.filter((e) => { const d = daysUntil(e.expires_at); return d !== null && d <= 14; }).length,
    [allEntries]
  );
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allEntries) for (const t of e.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [allEntries]);

  // Recargar todo después de un cambio en extras (etiquetas, vencimiento, duplicar, papelera)
  const refreshAll = useCallback(async (selectId?: string) => {
    await refreshCounts();
    if (sidebarFilter === null) await loadEntries(selectedCategory || undefined, searchTerm || undefined);
    if (selectId) await getEntry(selectId);
  }, [refreshCounts, loadEntries, getEntry, sidebarFilter, selectedCategory, searchTerm]);

  // Entradas filtradas por sidebar filter
  const displayedEntries = useMemo(() => {
    if (sidebarFilter === 'favorites') {
      return allEntries.filter(e => e.favorite);
    }
    if (sidebarFilter === 'recents') {
      // Por último uso (copiar, escribir automáticamente); si nunca se usó, por última edición
      const when = (e: EntryMeta) => new Date(e.last_used_at || e.updated_at).getTime();
      return [...allEntries].sort((a, b) => when(b) - when(a)).slice(0, 15);
    }
    if (sidebarFilter === 'expiring') {
      return allEntries
        .filter((e) => { const d = daysUntil(e.expires_at); return d !== null && d <= 14; })
        .sort((a, b) => (a.expires_at || '').localeCompare(b.expires_at || ''));
    }
    if (sidebarFilter?.startsWith('tag:')) {
      const tag = sidebarFilter.slice(4);
      return allEntries.filter((e) => e.tags.includes(tag));
    }
    return entries;
  }, [sidebarFilter, allEntries, entries]);

  const handleCategorySelect = useCallback((category: string | null) => {
    setSidebarFilter(null);
    setSelectedCategory(category);
    clearSelected();
  }, [clearSelected]);

  const handleSidebarFilter = useCallback((filter: SidebarFilter) => {
    setSidebarFilter(prev => prev === filter ? null : filter);
    setSelectedCategory(null);
    clearSelected();
  }, [clearSelected]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    if (value) {
      setSidebarFilter(null);
    }
  }, []);

  const handleEntrySelect = useCallback(
    (id: string) => {
      getEntry(id);
    },
    [getEntry]
  );

  const handleNewEntry = useCallback(() => {
    clearSelected();
    setEditingEntry(false);
    setShowForm(true);
  }, [clearSelected]);

  const handleEditEntry = useCallback(() => {
    setEditingEntry(true);
    setShowForm(true);
  }, []);

  const handleFormSave = useCallback(
    async (data: NewEntry | { id: string; entry: UpdateEntry }) => {
      if ('id' in data) {
        await updateEntry(data.id, data.entry);
      } else {
        const newId = await createEntry(data);
        if (newId) {
          getEntry(newId);
        }
      }
      setShowForm(false);
      setEditingEntry(false);
      refreshCounts();
    },
    [createEntry, updateEntry, getEntry, refreshCounts]
  );

  const handleFormCancel = useCallback(() => {
    setShowForm(false);
    setEditingEntry(false);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteEntry(id);
      refreshCounts();
    },
    [deleteEntry, refreshCounts]
  );

  // Atajos de teclado globales
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (mod && e.key === 'n') {
        e.preventDefault();
        if (!readOnly) handleNewEntry();
      }
      if (mod && e.key === 'l') {
        e.preventDefault();
        onLock();
      }
      // Copiar desde la entrada seleccionada: Ctrl+C contraseña, Ctrl+B usuario, Ctrl+T TOTP
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (mod && !e.shiftKey && selectedEntry && !typing) {
        const k = e.key.toLowerCase();
        const hasSelection = !!window.getSelection()?.toString();
        const map: Record<string, ['username' | 'password' | 'totp', string]> = {
          c: ['password', tr('Contraseña', 'Password')],
          b: ['username', tr('Usuario', 'Username')],
          t: ['totp', tr('Código TOTP', 'TOTP code')],
        };
        if (map[k] && !(k === 'c' && hasSelection)) {
          e.preventDefault();
          const [what, label] = map[k];
          quickCopy(selectedEntry.id, what, label).then((r) => {
            if (!r.success && r.error) showToast(r.error, 'error');
          });
        }
      }
      if (e.key === 'Escape') {
        if (showForm) {
          setShowForm(false);
          setEditingEntry(false);
        } else if (importExportMode) {
          setImportExportMode(null);
        } else if (showSync) {
          setShowSync(false);
        } else if (showChangePassword) {
          setShowChangePassword(false);
        } else if (showLicense) {
          setShowLicense(false);
        } else if (showSettings) {
          setShowSettings(false);
        } else if (showBackup) {
          setShowBackup(false);
        } else if (showAudit) {
          setShowAudit(false);
        } else if (showSshAgent) {
          setShowSshAgent(false);
        } else if (selectedEntry) {
          clearSelected();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [readOnly, handleNewEntry, onLock, showForm, importExportMode, showSync, showChangePassword, showLicense, showSettings, showBackup, showAudit, showSshAgent, selectedEntry, clearSelected, quickCopy, showToast, locale]);

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <BrandMark className="sidebar-header-icon" size={28} />
          <span className="sidebar-header-title" title={session?.name}>
            Vault Local
            {session && (session.vault_count > 1 || session.read_only) && (
              <span className="sidebar-vault-name">{session.name}</span>
            )}
          </span>
          <button
            className="lang-toggle"
            onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
          >
            {locale === 'es' ? 'EN' : 'ES'}
          </button>
          <button className="btn-icon theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? t('dashboard.theme_light') : t('dashboard.theme_dark')}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            )}
          </button>
          {isPremium ? (
            <span className="premium-badge" onClick={() => setShowLicense(true)} style={{ cursor: 'pointer' }} title={license.days_left !== null ? tr(`Vence en ${license.days_left} día(s)`, `Expires in ${license.days_left} day(s)`) : undefined}>
              {tierLabel(license, locale)}{license.days_left !== null && license.days_left <= 14 ? ` · ${license.days_left}d` : ''}
            </span>
          ) : (
            <span className="upgrade-link" onClick={() => setShowLicense(true)}>{t('dashboard.upgrade')}</span>
          )}
        </div>

        <nav className="sidebar-nav">
          {/* Filtros rapidos */}
          <div className="sidebar-section-label">{t('dashboard.filters')}</div>
          <button
            className={`category-item ${sidebarFilter === 'favorites' ? 'active' : ''}`}
            onClick={() => handleSidebarFilter('favorites')}
          >
            <svg viewBox="0 0 24 24" fill={sidebarFilter === 'favorites' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
            <span className="category-item-label">{t('dashboard.favorites')}</span>
            <span className="category-item-count">{favoritesCount}</span>
          </button>
          <button
            className={`category-item ${sidebarFilter === 'recents' ? 'active' : ''}`}
            onClick={() => handleSidebarFilter('recents')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12,6 12,12 16,14" />
            </svg>
            <span className="category-item-label">{t('dashboard.recents')}</span>
          </button>
          <button
            className={`category-item ${sidebarFilter === 'expiring' ? 'active' : ''}`}
            onClick={() => handleSidebarFilter('expiring')}
            title={tr('Entradas cuya fecha para cambiar la contraseña vence en 14 días o menos', 'Entries whose password change date is due in 14 days or less')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="category-item-label">{tr('Por vencer', 'Expiring')}</span>
            <span className="category-item-count" style={expiringCount > 0 ? { color: 'var(--warning)' } : undefined}>{expiringCount}</span>
          </button>
          <button
            className={`category-item ${sidebarFilter === 'trash' ? 'active' : ''}`}
            onClick={() => handleSidebarFilter('trash')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
            <span className="category-item-label">{tr('Papelera', 'Trash')}</span>
          </button>

          {tagCounts.length > 0 && (
            <>
              <div className="sidebar-filter-divider" />
              <div className="sidebar-section-label">{tr('Etiquetas', 'Tags')}</div>
              {tagCounts.map(([tag, count]) => (
                <button
                  key={tag}
                  className={`category-item ${sidebarFilter === `tag:${tag}` ? 'active' : ''}`}
                  onClick={() => handleSidebarFilter(`tag:${tag}`)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="category-item-label">{tag}</span>
                  <span className="category-item-count">{count}</span>
                </button>
              ))}
            </>
          )}

          <div className="sidebar-filter-divider" />

          {/* Categorias */}
          <CategoryFilter
            categories={categoryCounts}
            selected={sidebarFilter === null ? selectedCategory : null}
            onSelect={handleCategorySelect}
          />
        </nav>

        <div className="sidebar-footer">
          {!readOnly && <div className="sidebar-ie-actions">
            <button className="sidebar-ie-btn" onClick={() => setImportExportMode('import')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t('dashboard.import')}
            </button>
            <button className="sidebar-ie-btn" onClick={() => setImportExportMode('export')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('dashboard.export')}
            </button>
            <button className="sidebar-ie-btn" onClick={() => setShowShareImport(true)} title={tr('Recibir una entrada compartida (.vlshare)', 'Receive a shared entry (.vlshare)')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {tr('Recibir', 'Receive')}
            </button>
          </div>}
          {!readOnly && <button className="sidebar-lock-btn" onClick={() => (isPro ? setShowSync(true) : setShowLicense(true))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" />
            </svg>
            {t('dashboard.sync')}
          </button>}
          <button
            className="sidebar-lock-btn"
            onClick={() => { setShowSshAgent(!showSshAgent); setShowAudit(false); }}
            style={showSshAgent ? { color: 'var(--accent)' } : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M7 15h0M2 8h20" />
            </svg>
            {t('dashboard.ssh_agent')}
          </button>
          <button className="sidebar-lock-btn" onClick={() => setShowBackup(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t('dashboard.backup')}
          </button>
          <button className="sidebar-lock-btn" onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            {tr('Ajustes', 'Settings')}
          </button>
          {!readOnly && <button className="sidebar-lock-btn" onClick={() => setShowChangePassword(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
            {t('dashboard.change_password')}
          </button>}
          <button className="sidebar-lock-btn" onClick={onLock}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            {t('dashboard.lock')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="main-header">
          <SearchBar value={searchTerm} onChange={handleSearch} inputRef={searchInputRef} />
          <button
            className={`btn btn-secondary btn-sm ${showAudit ? 'active' : ''}`}
            onClick={() => { setShowAudit(!showAudit); setShowSshAgent(false); }}
            style={showAudit ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {t('dashboard.audit')}
          </button>
          {!readOnly && <button className="btn btn-primary btn-sm" onClick={handleNewEntry}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('dashboard.new_entry')}
          </button>}
        </div>
        {readOnly && (
          <div className="readonly-banner">
            <strong>{tr('Acceso de emergencia · solo lectura', 'Emergency access · read-only')}</strong>{' '}
            {tr(
              `Estás viendo «${session?.name}». Puedes ver y copiar los datos, pero no modificarlos. Si necesitas seguir usándolos, cópialos a una bóveda propia.`,
              `You are viewing “${session?.name}”. You can view and copy data but not change it. To keep using it, copy it into your own vault.`,
            )}
          </div>
        )}

        {auditSummary && !auditDismissed && !showAudit && (
          <div style={{ padding: '12px 16px 0' }}>
          <SecurityAlert
            summary={auditSummary}
            onReview={() => {
              setShowAudit(true);
              setShowSshAgent(false);
              setAuditDismissed(true);
            }}
            onDismiss={() => setAuditDismissed(true)}
          />
          </div>
        )}
        <div className="main-body">
          {showAudit ? (
            <AuditPanel
              onClose={() => setShowAudit(false)}
              onViewEntry={(entryId) => {
                setShowAudit(false);
                getEntry(entryId);
              }}
              isPremium={isPremium}
              onUpgrade={() => setShowLicense(true)}
            />
          ) : showSshAgent ? (
            <SshAgentPanel
              onClose={() => setShowSshAgent(false)}
              onViewEntry={(entryId) => {
                setShowSshAgent(false);
                getEntry(entryId);
              }}
            />
          ) : sidebarFilter === 'trash' ? (
            <TrashPanel onChanged={() => refreshAll()} notify={showToast} />
          ) : (
            <>
              {/* Entry List */}
              <div className="entry-list-panel">
                <div className="entry-list-scroll">
                  <EntryList
                    entries={displayedEntries}
                    selectedId={selectedEntry?.id || null}
                    onSelect={handleEntrySelect}
                    onToggleFavorite={readOnly ? () => {} : toggleFavorite}
                    loading={loading && sidebarFilter === null}
                    onNewEntry={readOnly ? () => {} : handleNewEntry}
                    onImport={readOnly ? () => {} : () => setImportExportMode('import')}
                    searchActive={!!searchTerm}
                  />
                </div>
              </div>

              {/* Detail Panel */}
              {selectedEntry ? (
                <EntryDetail
                  entry={selectedEntry}
                  onEdit={handleEditEntry}
                  onDelete={handleDelete}
                  onClose={clearSelected}
                  onToggleFavorite={toggleFavorite}
                  readOnly={readOnly}
                  extras={readOnly ? undefined : (
                    <EntryExtras
                      entry={selectedEntry}
                      isPremium={isPremium}
                      onUpgrade={() => setShowLicense(true)}
                      onChanged={() => refreshAll(selectedEntry.id)}
                      onDuplicated={(id) => refreshAll(id)}
                      notify={showToast}
                    />
                  )}
                />
              ) : (
                !readOnly && !gsHidden ? (
                  <div className="no-selection" style={{ overflowY: 'auto', justifyContent: 'flex-start' }}>
                    <GettingStarted
                      entryCount={allEntries.length}
                      quickSearchEnabled={settings.quick_search_enabled}
                      isPremium={isPremium}
                      onNewEntry={handleNewEntry}
                      onImport={() => setImportExportMode('import')}
                      onBackup={() => setShowBackup(true)}
                      onSettings={() => setShowSettings(true)}
                      onUpgrade={() => setShowLicense(true)}
                      onHide={() => {
                        try {
                          localStorage.setItem('vault-local-getting-started-hidden', 'true');
                        } catch {
                          // sin almacenamiento
                        }
                        setGsHidden(true);
                      }}
                    />
                  </div>
                ) : (
                <div className="no-selection">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                    <rect x="9.5" y="10" width="5" height="4.5" rx="0.5" />
                    <path d="M10.5 10V8.5a1.5 1.5 0 013 0V10" />
                  </svg>
                  <p>{t('dashboard.select_hint')}</p>
                  {!readOnly && (
                    <button
                      className="link-button"
                      onClick={() => {
                        showGettingStarted();
                        setGsHidden(false);
                      }}
                    >
                      {tr('Ver primeros pasos', 'Show getting started')}
                    </button>
                  )}
                </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* Entry Form Modal */}
      {showForm && (
        <EntryForm
          entry={editingEntry && selectedEntry ? selectedEntry : undefined}
          onSave={handleFormSave}
          onCancel={handleFormCancel}
          isPremium={isPremium}
          onUpgrade={() => setShowLicense(true)}
        />
      )}

      {/* Import/Export Modal */}
      {importExportMode && (
        <ImportExportDialog
          mode={importExportMode}
          onClose={() => setImportExportMode(null)}
          onComplete={() => {
            loadEntries(selectedCategory || undefined, searchTerm || undefined);
            refreshCounts();
            setImportExportMode(null);
          }}
        />
      )}

      {/* Sync Modal */}
      {showSync && (
        <SyncDialog
          onClose={() => setShowSync(false)}
          onComplete={() => {
            loadEntries(selectedCategory || undefined, searchTerm || undefined);
            refreshCounts();
          }}
        />
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <ChangePasswordDialog
          onClose={() => setShowChangePassword(false)}
        />
      )}

      {/* License Dialog */}
      {showLicense && (
        <LicenseDialog
          license={license}
          onActivate={activate}
          onDeactivate={deactivate}
          onClose={() => setShowLicense(false)}
        />
      )}

      {/* Backup Settings */}
      {showBackup && (
        <BackupSettings
          onClose={() => setShowBackup(false)}
        />
      )}

      {showShareImport && (
        <ShareDialog
          mode="import"
          onClose={() => setShowShareImport(false)}
          onImported={(id) => refreshAll(id)}
          notify={showToast}
        />
      )}

      {/* Ajustes */}
      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onUpgrade={() => { setShowSettings(false); setShowLicense(true); }}
        />
      )}

      {/* Aviso de bloqueo, pausa activa y barra del portapapeles */}
      {warningLeft !== null && (
        <LockWarning secondsLeft={warningLeft} onStillHere={touch} onLockNow={onLock} onUpgrade={() => setShowLicense(true)} />
      )}
      {pausedUntil !== null && pausedUntil > Date.now() && (
        <div className="lock-paused-pill" onClick={resumeLock} title={tr('Haz clic para reanudar el bloqueo automático', 'Click to resume auto-lock')}>
          {tr('Bloqueo pausado hasta', 'Lock paused until')} {new Date(pausedUntil).toLocaleTimeString(locale === 'en' ? 'en-US' : 'es', { hour: '2-digit', minute: '2-digit' })} · {tr('Reanudar', 'Resume')}
        </div>
      )}
      <ClipboardBar onUpgrade={() => setShowLicense(true)} />

      {/* Onboarding */}
      {showOnboarding && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}
    </div>
  );
}
