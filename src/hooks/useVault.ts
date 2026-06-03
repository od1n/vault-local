import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta, Entry, NewEntry, UpdateEntry } from '../types';

export function useVault() {
  const [entries, setEntries] = useState<EntryMeta[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async (category?: string, search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<EntryMeta[]>('get_entries', {
        category: category || undefined,
        search: search || undefined,
      });
      setEntries(result);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al cargar las entradas.');
    } finally {
      setLoading(false);
    }
  }, []);

  const getEntry = useCallback(async (id: string) => {
    try {
      const entry = await invoke<Entry>('get_entry', { id });
      setSelectedEntry(entry);
      return entry;
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al cargar la entrada.');
      return null;
    }
  }, []);

  const createEntry = useCallback(async (entry: NewEntry) => {
    setError(null);
    try {
      const id = await invoke<string>('create_entry', { entry });
      await loadEntries();
      return id;
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al crear la entrada.');
      return null;
    }
  }, [loadEntries]);

  const updateEntry = useCallback(async (id: string, entry: UpdateEntry) => {
    setError(null);
    try {
      await invoke('update_entry', { id, entry });
      await loadEntries();
      if (selectedEntry?.id === id) {
        await getEntry(id);
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al actualizar la entrada.');
    }
  }, [loadEntries, getEntry, selectedEntry]);

  const deleteEntry = useCallback(async (id: string) => {
    setError(null);
    try {
      await invoke('delete_entry', { id });
      if (selectedEntry?.id === id) {
        setSelectedEntry(null);
      }
      await loadEntries();
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al eliminar la entrada.');
    }
  }, [loadEntries, selectedEntry]);

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const newState = await invoke<boolean>('toggle_favorite', { id });
      setEntries(prev =>
        prev.map(e => (e.id === id ? { ...e, favorite: newState } : e))
      );
      if (selectedEntry?.id === id) {
        setSelectedEntry(prev => (prev ? { ...prev, favorite: newState } : prev));
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Error al cambiar favorito.');
    }
  }, [selectedEntry]);

  const clearSelected = useCallback(() => {
    setSelectedEntry(null);
  }, []);

  return {
    entries,
    selectedEntry,
    loading,
    error,
    loadEntries,
    getEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    toggleFavorite,
    clearSelected,
  };
}
