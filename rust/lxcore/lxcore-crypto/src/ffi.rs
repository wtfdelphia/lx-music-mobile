//! C ABI 薄层：iOS 侧经 `#[no_mangle] extern "C"` 调用（见 design.md D2）。
//!
//! 约定：
//! - 入参均为 NUL 结尾的 UTF-8 C 字符串；空语义传空串 ""
//! - 返回值是 `malloc` 语义的字节缓冲（可能含 NUL，如 raw RSA 解密块），
//!   长度经 `out_len` 返回；调用方用 `lx_free_string` 释放
//! - 与 Java 契约一致：任何错误返回空串（长度 0），不返回 null

use std::ffi::CStr;
use std::os::raw::c_char;

fn read_str<'a>(p: *const c_char) -> &'a str {
    if p.is_null() {
        return "";
    }
    unsafe { CStr::from_ptr(p) }.to_str().unwrap_or("")
}

fn into_out(s: String, out_len: *mut usize) -> *mut c_char {
    let mut bytes = s.into_bytes();
    bytes.push(0); // 便于按 C 字符串消费；真实长度以 out_len 为准
    let len = bytes.len() - 1;
    if !out_len.is_null() {
        unsafe { *out_len = len };
    }
    let ptr = bytes.as_ptr() as *mut c_char;
    std::mem::forget(bytes);
    ptr
}

macro_rules! ffi_fn {
    ($name:ident, $impl:path, $($arg:ident),+) => {
        #[no_mangle]
        pub extern "C" fn $name($($arg: *const c_char),+, out_len: *mut usize) -> *mut c_char {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                $impl($(read_str($arg)),+)
            }));
            match result {
                Ok(s) => into_out(s, out_len),
                Err(_) => into_out(String::new(), out_len),
            }
        }
    };
}

ffi_fn!(lx_aes_encrypt, crate::aes_encrypt, data, key, iv, mode);
ffi_fn!(lx_aes_decrypt, crate::aes_decrypt, data, key, iv, mode);
ffi_fn!(lx_rsa_encrypt, crate::rsa_encrypt, data, key, padding);
ffi_fn!(lx_rsa_decrypt, crate::rsa_decrypt, data, key, padding);

/// 对齐 `CryptoModule.generateRsaKey`：返回 JSON `{"publicKey":..,"privateKey":..}`。
/// 失败返回 `{}`（对应 Promise reject 语义由原生薄封装决定）。
#[no_mangle]
pub extern "C" fn lx_generate_rsa_key_json(out_len: *mut usize) -> *mut c_char {
    let result = std::panic::catch_unwind(|| match crate::generate_rsa_key() {
        Some((public_key, private_key)) => {
            let esc = |s: &str| {
                s.replace('\\', "\\\\").replace('"', "\\\"").replace('\r', "\\r").replace('\n', "\\n")
            };
            format!(
                "{{\"publicKey\":\"{}\",\"privateKey\":\"{}\"}}",
                esc(&public_key),
                esc(&private_key)
            )
        }
        None => "{}".to_string(),
    });
    match result {
        Ok(s) => into_out(s, out_len),
        Err(_) => into_out(String::new(), out_len),
    }
}

/// 释放本库分配的字符串缓冲。`len` 为 `out_len` 返回的长度。
///
/// # Safety
/// ptr 必须来自本库且未被释放；同一指针只释放一次。
#[no_mangle]
pub unsafe extern "C" fn lx_free_string(ptr: *mut c_char, len: usize) {
    if ptr.is_null() {
        return;
    }
    let _ = Vec::from_raw_parts(ptr as *mut u8, len + 1, len + 1);
}

/// 供原生侧探测链接是否成功。
#[no_mangle]
pub extern "C" fn lx_core_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr() as *const c_char
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    fn c(s: &str) -> CString {
        CString::new(s).unwrap()
    }

    #[test]
    fn ffi_roundtrip() {
        let key = c("MDEyMzQ1Njc4OWFiY2RlZg==");
        let iv = c("YWJjZGVmOTg3NjU0MzIxMA==");
        let data = c("aGVsbG8=");
        let mode = c("AES/CBC/PKCS7Padding");
        let mut len: usize = 0;
        let cipher_ptr = lx_aes_encrypt(data.as_ptr(), key.as_ptr(), iv.as_ptr(), mode.as_ptr(), &mut len);
        assert!(!cipher_ptr.is_null() && len > 0);
        let cipher = unsafe { std::str::from_utf8(std::slice::from_raw_parts(cipher_ptr as *const u8, len)).unwrap().to_string() };
        unsafe { lx_free_string(cipher_ptr, len) };

        let cipher_c = c(&cipher);
        let mut len2: usize = 0;
        let plain_ptr = lx_aes_decrypt(cipher_c.as_ptr(), key.as_ptr(), iv.as_ptr(), mode.as_ptr(), &mut len2);
        let plain = unsafe { std::str::from_utf8(std::slice::from_raw_parts(plain_ptr as *const u8, len2)).unwrap().to_string() };
        unsafe { lx_free_string(plain_ptr, len2) };
        assert_eq!(plain, "hello");
    }
}
