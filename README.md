# Vault Local

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-stable-orange.svg)](https://www.rust-lang.org/)
[![Tauri 2.0](https://img.shields.io/badge/tauri-2.0-24C8DB.svg)](https://tauri.app/)

**Gestor de credenciales local, zero-knowledge, cifrado de grado militar.**

Vault Local es una aplicacion de escritorio que almacena tus credenciales, passkeys, notas seguras y archivos adjuntos en una boveda cifrada que nunca sale de tu dispositivo. Sin cuentas, sin nube, sin telemetria.

## Caracteristicas

- **Cifrado de grado militar** — Argon2id para derivacion de claves, HKDF-SHA256 para sub-claves, XChaCha20-Poly1305 para cifrado de campos, SQLCipher para la base de datos.
- **Zero-knowledge** — Toda la informacion se cifra y descifra localmente. La clave maestra nunca se almacena.
- **Categorias** — Sitios web, bancos, wallets crypto, passkeys, notas seguras y mas.
- **Archivos adjuntos cifrados** — Adjunta documentos, imagenes o cualquier archivo (hasta 10 MB) cifrados con la misma seguridad.
- **Sincronizacion cifrada** — Exporta e importa tu boveda completa en un archivo cifrado con contraseña independiente para transferir entre dispositivos.
- **Importacion masiva** — Importa desde Chrome, Firefox, Edge, Bitwarden, 1Password, LastPass y KeePass.
- **Generador de contraseñas** — Configurable por longitud, mayusculas, numeros y simbolos.
- **Proteccion contra fuerza bruta** — Bloqueo progresivo tras intentos fallidos.
- **Multiplataforma** — Windows, macOS y Linux gracias a Tauri 2.0.

## Captura de pantalla

<!-- TODO: Agregar captura de pantalla -->

## Inicio rapido

### Prerrequisitos

- [Node.js](https://nodejs.org/) >= 20
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Dependencias del sistema para Tauri: ver [guia oficial](https://tauri.app/start/prerequisites/)

### Compilar y ejecutar

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/vault-local.git
cd vault-local

# Instalar dependencias de Node
npm ci

# Ejecutar en modo desarrollo
cargo tauri dev

# Compilar para produccion
cargo tauri build
```

## Arquitectura de seguridad

```
Contraseña maestra
       |
       v
   Argon2id (19 MiB, 2 iter, 1 hilo)
       |
       v
   Clave maestra (32 bytes)
       |
       v
   HKDF-SHA256
    /       \
   v         v
db_key     enc_key
   |         |
   v         v
SQLCipher  XChaCha20-Poly1305
(base de   (campos sensibles
 datos)     y adjuntos)
```

- **Argon2id** resiste ataques de GPU y ASIC con uso intensivo de memoria (19 MiB).
- **HKDF** separa la clave maestra en sub-claves independientes para la base de datos y el cifrado de campos.
- **XChaCha20-Poly1305** cifra cada campo sensible y archivo adjunto con un nonce aleatorio de 24 bytes.
- **SQLCipher** cifra la base de datos completa en reposo con AES-256.

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md) para conocer como configurar el entorno de desarrollo, el estilo de codigo y el proceso de pull requests.

## Seguridad

Si encuentras una vulnerabilidad, por favor lee [SECURITY.md](SECURITY.md) para saber como reportarla de forma responsable.

## Licencia

Este proyecto esta bajo la licencia MIT. Consulta [LICENSE](LICENSE) para mas detalles.
