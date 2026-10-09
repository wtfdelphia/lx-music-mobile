import { stat } from '@/utils/fs'

interface IndexEntry {
  quality: LX.Quality
  /** 相对 Documents 的路径 */
  relPath: string
}

/**
 * 全局已下载索引：按歌曲原 id 与切源记录（`toggleMusicInfo`）id 双重索引。
 * 只收录 `completed` 且对账通过的任务；由下载列表派生，不单独持久化（§5.2）。
 * 播放器经 `lookupLocal` 命中（§9），下载器链路不经过本模块
 */
const index = new Map<string, IndexEntry>()

/**
 * 音质高低，用于同歌多份时保留最高音质
 */
const qualityRank: Record<string, number> = {
  '128k': 1,
  '192k': 2,
  '320k': 3,
  ape: 4,
  wav: 5,
  flac: 6,
  flac24bit: 7,
}

/**
 * 从下载列表整体重建索引；文件缺失的任务不进索引（对账职责，§9）
 */
export const rebuildIndex = async(tasks: LX.Download.ListItem[]): Promise<void> => {
  const next = new Map<string, IndexEntry>()
  for (const task of tasks) {
    if (!task.isComplate || task.status !== 'completed') continue
    const relPath = task.metadata.filePath
    if (!relPath) continue
    const exists = await stat(relPath).then(() => true).catch(() => false)
    if (!exists) continue
    const entry: IndexEntry = { quality: task.metadata.quality, relPath }
    const ids = [task.metadata.musicInfo.id]
    const toggleId = task.metadata.musicInfo.meta.toggleMusicInfo?.id
    if (toggleId) ids.push(toggleId)
    for (const id of ids) {
      const prev = next.get(id)
      if (!prev || (qualityRank[entry.quality] ?? 0) > (qualityRank[prev.quality] ?? 0)) {
        next.set(id, entry)
      }
    }
  }
  index.clear()
  for (const [k, v] of next) index.set(k, v)
}

/**
 * 单个任务完成后的增量更新
 */
export const addToIndex = (task: LX.Download.ListItem): void => {
  if (!task.isComplate || task.status !== 'completed' || !task.metadata.filePath) return
  const entry: IndexEntry = { quality: task.metadata.quality, relPath: task.metadata.filePath }
  const ids = [task.metadata.musicInfo.id]
  const toggleId = task.metadata.musicInfo.meta.toggleMusicInfo?.id
  if (toggleId) ids.push(toggleId)
  for (const id of ids) {
    const prev = index.get(id)
    if (!prev || (qualityRank[entry.quality] ?? 0) > (qualityRank[prev.quality] ?? 0)) {
      index.set(id, entry)
    }
  }
}

export const removeFromIndex = (musicInfo: LX.Music.MusicInfoOnline): void => {
  index.delete(musicInfo.id)
  const toggleId = musicInfo.meta.toggleMusicInfo?.id
  if (toggleId) index.delete(toggleId)
}

/**
 * 播放器查询入口（§9）：依次按原 id 与切源 id 查，
 * 命中且文件存在返回相对路径；未命中返回空串
 */
export const lookupLocal = async(musicInfo: LX.Music.MusicInfoOnline): Promise<string> => {
  const ids = [musicInfo.id]
  const toggleId = musicInfo.meta.toggleMusicInfo?.id
  if (toggleId) ids.push(toggleId)
  for (const id of ids) {
    const entry = index.get(id)
    if (!entry) continue
    const exists = await stat(entry.relPath).then(() => true).catch(() => false)
    if (exists) return entry.relPath
  }
  return ''
}
