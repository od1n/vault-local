// Lógica del popup de la extensión Vault Local.
// Gestiona la interfaz de búsqueda, autocompletado y estado del vault.

'use strict';

// --- Referencias al DOM ---
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const stateDisconnected = document.getElementById('stateDisconnected');
const stateLocked = document.getElementById('stateLocked');
const stateUnlocked = document.getElementById('stateUnlocked');
const searchInput = document.getElementById('searchInput');
const autoMatchSection = document.getElementById('autoMatchSection');
const autoMatchList = document.getElementById('autoMatchList');
const searchResultsSection = document.getElementById('searchResultsSection');
const searchResultsList = document.getElementById('searchResultsList');
const emptyState = document.getElementById('emptyState');
const btnRetry = document.getElementById('btnRetry');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// --- Estado local ---
let currentTabUrl = '';
let searchDebounceTimer = null;

// --- Comunicación con el background ---

/**
 * Envía una solicitud al servidor IPC a través del service worker.
 * @param {string} method - Método IPC
 * @param {object} params - Parámetros
 * @returns {Promise<object>}
 */
function vaultRequest(method, params = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'vault_request', method, params },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: 'Error de comunicación con la extensión',
          });
          return;
        }
        resolve(response || { success: false, error: 'Sin respuesta' });
      }
    );
  });
}

// --- Gestión de estados de la UI ---

function showState(state) {
  stateDisconnected.style.display = 'none';
  stateLocked.style.display = 'none';
  stateUnlocked.style.display = 'none';

  switch (state) {
    case 'disconnected':
      stateDisconnected.style.display = '';
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Desconectado';
      break;
    case 'locked':
      stateLocked.style.display = '';
      statusDot.className = 'status-dot locked';
      statusText.textContent = 'Bloqueado';
      break;
    case 'unlocked':
      stateUnlocked.style.display = '';
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Desbloqueado';
      break;
  }
}

// --- Verificación de estado ---

async function checkStatus() {
  statusText.textContent = 'Conectando...';
  statusDot.className = 'status-dot';

  // Primero verificar conectividad con ping
  const pingResult = await vaultRequest('ping');
  if (!pingResult.success) {
    showState('disconnected');
    return;
  }

  // Verificar si el vault está desbloqueado
  const statusResult = await vaultRequest('status');
  if (!statusResult.success) {
    showState('disconnected');
    return;
  }

  if (statusResult.data && statusResult.data.locked) {
    showState('locked');
    return;
  }

  showState('unlocked');

  // Auto-detectar URL de la pestaña activa y buscar coincidencias
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      currentTabUrl = tab.url;
      await loadUrlMatches(tab.url);
    }
  } catch (e) {
    // No es crítico, el usuario puede buscar manualmente
    console.warn('[Vault Local] No se pudo obtener la pestaña activa:', e);
  }

  // Enfocar el campo de búsqueda
  searchInput.focus();
}

// --- Carga de coincidencias por URL ---

async function loadUrlMatches(url) {
  // No buscar para URLs de extensiones, about:, chrome:, etc.
  if (!url || !url.startsWith('http')) {
    return;
  }

  const result = await vaultRequest('list_for_url', { url });
  if (result.success && result.data && result.data.length > 0) {
    autoMatchSection.style.display = '';
    renderEntries(autoMatchList, result.data);
  } else {
    autoMatchSection.style.display = 'none';
  }
}

// --- Búsqueda ---

function handleSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    searchResultsSection.style.display = 'none';
    emptyState.style.display = 'none';
    return;
  }

  // Debounce: esperar 250ms después de que el usuario deje de escribir
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    const result = await vaultRequest('search', { query });
    if (result.success && result.data && result.data.length > 0) {
      searchResultsSection.style.display = '';
      emptyState.style.display = 'none';
      renderEntries(searchResultsList, result.data);
    } else {
      searchResultsSection.style.display = 'none';
      emptyState.style.display = '';
    }
  }, 250);
}

// --- Renderizado de entradas ---

/**
 * Renderiza una lista de entradas en el contenedor especificado.
 * @param {HTMLElement} container
 * @param {Array} entries - Array de EntryMeta
 */
function renderEntries(container, entries) {
  container.replaceChildren();

  entries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.entryId = entry.id;

    // Avatar con la primera letra del título
    const initial = entry.title.charAt(0).toUpperCase() || '?';

    const avatar = document.createElement('div');
    avatar.className = 'entry-avatar';
    avatar.textContent = initial;

    const info = document.createElement('div');
    info.className = 'entry-info';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'entry-title';
    titleDiv.title = entry.title;
    titleDiv.textContent = entry.title;

    const catDiv = document.createElement('div');
    catDiv.className = 'entry-category';
    catDiv.textContent = entry.category;

    info.appendChild(titleDiv);
    info.appendChild(catDiv);

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const btnFill = createActionBtn('fill', 'Autocompletar',
      'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
      'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z');
    const btnUser = createActionBtn('copy-user', 'Copiar usuario',
      'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2');
    const btnPass = createActionBtn('copy-pass', 'Copiar contraseña',
      'M7 11V7a5 5 0 0 1 10 0v4');

    // Agregar el círculo al botón de usuario
    const userSvg = btnUser.querySelector('svg');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '7');
    circle.setAttribute('r', '4');
    userSvg.appendChild(circle);

    // Agregar el rectángulo al botón de contraseña
    const passSvg = btnPass.querySelector('svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '11');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '11');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    passSvg.insertBefore(rect, passSvg.firstChild);

    actions.appendChild(btnFill);
    actions.appendChild(btnUser);
    actions.appendChild(btnPass);

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(actions);

    // Click en la tarjeta: autocompletar
    card.addEventListener('click', (e) => {
      if (e.target.closest('.entry-action-btn')) return;
      handleEntryAction(entry.id, 'fill');
    });

    // Botones de acción individuales
    card.querySelectorAll('.entry-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleEntryAction(entry.id, btn.dataset.action);
      });
    });

    container.appendChild(card);
  });
}

function createActionBtn(action, title, ...paths) {
  const btn = document.createElement('button');
  btn.className = 'entry-action-btn';
  btn.dataset.action = action;
  btn.title = title;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  paths.forEach((d) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  btn.appendChild(svg);
  return btn;
}

// --- Acciones sobre entradas ---

async function handleEntryAction(entryId, action) {
  // Obtener credenciales descifradas
  const result = await vaultRequest('get_credentials', { id: entryId });
  if (!result.success) {
    showToast('Error al obtener credenciales');
    return;
  }

  const { username, password } = result.data;

  switch (action) {
    case 'fill':
      // Enviar credenciales al content script para autocompletar
      chrome.runtime.sendMessage(
        {
          type: 'fill_credentials_from_popup',
          username,
          password,
        },
        (response) => {
          if (response && response.success) {
            showToast('Credenciales completadas');
            // Cerrar popup después de un breve delay
            setTimeout(() => window.close(), 600);
          } else {
            showToast('No se encontró formulario de login');
          }
        }
      );
      break;

    case 'copy-user':
      await copyToClipboard(username);
      showToast('Usuario copiado');
      break;

    case 'copy-pass':
      await copyToClipboard(password);
      showToast('Contraseña copiada');
      break;
  }
}

// --- Utilidades ---

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback para contextos sin permiso de clipboard
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

function showToast(message) {
  toastMessage.textContent = message;
  toast.style.display = '';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2000);
}

// --- Event listeners ---

searchInput.addEventListener('input', handleSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchResultsSection.style.display = 'none';
    emptyState.style.display = 'none';
  }
});

btnRetry.addEventListener('click', checkStatus);

// --- Inicialización ---

document.addEventListener('DOMContentLoaded', () => {
  checkStatus();
});
