import type { EntryCategory } from '../types';
import { CATEGORY_LABELS } from '../types';

interface CategoryCount {
  category: EntryCategory | 'all';
  count: number;
}

interface CategoryFilterProps {
  categories: CategoryCount[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

const categoryIcons: Record<string, JSX.Element> = {
  all: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
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

export function CategoryFilter({ categories, selected, onSelect }: CategoryFilterProps) {
  const totalCount = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <div>
      <div className="sidebar-section-label">Categorías</div>
      <button
        className={`category-item ${selected === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        {categoryIcons.all}
        <span className="category-item-label">Todas</span>
        <span className="category-item-count">{totalCount}</span>
      </button>
      {categories.map(({ category, count }) => (
        <button
          key={category}
          className={`category-item ${selected === category ? 'active' : ''}`}
          onClick={() => onSelect(category)}
        >
          {categoryIcons[category] || categoryIcons.other}
          <span className="category-item-label">
            {category === 'all' ? 'Todas' : CATEGORY_LABELS[category as EntryCategory] || category}
          </span>
          <span className="category-item-count">{count}</span>
        </button>
      ))}
    </div>
  );
}
