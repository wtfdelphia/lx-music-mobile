/**
 * 曲库播放埋点（最近播放消费面，P1 缺口补齐）：
 * 监听播放器曲目切换，对 `lxlib` 定位符调用原生 `bumpPlay`
 *（play_count + 1、last_played_at 更新）。查询侧按 `recent` 排序
 * 即可得到「最近播放」。
 * 失败静默：埋点是旁路，不允许影响播放链路
 */
import * as native from './native'
import { isLibraryLocator } from './locator'

let subscribed = false

export const subscribePlayTracking = (): void => {
  if (subscribed) return
  subscribed = true
  global.state_event.on('playMusicInfoChanged', (playMusicInfo) => {
    const mi = playMusicInfo.musicInfo
    if (!mi) return
    // PlayMusic 可能是下载任务项（无 `id` 语义为定位符），收窄后判断
    const id = 'id' in mi ? String(mi.id) : ''
    if (!isLibraryLocator(id)) return
    void native.bumpPlay(id).catch(() => {})
  })
}
