---
title: Building a Zero-Knowledge Password Manager with Rust and Tauri 2.0
published: true
tags: rust, security, tauri, opensource
canonical_url: https://vault-local.vercel.app
cover_image: 
---

LastPass was breached in 2022. 33 million encrypted vaults ended up in attackers' hands. The root cause? Your passwords lived on their servers.

I decided to build a password manager where that scenario is architecturally impossible — because there is no server.

This is how I built **Vault Local**: a local-first, zero-knowledge password manager using Rust, Tauri 2.0, and modern cryptography.

## The Architecture

The core principle: **your data never leaves your computer**. There's no cloud, no sync server, no account creation. Just one encrypted file on your disk.

```
Master Password
      │
      ▼
  Argon2id (19 MiB RAM, 2 iterations)
      │
      ▼
  HKDF-SHA256
      ├──────────────────┐
      ▼                  ▼
  db_key             enc_key
  (SQLCipher)        (XChaCha20-Poly1305)
      │                  │
      ▼                  ▼
  Encrypts entire    Encrypts individual
  database file      credential fields
```

Two independent keys derived from the same master password, but cryptographically separated via HKDF with different info strings. Even if SQLCipher were somehow compromised, the field-level encryption remains intact.

## Why Rust?

The ownership system prevents the exact class of bugs that plague password managers:

- **No buffer overflows** — Rust's borrow checker eliminates them at compile time
- **No use-after-free** — the compiler enforces lifetimes
- **Deterministic cleanup** — `Drop` runs exactly when a value goes out of scope, which matters when that value is an encryption key

For cryptographic secrets, I use the `zeroize` and `secrecy` crates:

```rust
use zeroize::{Zeroize, ZeroizeOnDrop};
use secrecy::Secret;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct EncKey(pub [u8; 32]);

pub struct VaultState {
    pub connection: Connection,
    pub enc_key: Secret<EncKey>,  // Auto-zeroized on drop
}
```

When the vault locks, `VaultState` drops, and the encryption key is overwritten with zeros in memory. No garbage collector, no "maybe the runtime will clean it up eventually."

## Why Tauri 2.0 over Electron?

| | Electron | Tauri 2.0 |
|---|---|---|
| Installer size | ~150 MB | **4.6 MB** |
| Runtime | Bundles Chromium | Uses system WebView |
| Backend | Node.js (JS) | **Rust** (native) |
| Security model | Full filesystem access | Principle of least privilege |
| IPC | Unrestricted | Explicit command registration |

Tauri's security model is the key differentiator. The web frontend cannot access the filesystem, network, or system APIs. Every capability must be explicitly declared:

```json
{
  "permissions": ["core:default", "dialog:default"]
}
```

The frontend communicates with the Rust backend exclusively through typed commands:

```rust
#[tauri::command]
pub fn get_entry(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Entry, String> {
    // Decrypt and return entry
}
```

```typescript
// Frontend — this is the ONLY way to access data
const entry = await invoke<Entry>('get_entry', { id });
```

## The Encryption Stack

### Key Derivation: Argon2id

Argon2id won the Password Hashing Competition. It's memory-hard, meaning it requires a fixed amount of RAM to compute — making GPU/ASIC attacks impractical:

```rust
let params = Params::new(
    19456,  // 19 MiB of RAM
    2,      // 2 iterations
    1,      // 1 degree of parallelism
    Some(32) // 32 bytes output
)?;

let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
argon2.hash_password_into(password, salt, &mut master_key)?;
```

### Symmetric Encryption: XChaCha20-Poly1305

I chose XChaCha20-Poly1305 over AES-256-GCM for a specific reason: the extended nonce.

- AES-256-GCM: 96-bit nonce → collision risk after ~2^32 encryptions with the same key
- XChaCha20-Poly1305: **192-bit nonce** → safe for virtually unlimited encryptions

For a long-lived local vault where the same key encrypts thousands of entries over years, the larger nonce margin is significant.

```rust
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext)?;
    
    // Store as: nonce (24 bytes) || ciphertext
    let mut result = Vec::with_capacity(24 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}
```

### Database Encryption: SQLCipher

SQLCipher is a fork of SQLite that encrypts the entire database file with AES-256-CBC + HMAC-SHA256. Every page is encrypted independently.

```rust
pub fn open_db(db_path: &Path, db_key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(db_path)?;
    let hex_key = hex::encode(db_key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;
    // Verify the key works
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
    Ok(conn)
}
```

## Browser Extension via Native Messaging

The browser extension doesn't store any credentials. It communicates with the desktop app through Chrome's Native Messaging protocol:

```
Extension popup → Native Messaging Host (Node.js) → TCP localhost:51820 → Rust IPC Server
```

The IPC server only listens on `127.0.0.1` and requires a token that regenerates on every vault unlock. No external network access.

## What I Learned

1. **Tauri 2.0 is production-ready** for security-sensitive apps. The permission model is genuinely useful.

2. **SQLCipher's `bundled-sqlcipher-vendored-openssl`** feature in rusqlite compiles OpenSSL from source. It requires Perl on Windows (Strawberry Perl). Plan for this in your build pipeline.

3. **The `zeroize` crate can't clear CPU registers** — it's a fundamental limitation. But it handles heap and stack memory correctly, which covers the vast majority of attack surface.

4. **XChaCha20 is constant-time without hardware support**, unlike AES which relies on AES-NI for timing-attack resistance. This matters for cross-platform software where you can't guarantee hardware features.

5. **Native Messaging on Windows requires a `.bat` wrapper** — Node.js `.js` files can't be executed directly as native messaging hosts. A one-line batch file solves it.

## Try It

Vault Local is free and open source (MIT):

- **GitHub**: [github.com/od1n/vault-local](https://github.com/od1n/vault-local)
- **Website**: [vault-local.vercel.app](https://vault-local.vercel.app)
- **Download**: [Windows installer (4.6 MB)](https://github.com/od1n/vault-local/releases)

Features include: password audit with HIBP breach check, TOTP authenticator, SSH agent, import from 8 formats (Chrome, Firefox, Bitwarden, 1Password, LastPass, KeePass), encrypted sync, browser extension, and passkey storage.

Built with ~15,000 lines of Rust + TypeScript across ~70 files. I'd appreciate any feedback, especially on the cryptographic implementation.
