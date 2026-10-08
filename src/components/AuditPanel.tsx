import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AuditResult, HibpResult } from '../types';
import { useTr } from '../i18n';

interface AuditPanelProps {
  onClose: () => void;
  onViewEntry: (entryId: string) => void;
  isPremium: boolean;
  onUpgrade: () => void;
}

type AuditTab = 'weak' | 'duplicated' | 'old' | 'hibp';

function getScoreClass(score: number): string {
  if (score >= 90) return 'audit-score-excellent';
  if (score >= 70) return 'audit-score-good';
  if (score >= 40) return 'audit-score-warning';
  return 'audit-score-critical';
}

function getScoreLabel(score: number, tr: (es: string, en: string) => string): string {
  if (score >= 90) return tr('Excelente', 'Excellent');
  if (score >= 70) return tr('Bueno', 'Good');
  if (score >= 40) return tr('Necesita atención', 'Needs attention');
  return tr('Critico', 'Critical');
}

export function AuditPanel({ onClose, onViewEntry, isPremium, onUpgrade }: AuditPanelProps) {
  const tr = useTr();
  // Referencia estable a tr para usarla en runAudit sin re-ejecutar la auditoría al cambiar de idioma
  const trRef = useRef(tr);
  trRef.current = tr;
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AuditTab>('weak');

  // HIBP state
  const [hibpResults, setHibpResults] = useState<HibpResult[] | null>(null);
  const [hibpLoading, setHibpLoading] = useState(false);
  const [hibpProgress, setHibpProgress] = useState<string | null>(null);
  const [hibpError, setHibpError] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AuditResult>('run_password_audit');
      setAudit(result);
    } catch (e) {
      setError(typeof e === 'string' ? e : trRef.current('Error al ejecutar la auditoria', 'Failed to run the audit'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAudit();
  }, [runAudit]);

  const checkHibp = useCallback(async () => {
    if (!isPremium) {
      onUpgrade();
      return;
    }
    setHibpLoading(true);
    setHibpError(null);
    setHibpProgress(tr('Verificando...', 'Checking...'));
    try {
      const results = await invoke<HibpResult[]>('check_hibp');
      setHibpResults(results);
      setHibpProgress(null);
    } catch (e) {
      setHibpError(typeof e === 'string' ? e : tr('Error al verificar filtraciones', 'Failed to check for breaches'));
      setHibpProgress(null);
    } finally {
      setHibpLoading(false);
    }
  }, [isPremium, onUpgrade, tr]);

  const renderPremiumGate = (featureName: string) => (
    <div className="premium-gate">
      <div className="premium-gate-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <div className="premium-gate-text">
        {tr(`${featureName} requiere Vault Local Premium`, `${featureName} requires Vault Local Premium`)}
      </div>
      <button className="btn btn-primary btn-sm" onClick={onUpgrade}>
        {tr('Actualizar a Premium', 'Upgrade to Premium')}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="audit-panel">
        <div className="audit-header">
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{tr('Auditoria de contraseñas', 'Password audit')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {tr('Cerrar', 'Close')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60, color: 'var(--text-secondary)' }}>
          <div className="loading-spinner" />
          <span>{tr('Analizando contraseñas...', 'Analyzing passwords...')}</span>
        </div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div className="audit-panel">
        <div className="audit-header">
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>{tr('Auditoria de contraseñas', 'Password audit')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {tr('Cerrar', 'Close')}
          </button>
        </div>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
          <p>{error || tr('Error desconocido', 'Unknown error')}</p>
          <button className="btn btn-primary btn-sm" onClick={runAudit} style={{ marginTop: 16 }}>
            {tr('Reintentar', 'Retry')}
          </button>
        </div>
      </div>
    );
  }

  const weakCount = audit.weak.length;
  const dupCount = audit.duplicated.reduce((acc, d) => acc + d.entries.length, 0);
  const oldCount = audit.old.length;

  return (
    <div className="audit-panel">
      {/* Header */}
      <div className="audit-header">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>{tr('Auditoria de contraseñas', 'Password audit')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={runAudit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" />
            </svg>
            {tr('Ejecutar auditoria', 'Run audit')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {tr('Cerrar', 'Close')}
          </button>
        </div>
      </div>

      {/* Score Card */}
      <div className="audit-score-card">
        <div className={`audit-score-circle ${getScoreClass(audit.score)}`}>
          {audit.score}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{getScoreLabel(audit.score, tr)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {tr('Puntuación de seguridad de tus contraseñas', 'Security score of your passwords')}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="audit-summary">
        <div className="audit-stat">
          <div className="audit-stat-value" style={{ color: 'var(--text-primary)' }}>
            {audit.total_passwords}
          </div>
          <div className="audit-stat-label">{tr('Total contraseñas', 'Total passwords')}</div>
        </div>
        <div className="audit-stat">
          <div className="audit-stat-value" style={{ color: weakCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {weakCount}
          </div>
          <div className="audit-stat-label">{tr('Debiles', 'Weak')}</div>
        </div>
        <div className="audit-stat">
          <div className="audit-stat-value" style={{ color: dupCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {dupCount}
          </div>
          <div className="audit-stat-label">{tr('Duplicadas', 'Duplicates')}</div>
        </div>
        <div className="audit-stat">
          <div className="audit-stat-value" style={{ color: oldCount > 0 ? '#e6c350' : 'var(--success)' }}>
            {oldCount}
          </div>
          <div className="audit-stat-label">{tr('Antiguas', 'Old')}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="audit-tabs">
        <button
          className={`audit-tab ${activeTab === 'weak' ? 'active' : ''}`}
          onClick={() => setActiveTab('weak')}
        >
          {tr('Debiles', 'Weak')}
          {weakCount > 0 && <span className="tab-count">{weakCount}</span>}
        </button>
        <button
          className={`audit-tab ${activeTab === 'duplicated' ? 'active' : ''}`}
          onClick={() => setActiveTab('duplicated')}
        >
          {tr('Duplicadas', 'Duplicates')}
          {audit.duplicated.length > 0 && <span className="tab-count">{audit.duplicated.length}</span>}
        </button>
        <button
          className={`audit-tab ${activeTab === 'old' ? 'active' : ''}`}
          onClick={() => setActiveTab('old')}
        >
          {tr('Antiguas', 'Old')}
          {oldCount > 0 && <span className="tab-count">{oldCount}</span>}
        </button>
        <button
          className={`audit-tab ${activeTab === 'hibp' ? 'active' : ''}`}
          onClick={() => setActiveTab('hibp')}
        >
          {tr('Filtraciones', 'Breaches')}
          {hibpResults && hibpResults.length > 0 && (
            <span className="tab-count" style={{ background: 'rgba(255, 76, 76, 0.15)', color: 'var(--danger)' }}>
              {hibpResults.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4 }}>
        {/* Weak passwords tab */}
        {activeTab === 'weak' && (
          !isPremium && weakCount > 0 ? (
            <div>
              <div style={{ padding: '12px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                {tr(`Se encontraron ${weakCount} contraseñas debiles.`, `${weakCount} weak passwords found.`)}
              </div>
              {renderPremiumGate(tr('El detalle de contraseñas debiles', 'Weak password details'))}
            </div>
          ) : weakCount === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <p>{tr('No se encontraron contraseñas debiles', 'No weak passwords found')}</p>
            </div>
          ) : (
            audit.weak.map((issue, i) => (
              <div className="audit-issue-row" key={i}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="audit-issue-info">
                  <div className="audit-issue-title">{issue.entry_title}</div>
                  <div className="audit-issue-reason">{issue.field_name} — {issue.reason}</div>
                </div>
                <div className="audit-issue-action">
                  <button className="btn btn-secondary btn-sm" onClick={() => onViewEntry(issue.entry_id)}>
                    {tr('Ver entrada', 'View entry')}
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {/* Duplicated passwords tab */}
        {activeTab === 'duplicated' && (
          !isPremium && audit.duplicated.length > 0 ? (
            <div>
              <div style={{ padding: '12px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                {tr(`Se encontraron ${audit.duplicated.length} grupos de contraseñas duplicadas.`, `${audit.duplicated.length} groups of duplicate passwords found.`)}
              </div>
              {renderPremiumGate(tr('El detalle de contraseñas duplicadas', 'Duplicate password details'))}
            </div>
          ) : audit.duplicated.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <p>{tr('No se encontraron contraseñas duplicadas', 'No duplicate passwords found')}</p>
            </div>
          ) : (
            audit.duplicated.map((group, gi) => (
              <div key={gi} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12,
                  color: 'var(--warning)',
                  fontWeight: 600,
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  {tr(`Grupo ${gi + 1} — ${group.entries.length} entradas comparten la misma contraseña`, `Group ${gi + 1} — ${group.entries.length} entries share the same password`)}
                </div>
                {group.entries.map((entry, ei) => (
                  <div className="audit-issue-row" key={ei}>
                    <div className="audit-issue-info">
                      <div className="audit-issue-title">{entry.entry_title}</div>
                      <div className="audit-issue-reason">{entry.field_name}</div>
                    </div>
                    <div className="audit-issue-action">
                      <button className="btn btn-secondary btn-sm" onClick={() => onViewEntry(entry.entry_id)}>
                        {tr('Ver entrada', 'View entry')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )
        )}

        {/* Old passwords tab */}
        {activeTab === 'old' && (
          !isPremium && oldCount > 0 ? (
            <div>
              <div style={{ padding: '12px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                {tr(`Se encontraron ${oldCount} contraseñas antiguas.`, `${oldCount} old passwords found.`)}
              </div>
              {renderPremiumGate(tr('El detalle de contraseñas antiguas', 'Old password details'))}
            </div>
          ) : oldCount === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <p>{tr('Todas las contraseñas estan actualizadas', 'All passwords are up to date')}</p>
            </div>
          ) : (
            audit.old.map((issue, i) => (
              <div className="audit-issue-row" key={i}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e6c350" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12,6 12,12 16,14" />
                </svg>
                <div className="audit-issue-info">
                  <div className="audit-issue-title">{issue.entry_title}</div>
                  <div className="audit-issue-reason">{issue.field_name} — {issue.reason}</div>
                </div>
                <div className="audit-issue-action">
                  <button className="btn btn-secondary btn-sm" onClick={() => onViewEntry(issue.entry_id)}>
                    {tr('Ver entrada', 'View entry')}
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {/* HIBP tab */}
        {activeTab === 'hibp' && (
          !isPremium ? (
            renderPremiumGate(tr('La verificación de filtraciones', 'Breach checking'))
          ) : (
            <div>
              {!hibpResults && !hibpLoading && (
                <div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: 14,
                    background: 'rgba(255, 183, 77, 0.08)',
                    border: '1px solid rgba(255, 183, 77, 0.2)',
                    borderRadius: 'var(--radius)',
                    marginBottom: 16,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>
                      {tr('Esto enviara los primeros 5 caracteres del hash SHA-1 de cada contraseña al servicio Have I Been Pwned. Las contraseñas nunca se envian.', 'This will send the first 5 characters of the SHA-1 hash of each password to the Have I Been Pwned service. Passwords are never sent.')}
                    </span>
                  </div>
                  <button className="btn btn-primary" onClick={checkHibp} style={{ width: '100%' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {tr('Verificar filtraciones', 'Check for breaches')}
                  </button>
                </div>
              )}

              {hibpLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, color: 'var(--text-secondary)' }}>
                  <div className="loading-spinner" />
                  <span>{hibpProgress || tr('Verificando...', 'Checking...')}</span>
                </div>
              )}

              {hibpError && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(255, 76, 76, 0.08)',
                  border: '1px solid rgba(255, 76, 76, 0.15)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--danger)',
                  fontSize: 13,
                  marginBottom: 12,
                }}>
                  {hibpError}
                </div>
              )}

              {hibpResults && !hibpLoading && (
                <div>
                  {hibpResults.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
                        <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                        <polyline points="9,12 12,15 16,10" />
                      </svg>
                      <p style={{ color: 'var(--success)' }}>{tr('Ninguna contraseña encontrada en filtraciones conocidas', 'No passwords found in known breaches')}</p>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>
                        {tr(
                          `${hibpResults.length} contraseña${hibpResults.length > 1 ? 's' : ''} encontrada${hibpResults.length > 1 ? 's' : ''} en filtraciones`,
                          `${hibpResults.length} password${hibpResults.length > 1 ? 's' : ''} found in breaches`
                        )}
                      </div>
                      {hibpResults.map((result, i) => (
                        <div className="audit-issue-row" key={i}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          <div className="audit-issue-info">
                            <div className="audit-issue-title">{result.entry_title}</div>
                            <div className="audit-issue-reason">
                              {result.field_name} — {tr(
                                `Encontrada en ${result.breach_count.toLocaleString()} filtración${result.breach_count > 1 ? 'es' : ''}`,
                                `Found in ${result.breach_count.toLocaleString()} breach${result.breach_count > 1 ? 'es' : ''}`
                              )}
                            </div>
                          </div>
                          <div className="audit-issue-action">
                            <button className="btn btn-secondary btn-sm" onClick={() => onViewEntry(result.entry_id)}>
                              {tr('Ver entrada', 'View entry')}
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={checkHibp}
                        style={{ marginTop: 12, width: '100%' }}
                      >
                        {tr('Verificar de nuevo', 'Check again')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
