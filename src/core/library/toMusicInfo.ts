/**
 * 曲库行转 `MusicInfoLocal`（design §4.3）。
 * 行结构对应 `LxLibraryStore` 的 track 表，纯函数，vitest 覆盖
 */
import { formatPlayTime2 } from '@/utils/common'
import type { NativeTrackRow } from './types'

export interface LibraryTrackRow extends NativeTrackRow {
  /** 本地缓存封面目录的绝对前缀，由调用方注入 */
  artworkDir?: string
  /** 远程封面 URL 的拼装回调（不带认证参数），由调用方注入 */
  buildRemotePicUrl?: (artwork: string) => string
}

export const toMusicInfo = (row: LibraryTrackRow): LX.Music.MusicInfoLocal => {
  const picUrl = row.sourceType === 'local'
    ? (row.artwork && row.artworkDir ? `file://${row.artworkDir}/${row.artwork}` : null)
    : (row.artwork && row.buildRemotePicUrl ? row.buildRemotePicUrl(row.artwork) : null)
  return {
    id: row.locator,
    name: row.title,
    singer: row.artist ?? '',
    source: 'local',
    interval: row.durationMs > 0 ? formatPlayTime2(Math.round(row.durationMs / 1000)) : null,
    meta: {
      songId: row.locator,
      albumName: row.album ?? '',
      filePath: row.locator,
      ext: row.ext ?? '',
      picUrl,
    },
  }
}
