/**
 * 曲库曲目动作（design §16 分级）：
 * - 从曲库移除（不删文件）：写排除表 + 删行，重扫 / 对账不再复活
 * - 删除文件：「下载」来源走下载模块（音频 + .lrc 一并删、自动解绑）；
 *   沙箱内本地来源走原生删除（含越界校验）；外部来源只读
 * - 喜欢 / 加入列表映射到 LX 列表
 */
import * as native from './native'
import { getDownloadList } from '@/store/download/action'
import { removeTasks } from '@/core/download'
import { addListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { getListMusics, userLists } from '@/utils/listManage'
import settingState from '@/store/setting/state'
import { toMusicInfo } from './toMusicInfo'
import { parseLocator } from './locator'
import { playNext, stop } from '@/core/player/player'
import playerState from '@/store/player/state'
import { getList } from '@/core/player/playInfo'
import type { NativeTrackRow } from './types'

/**
 * M11：被删除 / 移除的曲目若正在播放。此前用 playNext(true) 会遵循
 * 播放模式（单曲循环重播 / 列表末尾原地不动），文件已删导致反复
 * 失败并回落在线换源。现改为：列表里还有别的歌则强制切下一首
 *（isAutoToggle=false 不遵循循环），否则停止播放
 */
const skipIfPlaying = async(rows: NativeTrackRow[]): Promise<void> => {
  const cur = playerState.playMusicInfo.musicInfo
  if (!cur || !('id' in cur)) return
  const curId = String(cur.id)
  if (!rows.some(r => r.locator === curId)) return
  const listId = playerState.playMusicInfo.listId
  if (listId) {
    const list = getList(listId)
    const remain = list.filter(mi => !rows.some(r => r.locator === mi.id))
    if (remain.length) {
      await playNext(false).catch(() => {})
      return
    }
  }
  await stop().catch(() => {})
}

/**
 * 从所有列表（默认 / 喜欢 / 自建）中移除指定定位符的曲目。
 * 真机反馈：删除文件后曲目信息仍留在列表里，播放时定位符解析
 * 失败回落在线换源，出现「歌还在列表、自动找新音源播放」。
 * 文件已删（或已排除）的引用必然无法播放，随删除一并清理
 */
const removeLocatorsFromAllLists = async(rows: NativeTrackRow[]): Promise<void> => {
  const idSet = new Set(rows.map(r => r.locator))
  // TEMP 也清：删除后临时列表里的引用同样会触发换源
  const listIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP, ...userLists.map(l => l.id)]
  const { removeListMusics } = await import('@/core/list')
  for (const listId of listIds) {
    const list = await getListMusics(listId).catch(() => [] as LX.Music.MusicInfo[])
    const refIds = list.filter(mi => idSet.has(mi.id)).map(mi => mi.id)
    if (refIds.length) await removeListMusics(listId, refIds)
  }
}

/**
 * 从曲库移除（不删文件）。返回成功移除的数量
 */
export const removeFromLibrary = async(rows: NativeTrackRow[]): Promise<number> => {
  await skipIfPlaying(rows)
  let removed = 0
  for (const row of rows) {
    const parsed = parseLocator(row.locator)
    if (!parsed) continue
    const ok = await native.excludeTrack(parsed.sourceId, parsed.itemKey).catch(() => false)
    if (ok) removed++
  }
  if (removed > 0) await removeLocatorsFromAllLists(rows)
  return removed
}

/**
 * 恢复已移除（来源管理入口，M9）。
 * 清排除表后：本地来源触发重扫让曲目回来；下载来源触发对账
 */
export const restoreRemoved = async(sourceId: string, sourceType: string): Promise<boolean> => {
  const ok = await native.restoreExcluded(sourceId).catch(() => false)
  if (!ok) return false
  if (sourceType === 'download') {
    const { reconcileNow } = await import('./associate')
    reconcileNow()
  } else {
    // 本地 / 外部来源：触发增量扫描把之前排除的曲目重新入库
    const { startSourceScan } = await import('./sync')
    void startSourceScan(sourceId)
  }
  return ok
}

/**
 * 统计某来源的歌曲在全部列表（默认 / 喜欢 / 自建）中的引用数。
 * 删除来源前的提示用（§9）：引用中的曲目删除后将无法播放
 */
export const countListRefsForSource = async(sourceId: string): Promise<number> => {
  const listIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...userLists.map(l => l.id)]
  let count = 0
  for (const listId of listIds) {
    const list = await getListMusics(listId).catch(() => [] as LX.Music.MusicInfo[])
    for (const mi of list) {
      if (mi.source === 'local' && mi.id.startsWith(`lxlib://${sourceId}/`)) count++
    }
  }
  return count
}

/**
 * 删除来源（§9）：先统计列表引用，删除后可选从列表中移除引用曲目
 */
export const deleteLibrarySource = async(sourceId: string, removeFromLists: boolean): Promise<boolean> => {
  const ok = await native.deleteSource(sourceId).catch(() => false)
  if (!ok) return false
  if (removeFromLists) {
    const listIds = [LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...userLists.map(l => l.id)]
    for (const listId of listIds) {
      const list = await getListMusics(listId).catch(() => [] as LX.Music.MusicInfo[])
      const refIds = list
        .filter(mi => mi.source === 'local' && mi.id.startsWith(`lxlib://${sourceId}/`))
        .map(mi => mi.id)
      if (refIds.length) {
        const { removeListMusics } = await import('@/core/list')
        await removeListMusics(listId, refIds)
      }
    }
  }
  return true
}

/**
 * 删除文件（§16 分级）。返回实际删除音频的数量。
 * 「下载」来源：复用下载模块 `removeTasks(tasks, true)`，
 * 音频与 .lrc 一并删除，associate 随任务列表事件自动解绑；
 * 沙箱内本地来源：原生删除（含定位符越界校验）；
 * 外部来源：原生拒绝，抛错由调用方提示
 */
export const deleteFiles = async(rows: NativeTrackRow[]): Promise<number> => {
  await skipIfPlaying(rows)
  let removed = 0
  const downloadRows = rows.filter(r => r.sourceType === 'download')
  const otherRows = rows.filter(r => r.sourceType !== 'download')

  // 「下载」来源：按 itemKey 反查下载任务（itemKey == metadata.filePath）。
  // M1：删文件不写排除表——排除表只给「从曲库移除」用；同一首歌重新
  // 下载（filePath 相同）后必须能重新入库，否则排除表变永久黑名单
  if (downloadRows.length) {
    const keyToLocator = new Map(downloadRows.map(r => [r.itemKey, r.locator]))
    const tasks = getDownloadList().filter(t => keyToLocator.has(t.metadata.filePath))
    if (tasks.length) await removeTasks(tasks, true)
    removed += tasks.length
  }

  // 其余来源：原生分级处理（外部来源在此被拒绝）。
  // M4：逐条 try，外部只读来源失败不阻断后续沙箱曲目的删除
  let skipped = 0
  for (const row of otherRows) {
    try {
      const result = await native.deleteSourceFile(row.locator)
      if (result.removedAudio) removed++
      else skipped++
    } catch {
      skipped++
    }
  }
  if (skipped > 0 && removed === 0) throw new Error('E_READONLY')
  if (removed > 0) await removeLocatorsFromAllLists(rows)
  return removed
}

/**
 * 删除文件菜单显隐：所有曲目都显示「删除文件」。
 * 外部文件夹来源（bookmark）在 JS 层无法与沙箱内来源区分，
 * 由原生侧按 grant 类型拒绝（E_READONLY），调用方收到后提示
 */
/**
 * 「喜欢」状态集合（曲目行显示红心用）：
 * 从「我的收藏」列表按定位符建索引
 */
export const getLoveSet = async(): Promise<Set<string>> => {
  const list = await getListMusics(LIST_IDS.LOVE).catch(() => [] as LX.Music.MusicInfo[])
  return new Set(list.map(m => m.id))
}

/**
 * 切换喜欢：曲库曲目写「我的收藏」；取消则从该列表移除
 */
export const toggleLove = async(row: NativeTrackRow, loved: boolean): Promise<void> => {
  const musicInfo = toMusicInfo(row)
  if (!loved) {
    await addListMusics(LIST_IDS.LOVE, [musicInfo], settingState.setting['list.addMusicLocationType'])
  } else {
    const { removeListMusics } = await import('@/core/list')
    await removeListMusics(LIST_IDS.LOVE, [row.locator])
  }
}
