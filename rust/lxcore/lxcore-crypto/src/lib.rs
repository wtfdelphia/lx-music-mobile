//! LX Music Mobile 加密核心。
//!
//! 契约来源：`android/.../crypto/AES.java`、`RSA.java`、`CryptoModule.java`
//! （openspec change `add-ios-support` design.md「必须逐字节复刻的加密契约」）。
//! 与 Java 侧一致：所有错误被吞掉并返回空串，绝不抛到调用方。

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyInit, KeyIvInit};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rsa::{BigUint, Oaep, RsaPrivateKey, RsaPublicKey};
use sha1::Sha1;

pub mod ffi;

pub const MODE_CBC_PKCS7: &str = "AES/CBC/PKCS7Padding";
/// Java 侧 `Cipher.getInstance("AES")` 被 JCE 补全为 AES/ECB/PKCS5Padding。
/// PKCS5 与 PKCS7 在 16 字节块下字节级等价，此处显式声明，杜绝隐式默认。
pub const MODE_ECB_NO_PADDING_NAME: &str = "AES";
pub const PAD_OAEP_SHA1: &str = "RSA/ECB/OAEPWithSHA1AndMGF1Padding";
pub const PAD_NONE: &str = "RSA/ECB/NoPadding";

// ---------- base64 ----------

/// 对齐 Android `Base64.decode(..., DEFAULT)`：忽略字母表外字符（含换行），补齐缺失填充。
fn b64_decode_lenient(input: &str) -> Option<Vec<u8>> {
    let cleaned: String = input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=')
        .collect();
    let pad = (4 - cleaned.len() % 4) % 4;
    let mut s = cleaned;
    s.push_str(&"=".repeat(pad));
    STANDARD.decode(s.as_bytes()).ok()
}

/// 对齐 `Base64.encode(..., NO_WRAP)`：标准字母表 + 填充，无换行。
fn b64_encode(data: &[u8]) -> String {
    STANDARD.encode(data)
}

/// 对齐 `Base64.encode(..., DEFAULT)`：每 76 字符 CRLF 换行（用于生成的密钥导出）。
fn b64_encode_wrapped(data: &[u8]) -> String {
    let s = STANDARD.encode(data);
    s.as_bytes()
        .chunks(76)
        .map(|c| std::str::from_utf8(c).expect("base64 is ascii"))
        .collect::<Vec<_>>()
        .join("\r\n")
}

// ---------- AES ----------

fn norm_iv(iv: &[u8]) -> [u8; 16] {
    let mut out = [0u8; 16];
    let n = iv.len().min(16);
    out[..n].copy_from_slice(&iv[..n]);
    out
}

fn pad_left(data: &[u8], len: usize) -> Vec<u8> {
    if data.len() >= len {
        return data.to_vec();
    }
    let mut out = vec![0u8; len - data.len()];
    out.extend_from_slice(data);
    out
}

fn aes_encrypt_raw(data: &[u8], key: &[u8], iv: Option<[u8; 16]>, mode: &str) -> Option<Vec<u8>> {
    use aes::cipher::block_padding::Pkcs7;
    match (mode, iv) {
        (MODE_CBC_PKCS7, Some(iv)) => match key.len() {
            16 => Some(cbc::Encryptor::<aes::Aes128>::new_from_slices(key, &iv).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            24 => Some(cbc::Encryptor::<aes::Aes192>::new_from_slices(key, &iv).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            32 => Some(cbc::Encryptor::<aes::Aes256>::new_from_slices(key, &iv).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            _ => None,
        },
        (MODE_ECB_NO_PADDING_NAME, None) => match key.len() {
            16 => Some(ecb::Encryptor::<aes::Aes128>::new_from_slice(key).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            24 => Some(ecb::Encryptor::<aes::Aes192>::new_from_slice(key).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            32 => Some(ecb::Encryptor::<aes::Aes256>::new_from_slice(key).ok()?.encrypt_padded_vec_mut::<Pkcs7>(data)),
            _ => None,
        },
        // CBC 缺 IV / ECB 带 IV / 未知 mode：JCE 抛异常被吞 → 空串
        _ => None,
    }
}

fn aes_decrypt_raw(data: &[u8], key: &[u8], iv: Option<[u8; 16]>, mode: &str) -> Option<Vec<u8>> {
    use aes::cipher::block_padding::Pkcs7;
    match (mode, iv) {
        (MODE_CBC_PKCS7, Some(iv)) => match key.len() {
            16 => cbc::Decryptor::<aes::Aes128>::new_from_slices(key, &iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            24 => cbc::Decryptor::<aes::Aes192>::new_from_slices(key, &iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            32 => cbc::Decryptor::<aes::Aes256>::new_from_slices(key, &iv).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            _ => None,
        },
        (MODE_ECB_NO_PADDING_NAME, None) => match key.len() {
            16 => ecb::Decryptor::<aes::Aes128>::new_from_slice(key).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            24 => ecb::Decryptor::<aes::Aes192>::new_from_slice(key).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            32 => ecb::Decryptor::<aes::Aes256>::new_from_slice(key).ok()?.decrypt_padded_vec_mut::<Pkcs7>(data).ok(),
            _ => None,
        },
        _ => None,
    }
}

/// 对齐 `AES.encrypt(String data, String key, String iv, String mode)`。
/// 输入均为 base64；iv 为空串时走无 IV 重载。返回 base64 密文。
pub fn aes_encrypt(data_b64: &str, key_b64: &str, iv_b64: &str, mode: &str) -> String {
    let (data, key) = match (b64_decode_lenient(data_b64), b64_decode_lenient(key_b64)) {
        (Some(d), Some(k)) => (d, k),
        _ => return String::new(),
    };
    let iv = if iv_b64.is_empty() { None } else { b64_decode_lenient(iv_b64).map(|v| norm_iv(&v)) };
    // iv 非空但解码失败：Java 侧 decode 宽松不会失败；防御性处理
    if iv_b64.is_empty() == false && iv.is_none() {
        return String::new();
    }
    match aes_encrypt_raw(&data, &key, iv, mode) {
        Some(c) => b64_encode(&c),
        None => String::new(),
    }
}

/// 对齐 `AES.decrypt(...)`。返回 UTF-8 明文字符串（对齐 `new String(bytes, UTF_8)`）。
pub fn aes_decrypt(data_b64: &str, key_b64: &str, iv_b64: &str, mode: &str) -> String {
    let (data, key) = match (b64_decode_lenient(data_b64), b64_decode_lenient(key_b64)) {
        (Some(d), Some(k)) => (d, k),
        _ => return String::new(),
    };
    let iv = if iv_b64.is_empty() { None } else { b64_decode_lenient(iv_b64).map(|v| norm_iv(&v)) };
    if !iv_b64.is_empty() && iv.is_none() {
        return String::new();
    }
    match aes_decrypt_raw(&data, &key, iv, mode) {
        Some(p) => String::from_utf8_lossy(&p).into_owned(),
        None => String::new(),
    }
}

// ---------- RSA ----------

fn parse_public_key(key_b64: &str) -> Option<RsaPublicKey> {
    use rsa::pkcs8::spki::DecodePublicKey;
    let der = b64_decode_lenient(key_b64.trim())?;
    RsaPublicKey::from_public_key_der(&der).ok()
}

fn parse_private_key(key_b64: &str) -> Option<RsaPrivateKey> {
    use rsa::pkcs8::DecodePrivateKey;
    let der = b64_decode_lenient(key_b64.trim())?;
    RsaPrivateKey::from_pkcs8_der(&der).ok()
}

fn key_size_bytes(key: &RsaPublicKey) -> usize {
    use rsa::traits::PublicKeyParts;
    key.size()
}

/// 对齐 `RSA.encryptRSAToString`：输入为 base64 原文，输出 base64 密文。
pub fn rsa_encrypt(data_b64: &str, public_key_b64: &str, padding: &str) -> String {
    let data = match b64_decode_lenient(data_b64) { Some(d) => d, None => return String::new() };
    let key = match parse_public_key(public_key_b64) { Some(k) => k, None => return String::new() };
    let out: Option<Vec<u8>> = match padding {
        PAD_OAEP_SHA1 => {
            let oaep = Oaep::new::<Sha1>();
            key.encrypt(&mut rand::thread_rng(), oaep, &data).ok()
        }
        PAD_NONE => {
            // raw RSA（RSAEP）：输入不得超过模长，高位自动补零
            let size = key_size_bytes(&key);
            if data.len() > size {
                None
            } else {
                let m = BigUint::from_bytes_be(&data);
                rsa::hazmat::rsa_encrypt(&key, &m)
                    .ok()
                    .map(|c| pad_left(&c.to_bytes_be(), size))
            }
        }
        _ => None,
    };
    match out {
        Some(c) => b64_encode(&c),
        None => String::new(),
    }
}

/// 对齐 `RSA.decryptRSAToString`：输入 base64 密文，输出明文字符串。
/// raw 模式返回整个模长块（含前导零），与 JCE `RSA/ECB/NoPadding` 一致。
pub fn rsa_decrypt(data_b64: &str, private_key_b64: &str, padding: &str) -> String {
    match rsa_decrypt_raw(data_b64, private_key_b64, padding) {
        Some(p) => String::from_utf8_lossy(&p).into_owned(),
        None => String::new(),
    }
}

/// 与 `rsa_decrypt` 相同，但返回原始字节，供需要字节级校验的场景使用。
pub fn rsa_decrypt_raw(data_b64: &str, private_key_b64: &str, padding: &str) -> Option<Vec<u8>> {
    let data = b64_decode_lenient(data_b64)?;
    let key = parse_private_key(private_key_b64)?;
    match padding {
        PAD_OAEP_SHA1 => {
            let oaep = Oaep::new::<Sha1>();
            key.decrypt(oaep, &data).ok()
        }
        PAD_NONE => {
            let c = BigUint::from_bytes_be(&data);
            rsa::hazmat::rsa_decrypt(None::<&mut rand::rngs::OsRng>, &key, &c)
                .ok()
                .map(|m| {
                    use rsa::traits::PublicKeyParts;
                    pad_left(&m.to_bytes_be(), key.size())
                })
        }
        _ => None,
    }
}

/// 对齐 `CryptoModule.generateRsaKey`：2048 位，公钥 SPKI / 私钥 PKCS#8，
/// base64 按 Android `Base64.DEFAULT` 习惯每 76 字符换行。
pub fn generate_rsa_key() -> Option<(String, String)> {
    let mut rng = rand::thread_rng();
    let priv_key = RsaPrivateKey::new(&mut rng, 2048).ok()?;
    let pub_key = priv_key.to_public_key();
    use rsa::pkcs8::spki::EncodePublicKey;
    use rsa::pkcs8::EncodePrivateKey;
    let spki = pub_key.to_public_key_der().ok()?;
    let pkcs8 = priv_key.to_pkcs8_der().ok()?;
    Some((b64_encode_wrapped(spki.as_bytes()), b64_encode_wrapped(pkcs8.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_decode_ignores_wrapping() {
        // 模拟 Android Base64.DEFAULT 的换行密钥：编码后按 10 字符插入 CRLF
        let raw: Vec<u8> = (0..40u8).collect();
        let encoded = b64_encode(&raw);
        let wrapped = encoded
            .as_bytes()
            .chunks(10)
            .map(|c| std::str::from_utf8(c).unwrap())
            .collect::<Vec<_>>()
            .join("\r\n");
        assert!(wrapped.contains("\r\n"));
        assert_eq!(b64_decode_lenient(&wrapped).unwrap(), raw);
    }

    #[test]
    fn aes_roundtrip_cbc() {
        let key = b64_encode(b"0123456789abcdef");
        let iv = b64_encode(b"abcdef9876543210");
        let data = b64_encode("洛雪".as_bytes());
        let c = aes_encrypt(&data, &key, &iv, MODE_CBC_PKCS7);
        assert!(!c.is_empty());
        assert_eq!(aes_decrypt(&c, &key, &iv, MODE_CBC_PKCS7), "洛雪");
    }

    #[test]
    fn ecb_mode_name_is_actually_pkcs7() {
        // 5 字节明文 → 16 字节密文，证明 ECB 路径带填充（JCE "AES" 的真实行为）
        let key = b64_encode(b"0123456789abcdef");
        let data = b64_encode(b"hello");
        let c = aes_encrypt(&data, &key, "", MODE_ECB_NO_PADDING_NAME);
        assert_eq!(b64_decode_lenient(&c).unwrap().len(), 16);
        // ECB 带 IV 应失败（对齐 JCE：ECB mode cannot use IV）
        assert_eq!(aes_encrypt(&data, &key, &b64_encode(b"abcdef9876543210"), MODE_ECB_NO_PADDING_NAME), "");
    }

    #[test]
    fn rsa_roundtrip_oaep() {
        let (pub_key, priv_key) = generate_rsa_key().unwrap();
        let data = b64_encode("同步密钥交换测试".as_bytes());
        let c = rsa_encrypt(&data, &pub_key, PAD_OAEP_SHA1);
        assert!(!c.is_empty());
        assert_eq!(rsa_decrypt(&c, &priv_key, PAD_OAEP_SHA1), "同步密钥交换测试");
    }
}
