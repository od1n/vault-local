# Contribuir a Vault Local

Gracias por tu interes en contribuir a Vault Local. Este documento describe como configurar el entorno de desarrollo, el estilo de codigo y el proceso para enviar cambios.

## Configurar el entorno de desarrollo

### Prerrequisitos

1. **Node.js** >= 20 — [Descargar](https://nodejs.org/)
2. **Rust** (stable) — [Instalar](https://www.rust-lang.org/tools/install)
3. **Dependencias del sistema para Tauri** — Consulta la [guia oficial](https://tauri.app/start/prerequisites/) segun tu sistema operativo.

### Pasos

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/vault-local.git
cd vault-local

# Instalar dependencias de Node
npm ci

# Ejecutar en modo desarrollo
cargo tauri dev
```

El modo desarrollo abre la aplicacion con hot-reload para el frontend y recompilacion automatica del backend en Rust.

## Estilo de codigo

### Rust (backend)

- Formatear con `cargo fmt` antes de cada commit.
- Sin warnings de `cargo clippy`: ejecuta `cargo clippy -- -D warnings`.
- Comentarios y documentacion en español.
- Usar `///` para documentacion publica de funciones y structs.

### TypeScript / React (frontend)

- Formatear con Prettier (configuracion por defecto).
- Sin errores de TypeScript: ejecuta `npx tsc --noEmit`.
- Texto visible por el usuario en español neutro.
- Componentes funcionales con hooks. Sin clases.

## Proceso de Pull Requests

1. **Crea un fork** del repositorio.
2. **Crea una rama** desde `main` con un nombre descriptivo:
   - `feature/nombre-de-la-funcionalidad`
   - `fix/descripcion-del-bug`
   - `docs/que-se-actualiza`
3. **Haz commits atomicos** con mensajes claros. Usamos la convencion de [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: agregar exportacion de passkeys`
   - `fix: corregir descifrado de adjuntos en sync`
   - `docs: actualizar README con instrucciones de build`
   - `chore: actualizar dependencias de Tauri`
   - `security: sanitizar rutas de archivo en importacion`
4. **Asegurate de que pasan** todos los checks:
   ```bash
   # Backend
   cd src-tauri
   cargo fmt --check
   cargo clippy -- -D warnings

   # Frontend
   npx tsc --noEmit
   ```
5. **Abre un Pull Request** contra `main` con una descripcion clara de los cambios.

## Reportar problemas de seguridad

**No abras un issue publico para vulnerabilidades de seguridad.** Consulta [SECURITY.md](SECURITY.md) para el proceso de divulgacion responsable.

## Codigo de conducta

Este proyecto se rige por el [Codigo de conducta](CODE_OF_CONDUCT.md). Al participar, aceptas cumplir con sus terminos.

## Licencia

Al contribuir a Vault Local, aceptas que tus contribuciones se publiquen bajo la [licencia MIT](LICENSE).
