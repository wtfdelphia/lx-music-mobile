import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { NativeTrackRow } from '@/core/library/types'

const mockNative = vi.hoisted(() => ({
  resolvePlayFileUrl: vi.fn<(locator: string) => Promise<string>>(),
  getTrack: vi.fn<(locator: string) => Promise<NativeTrackRow | null>>(),
  artworkPath: vi.fn<(locator: string) => Promise<string>>(),
  readLyric: vi.fn<(locator: string) => Promise<{ lyric: string, source: 'embedded' | 'sidecar' } | null>>(),
}))

vi.mock('@/core/library/native', () => mockNative)

import { resolvePlayUrl, resolvePicUrl, resolveLyric } from '@/core/library/resolver'

const SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const LOC = `lxlib://${SID}/Music%2Fa.mp3`

const row = (over: Partial<NativeTrackRow> = {}): NativeTrackRow => ({
  locator: LOC,
  sourceId: SID,
  sourceType: 'local',
  itemKey: 'Music/a.mp3',
  albumKey: '',
  artistKey: '周杰伦',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  albumArtist: null,
  durationMs: 269000,
  ext: 'mp3',
  artwork: 'ab.jpg',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePlayUrl', () => {
  it('rejects unparseable locators without touching native', async() => {
    expect(await resolvePlayUrl('file:///tmp/a.mp3')).toBe('')
    expect(mockNative.resolvePlayFileUrl).not.toHaveBeenCalled()
  })

  it('returns the native file url', async() => {
    mockNative.resolvePlayFileUrl.mockResolvedValueOnce('file:///var/Music/a.mp3')
    expect(await resolvePlayUrl(LOC)).toBe('file:///var/Music/a.mp3')
  })

  it('downgrades native failure to empty string (online fallback)', async() => {
    mockNative.resolvePlayFileUrl.mockRejectedValueOnce(new Error('module gone'))
    expect(await resolvePlayUrl(LOC)).toBe('')
  })
})

describe('resolvePicUrl', () => {
  it('returns file url for local rows with artwork', async() => {
    mockNative.getTrack.mockResolvedValueOnce(row())
    mockNative.artworkPath.mockResolvedValueOnce('/cache/lx-library/artwork/ab.jpg')
    expect(await resolvePicUrl(LOC)).toBe('file:///cache/lx-library/artwork/ab.jpg')
  })

  it('returns null when artworkPath is empty', async() => {
    mockNative.getTrack.mockResolvedValueOnce(row())
    mockNative.artworkPath.mockResolvedValueOnce('')
    expect(await resolvePicUrl(LOC)).toBeNull()
  })

  it('skips remote rows in P1', async() => {
    mockNative.getTrack.mockResolvedValueOnce(row({ sourceType: 'subsonic' }))
    expect(await resolvePicUrl(LOC)).toBeNull()
    expect(mockNative.artworkPath).not.toHaveBeenCalled()
  })

  it('returns null on native failure', async() => {
    mockNative.getTrack.mockRejectedValueOnce(new Error('x'))
    expect(await resolvePicUrl(LOC)).toBeNull()
  })
})

describe('resolveLyric', () => {
  it('returns embedded lyric text', async() => {
    mockNative.readLyric.mockResolvedValueOnce({ lyric: '[00:00]hi', source: 'embedded' })
    expect(await resolveLyric(LOC)).toBe('[00:00]hi')
  })

  it('returns null on empty lyric or failure', async() => {
    mockNative.readLyric.mockResolvedValueOnce({ lyric: '', source: 'sidecar' })
    expect(await resolveLyric(LOC)).toBeNull()
    mockNative.readLyric.mockRejectedValueOnce(new Error('x'))
    expect(await resolveLyric(LOC)).toBeNull()
  })
})
