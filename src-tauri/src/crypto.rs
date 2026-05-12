//! VaultMate cryptography primitives.
//!
//! Threat model: a local attacker who copies the SQLite database file off the
//! user's machine. Without the master password, encrypted blobs must be
//! computationally infeasible to recover.
//!
//! Design:
//! - Master password → Argon2id KDF → 32-byte derived key (DK)
//! - Random 32-byte vault key (VK) is generated once at first setup
//! - VK is encrypted with DK (AES-256-GCM) and stored as `vault_key_blob`
//! - Field-level encryption (secret, notes, totp, custom_fields) uses VK
//! - Each ciphertext has its own random 12-byte nonce, so blob = nonce || ct
//! - Verifying the master password = attempting to decrypt VK; on success the
//!   plaintext VK is held in process memory until lock/exit
//! - Changing master password only re-encrypts VK, not all stored secrets

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroize;

pub const VAULT_KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;

// Argon2id parameters — tuned to ~250ms on a typical laptop in 2026.
const ARGON_M_COST: u32 = 65_536; // 64 MiB
const ARGON_T_COST: u32 = 3;
const ARGON_P_COST: u32 = 4;

#[derive(Debug)]
pub enum CryptoError {
    BadPassword,
    Encoding,
    Internal(String),
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::BadPassword => write!(f, "Incorrect password"),
            CryptoError::Encoding => write!(f, "Corrupt or malformed encrypted data"),
            CryptoError::Internal(s) => write!(f, "Crypto error: {s}"),
        }
    }
}

impl From<CryptoError> for String {
    fn from(e: CryptoError) -> Self {
        e.to_string()
    }
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], CryptoError> {
    let params = Params::new(ARGON_M_COST, ARGON_T_COST, ARGON_P_COST, Some(32))
        .map_err(|e| CryptoError::Internal(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| CryptoError::Internal(e.to_string()))?;
    Ok(out)
}

/// Encrypt `plaintext` with `key`. Returns nonce || ciphertext (raw bytes).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::Internal(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt `nonce || ciphertext` produced by [`encrypt`].
pub fn decrypt(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(CryptoError::Encoding);
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::BadPassword)
}

pub fn encrypt_string(key: &[u8; 32], plaintext: &str) -> Result<String, CryptoError> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    Ok(hex::encode(encrypt(key, plaintext.as_bytes())?))
}

pub fn decrypt_string(key: &[u8; 32], blob_hex: &str) -> Result<String, CryptoError> {
    if blob_hex.is_empty() {
        return Ok(String::new());
    }
    let bytes = hex::decode(blob_hex).map_err(|_| CryptoError::Encoding)?;
    let plaintext = decrypt(key, &bytes)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::Encoding)
}

/// Wrapper for the in-memory vault key. Zeroized on drop.
#[derive(Clone)]
pub struct VaultKey(pub [u8; VAULT_KEY_LEN]);

impl Drop for VaultKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl VaultKey {
    pub fn random() -> Self {
        let mut key = [0u8; VAULT_KEY_LEN];
        rand::thread_rng().fill_bytes(&mut key);
        VaultKey(key)
    }

    pub fn as_bytes(&self) -> &[u8; VAULT_KEY_LEN] {
        &self.0
    }
}

// ── TOTP (RFC 6238) ──────────────────────────────────────────────────────────

use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// Generate a 6-digit TOTP code for the given base32 secret at the current time.
pub fn totp_code(base32_secret: &str, period: u64, digits: u32) -> Result<(String, u64), String> {
    let cleaned: String = base32_secret
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase();
    let key = base32::decode(base32::Alphabet::RFC4648 { padding: false }, &cleaned)
        .ok_or_else(|| "Invalid base32 secret".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let counter = now / period;
    let remaining = period - (now % period);

    let counter_bytes = counter.to_be_bytes();
    let mut mac = <HmacSha1 as Mac>::new_from_slice(&key).map_err(|e| e.to_string())?;
    mac.update(&counter_bytes);
    let result = mac.finalize().into_bytes();

    let offset = (result[result.len() - 1] & 0x0f) as usize;
    let bin = ((u32::from(result[offset]) & 0x7f) << 24)
        | ((u32::from(result[offset + 1])) << 16)
        | ((u32::from(result[offset + 2])) << 8)
        | u32::from(result[offset + 3]);
    let modulus = 10u32.pow(digits);
    let code = bin % modulus;
    Ok((format!("{:0width$}", code, width = digits as usize), remaining))
}
