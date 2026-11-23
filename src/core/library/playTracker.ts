/**
 * 曲库播放埋点（最近播放消费面，P1 缺口补齐）：
 * 监听播放器曲目切换，对 `lxlib` 定位符调用原生 `bumpPlay`
 *（play_count + 1、last_played_at 更新）。查询侧按 `recent` 排序
 * 即可得到「最近播放」。
 * 失败静默：埋点是旁路，不允许影响播放链路
 */
import * as native from './native'
import { isLibraryLocator } from './locator'
import playerState from '@/store/player/state'

let subscribed = false
/** 候选曲目：切换时记录，真正开始播放才计数（低危项） */
let pendingId: string | null = null

export const subscribePlayTracking = (): void => {
  if (subscribed) return
  subscribed = true
  // 冷启动恢复上次曲目也会触发 playMusicInfoChanged，此时 isPlay 为
  // false。若直接计数，恢复一次就多算一次播放。改为记录候选，
  // 等真正开始播放（playStateChanged(true)）再落计数；
  // 播放中切歌（isPlay 已为 true）则立即计数
  global.state_event.on('playMusicInfoChanged', (playMusicInfo) => {
    const mi = playMusicInfo.musicInfo
    const id = mi && 'id' in mi ? String(mi.id) : ''
    if (!isLibraryLocator(id)) {
      pendingId = null
      return
    }
    pendingId = id
    if (playerState.isPlay) {
      void native.bumpPlay(id).catch(() => {})
      pendingId = null
    }
  })
  global.state_event.on('playStateChanged', (isPlay: boolean) => {
    if (isPlay && pendingId) {
      void native.bumpPlay(pendingId).catch(() => {})
      pendingId = null
    }
  })
}
