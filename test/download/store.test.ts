import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * store/download/action：冷启动状态重置与增删（§7.8）。
 * plugins/storage 用内存 Map 模拟；global.app_event 打桩
 */
const mem = new Map<string, unknown>()

vi.mock('@/plugins/storage', () => ({
  getData: async(key: string) => mem.get(key) ?? null,
  saveData: async(key: string, value: unknown) => { mem.set(key, value) },
  removeData: async(key: string) => { mem.delete(key) },
}))

const makeTask = (id: string, status: LX.Download.DownloadTaskStatus): LX.Download.ListItem => ({
  id,
  isComplate: status === 'completed',
  status,
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo: {
      id: `music_${id}`,
      name: 'song',
      singer: 'artist',
      source: 'kw',
      interval: '04:00',
      meta: { qualitys: [], _qualitys: { '128k': { size: '3M' } }, albumName: '', picUrl: '', toggleMusicInfo: null },
    } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: '128k',
    ext: 'mp3',
    fileName: `${id}.mp3`,
    filePath: `Download/${id}.mp3`,
  },
})

const loadAction = async() => {
  vi.resetModules()
  vi.doMock('@/plugins/storage', () => ({
    getData: async(key: string) => mem.get(key) ?? null,
    saveData: async(key: string, value: unknown) => { mem.set(key, value) },
    removeData: async(key: string) => { mem.delete(key) },
  }))
  return import('@/store/download/action')
}

beforeEach(() => {
  mem.clear()
  global.app_event = { downloadListUpdate: vi.fn() } as never
})

describe('store/download 冷启动', () => {
  it('run / waiting 一律重置为 pause（§7.8）', async() => {
    // 预置持久化数据：三条不同状态
    const { createDownloadPersist } = await import('@/core/download/persist')
    const persist = createDownloadPersist({
      getItem: async(key) => {
        const v = mem.get(key)
        return v == null ? null : JSON.stringify(v)
      },
      setItem: async(key, value) => { mem.set(key, JSON.parse(value as string)) },
      removeItem: async(key) => { mem.delete(key) },
    })
    persist.save([makeTask('a', 'run'), makeTask('b', 'waiting'), makeTask('c', 'completed')])
    await persist.flush()

    const action = await loadAction()
    await action.initDownloadList()
    const list = action.getDownloadList()
    expect(list.map(t => t.status)).toEqual(['pause', 'pause', 'completed'])
    expect(global.app_event.downloadListUpdate).toHaveBeenCalled()
  })

  it('无数据时初始化为空列表', async() => {
    const action = await loadAction()
    await action.initDownloadList()
    expect(action.getDownloadList()).toEqual([])
  })

  it('addDownloadTasks 按 top/bottom 插入并触发事件', async() => {
    const action = await loadAction()
    await action.initDownloadList()
    action.addDownloadTasks([makeTask('a', 'waiting')], 'bottom')
    action.addDownloadTasks([makeTask('b', 'waiting')], 'top')
    expect(action.getDownloadList().map(t => t.id)).toEqual(['b', 'a'])
  })

  it('removeDownloadTasks 与 clearDownloadList', async() => {
    const action = await loadAction()
    await action.initDownloadList()
    action.addDownloadTasks([makeTask('a', 'waiting'), makeTask('b', 'waiting')], 'bottom')
    action.removeDownloadTasks(['a'])
    expect(action.getDownloadList().map(t => t.id)).toEqual(['b'])
    action.clearDownloadList()
    expect(action.getDownloadList()).toEqual([])
  })
})
