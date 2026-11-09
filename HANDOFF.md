# HANDOFF — Vault Local / "Caja Segura" (gestor de contraseñas local)

> Respaldo preparado el 9 de noviembre de 2026. Resumen técnico completo: `RESUMEN_PROYECTO.md`.

| Dato | Valor |
|---|---|
| Repositorio | https://github.com/od1n/vault-local (**público**, código abierto con licencia MIT + licencias Premium/Pro) |
| Rama | `main` |
| Último commit | `3cae14f` (9 nov 2026) — actualización de versión en package.json, Cargo y tauri.conf (hecho en este respaldo, **falta el push**) |
| Versión publicada | v0.6.2 (19 oct 2026) |
| Carpeta local | `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local` |
| Documentos de negocio (fuera del repo) | `D:\Desarrollo\Claude\Projects\Caja Segura\` (auditoría, firma de código, plan de lanzamiento, monetización, folleto) |
| Página web | https://vault-local.vercel.app |

## 1. Qué es

Gestor de credenciales local, sin nube ni cuentas: Argon2id + HKDF-SHA256 + XChaCha20-Poly1305 + SQLCipher; categorías, archivos adjuntos cifrados, exportación cifrada entre equipos, importación desde navegadores y otros gestores, generador de contraseñas, TOTP, papelera, desbloqueo rápido. Extensión para Chrome y Firefox (la app hace de puente). Planes: gratis, Premium $15/año, Pro $39/año con licencias Ed25519 sin conexión. Binance Pay preparado pero oculto.

## 2. Tecnología

Tauri 2 (Rust en `src-tauri\`, React + TypeScript), extensión en `extension\`, actualizador firmado de Tauri, GitHub Actions para compilar y publicar.

## 3. Cómo ejecutarlo

```powershell
Set-Location 'D:\Desarrollo\Claude\Projects\Caja Segura\vault-local'
npm install
npm run tauri dev
```

## 4. Secretos críticos (NO están en GitHub)

Carpeta `D:\Desarrollo\Claude\Projects\Caja Segura\vault-local-secrets\`: llave privada de licencias (`license-private-key.txt`), llave del actualizador (`updater.key`) y sus públicas. **Si se pierden, no se pueden emitir licencias ni publicar actualizaciones que los usuarios acepten.** Guardar copia cifrada fuera del equipo. Nunca copiarlas dentro del repositorio público.

## 5. Pendientes

- Firma de código para Windows (`CODE_SIGNING.md`), activar Binance Pay al tener cuenta de entidad, promoción (`COMUNIDADES_PROMOCION.md`, artículos de dev.to).
