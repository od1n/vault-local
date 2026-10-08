import { useAuth } from './hooks/useAuth';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SettingsProvider } from './hooks/useSettings';
import { ClipboardProvider } from './hooks/useClipboard';
import { useTheme } from './hooks/useTheme';
import { LockScreen } from './components/LockScreen';
import { QuickUnlockPanel } from './components/QuickUnlockPanel';
import { Dashboard } from './components/Dashboard';
import { UpdateManager } from './components/UpdateManager';
import { VaultSwitcher } from './components/vaults/VaultSwitcher';
import { EmergencyOpenDialog } from './components/emergency/EmergencyOpenDialog';
import type { VaultList } from './types';
import { ToastProvider } from './components/Toast';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n, useTr } from './i18n';
import './App.css';

function AppContent() {
  const { authState, error, processing, createVault, unlock, lock, markUnlocked, recheck } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const tr = useTr();
  const [showEmergency, setShowEmergency] = useState(false);
  // Bóveda adicional recién registrada que todavía no tiene contraseña maestra
  const [pendingVault, setPendingVault] = useState<{ id: string; name: string } | null>(null);
  // Para que el selector se vuelva a montar (y recargue la lista) tras cambiar de bóveda
  const [switcherKey, setSwitcherKey] = useState(0);

  useEffect(() => {
    if (authState !== 'setup') {
      setPendingVault(null);
      return;
    }
    invoke<VaultList>('list_vaults')
      .then((l) => {
        const v = l.vaults.find((x) => x.id === l.active);
        setPendingVault(v && v.id !== 'principal' ? { id: v.id, name: v.name } : null);
      })
      .catch(() => setPendingVault(null));
  }, [authState]);

  const cancelNewVault = useCallback(async () => {
    if (!pendingVault) return;
    try {
      // Sin archivos creados no pide contraseña: solo quita el registro vacío
      await invoke('delete_vault', { id: pendingVault.id, password: '' });
    } catch {
      // si falla, al menos volver a la principal
      await invoke('select_vault', { id: 'principal' }).catch(() => {});
    }
    setSwitcherKey((k) => k + 1);
    recheck();
  }, [pendingVault, recheck]);

  const emergencyLink = (
    <div style={{ textAlign: 'center', marginTop: 16 }}>
      <button type="button" className="link-button" onClick={() => setShowEmergency(true)}>
        {tr('Acceso de emergencia (2 de 3 hojas)', 'Emergency access (2 of 3 sheets)')}
      </button>
    </div>
  );
  const emergencyDialog = showEmergency && (
    <EmergencyOpenDialog
      onClose={() => setShowEmergency(false)}
      onOpened={() => {
        setShowEmergency(false);
        markUnlocked();
      }}
    />
  );

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

  // Una sola instancia del gestor de actualizaciones en todas las pantallas (conserva la
  // descarga al bloquear/desbloquear)
  const withUpdater = (node: React.ReactNode) => (
    <>
      {node}
      <UpdateManager locked={authState !== 'unlocked'} />
    </>
  );

  if (authState === 'loading') {
    return withUpdater(
      <ToastProvider>
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">{t('app.loading')}</p>
        </div>
      </ToastProvider>
    );
  }

  if (authState === 'setup') {
    return withUpdater(
      <ToastProvider>
        <LockScreen
          key="setup"
          mode="setup"
          onSetup={createVault}
          onUnlock={() => {}}
          error={error}
          processing={processing}
          setupSubtitle={
            pendingVault
              ? tr(`Nueva bóveda «${pendingVault.name}»: crea su contraseña maestra (distinta de las demás)`, `New vault “${pendingVault.name}”: create its master password (different from the others)`)
              : undefined
          }
          onCancelSetup={pendingVault ? cancelNewVault : undefined}
          footer={pendingVault ? undefined : emergencyLink}
        />
        {emergencyDialog}
      </ToastProvider>
    );
  }

  if (authState === 'locked') {
    return withUpdater(
      <ToastProvider>
        <LockScreen
          key="unlock"
          mode="unlock"
          onUnlock={unlock}
          quickPanel={<QuickUnlockPanel key={switcherKey} onUnlocked={markUnlocked} />}
          vaultSwitcher={
            <VaultSwitcher
              key={switcherKey}
              onChanged={() => {
                setSwitcherKey((k) => k + 1);
                recheck();
              }}
            />
          }
          footer={emergencyLink}
          onSetup={() => Promise.resolve()}
          error={error}
          processing={processing}
        />
        {emergencyDialog}
      </ToastProvider>
    );
  }

  return withUpdater(
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
