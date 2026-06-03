import { useState, useEffect, useCallback } from 'react';

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const totalSteps = 3;

  const handleNext = useCallback(() => {
    if (step < totalSteps - 1) {
      setStep(prev => prev + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('onboarding-overlay')) {
      onComplete();
    }
  }, [onComplete]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onComplete();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onComplete]);

  return (
    <div className="onboarding-overlay" onClick={handleOverlayClick}>
      <div className="onboarding-card">
        {/* Indicador de progreso */}
        <div className="onboarding-dots">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        {/* Paso 1: Bienvenida */}
        {step === 0 && (
          <div className="onboarding-step-content" key="step-0">
            <svg className="onboarding-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
                fill="currentColor"
                opacity="0.15"
              />
              <path
                d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                fill="none"
              />
              <rect x="9.5" y="10" width="5" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M10.5 10V8.5a1.5 1.5 0 013 0V10" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
            <h2 className="onboarding-title">Bienvenido a Vault Local</h2>
            <p className="onboarding-text">
              Tu boveda personal de seguridad. Todo se cifra localmente en tu computadora — sin nubes, sin cuentas, sin rastreo.
            </p>
            <button className="btn btn-primary" onClick={handleNext}>Siguiente</button>
          </div>
        )}

        {/* Paso 2: Primeros pasos */}
        {step === 1 && (
          <div className="onboarding-step-content" key="step-1">
            <h2 className="onboarding-title">Comienza en segundos</h2>
            <div className="onboarding-tips">
              <div className="onboarding-tip">
                <svg className="onboarding-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Crea tu primera entrada con Ctrl+N
              </div>
              <div className="onboarding-tip">
                <svg className="onboarding-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Importa desde Chrome, Firefox, Bitwarden y mas
              </div>
              <div className="onboarding-tip">
                <svg className="onboarding-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Instala la extension de navegador para autocompletar
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleNext}>Siguiente</button>
          </div>
        )}

        {/* Paso 3: Contrasena maestra */}
        {step === 2 && (
          <div className="onboarding-step-content" key="step-2">
            <svg className="onboarding-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--warning)' }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h2 className="onboarding-title">Recuerda tu contrasena maestra</h2>
            <div className="onboarding-warning">
              <p className="onboarding-warning-text">
                Tu contrasena maestra es la UNICA forma de acceder a tus datos. No la almacenamos ni la podemos recuperar. Guardala en un lugar seguro.
              </p>
            </div>
            <button className="btn btn-primary" onClick={handleNext}>Entendido, comenzar</button>
          </div>
        )}
      </div>
    </div>
  );
}
