import { useI18n } from '../i18n';

interface AuditSummary {
  total_entries: number;
  weak_passwords: number;
  duplicate_passwords: number;
  old_passwords: number;
  score: number;
}

interface SecurityAlertProps {
  summary: AuditSummary;
  onReview: () => void;
  onDismiss: () => void;
}

export function SecurityAlert({ summary, onReview, onDismiss }: SecurityAlertProps) {
  const { t } = useI18n();

  const issues: string[] = [];
  if (summary.weak_passwords > 0) {
    issues.push(t('security_alert.weak').replace('{0}', String(summary.weak_passwords)));
  }
  if (summary.duplicate_passwords > 0) {
    issues.push(t('security_alert.duplicates').replace('{0}', String(summary.duplicate_passwords)));
  }
  if (summary.old_passwords > 0) {
    issues.push(t('security_alert.outdated').replace('{0}', String(summary.old_passwords)));
  }

  if (issues.length === 0) return null;

  const scoreColor = summary.score >= 80 ? 'var(--success, #4caf50)' :
                     summary.score >= 50 ? 'var(--warning)' :
                     'var(--danger)';

  return (
    <div className="security-alert">
      <div className="security-alert-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="security-alert-content">
        <span className="security-alert-issues">{issues.join(' · ')}</span>
        <span className="security-alert-score" style={{ color: scoreColor }}>
          {t('security_alert.score').replace('{0}', String(summary.score))}
        </span>
      </div>
      <div className="security-alert-actions">
        <button className="btn btn-sm btn-primary" onClick={onReview}>
          {t('security_alert.review')}
        </button>
        <button className="security-alert-dismiss" onClick={onDismiss} title={t('security_alert.dismiss')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
