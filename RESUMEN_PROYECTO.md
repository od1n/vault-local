# Vault Local — Resumen Completo del Proyecto

> Documento de referencia para retomar el desarrollo en cualquier sesión de chat.
> Última actualización: 2026-10-08 (v0.3.0: licencias Ed25519, tiempos configurables, acceso rápido, papelera, desbloqueo rápido)

---

## 1. Qué es Vault Local

Password manager local-only, zero-knowledge, open-source. No hay cuentas, no hay nube, no hay telemetría. Todo vive en la máquina del usuario.

- **Stack**: Tauri 2.0 (Rust backend + React/TypeScript frontend)
- **Repo**: https://github.com/od1n/vault-local
- **Website/Landing**: https://vault-local.vercel.app (Vercel)
- **Versión actual**: 0.3.0 (publicada el 2026-10-08; v0.2.0 nunca se etiquetó)
- **Tags de release publicados**: v0.1.0, v0.1.1, v0.1.3, v0.3.0
- **Licencia**: Freemium — gratis / Premium $15 al año / Pro $39 al año (licencias Ed25519 offline)

---

## 2. Arquitectura Criptográfica (Doble Cifrado)

```
Master Password
      │
      ▼
 Argon2id (19 MiB, 2 iter, 1 parallel) + salt 32 bytes
      │
      ▼
  Master Key (32 bytes) → se zeroiza inmediatamente
      │
  HKDF-SHA256
   /        \
  ▼          ▼
db_key      enc_key
(32 bytes)  (32 bytes)
info:       info:
"vault-     "vault-
local-db"   local-field-enc"
  │           │
  ▼           ▼
SQLCipher   XChaCha20-Poly1305
AES-256-CBC (nonce 24 bytes random)
(Layer 1)   (Layer 2)
```

Comprometer una capa no expone datos: las claves son criptográficamente independientes gracias a los `info` strings distintos en HKDF.

---

## 3. Estructura de Archivos del Proyecto

### Ruta raíz del proyecto en disco:
```
D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\
```

### Backend Rust (`src-tauri/src/`)
```
src-tauri/
├── Cargo.toml              # Dependencias Rust (v0.2.0)
├── tauri.conf.json          # Config Tauri (v0.2.0, CSP, ventana)
├── src/
│   ├── main.rs              # Entry point
│   ├── lib.rs               # Setup Tauri, registro de comandos, estado ventana
│   ├── state.rs             # AppState (Mutex<Option<VaultState>>)
│   ├── lockout.rs           # Bloqueo por intentos fallidos
│   ├── security.rs          # Módulo de seguridad
│   ├── ipc_server.rs        # Servidor IPC para extensión (puerto 51820)
│   ├── settings.rs          # Ajustes (settings.json) con límites gratis/pago aplicados en backend
│   ├── desktop.rs           # Suspensión/Win+L, bandeja, atajo global, ventana de búsqueda rápida
│   ├── quick_unlock.rs      # Desbloqueo rápido con PIN / Windows Hello (solo en memoria)
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── auth.rs          # create_vault, unlock, lock, change_password
│   │   ├── vault.rs         # CRUD entradas (get, create, update, delete, toggle_favorite)
│   │   ├── clipboard.rs     # Portapapeles: un temporizador, extender, borrar ahora, fuera del historial Win+V
│   │   ├── audit.rs         # Auditoría passwords (weak, reused, old, HIBP)
│   │   ├── backup.rs        # Respaldos automáticos (al bloquear vault)
│   │   ├── totp.rs          # Generador TOTP (RFC 6238)
│   │   ├── license.rs       # Licencias v2 offline (firma Ed25519, solo clave pública en la app)
│   │   ├── quick.rs         # Búsqueda rápida, copia en secuencia, escritura automática
│   │   ├── share.rs         # Compartir entrada como archivo .vlshare cifrado
│   │   ├── import_export.rs # CSV, JSON, KDBX (KeePass)
│   │   ├── sync.rs          # Sincronización cifrada entre dispositivos
│   │   ├── ssh_agent.rs     # Agente SSH integrado
│   │   └── attachments.rs   # Archivos adjuntos cifrados
│   ├── crypto/
│   │   ├── mod.rs
│   │   ├── kdf.rs           # Argon2id + HKDF-SHA256
│   │   ├── cipher.rs        # XChaCha20-Poly1305 encrypt/decrypt
│   │   └── password_gen.rs  # Generador de contraseñas
│   └── db/
│       ├── mod.rs
│       ├── models.rs        # Structs de datos
│       └── repository.rs    # Queries SQLCipher
```

### Frontend React (`src/`)
```
src/
├── main.tsx
├── App.tsx                  # Router principal (LockScreen ↔ Dashboard)
├── App.css                  # Estilos globales
├── types/index.ts           # TypeScript types
├── components/
│   ├── Dashboard.tsx        # Vista principal con sidebar + detalle
│   ├── LockScreen.tsx       # Login/creación de vault
│   ├── Onboarding.tsx       # Primera vez
│   ├── EntryList.tsx        # Lista de entradas
│   ├── EntryDetail.tsx      # Detalle de una entrada
│   ├── EntryForm.tsx        # Formulario crear/editar
│   ├── SearchBar.tsx        # Búsqueda
│   ├── CategoryFilter.tsx   # Filtros por categoría
│   ├── PasswordGenerator.tsx # Generador visual
│   ├── AuditPanel.tsx       # Panel de auditoría
│   ├── SecurityAlert.tsx    # Banner de alertas al desbloquear
│   ├── BackupSettings.tsx   # Configuración de respaldos
│   ├── TotpDisplay.tsx      # Display TOTP con countdown
│   ├── SshAgentPanel.tsx    # Panel SSH
│   ├── SyncDialog.tsx       # Diálogo de sincronización
│   ├── ImportExportDialog.tsx
│   ├── ChangePasswordDialog.tsx
│   ├── LicenseDialog.tsx
│   ├── Toast.tsx            # Notificaciones
│   ├── SettingsDialog.tsx   # Ajustes (bloqueo, portapapeles, acceso rápido, desbloqueo rápido)
│   ├── LockWarning.tsx      # Aviso antes del bloqueo automático (Sigo aquí / Pausar)
│   ├── ClipboardBar.tsx     # Barra de portapapeles (+30 s / Borrar ahora)
│   ├── QuickSearch.tsx      # Ventana flotante de búsqueda rápida (index.html#quick)
│   ├── QuickUnlockPanel.tsx # PIN / Windows Hello en la pantalla de bloqueo
│   └── extras/              # EntryExtras, TrashPanel, ShareDialog, HistoryDialog, WifiQrDialog, EmergencyKit
├── hooks/
│   ├── useAuth.ts           # Estado de autenticación
│   ├── useVault.ts          # CRUD de entradas
│   ├── useClipboard.tsx     # Contexto global del portapapeles
│   ├── useSettings.tsx      # Contexto de ajustes y pausa del bloqueo
│   ├── useAutoLock.ts       # Bloqueo por inactividad con aviso
│   ├── useBackup.ts         # Respaldos
│   ├── useLicense.ts        # Licencias
│   └── useTheme.ts          # Tema claro/oscuro
└── i18n/
    ├── index.ts
    ├── I18nProvider.tsx
    ├── es.ts / es.json      # Español
    └── en.ts / en.json      # English
```

### Extensión del Navegador (`extension/`)
```
extension/
├── manifest.json             # Chrome (Manifest V3)
├── manifest.firefox.json     # Firefox (Manifest V2 + data_collection_permissions)
├── background/service-worker.js
├── content/autofill.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # DOM API puro (sin innerHTML)
├── native-host/
│   ├── host.cjs              # Native messaging host (puerto IPC 51820)
│   ├── host.js
│   ├── host.bat
│   ├── install.ps1
│   ├── com.vaultlocal.app.json        # Chrome manifest
│   └── com.vaultlocal.app.firefox.json # Firefox manifest
├── icons/                    # 16, 48, 128 px
├── store-assets/             # Screenshots para stores
├── vault-local-extension.zip # Chrome Web Store package
└── vault-local-firefox.zip   # AMO package
```

### Website / Landing (`website/`)
```
website/
├── index.html          # Landing principal (español) con descargas multi-plataforma
├── en.html             # Landing en inglés
├── pt.html             # Landing en portugués
├── de.html             # Landing en alemán
├── privacy.html        # Política de privacidad (español)
├── privacy-en.html     # Política de privacidad (inglés)
├── _redirects          # Redirecciones Vercel
├── package.json        # "type": "module" para las funciones
└── api/
    ├── _license.js         # Firma Ed25519 y envío de correo (no se publica como endpoint)
    ├── paypal-webhook.js   # PayPal (verificado) → licencia de 1 año → correo (Resend)
    ├── redeem-promo.js     # Código promocional → licencia Pro de prueba de 30 días → correo
    └── README.md           # Variables de entorno y configuración paso a paso
```

### CI/CD (`.github/workflows/`)
```
.github/workflows/
├── ci.yml              # Push/PR: cargo fmt, clippy -D warnings, cargo audit, tsc --noEmit
│                       # Node 24, Windows runner
└── release.yml         # Tag v*: build multiplataforma (Windows, Linux, macOS universal)
│                       # Node 24, tauri-action v0
```

### Documentos en raíz del repo
```
BINANCE_PAY_RESEARCH.md    # Investigación Binance Pay (0% fees, webhook compatible)
COMUNIDADES_PROMOCION.md   # 60+ comunidades organizadas con plan 4 semanas
DEVTO_ARTICLE.md           # Primer artículo Dev.to (publicado)
DEVTO_ARTICLE_2.md         # Segundo artículo: doble cifrado (publicado)
SETUP.md                   # Guía de setup para desarrolladores
SECURITY.md                # Política de seguridad
```

---

## 4. Dependencias Clave (Rust)

| Crate | Versión | Uso |
|-------|---------|-----|
| `tauri` | 2 | Framework desktop |
| `rusqlite` | 0.31 | SQLCipher (feature `bundled-sqlcipher-vendored-openssl`) |
| `argon2` | 0.5 | KDF (Argon2id) |
| `chacha20poly1305` | 0.10 | Cifrado campo a campo |
| `hkdf` | 0.12 | Derivación de sub-claves |
| `zeroize` | 1 | Limpieza de memoria |
| `secrecy` | 0.8 | Protección de claves en memoria |
| `chrono` | 0.4 | Timestamps |
| `arboard` | 3 | Portapapeles del sistema |
| `reqwest` | 0.12 | HIBP API (blocking) |
| `tauri-plugin-dialog` | 2 | Diálogos nativos |
| `tauri-plugin-global-shortcut` | 2 | Atajo global de búsqueda rápida |
| `ed25519-dalek` | 2 | Verificación de licencias |
| `enigo` | 0.6 | Escritura automática (simula el teclado) |
| `windows-sys` / `windows` | 0.59 / 0.61 | Detección de Win+L y Windows Hello (solo Windows) |

---

## 5. Constantes y Secretos Críticos

| Valor | Ubicación | Notas |
|-------|-----------|-------|
| Clave PRIVADA de licencias (Ed25519) | `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\license-private-key.txt` y variable `LICENSE_PRIVATE_KEY` en Vercel | **Nunca** en el repositorio. Si se filtra, hay que generar otro par y publicar una versión nueva |
| Clave PÚBLICA de licencias | `src-tauri/src/commands/license.rs` (`LICENSE_PUBLIC_KEY`) y `vault-local-secrets\license-public-key.hex` | Pública; solo sirve para verificar |
| Tu licencia `owner` (sin vencimiento) | `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\licencia-owner.txt` | Guárdala también dentro de tu bóveda |
| PayPal Client ID | `website/index.html` (y en/pt/de) | Live mode |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | Variables de entorno en Vercel | Para verificar los avisos de PayPal |
| `RESEND_API_KEY`, `RESEND_FROM` | Variables de entorno en Vercel | `RESEND_FROM` debe usar un dominio verificado en Resend |
| `PROMO_CODES` | Variable de entorno en Vercel | Ej.: `PRODUCTHUNT2026:2026-12-31`. Da Pro (todas las funciones) de prueba por 30 días |
| Puerto IPC | `51820` en `ipc_server.rs` y `extension/native-host/host.cjs` | Comunicación app ↔ extensión |

### Clave de firma de las actualizaciones (desde v0.5.0)
- Privada: `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\updater.key` (sin contraseña). NUNCA al repositorio.
- Copiada en GitHub como secreto `TAURI_SIGNING_PRIVATE_KEY` (Settings → Secrets and variables → Actions). Sin ese secreto, la publicación falla.
- Pública: en `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. Si se pierde la privada, las apps instaladas no aceptarán más actualizaciones automáticas (habría que reinstalar a mano con una clave nueva).

### Cómo activar o renovar TU licencia (modo completo fijo)

Tu licencia es de tipo `owner` y **no vence**. Ya está generada en
`D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\licencia-owner.txt`.

1. Abre ese archivo con el Bloc de notas y copia todo el texto (empieza con `VL2-`).
2. En Vault Local, desbloquea la bóveda y haz clic en **Upgrade / Actualizar** (arriba a la izquierda, junto al ícono del tema).
3. Pega la clave en el campo **Clave de licencia** y pulsa **Activar**.

Para emitir una nueva (por ejemplo, si cambias de correo o necesitas una licencia de cortesía), en PowerShell 7:

```powershell
Set-Location 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local'
node 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\tools\issue-license.mjs' --key-file 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\license-private-key.txt' --email x0d1ns0x@gmail.com --tier owner
# Licencia Pro de 1 año para un cliente:
node 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\tools\issue-license.mjs' --key-file 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\license-private-key.txt' --email cliente@correo.com --tier pro --days 365
```

Nadie más puede hacer esto: sin el archivo de clave privada no se pueden firmar licencias válidas.
Limitación inevitable del código abierto: alguien técnico puede compilar su propia copia sin la
verificación; lo protegido es el instalador oficial.

## 6. Cómo Desarrollamos (Convenciones)

### Idioma
- Código: comentarios y mensajes de error en **español neutro** (NUNCA argentino)
- Variables/funciones/structs: inglés (Rust/React convenciones)
- Commits: español o inglés, prefijo convencional (`feat:`, `fix:`, `style:`, `ci:`)

### CI obligatorio antes de push
```powershell
# Desde D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\src-tauri\
cargo fmt --check
cargo clippy -- -D warnings
cargo audit
# Desde D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\
npx tsc --noEmit
```

### Release flow
1. Bumpar versión en `tauri.conf.json`, `Cargo.toml`, `package.json`
2. Commit y push
3. Crear tag: `git tag v0.X.Y && git push origin v0.X.Y`
4. GitHub Actions (release.yml) compila para Windows, Linux y macOS
5. Los assets se publican automáticamente en GitHub Releases

### Gotcha del sandbox
El sandbox Linux de Claude (bash) y el disco real (Read/Write/Edit) son filesystems distintos. El disco real es la verdad. Los commits, push y tags **siempre** deben ejecutarse desde PowerShell del usuario, nunca desde el sandbox.

---

## 7. Estado Actual de Tiendas y Extensiones

| Canal | Estado | Fecha |
|-------|--------|-------|
| Chrome Web Store (ID honffihiebfeephklbgnolejabdfocnp) | Rechazada 2026-06-06 por "Keyword Spam" (lista de navegadores en la descripción). Corregida en STORE_LISTING.md; reenviar v0.3.0 | Oct 2026 |
| Firefox AMO (vault-local@vaultlocal.com) | Aprobada y publicada 2026-06-08: https://addons.mozilla.org/addon/vault-local/ ; subir v0.3.0 (logo nuevo) | Oct 2026 |
| Dev.to artículo 1 | Publicado | Jun 2026 |
| Dev.to artículo 2 (doble cifrado) | Publicado | Jun 2026 |

---

## 8. Monetización

### Actual: PayPal (pago único anual, renovación manual)
- Checkout en la página: Premium $15/año, Pro $39/año
- Webhook en Vercel: verifica el aviso con PayPal → consulta la orden → firma licencia Ed25519 de 1 año → correo con Resend
- App Live de PayPal en la cuenta de negocio (Client ID `BAA3vJK3…dw_A`, webhook `707402621N091604W`, evento PAYMENT.CAPTURE.COMPLETED). Variables `PAYPAL_*` cargadas en Vercel.
- 2026-10-08: compra real de $15 cobrada (neto $13.89) pero NO llegó el correo de licencia: revisar Logs de Vercel (`paypal-webhook`). Pendiente.

### Planes
| Plan | Precio | Incluye |
|---|---|---|
| Gratis | $0 | Todo el gestor; tiempos de bloqueo ≤ 5 min y portapapeles ≤ 15 s; papelera, etiquetas, kit de emergencia, acceso de emergencia 2 de 3, bloqueo al suspender/Win+L, recibir entradas compartidas |
| Premium | $15/año | Tiempos hasta 8 h / 5 min, pausar bloqueo, +30 s portapapeles, bandeja, búsqueda rápida global, copia en secuencia, escritura automática, desbloqueo rápido PIN/Windows Hello, historial de contraseñas, vencimientos, compartir cifrado, QR Wi-Fi, HIBP, auditoría detallada, adjuntos |
| Pro | $39/año | Premium + sincronización cifrada + bóvedas múltiples |
| Owner | — | Todo, sin vencimiento (solo para el autor) |

### Binance Pay (en pausa: código listo, tarjeta oculta en el sitio)
- Binance eliminó las cuentas de comerciante individual: exige cuenta de entidad (empresa con verificación KYB). Usar El Hato Pascher C.A. no encaja con su objeto social; queda en pausa hasta tener empresa propia para Vault Local
- Para reactivar: en las 4 páginas quitar `style="display:none"` de la tarjeta "Crypto / Binance Pay" y la clase `one` de `payment-grid`
- Investigación en `BINANCE_PAY_RESEARCH.md` (0% al recibir; lo de comerciante individual ya no aplica)
- `website/api/binance-create-order.js` crea la orden en USDT (15/39) con correo, plan e idioma en `passThroughInfo`
- `website/api/binance-webhook.js` consulta la orden a Binance (estado PAID + monto + USDT) y envía la licencia (id `bn-<orden>`)
- Formulario de plan + correo en las 4 páginas (oculto); responde "todavía no disponible" mientras falten `BINANCE_PAY_API_KEY` y `BINANCE_PAY_SECRET` en Vercel
- Falta: cuenta de entidad aprobada en https://merchant.binance.com y cargar las dos variables

---

## 9. Lo que Falta por Hacer

### PayPal y publicación v0.4.0
- [x] Webhook Live y variables `PAYPAL_*` en Vercel; Client ID real en las 4 páginas; botones rotulados por plan
- [ ] Correo de licencia tras la compra real: no llegó → revisar Logs de Vercel y reenviar el aviso desde PayPal
- [ ] Probar el canje en https://vault-local.vercel.app/prueba.html?codigo=PRODUCTHUNT2026
- [ ] Publicar v0.4.0 (tag) y probar en Windows: bóvedas múltiples, acceso de emergencia (generar hojas y abrir con 2), cambio de contraseña
- [ ] Al publicar una versión: `@tauri-apps/api` (npm) debe tener la misma versión menor que la biblioteca `tauri` de Rust

### Desarrollo
- [ ] Reembolsos y contracargos de PayPal no revocan la licencia (las licencias offline no se pueden revocar; solo vencen)
- [ ] Límite de canjes de promoción global (hoy es por instancia de Vercel; haría falta Vercel KV)
- [ ] Mensajes de error del backend (Rust) solo en español
- [ ] Video demo
- [ ] Firma de código (diferido hasta tener ingresos; ~$200-400/año)

### Extensiones
- [ ] Verificar aprobación Chrome Web Store
- [ ] Verificar aprobación Firefox AMO

### Monetización
- [ ] (En pausa, requiere empresa) Cuenta de entidad en Binance Pay y cargar `BINANCE_PAY_API_KEY` / `BINANCE_PAY_SECRET` en Vercel (el código ya está)

### Promoción
- [ ] Ejecutar plan de 4 semanas de `COMUNIDADES_PROMOCION.md`
- [ ] Construir karma en Reddit/HN orgánicamente
- [ ] Considerar Product Hunt launch (código `PRODUCTHUNT2026` vía `PROMO_CODES`)

## 10. Features Implementadas (Completo)

1. **Vault CRUD** — Crear, leer, editar, eliminar entradas con campos personalizados
2. **Doble cifrado** — SQLCipher (archivo) + XChaCha20-Poly1305 (campos)
3. **Generador de contraseñas** — Longitud, caracteres, passphrase
4. **TOTP (2FA)** — RFC 6238, 6-8 dígitos, display con countdown
5. **Auditoría de seguridad** — Contraseñas débiles, duplicadas, antiguas
6. **HIBP** — Verificación de filtraciones (k-anonymity)
7. **Alertas al desbloquear** — Banner resumiendo problemas de seguridad
8. **Auto-backup** — Respaldo automático al bloquear vault, rotación configurable
9. **Importación** — CSV, JSON, KDBX (KeePass)
10. **Exportación** — CSV, JSON cifrado
11. **Sincronización cifrada** — Exportar/importar archivo cifrado entre dispositivos
12. **Archivos adjuntos** — Cifrados con XChaCha20
13. **Agente SSH** — Listar, agregar, remover claves del agente del sistema
14. **Portapapeles seguro** — Borrado automático configurable, extender, borrar ahora, fuera del historial Win+V
15. **Licencias offline** — Ed25519 (v2), planes anuales, prueba de 30 días por código
16. **Tema claro/oscuro** — Preferencia del sistema
17. **i18n** — Español + inglés
18. **Auto-lock** — Configurable (1 min–8 h), aviso previo, pausar; al suspender, Win+L o minimizar
19. **Bloqueo por intentos** — Lockout progresivo
20. **Extensión Chrome/Firefox** — Autofill, popup, native messaging
21. **Persistencia de ventana** — Recuerda posición y tamaño
22. **Landing multi-idioma** — ES, EN, PT, DE con descargas por plataforma y canje de códigos
23. **Bandeja del sistema y búsqueda rápida global** — Atajo configurable, Enter/Ctrl+U/Ctrl+T/Ctrl+Enter
24. **Copia en secuencia** — Usuario → contraseña → TOTP pulsando el atajo global
25. **Escritura automática** — Secuencias `{USERNAME}{TAB}{PASSWORD}{ENTER}{DELAY n}`
26. **Papelera** — 30 días, restaurar, vaciar
27. **Etiquetas, recientes por uso real, duplicar entrada**
28. **Historial de contraseñas** (hasta 20 por entrada) y **fecha para cambiar la contraseña**
29. **Compartir entrada cifrada** (.vlshare) y **QR de Wi-Fi**
30. **Plantillas** Tarjeta, Wi-Fi e Identidad
31. **Desbloqueo rápido** con PIN o Windows Hello (solo en memoria, caduca)
32. **Kit de emergencia** imprimible
33. **Bóvedas múltiples** (Pro) — cada una con contraseña y archivo propios (`vaults/<id>/`), selector en el desbloqueo; abrir las existentes no requiere licencia
34. **Acceso de emergencia** (gratis) — clave de recuperación dividida con Shamir 2 de 3 (24 palabras BIP39 + QR por hoja), `vault.recovery` junto a la base; abre en solo lectura (`PRAGMA query_only`); sobrevive al cambio de contraseña; los respaldos lo incluyen
35. **Cambio de contraseña a prueba de cortes** — `vault.salt.new` con la clave anterior envuelta; el siguiente desbloqueo con la contraseña nueva termina el cambio

---

## 11. Historial de Releases

| Tag | Cambios principales |
|-----|--------------------|
| v0.1.0 | Release inicial: vault CRUD, cifrado, generador, portapapeles |
| v0.1.1 | Correcciones, PayPal integration, promo codes |
| v0.1.3 | i18n, CI multiplataforma, Vercel analytics |
| v0.2.0 (no publicar) | Auto-backup, alertas seguridad, landings EN/PT/DE, fixes clippy/fmt/audit, Node 24 |
| v0.6.0 | La app hace de puente de la extensión (native messaging) y se registra sola en Chrome, Edge, Brave, Chromium y Firefox; ya no hace falta Node.js ni install.ps1 |
| v0.5.1 | Logo nuevo (dial de bóveda) |
| v0.5.0 | Actualizaciones automáticas firmadas, lista de Primeros pasos, folleto PDF |
| v0.4.0 | Bóvedas múltiples (Pro), acceso de emergencia 2 de 3, interfaz en inglés, cambio de contraseña atómico, etiquetas en sync/exportación |
| v0.3.0 | Licencias Ed25519 + planes anuales, tiempos configurables, portapapeles seguro, bandeja, búsqueda rápida, escritura automática, papelera, etiquetas, historial, compartir, desbloqueo rápido |

---

## 12. Para Retomar en Otro Chat

### Contexto mínimo que dar a Claude:
```
Proyecto: Vault Local — password manager local, Tauri 2.0 + Rust + React.
Repo: https://github.com/od1n/vault-local
Ruta: D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\
Versión: 0.3.0
CI: cargo fmt, clippy -D warnings, cargo audit, tsc --noEmit
Lee RESUMEN_PROYECTO.md en la raíz del repo para contexto completo.
Usa español neutro, nunca argentino.
Comandos PowerShell con ruta completa.
URLs completas en referencias.
No seas condescendiente; critica si hace falta.
```

### Archivos clave a leer primero:
1. `RESUMEN_PROYECTO.md` (este archivo)
2. `src-tauri/src/lib.rs` (registro de todos los comandos)
3. `src-tauri/Cargo.toml` (dependencias)
4. `.github/workflows/ci.yml` (qué valida el CI)

---

*Generado automáticamente. Verificar contra el estado real del repo antes de actuar.*
