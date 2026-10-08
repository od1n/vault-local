import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useTr } from '../../i18n';

interface Candidate {
  id: string;
  name: string;
}

interface ShareState {
  part: number;
  text: string;
}

/**
 * Abrir una bóveda con el acceso de emergencia: 2 de las 3 partes impresas.
 * La bóveda queda en modo solo lectura.
 */
export function EmergencyOpenDialog({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const tr = useTr();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [source, setSource] = useState<string>(''); // id de bóveda o "file"
  const [dbFile, setDbFile] = useState<string>('');
  const [shares, setShares] = useState<ShareState[]>([
    { part: 1, text: '' },
    { part: 2, text: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Candidate[]>('emergency_candidates')
      .then((c) => {
        setCandidates(c);
        setSource(c[0]?.id ?? 'file');
      })
      .catch(() => setSource('file'));
  }, []);

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      title: tr('Elige el archivo de la bóveda (.db)', 'Choose the vault file (.db)'),
      filters: [{ name: 'Vault Local', extensions: ['db'] }],
    });
    if (typeof selected === 'string') setDbFile(selected);
  };

  const setShare = (i: number, patch: Partial<ShareState>) =>
    setShares((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await invoke('emergency_open', {
        source: source === 'file' ? { vault_id: null, db_file: dbFile } : { vault_id: source, db_file: null },
        shares: shares.map((s) => ({ part: s.part, text: s.text })),
      });
      onOpened();
    } catch (e) {
      setError(typeof e === 'string' ? e : tr('No se pudo abrir la bóveda', 'Could not open the vault'));
    } finally {
      setBusy(false);
    }
  };

  const ready = (source !== 'file' || dbFile) && shares.every((s) => s.text.trim().length > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h2 className="modal-title">{tr('Acceso de emergencia', 'Emergency access')}</h2>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.5 }}>
            {tr(
              'Si el dueño de la bóveda preparó el acceso de emergencia, entregó 3 hojas («Parte 1», «Parte 2», «Parte 3») a personas distintas. Con 2 cualesquiera se abre la bóveda en modo solo lectura: se puede ver y copiar todo, pero no modificar nada.',
              'If the vault owner set up emergency access, they gave 3 sheets ("Part 1", "Part 2", "Part 3") to different people. Any 2 of them open the vault in read-only mode: everything can be viewed and copied, but nothing can be changed.',
            )}
          </p>

          <label className="form-label">{tr('1. ¿Qué bóveda abrir?', '1. Which vault?')}</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {tr('En este equipo', 'On this computer')}: {c.name}
              </option>
            ))}
            <option value="file">{tr('Un respaldo (elegir archivo .db)', 'A backup (choose .db file)')}</option>
          </select>
          {source === 'file' && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={pickFile}>
                {tr('Elegir archivo…', 'Choose file…')}
              </button>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, wordBreak: 'break-all' }}>
                {dbFile ||
                  tr(
                    'Elige el archivo que termina en .db. En la misma carpeta debe estar el archivo con el mismo nombre que termina en .recovery.',
                    'Choose the file ending in .db. The file with the same name ending in .recovery must be in the same folder.',
                  )}
              </div>
            </div>
          )}

          {shares.map((s, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <label className="form-label">
                {i === 0 ? tr('2. Primera hoja', '2. First sheet') : tr('3. Segunda hoja', '3. Second sheet')}
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>{tr('Número de parte:', 'Part number:')}</span>
                <select className="input" style={{ width: 80 }} value={s.part} onChange={(e) => setShare(i, { part: Number(e.target.value) })}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </div>
              <textarea
                className="textarea"
                rows={4}
                spellCheck={false}
                autoCapitalize="off"
                placeholder={tr(
                  'Escribe las 24 palabras en orden, separadas por espacios (o pega el código que empieza con VLR1)',
                  'Type the 24 words in order, separated by spaces (or paste the code starting with VLR1)',
                )}
                value={s.text}
                onChange={(e) => setShare(i, { text: e.target.value })}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
          ))}

          {error && <div className="lock-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {tr('Cancelar', 'Cancel')}
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!ready || busy}>
            {busy ? tr('Abriendo…', 'Opening…') : tr('Abrir en solo lectura', 'Open read-only')}
          </button>
        </div>
      </div>
    </div>
  );
}
