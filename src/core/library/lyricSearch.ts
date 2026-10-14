/**
 * 歌词手动搜索（design §13.1 / F14，P1）：
 * 用 LX 在线源按「歌名 + 歌手」检索，候选展示歌名、歌手、专辑、时长差，
 * 选中后获取该在线曲目歌词并写入 LX 歌词缓存（后续 `getCachedLyricInfo`
 * 命中）。
 */
import { searchMusic } from '@/utils/musicSdk'
import { buildLyricInfo } from '@/core/music/utils'
import { getLyricInfo } from '@/core/music/online'
import { saveEditedLyric } from '@/utils/data'
import { refreshCurrentLyric } from '@/core/player/player'
import playerState from '@/store/player/state'
import type { NativeTrackRow } from './types'

export interface LyricCandidate {
  musicInfo: LX.Music.MusicInfoOnline
  /** 与曲库曲目的时长差（秒），供候选排序展示 */
  durationDiff: number
}

/**
 * 检索候选。曲库行转成本地音乐信息，取歌名 / 歌手搜
 */
export const searchLyricCandidates = async(row: NativeTrackRow, limit = 15): Promise<LyricCandidate[]> => {
  const lists: Array<{ list?: unknown[] }> = await searchMusic({ name: row.title, singer: row.artist ?? '', source: null, limit })
  const flat: LX.Music.MusicInfoOnline[] = lists.flatMap(l => (l.list ?? []) as LX.Music.MusicInfoOnline[])
  const baseSec = row.durationMs / 1000
  return flat
    .map(m => ({ musicInfo: m, durationDiff: parseDuration(m.interval) - baseSec }))
    .sort((a, b) => Math.abs(a.durationDiff) - Math.abs(b.durationDiff))
    .slice(0, limit)
}

const parseDuration = (interval: string | null): number => {
  if (!interval) return 0
  const parts = interval.split(':').map(n => parseInt(n, 10))
  if (parts.some(isNaN)) return 0
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1]
}

/**
 * 应用选中的候选歌词到曲库曲目：
 * 获取在线曲目歌词 → 写入该曲库曲目（定位符）的歌词缓存
 */
export const applyLyricCandidate = async(row: NativeTrackRow, candidate: LyricCandidate): Promise<LX.Music.LyricInfo> => {
  const lyricInfo = await getLyricInfo({
    musicInfo: candidate.musicInfo,
    isRefresh: false,
    allowToggleSource: true,
  })
  // M10：写 _edited 通道而非普通缓存，避免被文件内嵌歌词 / 同名 .lrc
  // 盖住（getLyricInfo 优先读编辑歌词）
  const localInfo = toLocalKey(row)
  await saveEditedLyric(localInfo, lyricInfo)
  // 正在播放这首歌时立即刷新歌词界面
  if (playerState.playMusicInfo.musicInfo?.id === row.locator) refreshCurrentLyric()
  return lyricInfo
}

/** 构造用于歌词缓存键的本地音乐信息（只需 id） */
const toLocalKey = (row: NativeTrackRow): LX.Music.MusicInfoLocal => ({
  id: row.locator,
  name: row.title,
  singer: row.artist ?? '',
  source: 'local',
  interval: null,
  meta: { songId: row.locator, albumName: row.album ?? '', filePath: row.locator, ext: row.ext ?? '' },
})

export { buildLyricInfo }
