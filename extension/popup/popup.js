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
  container.innerHTML = '';

  entries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.entryId = entry.id;

    // Avatar con la primera letra del título
    const initial = entry.title.charAt(0).toUpperCase() || '?';

    card.innerHTML = `
      <div class="entry-avatar">${escapeHtml(initial)}</div>
      <div class="entry-info">
        <div class="entry-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</div>
        <div class="entry-category">${escapeHtml(entry.category)}</div>
      </div>
      <div class="entry-actions">
        <button class="entry-action-btn" data-action="fill" title="Autocompletar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="entry-action-btn" data-action="copy-user" title="Copiar usuario">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
        <button class="entry-action-btn" data-action="copy-pass" title="Copiar contraseña">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </button>
      </div>
    `;

    // Click en la tarjeta: autocompletar
    card.addEventListener('click', (e) => {
      // Ignorar si se hizo click en un botón de acción
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
