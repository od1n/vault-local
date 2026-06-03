// Content script de Vault Local.
// Detecta formularios de login y rellena credenciales cuando se solicita.
// Se inyecta en todas las páginas (document_idle).

'use strict';

(() => {
  // Evitar inyección múltiple
  if (window.__vaultLocalInjected) return;
  window.__vaultLocalInjected = true;

  /**
   * Detecta campos de login en la página.
   * Busca campos de contraseña visibles y campos de usuario/email cercanos.
   * @returns {{ userField: HTMLInputElement|null, pwField: HTMLInputElement|null } | null}
   */
  function findLoginFields() {
    // Buscar campos de contraseña visibles
    const passwordFields = Array.from(
      document.querySelectorAll('input[type="password"]')
    ).filter((el) => isVisible(el));

    if (passwordFields.length === 0) return null;

    const pwField = passwordFields[0];

    // Buscar campo de usuario/email asociado
    const userField = findUsernameField(pwField);

    return { userField, pwField };
  }

  /**
   * Busca el campo de usuario/email más probable asociado a un campo de contraseña.
   * Prioriza campos dentro del mismo formulario, luego busca en el DOM cercano.
   * @param {HTMLInputElement} pwField
   * @returns {HTMLInputElement|null}
   */
  function findUsernameField(pwField) {
    // Selectores para campos de usuario/email
    const selectors = [
      'input[type="email"]',
      'input[type="text"][name*="user" i]',
      'input[type="text"][name*="email" i]',
      'input[type="text"][name*="login" i]',
      'input[type="text"][name*="account" i]',
      'input[type="text"][name*="cuenta" i]',
      'input[type="text"][name*="usuario" i]',
      'input[type="text"][name*="correo" i]',
      'input[type="text"][id*="user" i]',
      'input[type="text"][id*="email" i]',
      'input[type="text"][id*="login" i]',
      'input[type="text"][autocomplete="username"]',
      'input[type="text"][autocomplete="email"]',
      'input[type="text"]',
      'input[type="tel"]', // Algunos sitios usan teléfono como login
    ];

    // Primero buscar dentro del mismo formulario
    const form = pwField.closest('form');
    if (form) {
      for (const selector of selectors) {
        const candidates = Array.from(form.querySelectorAll(selector)).filter(
          (el) => isVisible(el) && el !== pwField
        );
        if (candidates.length > 0) {
          // Tomar el que está más cerca (antes) del campo de contraseña
          const before = candidates.filter(
            (el) =>
              el.compareDocumentPosition(pwField) &
              Node.DOCUMENT_POSITION_FOLLOWING
          );
          return before.length > 0 ? before[before.length - 1] : candidates[0];
        }
      }
    }

    // Si no hay formulario, buscar en el DOM general
    for (const selector of selectors) {
      const candidates = Array.from(
        document.querySelectorAll(selector)
      ).filter((el) => isVisible(el) && el !== pwField);
      if (candidates.length > 0) {
        // Tomar el más cercano al campo de contraseña en el DOM
        const before = candidates.filter(
          (el) =>
            el.compareDocumentPosition(pwField) &
            Node.DOCUMENT_POSITION_FOLLOWING
        );
        return before.length > 0 ? before[before.length - 1] : candidates[0];
      }
    }

    return null;
  }

  /**
   * Verifica si un elemento es visible en la página.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    // Verificar atributos ARIA de ocultación
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;

    return true;
  }

  /**
   * Establece el valor de un input de forma compatible con React/Vue/Angular.
   * Los frameworks modernos usan descriptores de propiedad internos que no
   * se activan con una simple asignación de .value.
   * @param {HTMLInputElement} el
   * @param {string} value
   */
  function setNativeValue(el, value) {
    // Intentar usar el setter nativo del prototipo
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    const setter =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
        ?.set ||
      nativeInputValueSetter ||
      nativeTextAreaValueSetter;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }

  /**
   * Simula los eventos de interacción del usuario sobre un campo.
   * Necesario para que React/Vue/Angular detecten el cambio.
   * @param {HTMLInputElement} el
   */
  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * Rellena los campos de login con las credenciales proporcionadas.
   * @param {string} username
   * @param {string} password
   * @returns {boolean} true si se rellenó al menos un campo
   */
  function fillCredentials(username, password) {
    const fields = findLoginFields();
    if (!fields) return false;

    let filled = false;

    if (fields.userField && username) {
      // Enfocar, limpiar y rellenar el campo de usuario
      fields.userField.focus();
      setNativeValue(fields.userField, '');
      dispatchInputEvents(fields.userField);

      setNativeValue(fields.userField, username);
      dispatchInputEvents(fields.userField);
      filled = true;
    }

    if (fields.pwField && password) {
      // Enfocar, limpiar y rellenar el campo de contraseña
      fields.pwField.focus();
      setNativeValue(fields.pwField, '');
      dispatchInputEvents(fields.pwField);

      setNativeValue(fields.pwField, password);
      dispatchInputEvents(fields.pwField);
      filled = true;
    }

    return filled;
  }

  // --- Listener de mensajes del background/popup ---

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'fill_credentials') {
      const success = fillCredentials(msg.username, msg.password);
      sendResponse({ success });
      return;
    }

    if (msg.type === 'detect_fields') {
      const fields = findLoginFields();
      sendResponse({
        hasLoginForm: !!fields,
        hasUserField: !!(fields && fields.userField),
        hasPasswordField: !!(fields && fields.pwField),
      });
      return;
    }
  });
})();
