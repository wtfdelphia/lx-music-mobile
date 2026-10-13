/**
 * 曲库曲目动作（design §16 分级）：
 * - 从曲库移除（不删文件）：写排除表 + 删行，重扫 / 对账不再复活
 * - 删除文件：「下载」来源走下载模块（音频 + .lrc 一并删、自动解绑）；
 *   沙箱内本地来源走原生删除（含越界校验）；外部来源只读
 * - 喜欢 / 加入列表映射到 LX 列表
 */
import * as native from './native'
import { parseLocator } from './locator'
import { getDownloadList } from '@/store/download/action'
import { removeTasks } from '@/core/download'
import { addListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import { getListMusics } from '@/utils/listManage'
import settingState from '@/store/setting/state'
import { toMusicInfo } from './toMusicInfo'
import type { NativeTrackRow } from './types'

/**
 * 从曲库移除（不删文件）。返回成功移除的数量
 */
export const removeFromLibrary = async(rows: NativeTrackRow[]): Promise<number> => {
  let removed = 0
  for (const row of rows) {
    const parsed = parseLocator(row.locator)
    if (!parsed) continue
    const ok = await native.excludeTrack(parsed.sourceId, parsed.itemKey).catch(() => false)
    if (ok) removed++
  }
  return removed
}

/**
 * 恢复已移除（来源管理入口）
 */
export const restoreRemoved = async(sourceId: string): Promise<boolean> => {
  return native.restoreExcluded(sourceId).catch(() => false)
}

/**
 * 删除文件（§16 分级）。返回实际删除音频的数量。
 * 「下载」来源：复用下载模块 `removeTasks(tasks, true)`，
 * 音频与 .lrc 一并删除，associate 随任务列表事件自动解绑；
 * 沙箱内本地来源：原生删除（含定位符越界校验）；
 * 外部来源：原生拒绝，抛错由调用方提示
 */
export const deleteFiles = async(rows: NativeTrackRow[]): Promise<number> => {
  let removed = 0
  const downloadRows = rows.filter(r => r.sourceType === 'download')
  const otherRows = rows.filter(r => r.sourceType !== 'download')

  // 「下载」来源：按 itemKey 反查下载任务（itemKey == metadata.filePath）
  if (downloadRows.length) {
    const keyToLocator = new Map(downloadRows.map(r => [r.itemKey, r.locator]))
    const tasks = getDownloadList().filter(t => keyToLocator.has(t.metadata.filePath))
    if (tasks.length) await removeTasks(tasks, true)
    removed += tasks.length
    // 排除表挡重扫 / 对账；任务删除后 associate 会自动解绑行，
    // 这里再写排除确保不被再次完成的任务复活
    for (const row of downloadRows) {
      const parsed = parseLocator(row.locator)
      if (parsed) await native.excludeTrack(parsed.sourceId, parsed.itemKey).catch(() => {})
    }
  }

  // 其余来源：原生分级处理（外部来源在此被拒绝）
  for (const row of otherRows) {
    const result = await native.deleteSourceFile(row.locator)
    if (result.removedAudio) {
      removed++
      const parsed = parseLocator(row.locator)
      if (parsed) await native.excludeTrack(parsed.sourceId, parsed.itemKey).catch(() => {})
    }
  }
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
