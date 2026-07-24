use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Session state for the GUI's optional screen-lock PIN. This is a UI
/// nuisance-gate only, not a security boundary — the vault has no
/// cryptographic key anymore (see `crypto.rs`/`db.rs` doc comments). MCP
/// access never checks this; only the bearer token gates MCP (`mcp.rs`).
/// `locked` starts `true` only when a PIN is actually configured — a vault
/// with no PIN set never gates the GUI at all.
pub struct VaultState {
    inner: Mutex<Inner>,
}

struct Inner {
    locked: bool,
    last_activity: Instant,
    pin_fail_count: u32,
    pin_cooldown_until: Option<Instant>,
}

impl VaultState {
    pub fn new(locked: bool) -> Self {
        Self {
            inner: Mutex::new(Inner {
                locked,
                last_activity: Instant::now(),
                pin_fail_count: 0,
                pin_cooldown_until: None,
            }),
        }
    }

    pub fn lock_screen(&self) {
        self.inner.lock().unwrap().locked = true;
    }

    pub fn is_locked(&self) -> bool {
        self.inner.lock().unwrap().locked
    }

    pub fn touch(&self) {
        self.inner.lock().unwrap().last_activity = Instant::now();
    }

    pub fn idle_for(&self) -> Duration {
        Instant::now().saturating_duration_since(self.inner.lock().unwrap().last_activity)
    }

    /// In-memory-only cooldown against rapid PIN guessing. Deliberately not
    /// persisted to disk — the PIN guards nothing that isn't already
    /// reachable via MCP unconditionally, so this only needs to stop a
    /// tight-loop script, not survive a process restart.
    pub fn check_pin_cooldown(&self) -> Result<(), String> {
        let g = self.inner.lock().unwrap();
        if let Some(until) = g.pin_cooldown_until {
            let now = Instant::now();
            if now < until {
                let secs = (until - now).as_secs() + 1;
                return Err(format!("Too many attempts. Try again in {secs}s."));
            }
        }
        Ok(())
    }

    pub fn record_pin_failure(&self) {
        let mut g = self.inner.lock().unwrap();
        g.pin_fail_count += 1;
        if g.pin_fail_count >= 5 {
            g.pin_cooldown_until = Some(Instant::now() + Duration::from_secs(30));
        }
    }

    pub fn record_pin_success(&self) {
        let mut g = self.inner.lock().unwrap();
        g.pin_fail_count = 0;
        g.pin_cooldown_until = None;
        g.locked = false;
        g.last_activity = Instant::now();
    }
}
