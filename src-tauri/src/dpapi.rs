//! Windows DPAPI wrapper — legacy migration helper only.
//!
//! At-rest encryption has been removed entirely (see `crypto.rs`/`db.rs`);
//! nothing wraps a vault key with DPAPI anymore. This module is kept solely
//! as a silent-unwrap fallback inside `commands::finish_migration`, for any
//! vault that had DPAPI auto-unlock enabled before that removal. Once a
//! vault has migrated there is nothing left to unwrap.
//!
//! Every failure path returns `Result::Err`, never panics — required because
//! the release profile builds with `panic = "abort"`, and a foreign/corrupt
//! blob (wrong machine, wrong user, tampered bytes) must fail gracefully.

use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::core::PCWSTR;

/// Wrap `plaintext` (the raw VK bytes) with DPAPI, scoped to the current user.
/// No longer called anywhere post-migration (nothing re-wraps a vault key
/// once `finish_migration` has run) — kept only so `unprotect` below has a
/// matching counterpart for anyone reading this file, and in case a future
/// need for DPAPI wrapping resurfaces.
#[allow(dead_code)]
pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| format!("DPAPI protect failed: {e}"))?;

        if out.pbData.is_null() {
            return Err("DPAPI protect returned no data".to_string());
        }
        let result = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        Ok(result)
    }
}

/// Unwrap a blob produced by [`protect`]. Fails (never panics) if the blob is
/// corrupt, or was produced on a different machine/user profile.
pub fn unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: blob.len() as u32,
            pbData: blob.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
        .map_err(|e| format!("DPAPI unprotect failed: {e}"))?;

        if out.pbData.is_null() {
            return Err("DPAPI unprotect returned no data".to_string());
        }
        let result = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut core::ffi::c_void)));
        Ok(result)
    }
}
