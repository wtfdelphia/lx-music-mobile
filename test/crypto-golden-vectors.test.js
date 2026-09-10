import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 黄金基准文件完整性检查。
// 字节级回归的主体在 rust/lxcore（cargo test）；此处保证基准文件本身可信。
const vectors = JSON.parse(readFileSync(new URL('./crypto-golden-vectors.json', import.meta.url), 'utf8'))

const b64 = (s) => Buffer.from(s, 'base64')

describe('crypto-golden-vectors.json', () => {
  it('meta 标注了基准来源', () => {
    expect(['jdk8-bootstrap', 'android-device']).toContain(vectors.meta.source)
  })

  it('AES 用例完整且密文长度为块对齐', () => {
    expect(vectors.aes.length).toBeGreaterThanOrEqual(10)
    for (const c of vectors.aes) {
      expect(c.expectCipherB64, c.name).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(b64(c.expectCipherB64).length % 16, c.name).toBe(0)
      expect(b64(c.keyB64).length, c.name).toBe(16)
      if (c.mode === 'AES') expect(c.ivB64, `${c.name}: ECB 必须走空 IV 重载`).toBe('')
    }
  })

  it('AES 覆盖 padding 关键场景', () => {
    const names = vectors.aes.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'ecb_noiv_p1_5b', // 非 16 字节对齐明文：唯一能暴露 ECB padding 差异的用例
      'cbc_iv8_zeropad_p1',
      'cbc_iv24_truncate_p1',
    ]))
  })

  it('RSA 用例覆盖两种 padding', () => {
    const paddings = new Set(vectors.rsa.cases.map(c => c.padding))
    expect(paddings.has('RSA/ECB/OAEPWithSHA1AndMGF1Padding')).toBe(true)
    expect(paddings.has('RSA/ECB/NoPadding')).toBe(true)
    // 密钥为 Android Base64.DEFAULT 产物（含换行），验证宽松解码路径
    expect(vectors.rsa.publicKeyB64).toMatch(/\r?\n/)
  })
})
