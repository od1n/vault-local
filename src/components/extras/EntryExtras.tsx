import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Entry } from '../../types';
import { ShareDialog } from './ShareDialog';
import { HistoryDialog } from './HistoryDialog';
import { WifiQrDialog, wifiPayload } from './WifiQrDialog';
import { useTr } from '../../i18n';

interface Props {
  entry: Entry;
  isPremium: boolean;
  onUpgrade: () => void;
  /** Recargar la entrada y la lista después de un cambio */
  onChanged: () => void;
  onDuplicated: (newId: string) => void;
  notify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** Etiquetas, vencimiento y acciones extra de una entrada. */
export function EntryExtras({ entry, isPremium, onUpgrade, onChanged, onDuplicated, notify }: Props) {
  const tr = useTr();
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(entry.tags);
  const [dialog, setDialog] = useState<'share' | 'history' | 'qr' | null>(null);

  useEffect(() => {
    setTags(entry.tags);
    setTagInput('');
  }, [entry.id, entry.tags]);

  const saveTags = async (next: string[]) => {
    try {
      setTags(await invoke<string[]>('set_entry_tags', { id: entry.id, tags: next }));
      onChanged();
    } catch (e) {
      notify(typeof e === 'string' ? e : tr('No se pudieron guardar las etiquetas', 'Could not save the tags'), 'error');
    }
  };

  const addTag = () => {
    const parts = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    if (parts.length) saveTags([...tags, ...parts]);
    setTagInput('');
  };

  const setExpiry = async (value: string | null) => {
    if (value && !isPremium) {
      onUpgrade();
      return;
    }
    try {
      const iso = value ? new Date(`${value}T12:00:00`).toISOString() : null;
      await invoke('set_entry_expiry', { id: entry.id, expiresAt: iso });
      onChanged();
    } catch (e) {
      notify(typeof e === 'string' ? e : tr('No se pudo guardar la fecha', 'Could not save the date'), 'error');
    }
  };

  const quickExpiry = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    setExpiry(d.toISOString().slice(0, 10));
  };

  const duplicate = async () => {
    try {
      const id = await invoke<string>('duplicate_entry', { id: entry.id });
      notify(tr('Entrada duplicada', 'Entry duplicated'), 'success');
      onDuplicated(id);
    } catch (e) {
      notify(typeof e === 'string' ? e : tr('No se pudo duplicar', 'Could not duplicate'), 'error');
    }
  };

  const premiumAction = (d: 'share' | 'history' | 'qr') => () => (isPremium ? setDialog(d) : onUpgrade());
  const left = daysUntil(entry.expires_at);
  const isWifi = !!wifiPayload(entry);

  return (
    <div className="entry-extras">
      <div className="entry-extras-row">
        <span className="entry-extras-label">{tr('Etiquetas', 'Tags')}</span>
        <div className="tag-list">
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              <button aria-label={tr(`Quitar etiqueta ${t}`, `Remove tag ${t}`)} onClick={() => saveTags(tags.filter((x) => x !== t))}>×</button>
            </span>
          ))}
          <input
            className="tag-input"
            placeholder={tr('Agregar etiqueta y pulsar Enter', 'Add a tag and press Enter')}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={() => tagInput.trim() && addTag()}
          />
        </div>
      </div>

      <div className="entry-extras-row">
        <span className="entry-extras-label">
          {tr('Cambiar contraseña el', 'Change password on')}{!isPremium && <span className="premium-star">★</span>}
        </span>
        <div className="entry-extras-expiry">
          <input
            type="date"
            className="input"
            value={toDateInput(entry.expires_at)}
            onChange={(e) => setExpiry(e.target.value || null)}
            style={{ width: 160 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => quickExpiry(90)}>{tr('+90 días', '+90 days')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => quickExpiry(180)}>{tr('+180 días', '+180 days')}</button>
          {entry.expires_at && (
            <button className="btn btn-ghost btn-sm" onClick={() => setExpiry(null)}>{tr('Quitar', 'Remove')}</button>
          )}
          {left !== null && (
            <span className={`expiry-badge ${left <= 0 ? 'overdue' : left <= 14 ? 'soon' : ''}`}>
              {left <= 0 ? tr(`Vencida hace ${-left} día(s)`, `Overdue by ${-left} day(s)`) : tr(`Faltan ${left} día(s)`, `${left} day(s) left`)}
            </span>
          )}
        </div>
      </div>

      <div className="entry-extras-actions">
        <button className="btn btn-secondary btn-sm" onClick={duplicate}>{tr('Duplicar', 'Duplicate')}</button>
        <button className="btn btn-secondary btn-sm" onClick={premiumAction('share')}>
          {tr('Compartir cifrada', 'Share encrypted')}{!isPremium && ' ★'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={premiumAction('history')}>
          {tr('Historial', 'History')} ({entry.history_count}){!isPremium && ' ★'}
        </button>
        {isWifi && (
          <button className="btn btn-secondary btn-sm" onClick={premiumAction('qr')}>
            {tr('Código QR del Wi-Fi', 'Wi-Fi QR code')}{!isPremium && ' ★'}
          </button>
        )}
      </div>

      {dialog === 'share' && <ShareDialog mode="export" entry={entry} onClose={() => setDialog(null)} notify={notify} />}
      {dialog === 'history' && <HistoryDialog entry={entry} onClose={() => setDialog(null)} />}
      {dialog === 'qr' && <WifiQrDialog entry={entry} onClose={() => setDialog(null)} />}
    </div>
  );
}
