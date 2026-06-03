# Vault Local — Guía de Instalación y Compilación

## Prerequisitos

### 1. Rust (>= 1.77)
```powershell
# Instalar desde https://rustup.rs
# Verificar instalación:
rustc --version
cargo --version
```

### 2. Node.js (>= 18) y npm
```powershell
# Instalar desde https://nodejs.org
node --version
npm --version
```

### 3. Visual Studio Build Tools (Windows)
Necesario para compilar SQLCipher (dependencia nativa en C).
- Descargar desde: https://visualstudio.microsoft.com/visual-cpp-build-tools/
- Instalar el workload **"Desarrollo para escritorio con C++"**
- Esto incluye MSVC y el Windows SDK

### 4. Tauri CLI
```powershell
cargo install tauri-cli
```

## Compilación

### Desarrollo (hot-reload)
```powershell
cd D:\Desarrollo\Claude\Projects\Caja Segura\vault-local

# Instalar dependencias de Node
npm install

# Ejecutar en modo desarrollo
cargo tauri dev
```

La primera compilación descarga y compila todas las dependencias de Rust (incluido SQLCipher). Puede tardar varios minutos.

### Producción (binario distribuible)
```powershell
cargo tauri build
```

El ejecutable resultante se encuentra en:
```
src-tauri\target\release\vault-local.exe
```

El instalador (MSI/NSIS) se genera en:
```
src-tauri\target\release\bundle\
```

## Estructura del Proyecto

```
vault-local/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/               # Componentes UI
│   ├── hooks/                    # Hooks de React
│   ├── types/                    # Definiciones de tipos
│   ├── App.tsx                   # Componente raíz
│   └── App.css                   # Estilos globales
├── src-tauri/                    # Backend (Rust + Tauri 2.0)
│   ├── src/
│   │   ├── crypto/               # Argon2id, XChaCha20-Poly1305, HKDF
│   │   ├── db/                   # SQLCipher, modelos, repositorio
│   │   ├── commands/             # Comandos Tauri (auth, vault, clipboard)
│   │   ├── state.rs              # Estado global de la app
│   │   └── lib.rs                # Punto de entrada Tauri
│   ├── Cargo.toml                # Dependencias Rust
│   └── tauri.conf.json           # Configuración Tauri
├── package.json                  # Dependencias Node
└── vite.config.ts                # Configuración Vite
```

## Datos de la Aplicación

La base de datos cifrada y el salt se almacenan en:
```
Windows:  %APPDATA%\com.vaultlocal.app\
macOS:    ~/Library/Application Support/com.vaultlocal.app/
Linux:    ~/.local/share/com.vaultlocal.app/
```

Archivos:
- `vault.db` — Base de datos SQLCipher (AES-256-CBC + HMAC-SHA256)
- `vault.salt` — Salt de 32 bytes para Argon2id

## Arquitectura de Seguridad

- **Capa 1:** SQLCipher cifra todo el archivo DB en disco
- **Capa 2:** XChaCha20-Poly1305 cifra campos sensibles dentro de la DB
- **KDF:** Argon2id (19 MiB RAM, 2 iteraciones) + HKDF-SHA256 para derivar claves independientes
- **Memoria:** `zeroize` + `secrecy` para limpieza automática de claves
- **Portapapeles:** Limpieza automática tras 15 segundos
- **Inactividad:** Bloqueo automático tras 5 minutos
- **Red:** La aplicación no realiza ninguna conexión de red (air-gapped)

## Notas

- El primer `cargo tauri dev` descarga ~300+ crates de Rust. Es normal.
- Si falla la compilación de SQLCipher, verificar que Visual Studio Build Tools están instalados correctamente.
- La app no requiere permisos de red. Si un firewall pregunta, bloquear sin problema.
- Para resetear el vault completamente, eliminar los archivos `vault.db` y `vault.salt` del directorio de datos.
