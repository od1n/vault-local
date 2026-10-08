import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Entry } from '../../types';
import { ShareDialog } from './ShareDialog';
import { HistoryDialog } from './HistoryDialog';
import { WifiQrDialog, wifiPayload } from './WifiQrDialog';

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
      notify(typeof e === 'string' ? e : 'No se pudieron guardar las etiquetas', 'error');
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
      notify(typeof e === 'string' ? e : 'No se pudo guardar la fecha', 'error');
    }
  };

  const quickExpiry = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    setExpiry(d.toISOString().slice(0, 10));
  };

  const duplicate = async () => {
    try {
      const id = await invoke<string>('duplicate_entry', { id: entry.id });
      notify('Entrada duplicada', 'success');
      onDuplicated(id);
    } catch (e) {
      notify(typeof e === 'string' ? e : 'No se pudo duplicar', 'error');
    }
  };

  const premiumAction = (d: 'share' | 'history' | 'qr') => () => (isPremium ? setDialog(d) : onUpgrade());
  const left = daysUntil(entry.expires_at);
  const isWifi = !!wifiPayload(entry);

  return (
    <div className="entry-extras">
      <div className="entry-extras-row">
        <span className="entry-extras-label">Etiquetas</span>
        <div className="tag-list">
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              <button aria-label={`Quitar etiqueta ${t}`} onClick={() => saveTags(tags.filter((x) => x !== t))}>×</button>
            </span>
          ))}
          <input
            className="tag-input"
            placeholder="Agregar etiqueta y pulsar Enter"
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
          Cambiar contraseña el{!isPremium && <span className="premium-star">★</span>}
        </span>
        <div className="entry-extras-expiry">
          <input
            type="date"
            className="input"
            value={toDateInput(entry.expires_at)}
            onChange={(e) => setExpiry(e.target.value || null)}
            style={{ width: 160 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => quickExpiry(90)}>+90 días</button>
          <button className="btn btn-ghost btn-sm" onClick={() => quickExpiry(180)}>+180 días</button>
          {entry.expires_at && (
            <button className="btn btn-ghost btn-sm" onClick={() => setExpiry(null)}>Quitar</button>
          )}
          {left !== null && (
            <span className={`expiry-badge ${left <= 0 ? 'overdue' : left <= 14 ? 'soon' : ''}`}>
              {left <= 0 ? `Vencida hace ${-left} día(s)` : `Faltan ${left} día(s)`}
            </span>
          )}
        </div>
      </div>

      <div className="entry-extras-actions">
        <button className="btn btn-secondary btn-sm" onClick={duplicate}>Duplicar</button>
        <button className="btn btn-secondary btn-sm" onClick={premiumAction('share')}>
          Compartir cifrada{!isPremium && ' ★'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={premiumAction('history')}>
          Historial ({entry.history_count}){!isPremium && ' ★'}
        </button>
        {isWifi && (
          <button className="btn btn-secondary btn-sm" onClick={premiumAction('qr')}>
            Código QR del Wi-Fi{!isPremium && ' ★'}
          </button>
        )}
      </div>

      {dialog === 'share' && <ShareDialog mode="export" entry={entry} onClose={() => setDialog(null)} notify={notify} />}
      {dialog === 'history' && <HistoryDialog entry={entry} onClose={() => setDialog(null)} />}
      {dialog === 'qr' && <WifiQrDialog entry={entry} onClose={() => setDialog(null)} />}
    </div>
  );
}
