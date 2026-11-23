/**
 * 曲库列表动作（add-ios-local-library §9）：
 * 播放走 LX 临时列表（`LIST_IDS.TEMP`），「下一首播放」复用 `PLAY_LATER`
 */
import { overwriteListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { playList } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { toMusicInfo } from '@/core/library/toMusicInfo'
import type { NativeTrackRow } from '@/core/library/types'

/**
 * 把曲库行转成 `MusicInfoLocal`。封面目录由调用方注入
 */
export const rowsToMusicInfos = (
  rows: NativeTrackRow[],
  artworkDir?: string,
): LX.Music.MusicInfoLocal[] => {
  return rows.map(row => toMusicInfo({ ...row, artworkDir }))
}

/**
 * 播放：写入临时列表后从指定位置开始（§9「播放」）
 */
export const handlePlay = async(rows: NativeTrackRow[], index: number, artworkDir?: string): Promise<void> => {
  if (!rows.length) return
  const list = rowsToMusicInfos(rows, artworkDir)
  await overwriteListMusics(LIST_IDS.TEMP, list)
  await playList(LIST_IDS.TEMP, Math.min(index, list.length - 1))
}

/**
 * 「下一首播放」（§9）：复用稍后播放列表（PLAY_LATER）
 */
export const handlePlayLater = async(row: NativeTrackRow, artworkDir?: string): Promise<void> => {
  const musicInfo = toMusicInfo({ ...row, artworkDir })
  addTempPlayList([{ listId: null, musicInfo }])
}
