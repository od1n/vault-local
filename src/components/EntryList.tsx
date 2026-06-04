import type { EntryMeta, EntryCategory } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useI18n } from '../i18n';

interface EntryListProps {
  entries: EntryMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  loading: boolean;
  onNewEntry?: () => void;
  onImport?: () => void;
  searchActive?: boolean;
}

const categoryIcons: Record<string, JSX.Element> = {
  web: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M3 10h18" />
      <path d="M12 3l9 7H3l9-7z" />
      <path d="M5 10v8" />
      <path d="M9.5 10v8" />
      <path d="M14.5 10v8" />
      <path d="M19 10v8" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M16 14h2" />
      <path d="M22 6V5a2 2 0 00-2-2H6a2 2 0 00-2 2v1" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  ),
  passkey: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 10-4-4Z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  ),
};

function formatRelativeDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays < 7) return `Hace ${diffDays}d`;
    return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function EntryList({ entries, selectedId, onSelect, onToggleFavorite, loading, onNewEntry, onImport, searchActive }: EntryListProps) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="empty-state">
        <div className="loading-spinner" />
        <p className="empty-state-text">{t('entry.loading')}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    if (searchActive) {
      return (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="empty-state-title">{t('entry.no_results.title')}</span>
          <span className="empty-state-text">{t('entry.no_results.subtitle')}</span>
        </div>
      );
    }
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
          <line x1="12" y1="10" x2="12" y2="16" />
          <line x1="9" y1="13" x2="15" y2="13" />
        </svg>
        <h3>{t('entry.empty.title')}</h3>
        <p>{t('entry.empty.subtitle')}</p>
        <div className="empty-state-actions">
          {onNewEntry && (
            <button className="btn btn-primary btn-sm" onClick={onNewEntry}>
              {t('entry.empty.create')}
            </button>
          )}
          {onImport && (
            <button className="btn btn-secondary btn-sm" onClick={onImport}>
              {t('entry.empty.import')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <button
          key={entry.id}
          className={`entry-card ${selectedId === entry.id ? 'selected' : ''}`}
          onClick={() => onSelect(entry.id)}
        >
          <div className="entry-card-icon">
            {categoryIcons[entry.category] || categoryIcons.other}
          </div>
          <div className="entry-card-info">
            <div className="entry-card-title">{entry.title}</div>
            <div className="entry-card-meta">
              <span className="entry-card-category">
                {CATEGORY_LABELS[entry.category as EntryCategory] || entry.category}
              </span>
              <span className="entry-card-date">{formatRelativeDate(entry.updated_at)}</span>
            </div>
          </div>
          <button
            className={`entry-card-fav ${entry.favorite ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(entry.id);
            }}
            aria-label={entry.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          >
            {entry.favorite ? (
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            )}
          </button>
        </button>
      ))}
    </>
  );
}
