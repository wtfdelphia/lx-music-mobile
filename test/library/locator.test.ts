import { describe, expect, it } from 'vitest'
import { buildItemKey, buildLocator, isLibraryLocator, parseLocator } from '@/core/library/locator'

const SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('locator', () => {
  it('round-trips a local relative path', () => {
    const key = buildItemKey(['Music', '周杰伦', '晴天 - 01 晴天.mp3'])
    const locator = buildLocator(SID, key)
    expect(isLibraryLocator(locator)).toBe(true)
    expect(parseLocator(locator)).toEqual({
      sourceId: SID,
      itemKey: 'Music/周杰伦/晴天 - 01 晴天.mp3',
    })
  })

  it('round-trips a remote single-segment key', () => {
    const locator = buildLocator(SID, buildItemKey(['track:1234']))
    expect(parseLocator(locator)?.itemKey).toBe('track:1234')
  })

  it('normalizes NFC so equivalent forms parse to the same itemKey', () => {
    // é as e + combining acute (NFD) vs precomposed (NFC)
    const nfd = '\u0065\u0301tude.mp3'
    const nfc = '\u00e9tude.mp3'
    const a = parseLocator(buildLocator(SID, buildItemKey([nfd])))
    const b = parseLocator(buildLocator(SID, buildItemKey([nfc])))
    expect(a?.itemKey).toBe(b?.itemKey)
  })

  it('percent-encodes reserved characters segment by segment', () => {
    const key = buildItemKey(['a/b', 'c?d#e'])
    expect(key).not.toContain('?')
    expect(key).not.toContain('#')
    // slash inside a segment is encoded, so it stays one segment
    expect(parseLocator(buildLocator(SID, key))?.itemKey).toBe('a/b/c?d#e')
  })

  it('rejects dot and dot-dot segments at build time', () => {
    expect(() => buildItemKey(['..'])).toThrow()
    expect(() => buildItemKey(['.'])).toThrow()
    expect(() => buildItemKey(['a', '..', 'b'])).toThrow()
    expect(() => buildItemKey([''])).toThrow()
    expect(() => buildItemKey([])).toThrow()
  })

  it('rejects an invalid sourceId', () => {
    expect(() => buildLocator('short', 'x')).toThrow()
    expect(() => buildLocator('ZZ'.repeat(16), 'x')).toThrow()
  })

  it('returns null for malformed input', () => {
    expect(parseLocator('file:///tmp/a.mp3')).toBeNull()
    expect(parseLocator('lxlib://')).toBeNull()
    expect(parseLocator(`lxlib://${SID}`)).toBeNull() // no slash
    expect(parseLocator(`lxlib://${SID}/`)).toBeNull() // empty key
    expect(parseLocator(`lxlib://bad/${buildItemKey(['x'])}`)).toBeNull()
  })

  it('returns null for traversal that survives decoding', () => {
    // encode ".." then stitch it in raw so parse-time must catch it
    expect(parseLocator(`lxlib://${SID}/%2E%2E`)).toBeNull()
    expect(parseLocator(`lxlib://${SID}/a%2F..%2Fb`)).toBeNull()
  })

  it('returns null on broken percent-encoding', () => {
    expect(parseLocator(`lxlib://${SID}/%E4%B8`)).toBeNull()
  })
})
