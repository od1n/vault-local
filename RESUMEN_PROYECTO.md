# Vault Local — Resumen Completo del Proyecto

> Documento de referencia para retomar el desarrollo en cualquier sesión de chat.
> Última actualización: 2026-10-08

---

## 1. Qué es Vault Local

Password manager local-only, zero-knowledge, open-source. No hay cuentas, no hay nube, no hay telemetría. Todo vive en la máquina del usuario.

- **Stack**: Tauri 2.0 (Rust backend + React/TypeScript frontend)
- **Repo**: https://github.com/od1n/vault-local
- **Website/Landing**: https://vault-local.vercel.app (Vercel)
- **Versión actual**: 0.2.0
- **Tags de release publicados**: v0.1.0, v0.1.1, v0.1.3
- **Licencia**: Freemium (personal gratis, Premium con clave de licencia)

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
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── auth.rs          # create_vault, unlock, lock, change_password
│   │   ├── vault.rs         # CRUD entradas (get, create, update, delete, toggle_favorite)
│   │   ├── clipboard.rs     # Copiar al portapapeles (auto-clear 15s)
│   │   ├── audit.rs         # Auditoría passwords (weak, reused, old, HIBP)
│   │   ├── backup.rs        # Respaldos automáticos (al bloquear vault)
│   │   ├── totp.rs          # Generador TOTP (RFC 6238)
│   │   ├── license.rs       # Licencias offline (HMAC-SHA256)
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
│   └── Toast.tsx            # Notificaciones
├── hooks/
│   ├── useAuth.ts           # Estado de autenticación
│   ├── useVault.ts          # CRUD de entradas
│   ├── useClipboard.ts      # Copiar al portapapeles
│   ├── useBackup.ts         # Respaldos
│   ├── useLicense.ts        # Licencias
│   ├── useTheme.ts          # Tema claro/oscuro
│   └── useInactivity.ts     # Auto-lock por inactividad
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
└── api/
    ├── paypal-webhook.js   # Serverless function: PayPal → generar licencia → email (Resend)
    └── README.md
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

---

## 5. Constantes y Secretos Críticos

| Valor | Ubicación | Notas |
|-------|-----------|-------|
| `LICENSE_SIGNING_KEY` | `src-tauri/src/commands/license.rs` Y `website/api/paypal-webhook.js` | **DEBEN coincidir**. Cambiar en producción. |
| PayPal Client ID | `website/index.html` (hardcoded) | Live mode |
| `RESEND_API_KEY` | Variable de entorno en Vercel | Para envío de emails con licencia |
| Puerto IPC | `51820` en `ipc_server.rs` y `extension/native-host/host.cjs` | Comunicación app ↔ extensión |
| Código promocional | `PRODUCTHUNT2026` | Activa Premium |

---

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
| Chrome Web Store | Enviado, pendiente revisión | ~Jun 2026 |
| Firefox AMO | Enviado (v0.2.0), pendiente revisión | ~Jun 2026 |
| Dev.to artículo 1 | Publicado | Jun 2026 |
| Dev.to artículo 2 (doble cifrado) | Publicado | Jun 2026 |

---

## 8. Monetización

### Actual: PayPal
- Checkout integrado en landing page
- Webhook serverless en Vercel: recibe pago → genera clave HMAC → envía email via Resend
- Funciona end-to-end

### Pendiente: Binance Pay
- Investigación completa en `BINANCE_PAY_RESEARCH.md`
- 0% fees recibiendo, 0.80% retirando
- Individual merchant soportado
- Falta: aplicar como merchant en https://merchant.binance.com, implementar webhook

---

## 9. Lo que Falta por Hacer

### Desarrollo
- [ ] Probar `cargo tauri build` local con las features nuevas (backup, alerts)
- [ ] Crear tag v0.2.0 y publicar release
- [ ] Video demo (investigar herramientas de grabación automatizada)
- [ ] Firma de código (diferido hasta tener ingresos reales; cuesta ~$200-400/año)

### Extensiones
- [ ] Verificar aprobación Chrome Web Store
- [ ] Verificar aprobación Firefox AMO
- [ ] Responder a cualquier feedback de los revisores

### Monetización
- [ ] Aplicar como merchant en Binance Pay
- [ ] Implementar webhook Binance Pay (similar al de PayPal, en `website/api/`)

### Promoción
- [ ] Ejecutar plan de 4 semanas de `COMUNIDADES_PROMOCION.md`
- [ ] Construir karma en Reddit/HN orgánicamente (no automatizable — viola TOS)
- [ ] Posts en Lemmy, Mastodon, Lobste.rs, foros de seguridad
- [ ] Considerar Product Hunt launch

---

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
14. **Portapapeles seguro** — Auto-clear a 15 segundos
15. **Licencias offline** — HMAC-SHA256, sin conexión requerida
16. **Tema claro/oscuro** — Preferencia del sistema
17. **i18n** — Español + inglés
18. **Auto-lock** — Bloqueo por inactividad
19. **Bloqueo por intentos** — Lockout progresivo
20. **Extensión Chrome/Firefox** — Autofill, popup, native messaging
21. **Persistencia de ventana** — Recuerda posición y tamaño
22. **Landing multi-idioma** — ES, EN, PT, DE con descargas por plataforma

---

## 11. Historial de Releases

| Tag | Cambios principales |
|-----|--------------------|
| v0.1.0 | Release inicial: vault CRUD, cifrado, generador, portapapeles |
| v0.1.1 | Correcciones, PayPal integration, promo codes |
| v0.1.3 | i18n, CI multiplataforma, Vercel analytics |
| v0.2.0 (pendiente tag) | Auto-backup, alertas seguridad, landings EN/PT/DE, fixes clippy/fmt/audit, Node 24 |

---

## 12. Para Retomar en Otro Chat

### Contexto mínimo que dar a Claude:
```
Proyecto: Vault Local — password manager local, Tauri 2.0 + Rust + React.
Repo: https://github.com/od1n/vault-local
Ruta: D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\
Versión: 0.2.0
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
