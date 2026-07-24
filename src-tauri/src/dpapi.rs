//! Windows DPAPI wrapper for auto-unlock.
//!
//! Threat model shift (deliberate, user-approved trade-off): auto-unlock wraps
//! the raw 32-byte vault key (VK) with `CryptProtectData`, scoped to the
//! current Windows user profile with no additional entropy. Anyone able to
//! run code as this Windows user (or read this user's DPAPI master key via a
//! sufficiently privileged local attack) can recover VK without the master
//! password. This is strictly opt-in — see `commands::enable_auto_unlock`.
//!
//! Every failure path returns `Result::Err`, never panics — required because
//! the release profile builds with `panic = "abort"`, and a foreign/corrupt
//! blob (wrong machine, wrong user, tampered bytes) must fail gracefully so
//! the caller can fall back to the normal password-unlock screen.

use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::core::PCWSTR;

/// Wrap `plaintext` (the raw VK bytes) with DPAPI, scoped to the current user.
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
