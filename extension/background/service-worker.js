// Service worker (background) de la extensión Vault Local.
// Gestiona la comunicación con el native messaging host y
// actúa como puente entre el popup, content scripts y la app de escritorio.

const NATIVE_HOST = 'com.vaultlocal.app';

let port = null;
let pendingRequests = new Map();
let requestId = 0;
let connectionRetries = 0;
const MAX_RETRIES = 3;

/**
 * Establece conexión con el native messaging host.
 * Reutiliza la conexión existente si está activa.
 */
function connectNative() {
  if (port) return true;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);

    port.onMessage.addListener((msg) => {
      // Resetear contador de reintentos tras mensaje exitoso
      connectionRetries = 0;

      // Enrutar respuesta a la solicitud pendiente correspondiente
      if (msg && msg._reqId && pendingRequests.has(msg._reqId)) {
        const resolver = pendingRequests.get(msg._reqId);
        pendingRequests.delete(msg._reqId);
        resolver(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn('[Vault Local] Native host desconectado:', error.message);
      }
      port = null;

      // Rechazar todas las solicitudes pendientes
      for (const [id, resolver] of pendingRequests) {
        resolver({
          success: false,
          error: 'Conexión con Vault Local perdida',
        });
      }
      pendingRequests.clear();
    });

    connectionRetries = 0;
    return true;
  } catch (e) {
    console.error('[Vault Local] Error al conectar native host:', e);
    port = null;
    return false;
  }
}

/**
 * Envía una solicitud al native messaging host y espera la respuesta.
 * @param {string} method - Método IPC a invocar
 * @param {object} params - Parámetros del método
 * @returns {Promise<object>} Respuesta del servidor IPC
 */
function sendNative(method, params = {}) {
  return new Promise((resolve) => {
    const connected = connectNative();
    if (!connected || !port) {
      resolve({
        success: false,
        error: 'No se pudo conectar con Vault Local. Verifica que la aplicación esté abierta.',
      });
      return;
    }

    const id = ++requestId;
    pendingRequests.set(id, resolve);

    try {
      port.postMessage({ method, params, _reqId: id });
    } catch (e) {
      pendingRequests.delete(id);
      resolve({
        success: false,
        error: 'Error al enviar mensaje a Vault Local',
      });
      return;
    }

    // Timeout de 5 segundos
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        resolve({ success: false, error: 'Timeout: Vault Local no respondió a tiempo' });
      }
    }, 5000);
  });
}

/**
 * Listener principal: recibe mensajes del popup y content scripts.
 * Protocolo:
 *   { type: 'vault_request', method: string, params: object }
 *   Responde con el resultado del servidor IPC.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'vault_request') {
    sendNative(msg.method, msg.params || {}).then((response) => {
      sendResponse(response);
    });
    // Retornar true para indicar respuesta asíncrona
    return true;
  }

  if (msg.type === 'fill_credentials_from_popup') {
    // El popup solicita rellenar credenciales en la pestaña activa
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            type: 'fill_credentials',
            username: msg.username,
            password: msg.password,
          },
          (response) => {
            sendResponse(response || { success: false });
          }
        );
      } else {
        sendResponse({ success: false, error: 'No hay pestaña activa' });
      }
    });
    return true;
  }
});

// Escuchar clics en el icono de la extensión (fallback si no hay popup)
chrome.action?.onClicked?.addListener?.((tab) => {
  // El popup se abre automáticamente si está definido en manifest
});
