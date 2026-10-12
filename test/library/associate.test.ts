import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 已下载曲目自动关联（§11）：过滤规则、多音质去重、映射键。
 * 差量对账依赖原生模块，纯算法部分在此覆盖
 */

const mockNative = vi.hoisted(() => ({
  getSources: vi.fn(async() => [] as Array<{ id: string }>),
  saveSource: vi.fn(async() => {}),
  query: vi.fn(async() => ({ rows: [], total: 0 })),
  upsertTracks: vi.fn(async() => {}),
  deleteTrack: vi.fn(async() => {}),
  finishSync: vi.fn(async() => {}),
}))

const mockSetting = vi.hoisted(() => ({
  setting: {
    'library.enable': true,
    'library.autoAssociateDownloads': true,
  } as Record<string, unknown>,
}))

const mockDownload = vi.hoisted(() => ({
  tasks: [] as LX.Download.ListItem[],
}))

vi.mock('@/core/library/native', () => mockNative)
vi.mock('@/store/setting/state', () => ({ default: mockSetting }))
vi.mock('@/store/download/action', () => ({
  getDownloadList: () => mockDownload.tasks,
}))
vi.mock('@/store/library/state', () => ({ default: { sources: [] } }))

import {
  isAssociable,
  pickBestByMusicId,
  buildTrackRow,
  DOWNLOAD_SOURCE_ID,
} from '@/core/library/associate'

const makeTask = (overrides: Partial<LX.Download.ListItem> & { musicId?: string, quality?: LX.Quality, filePath?: string, kind?: 'online' | 'library', errorCode?: LX.Download.DownloadErrorCode } = {}): LX.Download.ListItem => {
  const { musicId = 'song_1', quality = '128k', filePath = 'Download/a.mp3', kind, errorCode, ...rest } = overrides
  const metadata: LX.Download.ListItem['metadata'] = {
    musicInfo: {
      id: musicId,
      name: '晴天',
      singer: '周杰伦',
      source: 'kw',
      interval: '04:29',
      meta: { songId: musicId, albumName: '叶惠美', qualitys: [], _qualitys: {} },
    } as LX.Music.MusicInfoOnline,
    url: null,
    quality,
    ext: 'mp3',
    fileName: '晴天 - 周杰伦.mp3',
    filePath,
  }
  if (kind) (metadata as Record<string, unknown>).kind = kind
  return {
    id: `${musicId}_${quality}_mp3`,
    isComplate: true,
    status: 'completed',
    statusText: '',
    downloaded: 100,
    total: 100,
    progress: 100,
    speed: '',
    metadata,
    ...(errorCode ? { errorCode } : {}),
    ...rest,
  } as LX.Download.ListItem
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDownload.tasks = []
  mockSetting.setting['library.enable'] = true
  mockSetting.setting['library.autoAssociateDownloads'] = true
})

describe('isAssociable', () => {
  it('accepts a completed online task with a file path', () => {
    expect(isAssociable(makeTask())).toBe(true)
  })

  it('rejects non-completed tasks', () => {
    expect(isAssociable(makeTask({ status: 'run' }))).toBe(false)
    expect(isAssociable(makeTask({ isComplate: false }))).toBe(false)
  })

  it('rejects tasks without a file path', () => {
    expect(isAssociable(makeTask({ filePath: '' }))).toBe(false)
  })

  it('rejects FILE_MISSING tasks', () => {
    expect(isAssociable(makeTask({ errorCode: 'FILE_MISSING' }))).toBe(false)
  })

  it('rejects kind:library tasks (§11.3)', () => {
    expect(isAssociable(makeTask({ kind: 'library' }))).toBe(false)
  })

  it('accepts kind:online tasks', () => {
    expect(isAssociable(makeTask({ kind: 'online' }))).toBe(true)
  })
})

describe('pickBestByMusicId', () => {
  it('keeps the highest quality per music id', () => {
    const tasks = [makeTask({ quality: '128k' }), makeTask({ quality: 'flac' }), makeTask({ quality: '320k' })]
    const best = pickBestByMusicId(tasks)
    expect(best).toHaveLength(1)
    expect(best[0].metadata.quality).toBe('flac')
  })

  it('keeps distinct songs', () => {
    const tasks = [makeTask({ musicId: 's1', quality: '128k' }), makeTask({ musicId: 's2', quality: '128k' })]
    expect(pickBestByMusicId(tasks)).toHaveLength(2)
  })

  it('uses qualityRank ordering', () => {
    const tasks = [makeTask({ quality: 'flac24bit' }), makeTask({ quality: 'flac' })]
    expect(pickBestByMusicId(tasks)[0].metadata.quality).toBe('flac24bit')
  })
})

describe('buildTrackRow', () => {
  it('maps item_key to the download filePath (§11.2)', () => {
    const row = buildTrackRow(makeTask({ filePath: 'Download/周杰伦/晴天.mp3' }))
    expect(row).not.toBeNull()
    expect(row!.item_key).toBe('Download/周杰伦/晴天.mp3')
    expect(row!.locator).toContain(DOWNLOAD_SOURCE_ID)
    expect(row!.title).toBe('晴天')
  })

  it('returns null without a file path', () => {
    expect(buildTrackRow(makeTask({ filePath: '' }))).toBeNull()
  })
})
