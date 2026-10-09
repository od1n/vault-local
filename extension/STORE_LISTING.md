# Chrome Web Store Listing — Vault Local

## Name
Vault Local — Password Manager

## Short Description (132 chars max)
Autocompletado para Vault Local, el gestor de contraseñas que guarda todo cifrado en tu computadora. Sin nube, sin cuentas.

## Detailed Description
Vault Local es un gestor de contraseñas que guarda tus datos cifrados en tu propia computadora, sin nube y sin cuentas. Esta extensión conecta el navegador con la aplicación de escritorio Vault Local para rellenar usuario y contraseña en las páginas de inicio de sesión.

QUÉ HACE
- Rellena usuario y contraseña en los formularios de inicio de sesión
- Busca credenciales desde la ventana de la extensión
- Detecta el sitio web abierto y sugiere la cuenta que corresponde
- Copia credenciales con borrado automático del portapapeles

SEGURIDAD
- La extensión no guarda ninguna contraseña: solo se comunica con la aplicación de escritorio en tu equipo
- La comunicación es local (127.0.0.1) y usa un token que cambia en cada sesión
- La bóveda está cifrada con SQLCipher (AES-256) y XChaCha20-Poly1305

REQUISITOS
- La aplicación de escritorio Vault Local 0.6 o posterior, instalada y desbloqueada. Descarga gratis en https://vault-local.vercel.app
- No hace falta instalar nada más: la aplicación configura la conexión con el navegador al abrirse.

CÓDIGO ABIERTO
El código fuente está en https://github.com/od1n/vault-local

## Category
Productivity

## Language
Spanish (Latin America)

## Website
https://vault-local.vercel.app

## Privacy Policy URL
https://vault-local.vercel.app/privacy.html

## Single Purpose Description (required by Chrome)
This extension autofills login credentials from the Vault Local desktop password manager application.

## Permissions Justification

### nativeMessaging
Required to communicate with the Vault Local desktop application via the native messaging protocol. The extension sends credential requests to the local app and receives encrypted responses.

### activeTab
Required to detect the current website URL for matching stored credentials, and to inject autofill scripts into login forms.

### scripting
Required to programmatically fill username and password fields in login forms on the active tab.

### host_permissions: <all_urls>
Required because login forms exist on any website. The content script needs to detect and fill forms across all domains.
