import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * downloadIndex：双 id 索引、最高音质保留、lookupLocal（§5.2、§9）
 */

const existingPaths = new Set<string>()

vi.mock('@/utils/fs', () => ({
  stat: vi.fn(async(path: string) => {
    if (!existingPaths.has(path)) throw new Error('ENOENT')
    return { size: 1000 }
  }),
  // path.ts 依赖的 Documents 根
  privateStorageDirectoryPath: '/mock/Documents',
}))

import { addToIndex, lookupLocal, rebuildIndex, removeFromIndex } from '@/core/download/downloadIndex'

const makeTask = (overrides: {
  id?: string
  musicId?: string
  toggleId?: string | null
  quality?: LX.Quality
  relPath?: string
  completed?: boolean
} = {}): LX.Download.ListItem => ({
  id: overrides.id ?? 'task1',
  isComplate: overrides.completed !== false,
  status: overrides.completed !== false ? 'completed' : 'run',
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo: {
      id: overrides.musicId ?? 'music1',
      name: 'song',
      singer: 'artist',
      source: 'kw',
      interval: '04:00',
      meta: {
        qualitys: [],
        _qualitys: { '128k': { size: '3M' } },
        albumName: '',
        picUrl: '',
        toggleMusicInfo: overrides.toggleId
          ? { id: overrides.toggleId, name: 'toggled', singer: 'artist', source: 'wy', interval: '04:00', meta: {} } as unknown as LX.Music.MusicInfoOnline
          : null,
      },
    } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: overrides.quality ?? '128k',
    ext: 'mp3',
    fileName: 'song.mp3',
    filePath: overrides.relPath ?? 'Download/song.mp3',
  },
})

const musicOf = (task: LX.Download.ListItem) => task.metadata.musicInfo

beforeEach(async() => {
  existingPaths.clear()
  await rebuildIndex([])
})

describe('rebuildIndex / lookupLocal', () => {
  it('原 id 命中返回绝对路径', async() => {
    existingPaths.add('/mock/Documents/Download/song.mp3')
    await rebuildIndex([makeTask({ relPath: 'Download/song.mp3' })])
    const path = await lookupLocal(musicOf(makeTask()))
    expect(path).toContain('Download/song.mp3')
  })

  it('文件不存在时不命中', async() => {
    await rebuildIndex([makeTask()])
    const path = await lookupLocal(musicOf(makeTask()))
    expect(path).toBe('')
  })

  it('切源 id 也能命中（双索引）', async() => {
    existingPaths.add('/mock/Documents/Download/song.mp3')
    const task = makeTask({ musicId: 'orig', toggleId: 'toggle1', relPath: 'Download/song.mp3' })
    await rebuildIndex([task])
    // 用切源后的 musicInfo（id 为 toggle1）查询
    const toggledMusic = { id: 'toggle1', meta: {} } as unknown as LX.Music.MusicInfoOnline
    const path = await lookupLocal(toggledMusic)
    expect(path).toContain('Download/song.mp3')
  })

  it('未完成任务不进索引', async() => {
    existingPaths.add('/mock/Documents/Download/song.mp3')
    await rebuildIndex([makeTask({ completed: false })])
    const path = await lookupLocal(musicOf(makeTask()))
    expect(path).toBe('')
  })

  it('同歌多份保留最高音质', async() => {
    existingPaths.add('/mock/Documents/Download/song.mp3')
    existingPaths.add('/mock/Documents/Download/song.flac')
    await rebuildIndex([
      makeTask({ id: 't1', quality: '128k', relPath: 'Download/song.mp3' }),
      makeTask({ id: 't2', quality: 'flac', relPath: 'Download/song.flac' }),
    ])
    const path = await lookupLocal(musicOf(makeTask()))
    expect(path).toContain('song.flac')
  })
})

describe('addToIndex / removeFromIndex', () => {
  it('增量加入后可命中', async() => {
    existingPaths.add('/mock/Documents/Download/new.mp3')
    addToIndex(makeTask({ relPath: 'Download/new.mp3' }))
    const path = await lookupLocal(musicOf(makeTask()))
    expect(path).toContain('Download/new.mp3')
  })

  it('移除后不再命中', async() => {
    existingPaths.add('/mock/Documents/Download/new.mp3')
    const task = makeTask({ toggleId: 'toggle9', relPath: 'Download/new.mp3' })
    addToIndex(task)
    removeFromIndex(musicOf(task))
    const path = await lookupLocal(musicOf(task))
    expect(path).toBe('')
    // 切源 id 同步移除
    const toggled = { id: 'toggle9', meta: {} } as unknown as LX.Music.MusicInfoOnline
    expect(await lookupLocal(toggled)).toBe('')
  })
})
