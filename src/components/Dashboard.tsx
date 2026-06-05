import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVault } from '../hooks/useVault';
import { useLicense } from '../hooks/useLicense';
import { useI18n } from '../i18n';
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
import { BackupSettings } from './BackupSettings';
import { Onboarding } from './Onboarding';
import { SecurityAlert } from './SecurityAlert';
import type { EntryCategory, EntryMeta, NewEntry, UpdateEntry } from '../types';

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

type SidebarFilter = 'favorites' | 'recents' | null;

const ALL_CATEGORIES: EntryCategory[] = ['web', 'bank', 'wallet', 'passkey', 'note', 'other'];

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

  const { isPremium, licenseKey, activatedAt, activate, deactivate } = useLicense();
  const { t, locale, setLocale } = useI18n();

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
    if (allEntries.length === 0 && allEntries !== undefined) {
      try {
        if (localStorage.getItem('vault-local-onboarding-done') !== 'true') {
          setShowOnboarding(true);
        }
      } catch {
        // localStorage no disponible
      }
    }
  }, [allEntries]);

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

  // Entradas filtradas por sidebar filter
  const displayedEntries = useMemo(() => {
    if (sidebarFilter === 'favorites') {
      return allEntries.filter(e => e.favorite);
    }
    if (sidebarFilter === 'recents') {
      return [...allEntries]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 10);
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
        handleNewEntry();
      }
      if (mod && e.key === 'l') {
        e.preventDefault();
        onLock();
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
  }, [handleNewEntry, onLock, showForm, importExportMode, showSync, showChangePassword, showLicense, showBackup, showAudit, showSshAgent, selectedEntry, clearSelected]);

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <svg className="sidebar-header-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
              fill="currentColor"
              opacity="0.15"
            />
            <path
              d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <span className="sidebar-header-title">Vault Local</span>
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
            <span className="premium-badge" onClick={() => setShowLicense(true)} style={{ cursor: 'pointer' }}>Premium</span>
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

          <div className="sidebar-filter-divider" />

          {/* Categorias */}
          <CategoryFilter
            categories={categoryCounts}
            selected={sidebarFilter === null ? selectedCategory : null}
            onSelect={handleCategorySelect}
          />
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-ie-actions">
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
          </div>
          <button className="sidebar-lock-btn" onClick={() => setShowSync(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" />
            </svg>
            {t('dashboard.sync')}
          </button>
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
          <button className="sidebar-lock-btn" onClick={() => setShowChangePassword(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
              <circle cx="12" cy="16" r="1" />
            </svg>
            {t('dashboard.change_password')}
          </button>
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
          <button className="btn btn-primary btn-sm" onClick={handleNewEntry}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('dashboard.new_entry')}
          </button>
        </div>

        <div className="main-body">
          {auditSummary && !auditDismissed && !showAudit && (
            <SecurityAlert
              summary={auditSummary}
              onReview={() => {
                setShowAudit(true);
                setShowSshAgent(false);
                setAuditDismissed(true);
              }}
              onDismiss={() => setAuditDismissed(true)}
            />
          )}
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
          ) : (
            <>
              {/* Entry List */}
              <div className="entry-list-panel">
                <div className="entry-list-scroll">
                  <EntryList
                    entries={displayedEntries}
                    selectedId={selectedEntry?.id || null}
                    onSelect={handleEntrySelect}
                    onToggleFavorite={toggleFavorite}
                    loading={loading && sidebarFilter === null}
                    onNewEntry={handleNewEntry}
                    onImport={() => setImportExportMode('import')}
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
                />
              ) : (
                <div className="no-selection">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                    <rect x="9.5" y="10" width="5" height="4.5" rx="0.5" />
                    <path d="M10.5 10V8.5a1.5 1.5 0 013 0V10" />
                  </svg>
                  <p>{t('dashboard.select_hint')}</p>
                </div>
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
          isPremium={isPremium}
          licenseKey={licenseKey}
          activatedAt={activatedAt}
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

      {/* Onboarding */}
      {showOnboarding && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}
    </div>
  );
}
