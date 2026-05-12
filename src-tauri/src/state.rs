use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::crypto::VaultKey;

/// Process-global vault state. The plaintext vault key lives here only while
/// the user is unlocked; on `lock()` the key is dropped and the buffer is
/// zeroized via `VaultKey`'s `Drop` impl.
pub struct VaultState {
    inner: Mutex<Inner>,
}

struct Inner {
    key: Option<VaultKey>,
    last_activity: Instant,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                key: None,
                last_activity: Instant::now(),
            }),
        }
    }

    pub fn unlock(&self, key: VaultKey) {
        let mut g = self.inner.lock().unwrap();
        g.key = Some(key);
        g.last_activity = Instant::now();
    }

    pub fn lock(&self) {
        let mut g = self.inner.lock().unwrap();
        g.key = None;
    }

    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().key.is_some()
    }

    pub fn touch(&self) {
        self.inner.lock().unwrap().last_activity = Instant::now();
    }

    pub fn idle_for(&self) -> Duration {
        Instant::now().saturating_duration_since(self.inner.lock().unwrap().last_activity)
    }

    /// Run `f` with a borrow of the vault key. Returns `Err` if the vault is
    /// locked. Activity timer is touched on each successful access.
    pub fn with_key<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&VaultKey) -> T,
    {
        let mut g = self.inner.lock().unwrap();
        let key = g.key.as_ref().ok_or_else(|| "Vault is locked".to_string())?;
        let out = f(key);
        g.last_activity = Instant::now();
        Ok(out)
    }
}
