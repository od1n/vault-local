import { useAuth } from './hooks/useAuth';
import { useInactivity } from './hooks/useInactivity';
import { useTheme } from './hooks/useTheme';
import { LockScreen } from './components/LockScreen';
import { Dashboard } from './components/Dashboard';
import { ToastProvider } from './components/Toast';
import './App.css';

function App() {
  const { authState, error, processing, createVault, unlock, lock } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useInactivity(() => {
    if (authState === 'unlocked') {
      lock();
    }
  }, 300000);

  if (authState === 'loading') {
    return (
      <ToastProvider>
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Iniciando Vault Local...</p>
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

export default App;
