import { useAuth } from './hooks/useAuth';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SettingsProvider } from './hooks/useSettings';
import { ClipboardProvider } from './hooks/useClipboard';
import { useTheme } from './hooks/useTheme';
import { LockScreen } from './components/LockScreen';
import { Dashboard } from './components/Dashboard';
import { ToastProvider } from './components/Toast';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n } from './i18n';
import './App.css';

function AppContent() {
  const { authState, error, processing, createVault, unlock, lock } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  // El sistema pide bloquear (suspensión, bloqueo de sesión, minimizar, bandeja)
  useEffect(() => {
    if (authState !== 'unlocked') return;
    const un = listen('request-lock', () => {
      lock();
    });
    return () => {
      un.then((f) => f());
    };
  }, [authState, lock]);

  if (authState === 'loading') {
    return (
      <ToastProvider>
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">{t('app.loading')}</p>
        </div>
      </ToastProvider>
    );
  }

  if (authState === 'setup') {
    return (
      <ToastProvider>
        <LockScreen
          mode="setup"
          onSetup={createVault}
          onUnlock={() => {}}
          error={error}
          processing={processing}
        />
      </ToastProvider>
    );
  }

  if (authState === 'locked') {
    return (
      <ToastProvider>
        <LockScreen
          mode="unlock"
          onUnlock={unlock}
          onSetup={() => Promise.resolve()}
          error={error}
          processing={processing}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Dashboard onLock={lock} theme={theme} toggleTheme={toggleTheme} />
    </ToastProvider>
  );
}

function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <ClipboardProvider>
          <AppContent />
        </ClipboardProvider>
      </SettingsProvider>
    </I18nProvider>
  );
}

export default App;
