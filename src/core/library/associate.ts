/**
 * 已下载曲目自动关联（design §11 / F17）。
 * 订阅 `downloadListUpdate`，对 `kind: 'online'` 的完成任务做差量对账：
 * - 完成即入库（含 skipExistFile 快路径与孤儿认领）
 * - 同歌多音质按歌曲 id 去重，保留最高音质
 * - 删任务 / 清空已完成 / FILE_MISSING 时移除关联
 * 不修改下载引擎，仅消费其状态；映射键为 `item_key == metadata.filePath`
 *
 * 对账约束（2026-10-13 修复）：
 * - 现有曲目经原生 `listItemKeys` 全量取回，不再受 query limit 200 截断（S3）
 * - 删除只走 deleteTrack，下载来源不调 finishSync：upsert 只写增量行，
 *   finishSync 的 seen 语义会把未重写的存量行误删（S4）
 * - buildTrackRow 省略空值字段，桥上不传 null（NSNull 崩溃的 JS 侧防御）
 */
import * as native from './native'
import { buildLocator, buildItemKey } from './locator'
import settingState from '@/store/setting/state'
import { getDownloadList } from '@/store/download/action'

/** 音质高低，与 `downloadIndex.qualityRank` 一致（该表私有，此处复刻）。导出供测试 */
export const qualityRank: Record<string, number> = {
  '128k': 1,
  '192k': 2,
  '320k': 3,
  ape: 4,
  wav: 5,
  flac: 6,
  flac24bit: 7,
}

/** 全库唯一的「下载」虚拟来源 id，固定常量（§11.1）。
 * 固定 32 位十六进制（design §4.1 对 sourceId 的格式要求） */
export const DOWNLOAD_SOURCE_ID = 'd0000000000000000000000000000001'

let throttling = false
/** 单飞：首次创建来源时并发调用共享同一次检查（§11.1 全库只允许一个） */
let ensurePromise: Promise<void> | null = null

/** 确保「下载」虚拟来源存在（首次关联时创建）。
 * H5：来源可能被删除（旧版本允许），缓存的 Promise 不能永久挡重建 */
const ensureDownloadSource = async(): Promise<void> => {
  if (ensurePromise) return ensurePromise
  const run = async(): Promise<void> => {
    const sources = await native.getSources().catch(() => [] as Array<{ id: string }>)
    if (sources.some(s => s.id === DOWNLOAD_SOURCE_ID)) return
    await native.saveSource({
      id: DOWNLOAD_SOURCE_ID,
      type: 'download',
      name: 'download',
      enabled: true,
      config: JSON.stringify({ recursive: false }),
      state: 'ok',
      lastScanAt: null,
      lastScanReport: null,
      createdAt: Date.now(),
    })
  }
  ensurePromise = run().catch((err: unknown) => {
    // 失败后重置，下次对账重试（否则一次失败永久不再创建）
    ensurePromise = null
    throw err
  })
  return ensurePromise
}

/**
 * 判定任务是否参与自动关联：
 * 已完成、有文件路径、未标 FILE_MISSING、非 `kind:'library'` 任务。
 * 导出供测试（§11 过滤规则）
 */
export const isAssociable = (task: LX.Download.ListItem): boolean => {
  if (!task.isComplate || task.status !== 'completed') return false
  if (!task.metadata.filePath) return false
  if (task.errorCode === 'FILE_MISSING') return false
  // §11.3：`kind:'library'`（远程曲库离线下载）已由 `offline_path` 表示，跳过
  const metadata = task.metadata as { kind?: 'online' | 'library' }
  if (metadata.kind === 'library') return false
  return true
}

/** 对完成的任务按歌曲 id 分组、每组选最高音质。导出供测试（§11.4 去重） */
export const pickBestByMusicId = (tasks: LX.Download.ListItem[]): LX.Download.ListItem[] => {
  const best = new Map<string, LX.Download.ListItem>()
  for (const task of tasks) {
    const musicId = task.metadata.musicInfo.id
    const prev = best.get(musicId)
    if (!prev) {
      best.set(musicId, task)
      continue
    }
    const prevRank = qualityRank[prev.metadata.quality] ?? 0
    const curRank = qualityRank[task.metadata.quality] ?? 0
    if (curRank > prevRank) best.set(musicId, task)
  }
  return Array.from(best.values())
}

/**
 * 由下载任务构造曲库行的定位符与 itemKey。导出供测试（§11.2 映射键）。
 * 空值字段直接省略：JS null 经桥转为 NSNull，原生侧对 NSNull 发
 * NSString 消息会崩（S1），双向防御
 */
export const buildTrackRow = (task: LX.Download.ListItem): Record<string, unknown> | null => {
  const filePath = task.metadata.filePath
  if (!filePath) return null
  const musicInfo = task.metadata.musicInfo
  const row: Record<string, unknown> = {
    locator: buildLocator(DOWNLOAD_SOURCE_ID, buildItemKey([filePath])),
    item_key: filePath,
    // 标题降级链：歌名缺失时取文件名再退到路径（`||` 对空串语义，
    // `??` 对 pop 的 undefined）
    title: musicInfo.name || (filePath.split('/').pop() ?? filePath),
    duration_ms: 0,
    has_embedded_lyric: false,
    // 元数据其余字段由原生侧 `LxMediaProbe` 读实际文件补全（§11.5）
  }
  if (musicInfo.singer) row.artist = musicInfo.singer
  if (musicInfo.meta.albumName) row.album = musicInfo.meta.albumName
  if (task.metadata.ext) row.ext = task.metadata.ext
  return row
}

/**
 * 差量对账：对比曲库中「下载」来源的现有曲目与当前完成的任务集
 */
const reconcile = async(): Promise<void> => {
  if (!settingState.setting['library.enable']) return
  if (!settingState.setting['library.autoAssociateDownloads']) return

  const tasks = getDownloadList().filter(isAssociable)
  const selected = pickBestByMusicId(tasks)
  const wantedKeys = new Set(selected.map(t => t.metadata.filePath).filter(Boolean))

  await ensureDownloadSource()

  // S3：全量取 itemKey，不受 query limit 200 截断
  const existingKeys = await native.listItemKeys(DOWNLOAD_SOURCE_ID).catch(() => [] as string[])
  const existingKeySet = new Set(existingKeys)
  // §16 排除表：已移除的曲目对账不复活
  const excludedKeys = await native.listExcludedItemKeys(DOWNLOAD_SOURCE_ID).catch(() => [] as string[])
  const excludedKeySet = new Set(excludedKeys)

  // 待入库：本次应有但库里没有、且未被排除
  const toAdd = selected.filter(t => !existingKeySet.has(t.metadata.filePath) && !excludedKeySet.has(t.metadata.filePath))
  // 待移除：库里有但本次任务已不在（删除 / 清空 / FILE_MISSING）。
  // 排除项已在 toAdd 侧挡住，这里不再处理（其曲目行本就不存在）
  const toRemoveKeys = existingKeys.filter(key => !wantedKeys.has(key))

  let changed = false
  if (toAdd.length) {
    const rows = toAdd.map(buildTrackRow).filter((r): r is Record<string, unknown> => r != null)
    if (rows.length) {
      await native.upsertTracks(DOWNLOAD_SOURCE_ID, rows).catch(() => {})
      changed = true
    }
  }
  for (const key of toRemoveKeys) {
    await native.deleteTrack(buildLocator(DOWNLOAD_SOURCE_ID, buildItemKey([key]))).catch(() => {})
    changed = true
  }
  // S4：下载来源不调 finishSync。删除只走 toRemove + deleteTrack；
  // upsert 只写增量行，finishSync 的 seen 语义会把存量行误删再补回，
  // 导致曲目数在轮次之间翻转。
  // 有变更时刷新来源列表并发行更新事件，让来源管理 / 曲库页
  // 数量即时反映（此前 void changed 什么都不做）
  if (changed) {
    const { refreshSources } = await import('./sync')
    void refreshSources()
    global.app_event.libraryRowsUpdated()
  }
}

/**
 * 手动触发一次对账（M9：下载来源「恢复已移除」后让曲目回来）。
 * 内部仍受节流与设置门控约束
 */
export const reconcileNow = (): void => {
  void reconcile()
}

/**
 * 事件处理入口：节流约 1 秒，下载进行中事件高频但差量逻辑轻量
 */
const handleDownloadListUpdate = (): void => {
  if (throttling) return
  throttling = true
  setTimeout(() => {
    throttling = false
    void reconcile()
  }, 1000)
}

/**
 * 初始化：需在 `initDownload` 与曲库 store 初始化完成后调用（§11.7）。
 * 订阅事件并异步执行首次差量。首次差量不阻塞启动链（S2）：
 * 对账结果只影响曲库页可见性，不影响首页渲染与播放
 */
export const initAssociate = (): void => {
  global.app_event.on('downloadListUpdate', handleDownloadListUpdate)
  void reconcile()
}

/** 测试钩子 */
export const __resetForTest = (): void => {
  ensurePromise = null
  throttling = false
}
