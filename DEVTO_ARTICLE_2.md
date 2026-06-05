---
title: "Why One Layer of Encryption Isn't Enough: Inside Vault Local's Double-Encryption Architecture"
published: false
description: "A deep dive into how Vault Local uses Argon2id, HKDF-SHA256, SQLCipher, and XChaCha20-Poly1305 to build a defense-in-depth password manager where compromising one layer still leaves your data protected."
tags: security, rust, encryption, opensource
cover_image:
canonical_url:
series: "Building Vault Local"
---

Most password managers encrypt your database and call it a day. Vault Local encrypts the database **and** every single field inside it, with two independent keys derived from one password. If either layer is compromised in isolation, your secrets remain protected.

In this article I will walk through the exact cryptographic architecture, why each algorithm was chosen, and show the actual Rust code that implements it.

## The Problem with Single-Layer Encryption

A typical password manager uses one key to encrypt a database file. This works fine until it doesn't. If an attacker finds a vulnerability in the database encryption layer (a padding oracle, a side-channel leak, a misconfigured cipher mode), they get everything at once: every password, every note, every TOTP seed.

Vault Local takes a different approach: **defense in depth**. Even if an attacker fully decrypts the database file, they still face a second, independent encryption layer on every sensitive field. And vice versa -- if the field-level cipher is somehow broken, the database file itself is still an opaque blob.

## The Key Derivation Pipeline

Everything starts with your master password. From that single input, we derive two completely independent encryption keys through a three-stage pipeline:

```
Master Password
      |
      v
+------------------+
| Argon2id KDF     |  salt (32 random bytes, stored on disk)
| 19 MiB memory    |  
| 2 iterations     |
| 1 parallelism    |
+------------------+
      |
      v
  Master Key (32 bytes)
      |
      v
+-------------------+
| HKDF-SHA256       |  same salt
+-------------------+
   /            \
  v              v
db_key          enc_key
(32 bytes)      (32 bytes)
info:           info:
"vault-local    "vault-local
 -db"            -field-enc"
  |                |
  v                v
SQLCipher       XChaCha20-Poly1305
(Layer 1)       (Layer 2)
```

### Stage 1: Argon2id -- Password to Master Key

The first stage converts your password into a 256-bit master key using Argon2id, the winner of the Password Hashing Competition and the current recommendation from OWASP.

```rust
use argon2::{Algorithm, Argon2, Params, Version};

pub fn derive_master_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(
        19456,    // m_cost in KiB (~19 MiB)
        2,        // t_cost (iterations)
        1,        // p_cost (parallelism)
        Some(32), // output length in bytes
    )
    .map_err(|e| format!("Argon2 params error: {}", e))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut master_key = [0u8; 32];
    argon2
        .hash_password_into(password, salt, &mut master_key)
        .map_err(|e| format!("Key derivation error: {}", e))?;

    Ok(master_key)
}
```

Why Argon2**id** specifically? It combines the side-channel resistance of Argon2i with the GPU/ASIC resistance of Argon2d. The `id` variant uses Argon2i for the first pass (protecting against timing attacks during the initial memory fill) and Argon2d for subsequent passes (maximizing resistance against GPU-based cracking).

The 19 MiB memory parameter is deliberately chosen: high enough to make brute-force attacks expensive (each guess costs 19 MiB of allocation), but low enough that unlocking remains fast on modest hardware. The salt is 32 bytes of `OsRng` output, stored alongside the database.

### Stage 2: HKDF-SHA256 -- Master Key to Sub-Keys

Using the master key directly for two different encryption systems would be a cryptographic sin. Instead, we use HKDF (HMAC-based Key Derivation Function) to derive two independent sub-keys:

```rust
use hkdf::Hkdf;
use sha2::Sha256;

pub fn derive_sub_keys(
    master_key: &[u8; 32],
    salt: &[u8],
) -> Result<([u8; 32], [u8; 32]), String> {
    let hk = Hkdf::<Sha256>::new(Some(salt), master_key);

    let mut db_key = [0u8; 32];
    hk.expand(b"vault-local-db", &mut db_key)
        .map_err(|e| format!("db_key derivation error: {}", e))?;

    let mut enc_key = [0u8; 32];
    hk.expand(b"vault-local-field-enc", &mut enc_key)
        .map_err(|e| format!("enc_key derivation error: {}", e))?;

    Ok((db_key, enc_key))
}
```

The different `info` strings (`"vault-local-db"` and `"vault-local-field-enc"`) guarantee that the two output keys are cryptographically independent. Knowing one sub-key tells you absolutely nothing about the other. This is the foundation of the defense-in-depth property: compromising Layer 1 does not help attack Layer 2.

After deriving the sub-keys, the master key is immediately zeroized:

```rust
pub fn derive_keys_from_password(
    password: &[u8],
    salt: &[u8],
) -> Result<([u8; 32], [u8; 32]), String> {
    let mut master_key = derive_master_key(password, salt)?;
    let result = derive_sub_keys(&master_key, salt);

    // Zeroize the intermediate master key
    master_key.zeroize();

    result
}
```

## Layer 1: SQLCipher (Full-Disk Encryption)

The `db_key` feeds into SQLCipher, which transparently encrypts the entire SQLite database file using AES-256-CBC with HMAC-SHA256 page authentication. Every page of the database (including metadata, indexes, and schema) is encrypted at rest.

```rust
pub fn open_db(db_path: &Path, db_key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Database open error: {}", e))?;

    let hex_key = hex::encode(db_key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))
        .map_err(|e| format!("SQLCipher key error: {}", e))?;

    // Verify the key is correct
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| "Incorrect password or corrupt database".to_string())?;

    Ok(conn)
}
```

SQLCipher handles encryption transparently -- the application reads and writes normal SQL. But it only protects the file on disk. Once the database is opened with the correct key, all data is accessible in plaintext through queries. This is where Layer 2 comes in.

## Layer 2: XChaCha20-Poly1305 (Field-Level Encryption)

Each entry's sensitive data is encrypted individually using XChaCha20-Poly1305 with the `enc_key`. Every encryption operation generates a fresh 24-byte random nonce:

```rust
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};

pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());

    // Fresh 24-byte random nonce for every encryption
    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption error: {}", e))?;

    // Storage format: nonce (24) || ciphertext || tag (16)
    let mut result = Vec::with_capacity(24 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}
```

### Why XChaCha20-Poly1305 over AES-GCM?

This is a deliberate choice, not a default. Two reasons:

**1. Nonce size.** AES-GCM uses a 96-bit (12-byte) nonce. XChaCha20-Poly1305 uses a 192-bit (24-byte) nonce. With random nonces, the birthday bound for a collision is approximately 2^(n/2) encryptions under the same key. For AES-GCM that is roughly 2^48 -- still large, but uncomfortably reachable for a long-lived key in a password manager that could be used for decades. For XChaCha20, it is 2^96 -- a number so large it is effectively infinite. A nonce collision in an AEAD cipher is catastrophic (it can leak the XOR of two plaintexts and the authentication key), so the extra margin matters.

**2. Constant-time without hardware support.** AES-GCM relies on AES-NI instructions for constant-time execution. Without them (older CPUs, some ARM devices), software AES implementations can leak timing information. ChaCha20 is built from ARX operations (add, rotate, XOR) that are inherently constant-time on all architectures.

## Memory Safety: Keys Never Linger

Vault Local uses two Rust crates to ensure key material does not persist in memory longer than needed:

- **`zeroize`**: Overwrites sensitive byte arrays with zeros when they leave scope. The `ZeroizeOnDrop` derive macro makes this automatic.
- **`secrecy::Secret<>`**: Wraps the encryption key in a type that prevents accidental logging or serialization. You must explicitly call `.expose_secret()` to access the inner value.

```rust
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct EncKey(pub [u8; 32]);

pub struct VaultState {
    pub connection: Connection,
    pub enc_key: Secret<EncKey>,  // Protected in memory
    pub db_path: PathBuf,
}
```

When the vault is locked, the entire `VaultState` is dropped. The `ZeroizeOnDrop` trait ensures the encryption key is overwritten with zeros before the memory is freed.

## The IPC Boundary: Decrypted Values Never Cross It

One subtle but important design decision: when the user clicks "copy password," the frontend does **not** receive the decrypted value. Instead, it sends the entry ID and field index to the Rust backend, which decrypts the field and copies it directly to the system clipboard:

```rust
#[tauri::command]
pub fn copy_field_to_clipboard(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    field_index: u32,
    clear_after_secs: Option<u64>,
) -> Result<(), String> {
    let guard = state.vault.lock()
        .map_err(|_| "Vault access error".to_string())?;
    let vault = guard.as_ref().ok_or("Vault is locked")?;

    // Decrypt in the backend
    let (_, _, encrypted_data, _, _, _) =
        repository::get_entry_raw(&vault.connection, &entry_id)?;
    let enc_key = &vault.enc_key.expose_secret().0;
    let decrypted = cipher::decrypt(enc_key, &encrypted_data)?;
    let entry_data: EntryData = serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Deserialization error: {}", e))?;

    let field = entry_data.fields.get(field_index as usize)
        .ok_or("Field not found")?;

    // Copy directly to clipboard -- plaintext never crosses IPC
    copy_to_clipboard(field.value.clone(), clear_after_secs)
}
```

The clipboard is automatically cleared after 15 seconds. A background thread checks that the clipboard still contains the copied value before clearing, so it does not overwrite something the user copied manually in the meantime.

## Putting It All Together

Here is the complete threat model in one table:

| Attack scenario | Layer 1 (SQLCipher) | Layer 2 (XChaCha20) | Data exposed? |
|---|---|---|---|
| Attacker steals the `.db` file | Encrypted | Encrypted inside encrypted DB | No |
| SQLCipher vulnerability found | Compromised | Still encrypted per-field | No |
| XChaCha20 vulnerability found | Still encrypted at file level | Compromised | No |
| Both layers compromised | Compromised | Compromised | Yes (but requires breaking two independent algorithms) |
| Memory dump while unlocked | Keys in memory (protected by `secrecy`) | Keys in memory (protected by `secrecy`) | Partial (requires sophisticated attack) |
| IPC/frontend compromise | N/A | Plaintext never sent to frontend | No |

The key insight is that both layers use **independent keys derived from the same password**. An attacker cannot combine partial breaks of both systems -- they need to fully compromise one OR know the master password.

## The Crate Stack

For anyone building something similar in Rust, here are the exact dependencies:

```toml
[dependencies]
rusqlite = { version = "0.31", features = ["bundled-sqlcipher-vendored-openssl"] }
argon2 = "0.5"
chacha20poly1305 = "0.10"
hkdf = "0.12"
zeroize = { version = "1", features = ["derive"] }
secrecy = { version = "0.8", features = ["serde"] }
```

The `bundled-sqlcipher-vendored-openssl` feature compiles SQLCipher from source with a vendored OpenSSL, so there are no system dependencies to worry about.

## Try It

Vault Local is open source and free for personal use. Everything runs locally -- no accounts, no cloud sync, no telemetry.

- **Download**: [vault-local.vercel.app](https://vault-local.vercel.app)
- **Source code**: [github.com/od1n/vault-local](https://github.com/od1n/vault-local)

If you have questions about the cryptographic design or want to contribute, open an issue on GitHub. The entire crypto module is under `src-tauri/src/crypto/` -- around 150 lines of Rust with no magic.
