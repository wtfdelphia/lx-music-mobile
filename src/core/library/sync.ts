/**
 * 来源同步编排（design §6）：
 * - 单来源单飞：同一来源同时只允许一次扫描
 * - 进度与报告入 store
 * - 冷启动后不自动扫描（只有用户触发，或开启「启动时增量扫描」）
 */
import * as native from './native'
import type { ScanProgressEvent, ScanDoneEvent } from './native'
import { setScanProgress, clearScanProgress, setScanReport, setSources } from '@/store/library/action'
import state from '@/store/library/state'
import type { LibrarySource } from './types'

/** 单飞锁：正在扫描的来源集合 */
const scanning = new Set<string>()
let subscribed = false

const handleScanEvent = (event: ScanProgressEvent | ScanDoneEvent): void => {
  // 完成事件带 report；进度事件带 phase。两个分支都要维护单飞集合，
  // 否则扫描完成后扫描全部/重复触发的等待永远不会退出
  if ('report' in event) {
    scanning.delete(event.sourceId)
    clearScanProgress(event.sourceId)
    setScanReport(event.sourceId, event.report)
    void refreshSources()
    // H4：扫描入库由原生完成，这里只发事件；由页面按当前
    // 视图状态（Tab / 下钻 / 筛选 / 关键词 / 排序）自行重载，
    // 避免用歌曲列表覆盖专辑 / 艺人 / 最近播放 / 下钻视图
    global.app_event.libraryScanDone(event.sourceId)
    return
  }
  setScanProgress({
    sourceId: event.sourceId,
    phase: event.phase,
    scanned: event.scanned,
    total: event.total,
    imported: event.imported,
  })
}

/**
 * 订阅原生扫描事件（幂等，随编排器初始化调用一次）
 */
export const subscribeScanEvents = (): void => {
  if (subscribed) return
  subscribed = true
  native.subscribeScanEvents(handleScanEvent)
}

/** 重新拉取来源列表并写入 store */
export const refreshSources = async(): Promise<LibrarySource[]> => {
  try {
    const sources = await native.getSources()
    setSources(sources)
    return sources
  } catch {
    return state.sources
  }
}

/** 扫描启动失败原因：UI 按原因分别提示，不再一律显示「正在扫描中」 */
const mapNativeScanError = (err: unknown): string => {
  const code = (err as { code?: string } | null)?.code ?? (err instanceof Error ? err.message : String(err))
  if (code.includes('E_SCAN_BUSY')) return 'busy'
  if (code.includes('E_REAUTH')) return 'reauth'
  if (code.includes('E_NOT_FOUND')) return 'not_found'
  return code
}

/**
 * 触发单来源扫描。失败时经 `onError` 透出原因：
 * `busy`（JS 单飞 / 原生忙）、`disabled`、`not_found`、`download`、
 * `reauth` 或原生原始信息。调用方据此提示，不再一律「正在扫描中」
 */
export const startSourceScan = async(sourceId: string, onError?: (reason: string) => void): Promise<boolean> => {
  const fail = (reason: string): boolean => {
    if (onError) onError(reason)
    return false
  }
  if (scanning.has(sourceId)) return fail('busy')
  const source = state.sources.find(s => s.id === sourceId)
  if (!source) return fail('not_found')
  if (!source.enabled) return fail('disabled')
  // H2：「下载」虚拟来源由对账维护，不允许扫描（原生侧也有兜底）
  if (source.type === 'download') return fail('download')
  let recursive = true
  try {
    recursive = (JSON.parse(source.config) as { recursive?: boolean }).recursive ?? true
  } catch { /* config 损坏时用默认递归 */ }
  scanning.add(sourceId)
  subscribeScanEvents()
  try {
    await native.startScan(sourceId, { recursive })
  } catch (err) {
    scanning.delete(sourceId)
    // 把原生拒绝原因（E_SCAN_BUSY / E_REAUTH / E_NOT_FOUND）归一后透出，
    // 由调用方决定是否提示用户（此前被吞掉，失败无任何反馈）
    return fail(mapNativeScanError(err))
  }
  return true
}

/** 失败原因的提示文案（core 层可用 global.i18n，同 tools.confirmDialog） */
export const scanFailTip = (sourceName: string, reason: string): string => {
  const t = global.i18n.t
  const name = sourceName ? `${sourceName}: ` : ''
  switch (reason) {
    case 'busy':
    case 'download':
      return `${sourceName} ${t('library_scan_busy')}`.trim()
    case 'reauth': return `${name}${t('library_source_state_needs_reauth')}`
    case 'disabled': return `${name}${t('library_source_disabled')}`
    case 'not_found': return `${name}${t('library_source_state_unreachable')}`
    default: return `${name}${reason}`
  }
}

export const cancelSourceScan = async(sourceId: string): Promise<void> => {
  try {
    await native.cancelScan(sourceId)
  } catch { /* 取消失败不致命：扫描会在下一个文件边界自然停止或完成 */ }
}

/**
 * 扫描全部启用的来源（曲库页「扫描全部」入口）。
 * 逐个顺序扫描，避免并发打满元数据读取队列。
 * 等待方式：订阅扫描完成事件（事件驱动），不能用忙轮询——
 * 阻塞式 while 会占住 JS 线程，原生完成事件回不来，形成死锁
 */
let scanAllRunning = false
/** 单来源等待上限：万首级扫描的兜底，卡死不阻塞后续来源 */
const SCAN_WAIT_TIMEOUT_MS = 15 * 60 * 1000

export const scanAllSources = async(): Promise<void> => {
  // 单飞：重复点击不叠加第二轮
  if (scanAllRunning) return
  scanAllRunning = true
  try {
    for (const source of state.sources) {
      if (!source.enabled) continue
      if (source.type === 'download') continue // H2
      if (!(await startSourceScan(source.id))) continue
      await waitForScanDone(source.id)
    }
  } finally {
    scanAllRunning = false
  }
}

const waitForScanDone = async(sourceId: string): Promise<void> => {
  if (!scanning.has(sourceId)) return
  let timer: ReturnType<typeof setInterval> | null = null
  const done = new Promise<boolean>(resolve => {
    timer = setInterval(() => {
      if (!scanning.has(sourceId)) resolve(true)
    }, 500)
  })
  const timedOut = new Promise<boolean>(resolve => { setTimeout(() => { resolve(false) }, SCAN_WAIT_TIMEOUT_MS) })
  const finished = await Promise.race([done, timedOut])
  if (timer) clearInterval(timer)
  if (!finished) {
    // 兜底：超时后强制清掉单飞锁并尝试取消原生扫描。此前超时只退出
    // 等待，scanning 集合不清理，该来源会被永久判忙，之后所有扫描
    // 入口一律显示「正在扫描中」（真机反馈第 4 条的放大器）
    scanning.delete(sourceId)
    clearScanProgress(sourceId)
    void cancelSourceScan(sourceId)
  }
}

/** 测试钩子：清空单飞锁（生产不调用） */
export const __resetForTest = (): void => {
  scanning.clear()
  subscribed = false
}
