import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Entry } from '../../types';

function escapeWifi(s: string) {
  return s.replace(/([\;,":])/g, '\\$1');
}

/** Texto estándar "WIFI:" que entienden las cámaras de Android e iPhone, o null si no aplica. */
export function wifiPayload(entry: Entry): string | null {
  if (entry.category !== 'wifi') return null;
  const find = (re: RegExp) => entry.fields.find((f) => re.test(f.name.toLowerCase()))?.value?.trim() ?? '';
  const ssid = find(/ssid|red/);
  if (!ssid) return null;
  const password = entry.fields.find((f) => f.field_type === 'password')?.value ?? '';
  let security = find(/seguridad|security/).toUpperCase() || 'WPA';
  if (!password) security = 'nopass';
  if (!['WPA', 'WEP', 'NOPASS'].includes(security.toUpperCase())) security = 'WPA';
  return `WIFI:T:${security === 'NOPASS' ? 'nopass' : security};S:${escapeWifi(ssid)};P:${escapeWifi(password)};;`;
}

/** Muestra un QR para conectarse a la red escaneándolo con la cámara del teléfono. */
export function WifiQrDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    const payload = wifiPayload(entry);
    if (!payload) return;
    QRCode.toString(payload, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then(setSvg);
    return () => setSvg(null);
  }, [entry]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2 className="modal-title">Conectarse a «{entry.title}»</h2>
        </div>
        <div className="modal-body" style={{ textAlign: 'center' }}>
          {svg ? (
            <div style={{ background: '#fff', padding: 12, borderRadius: 8, display: 'inline-block', width: 260 }} dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p>Completa el nombre de la red (SSID) para generar el código.</p>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Abre la cámara del teléfono y apunta al código. Quien lo vea en tu pantalla también puede conectarse.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
