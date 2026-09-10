//! 黄金基准回归：与 Android（JDK 引导版）逐字节对齐。
//! 基准来源：`test/crypto-golden-vectors.json`（生成：`bash test/golden/gen.sh`）。
//! 发布前基准必须替换为 Android 真机产出（见桥计划停止条件 3）。

use lxcore_crypto::{
    aes_decrypt, aes_encrypt, rsa_decrypt_raw, rsa_encrypt, MODE_CBC_PKCS7, MODE_ECB_NO_PADDING_NAME,
    PAD_NONE, PAD_OAEP_SHA1,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    aes: Vec<AesCase>,
    rsa: RsaSection,
}

#[derive(Deserialize)]
struct AesCase {
    name: String,
    mode: String,
    #[serde(rename = "dataB64")]
    data_b64: String,
    #[serde(rename = "keyB64")]
    key_b64: String,
    #[serde(rename = "ivB64")]
    iv_b64: String,
    #[serde(rename = "expectCipherB64")]
    expect_cipher_b64: String,
    #[serde(rename = "expectPlainUtf8")]
    expect_plain_utf8: String,
}

#[derive(Deserialize)]
struct RsaSection {
    #[serde(rename = "publicKeyB64")]
    public_key_b64: String,
    #[serde(rename = "privateKeyB64")]
    private_key_b64: String,
    cases: Vec<RsaCase>,
}

#[derive(Deserialize)]
struct RsaCase {
    name: String,
    padding: String,
    #[serde(rename = "dataB64")]
    data_b64: String,
    #[serde(rename = "cipherB64")]
    cipher_b64: String,
    #[serde(rename = "plainB64")]
    plain_b64: String,
}

fn load_vectors() -> Vectors {
    let path = format!(
        "{}/../../../test/crypto-golden-vectors.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读取黄金基准失败 {path}：{e}（先运行 bash test/golden/gen.sh）"));
    serde_json::from_str(&content).expect("黄金基准 JSON 解析失败")
}

fn b64_decode(s: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .unwrap_or_else(|e| panic!("基准内 base64 无效：{e}"))
}

#[test]
fn aes_encrypt_matches_golden_vectors() {
    for case in &load_vectors().aes {
        let got = aes_encrypt(&case.data_b64, &case.key_b64, &case.iv_b64, &case.mode);
        assert_eq!(got, case.expect_cipher_b64, "AES 加密不一致: {}", case.name);
    }
}

#[test]
fn aes_decrypt_matches_golden_vectors() {
    for case in &load_vectors().aes {
        let got = aes_decrypt(&case.expect_cipher_b64, &case.key_b64, &case.iv_b64, &case.mode);
        assert_eq!(got, case.expect_plain_utf8, "AES 解密不一致: {}", case.name);
    }
}

#[test]
fn rsa_decrypt_matches_golden_vectors() {
    let v = load_vectors();
    for case in &v.rsa.cases {
        let got = rsa_decrypt_raw(&case.cipher_b64, &v.rsa.private_key_b64, &case.padding)
            .unwrap_or_else(|| panic!("RSA 解密失败: {}", case.name));
        assert_eq!(got, b64_decode(&case.plain_b64), "RSA 解密不一致: {}", case.name);
    }
}

#[test]
fn rsa_encrypt_matches_golden_vectors() {
    let v = load_vectors();
    for case in &v.rsa.cases {
        match case.padding.as_str() {
            // raw RSA 确定性强校验；OAEP 密文随机，只做自往返
            PAD_NONE => {
                let got = rsa_encrypt(&case.data_b64, &v.rsa.public_key_b64, PAD_NONE);
                assert_eq!(got, case.cipher_b64, "RSA raw 加密不一致: {}", case.name);
            }
            PAD_OAEP_SHA1 => {
                let got = rsa_encrypt(&case.data_b64, &v.rsa.public_key_b64, PAD_OAEP_SHA1);
                assert!(!got.is_empty(), "OAEP 加密失败: {}", case.name);
                let back = rsa_decrypt_raw(&got, &v.rsa.private_key_b64, PAD_OAEP_SHA1).unwrap();
                assert_eq!(back, b64_decode(&case.data_b64), "OAEP 往返不一致: {}", case.name);
            }
            other => panic!("未知 padding: {other}"),
        }
    }
}

#[test]
fn wrapped_keys_are_accepted() {
    // 基准中的密钥是 Android Base64.DEFAULT 产物（含 CRLF 换行），必须被宽松接受
    let v = load_vectors();
    assert!(v.rsa.public_key_b64.contains("\r\n"), "基准公钥应含换行");
    let data = "aGVsbG8="; // "hello"
    assert!(!rsa_encrypt(data, &v.rsa.public_key_b64, PAD_OAEP_SHA1).is_empty());
}

#[test]
fn mode_name_constants_match_js() {
    // 与 src/utils/nativeModules/crypto.ts 的枚举值保持一致
    assert_eq!(MODE_CBC_PKCS7, "AES/CBC/PKCS7Padding");
    assert_eq!(MODE_ECB_NO_PADDING_NAME, "AES");
    assert_eq!(PAD_OAEP_SHA1, "RSA/ECB/OAEPWithSHA1AndMGF1Padding");
    assert_eq!(PAD_NONE, "RSA/ECB/NoPadding");
}
