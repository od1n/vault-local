# Chrome Web Store Listing — Vault Local

## Name
Vault Local — Password Manager

## Short Description (132 chars max)
Autocompletado seguro para Vault Local. Gestor de contrasenas local, zero-knowledge, cifrado de grado militar. 100% offline.

## Detailed Description
Vault Local es un gestor de contrasenas local y zero-knowledge. Esta extension conecta tu navegador con la aplicacion de escritorio Vault Local para autocompletar credenciales de forma segura.

CARACTERISTICAS:
- Autocompletado de usuario y contrasena en formularios de login
- Busqueda rapida de credenciales desde el popup
- Deteccion automatica del sitio web actual
- Copia de credenciales al portapapeles con limpieza automatica

SEGURIDAD:
- Cifrado de grado militar (XChaCha20-Poly1305 + SQLCipher)
- Zero-knowledge: tus datos nunca salen de tu computadora
- La extension NO almacena ninguna contrasena — solo comunica con la app local
- Comunicacion exclusivamente via localhost (127.0.0.1)
- Token de autenticacion regenerado en cada sesion

REQUISITOS:
- Aplicacion de escritorio Vault Local instalada (descarga gratis en vault-local.vercel.app)
- Node.js instalado (para el puente de comunicacion)

CODIGO ABIERTO:
Todo el codigo fuente esta disponible en GitHub: github.com/od1n/vault-local

Compatible con Chrome, Edge, Brave, Opera, Vivaldi y Arc.

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
