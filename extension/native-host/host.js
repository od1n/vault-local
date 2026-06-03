#!/usr/bin/env node

// Native Messaging Host para Vault Local.
// Actúa como puente entre la extensión del navegador y el servidor IPC local.
// Protocolo: lee mensajes del stdin (4 bytes longitud LE + JSON),
// los reenvía al servidor TCP en 127.0.0.1:51820,
// y devuelve la respuesta por stdout.

'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

const IPC_PORT = 51820;
const IPC_HOST = '127.0.0.1';
const TIMEOUT_MS = 5000;

// --- Protocolo Native Messaging ---

/**
 * Lee mensajes del stdin según el protocolo de Native Messaging.
 * Cada mensaje: 4 bytes (longitud en LE uint32) + payload JSON.
 * @param {function} callback - Recibe el objeto JSON parseado
 */
function readMessages(callback) {
  let buffer = Buffer.alloc(0);

  process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      buffer = Buffer.concat([buffer, chunk]);

      // Procesar todos los mensajes completos en el buffer
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32LE(0);

        // Protección contra mensajes excesivamente grandes (>1MB)
        if (msgLen > 1024 * 1024) {
          sendMessage({ success: false, error: 'Mensaje demasiado grande' });
          process.exit(1);
          return;
        }

        if (buffer.length < 4 + msgLen) break; // Mensaje incompleto

        const msgData = buffer.slice(4, 4 + msgLen).toString('utf8');
        buffer = buffer.slice(4 + msgLen);

        try {
          const msg = JSON.parse(msgData);
          callback(msg);
        } catch (e) {
          sendMessage({ success: false, error: 'JSON inválido en mensaje' });
        }
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

/**
 * Envía un mensaje por stdout según el protocolo de Native Messaging.
 * @param {object} msg - Objeto a serializar como JSON
 */
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(json.length, 0);

  try {
    process.stdout.write(buf);
    process.stdout.write(json);
  } catch (e) {
    // Si stdout está cerrado, salir silenciosamente
    process.exit(0);
  }
}

// --- Obtención del token de autenticación ---

/**
 * Determina la ruta al archivo de token IPC según la plataforma.
 * @returns {string}
 */
function getTokenPath() {
  switch (process.platform) {
    case 'win32':
      return path.join(
        process.env.APPDATA || '',
        'com.vaultlocal.app',
        'ipc.token'
      );
    case 'darwin':
      return path.join(
        process.env.HOME || '',
        'Library',
        'Application Support',
        'com.vaultlocal.app',
        'ipc.token'
      );
    default:
      // Linux y otros Unix
      return path.join(
        process.env.HOME || '',
        '.local',
        'share',
        'com.vaultlocal.app',
        'ipc.token'
      );
  }
}

/**
 * Lee el token de autenticación del archivo en disco.
 * @returns {string} Token o cadena vacía si no existe
 */
function readToken() {
  try {
    return fs.readFileSync(getTokenPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

// --- Comunicación con el servidor IPC ---

/**
 * Reenvía una solicitud al servidor IPC local via TCP.
 * @param {object} request - Solicitud de la extensión
 * @returns {Promise<object>} Respuesta del servidor
 */
function forwardToApp(request) {
  return new Promise((resolve) => {
    const token = readToken();

    // Preservar _reqId para enrutamiento en el service worker
    const reqId = request._reqId;

    // Construir solicitud para el servidor IPC
    const ipcRequest = {
      method: request.method,
      params: request.params || {},
      token: token,
    };

    const client = new net.Socket();
    let data = '';
    let resolved = false;

    function finish(response) {
      if (resolved) return;
      resolved = true;
      client.destroy();

      // Re-adjuntar el _reqId para que el service worker enrute la respuesta
      if (reqId !== undefined) {
        response._reqId = reqId;
      }
      resolve(response);
    }

    // Timeout de conexión
    const timer = setTimeout(() => {
      finish({
        success: false,
        data: null,
        error: 'Timeout: el servidor IPC no respondió',
      });
    }, TIMEOUT_MS);

    client.connect(IPC_PORT, IPC_HOST, () => {
      const payload = JSON.stringify(ipcRequest) + '\n';
      client.write(payload);
    });

    client.on('data', (chunk) => {
      data += chunk.toString();

      // El servidor envía una línea JSON completa
      const newlineIdx = data.indexOf('\n');
      if (newlineIdx !== -1) {
        clearTimeout(timer);
        const line = data.substring(0, newlineIdx);
        try {
          finish(JSON.parse(line));
        } catch {
          finish({ success: false, data: null, error: 'Respuesta inválida del servidor' });
        }
      }
    });

    client.on('close', () => {
      clearTimeout(timer);
      if (!resolved) {
        if (data.trim()) {
          try {
            finish(JSON.parse(data.trim()));
          } catch {
            finish({ success: false, data: null, error: 'Respuesta incompleta del servidor' });
          }
        } else {
          finish({ success: false, data: null, error: 'Conexión cerrada sin respuesta' });
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      finish({
        success: false,
        data: null,
        error: 'Vault Local no está en ejecución o está bloqueado',
      });
    });
  });
}

// --- Punto de entrada ---

readMessages(async (msg) => {
  const response = await forwardToApp(msg);
  sendMessage(response);
});
