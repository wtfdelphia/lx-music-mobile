import { describe, expect, it, vi } from 'vitest'
import { createDownloadPersist } from '@/core/download/persist'

const makeStorage = () => {
  const map = new Map<string, string>()
  return {
    store: map,
    getItem: vi.fn(async(key: string) => map.get(key) ?? null),
    setItem: vi.fn(async(key: string, value: string) => { map.set(key, value) }),
    removeItem: vi.fn(async(key: string) => { map.delete(key) }),
  }
}

const makeTask = (id: string, status: LX.Download.DownloadTaskStatus = 'waiting'): LX.Download.ListItem => ({
  id,
  isComplate: status === 'completed',
  status,
  statusText: 'test',
  downloaded: 1234,
  total: 9999,
  progress: 12.3,
  speed: '1MB/s',
  metadata: {
    musicInfo: {
      id: `music_${id}`,
      name: 'song',
      singer: 'artist',
      source: 'kw',
      interval: '04:00',
      meta: { qualitys: [], _qualitys: {}, albumName: '', picUrl: '', toggleMusicInfo: null },
    } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: '128k',
    ext: 'mp3',
    fileName: `${id}.mp3`,
    filePath: `Download/${id}.mp3`,
    listId: 'test-list',
  },
})

describe('download persist', () => {
  it('save + flush + load 回环', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    const tasks = [makeTask('a'), makeTask('b')]
    persist.save(tasks)
    await persist.flush()
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('进度类内存字段不落盘，读取后归零', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    persist.save([makeTask('a', 'run')])
    await persist.flush()
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded[0].downloaded).toBe(0)
    expect(loaded[0].total).toBe(0)
    expect(loaded[0].progress).toBe(0)
    expect(loaded[0].speed).toBe('')
    expect(loaded[0].status).toBe('run')
  })

  it('无数据时 load 返回空列表', async() => {
    const persist = createDownloadPersist(makeStorage())
    expect(await persist.load()).toEqual([])
  })

  it('meta 损坏时返回空列表', async() => {
    const storage = makeStorage()
    storage.store.set('@download_list__meta', '{invalid json')
    const persist = createDownloadPersist(storage)
    expect(await persist.load()).toEqual([])
  })

  it('分片：超过 100 条任务分多片存储且按 meta 顺序恢复', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    const tasks = Array.from({ length: 250 }, (_, i) => makeTask(`t${i}`))
    persist.save(tasks)
    await persist.flush()
    // meta + 3 个分片
    expect(storage.store.has('@download_list__meta')).toBe(true)
    expect(storage.store.has('@download_list__0')).toBe(true)
    expect(storage.store.has('@download_list__1')).toBe(true)
    expect(storage.store.has('@download_list__2')).toBe(true)
    expect(storage.store.has('@download_list__3')).toBe(false)
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.length).toBe(250)
    expect(loaded[0].id).toBe('t0')
    expect(loaded[249].id).toBe('t249')
  })

  it('任务变少时清理多余分片', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    persist.save(Array.from({ length: 150 }, (_, i) => makeTask(`t${i}`)))
    await persist.flush()
    expect(storage.store.has('@download_list__1')).toBe(true)
    persist.save([makeTask('only')])
    await persist.flush()
    expect(storage.store.has('@download_list__0')).toBe(true)
    expect(storage.store.has('@download_list__1')).toBe(false)
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.length).toBe(1)
  })

  it('并发 flush 串行执行，不交错写入（H2）', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    persist.save([makeTask('a')])
    // 两个并发 flush：第二个必须等第一个完成再写，不会交错
    const p1 = persist.flush()
    const p2 = persist.flush()
    await Promise.all([p1, p2])
    // flush 期间新数据到达，应被补写
    persist.save([makeTask('a'), makeTask('b')])
    const p3 = persist.flush()
    const p4 = persist.flush()
    await Promise.all([p3, p4])
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('写入失败时保留待写数据，下次可重试（H4）', async() => {
    const storage = makeStorage()
    let failOnce = true
    const failSetItem = storage.setItem
    storage.setItem = vi.fn(async(key: string, value: string) => {
      if (failOnce && key.endsWith('meta')) {
        failOnce = false
        throw new Error('storage full')
      }
      return failSetItem(key, value)
    })
    const persist = createDownloadPersist(storage)
    persist.save([makeTask('a')])
    await expect(persist.flush()).rejects.toThrow('storage full')
    // 失败后数据仍在，重试成功
    await persist.flush()
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.map(t => t.id)).toEqual(['a'])
  })

  it('load 按 meta 顺序恢复，忽略孤儿记录', async() => {
    const storage = makeStorage()
    const persist = createDownloadPersist(storage)
    persist.save([makeTask('x'), makeTask('y'), makeTask('z')])
    await persist.flush()
    // 手工破坏：往分片塞一个 meta 里没有的任务
    const shard = JSON.parse(storage.store.get('@download_list__0')!)
    shard.push({
      id: 'orphan', isComplate: false, status: 'waiting', statusText: '',
      metadata: { musicInfo: null, url: null, quality: '128k', ext: 'mp3', fileName: '', filePath: '' },
    })
    storage.store.set('@download_list__0', JSON.stringify(shard))
    const loaded = await createDownloadPersist(storage).load()
    expect(loaded.map(t => t.id)).toEqual(['x', 'y', 'z'])
  })
})
