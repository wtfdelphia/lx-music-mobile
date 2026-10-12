import { storageDataPrefix } from '@/config/constant'

/**
 * 存储接口。生产环境传 AsyncStorage（`src/plugins/storage` 的导出面），
 * 测试传内存实现，模块本身不依赖 RN
 */
export interface DownloadStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

const SHARD_SIZE = 100
const META_VERSION = 1
const WRITE_THROTTLE_MS = 100

const metaKey = storageDataPrefix.downloadList + 'meta'
const shardKey = (n: number) => storageDataPrefix.downloadList + n

interface MetaInfo {
  ids: string[]
  version: number
}

/**
 * 只持久化稳定字段；进度、速度、错误码等内存字段不落盘（§5.3）。
 * 恢复时内存字段按初始值重建
 */
const toPersisted = (task: LX.Download.ListItem) => ({
  id: task.id,
  isComplate: task.isComplate,
  status: task.status,
  statusText: task.statusText,
  metadata: task.metadata,
})

const fromPersisted = (raw: ReturnType<typeof toPersisted>): LX.Download.ListItem => ({
  id: raw.id,
  isComplate: raw.isComplate,
  status: raw.status,
  statusText: raw.statusText,
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: raw.metadata,
})

const splitShards = <T>(list: T[]): T[][] => {
  const shards: T[][] = []
  for (let i = 0; i < list.length; i += SHARD_SIZE) shards.push(list.slice(i, i + SHARD_SIZE))
  if (!shards.length) shards.push([])
  return shards
}

/**
 * 任务列表持久化：`@download_list__meta` 保序，数据每 100 条一片。
 * 状态变化调 `save`（100ms 合并），关键状态（完成/错误确认后）
 * 必须 `await flush()` 再 ack 原生事件（§4.6）
 */
export const createDownloadPersist = (storage: DownloadStorage) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: LX.Download.ListItem[] | null = null
  let flushing: Promise<void> | null = null

  const writeAll = async(tasks: LX.Download.ListItem[]) => {
    const shards = splitShards(tasks.map(toPersisted))
    const keys = shards.map((_, i) => shardKey(i))
    await storage.setItem(metaKey, JSON.stringify({
      ids: tasks.map(t => t.id),
      version: META_VERSION,
    } satisfies MetaInfo))
    for (let i = 0; i < shards.length; i++) {
      await storage.setItem(keys[i], JSON.stringify(shards[i]))
    }
    // 清理旧写入留下的多余分片（任务变少时）
    let extraIdx = shards.length
    for (;;) {
      const key = shardKey(extraIdx)
      if (!(await storage.getItem(key))) break
      await storage.removeItem(key)
      extraIdx++
    }
  }

  const doFlush = async() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const current = pending
    if (!current) return
    await writeAll(current)
    // 写成功后才清；只清本次写入的快照，写入期间新到的数据留给下次
    if (pending === current) pending = null
  }

  /**
   * 单飞：并发调用返回同一个写入；写入期间到达的新数据在
   * finally 里补一次写入，保证串行且不丢（§4.6）
   */
  const startFlush = async(): Promise<void> => {
    if (flushing) return flushing
    if (!pending) return
    flushing = doFlush().finally(() => {
      flushing = null
      if (pending != null) void startFlush()
    })
    return flushing
  }

  return {
    /**
     * 读取全部任务；无数据时返回空列表。
     * 冷启动的状态重置（run/waiting → pause）由调用方处理（§7.8）
     */
    load: async(): Promise<LX.Download.ListItem[]> => {
      const rawMeta = await storage.getItem(metaKey)
      if (!rawMeta) return []
      let meta: MetaInfo
      try {
        meta = JSON.parse(rawMeta) as MetaInfo
      } catch {
        return []
      }
      if (meta.version !== META_VERSION || !Array.isArray(meta.ids)) return []
      const tasks: LX.Download.ListItem[] = []
      const byId = new Map<string, ReturnType<typeof toPersisted>>()
      for (let i = 0; ; i++) {
        const rawShard = await storage.getItem(shardKey(i))
        if (!rawShard) break
        try {
          for (const item of JSON.parse(rawShard) as Array<ReturnType<typeof toPersisted>>) byId.set(item.id, item)
        } catch { /* 分片损坏跳过，保序重建时自然缺失 */ }
      }
      // 按 meta 记录的顺序恢复，丢弃 meta 里没有的孤儿记录
      for (const id of meta.ids) {
        const item = byId.get(id)
        if (item) tasks.push(fromPersisted(item))
      }
      return tasks
    },

    /**
     * 标记待写入，100ms 合并一次（桌面版 `throttleUpdateTask` 同语义）
     */
    save: (tasks: LX.Download.ListItem[]) => {
      pending = tasks
      if (timer != null || flushing != null) return
      timer = setTimeout(() => {
        timer = null
        void startFlush()
      }, WRITE_THROTTLE_MS)
    },

    /**
     * 立即写入并返回完成时机；并发调用共享同一次写入
     */
    flush: async(): Promise<void> => {
      await startFlush()
    },
  }
}

export type DownloadPersist = ReturnType<typeof createDownloadPersist>
