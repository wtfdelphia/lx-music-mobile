import { describe, expect, it, vi, beforeEach } from 'vitest'

const existing = new Set<string>()

vi.mock('@/utils/fs', () => ({
  existsFile: vi.fn(async(path: string) => existing.has(path)),
  privateStorageDirectoryPath: '/container/NEW/Documents',
}))

const mockResolver = vi.hoisted(() => ({
  resolvePlayUrl: vi.fn<(locator: string) => Promise<string>>(),
}))
vi.mock('@/core/library/resolver', () => mockResolver)

import { getLocalFilePath } from '@/utils/music.ios'

const info = (filePath: string): LX.Music.MusicInfoLocal => ({
  id: filePath,
  name: 't',
  singer: '',
  source: 'local',
  interval: null,
  meta: { songId: filePath, albumName: '', filePath, ext: 'mp3' },
})

beforeEach(() => {
  existing.clear()
  vi.clearAllMocks()
})

describe('getLocalFilePath (ios)', () => {
  it('routes lxlib locators to the library resolver', async() => {
    mockResolver.resolvePlayUrl.mockResolvedValueOnce('file:///var/a.mp3')
    const locator = 'lxlib://a1b2c3d4e5f60718293a4b5c6d7e8f90/a.mp3'
    expect(await getLocalFilePath(info(locator))).toBe('file:///var/a.mp3')
  })

  it('returns the path itself when the file exists', async() => {
    existing.add('/container/NEW/Documents/a.mp3')
    expect(await getLocalFilePath(info('/container/NEW/Documents/a.mp3')))
      .toBe('/container/NEW/Documents/a.mp3')
  })

  it('rebases a legacy container path after resign', async() => {
    // 旧容器下的绝对路径，文件已在新容器
    existing.add('/container/NEW/Documents/Music/a.mp3')
    const legacy = '/container/OLD-UUID/Documents/Music/a.mp3'
    expect(await getLocalFilePath(info(legacy))).toBe('/container/NEW/Documents/Music/a.mp3')
  })

  it('returns empty when rebased target is also missing', async() => {
    const legacy = '/container/OLD-UUID/Documents/Music/gone.mp3'
    expect(await getLocalFilePath(info(legacy))).toBe('')
  })

  it('keeps the numeric-suffix intent path branch', async() => {
    expect(await getLocalFilePath(info('/some/intent/123456'))).toBe('/some/intent/123456')
  })
})
