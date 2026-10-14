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

/**
 * 触发单来源扫描。来源正在扫描中时返回 `E_SCAN_BUSY` 语义的 false
 */
export const startSourceScan = async(sourceId: string): Promise<boolean> => {
  if (scanning.has(sourceId)) return false
  const source = state.sources.find(s => s.id === sourceId)
  if (!source || !source.enabled) return false
  // H2：「下载」虚拟来源由对账维护，不允许扫描（原生侧也有兜底）
  if (source.type === 'download') return false
  let recursive = true
  try {
    recursive = (JSON.parse(source.config) as { recursive?: boolean }).recursive ?? true
  } catch { /* config 损坏时用默认递归 */ }
  scanning.add(sourceId)
  subscribeScanEvents()
  try {
    await native.startScan(sourceId, { recursive })
  } catch {
    scanning.delete(sourceId)
    return false
  }
  return true
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
  await Promise.race([
    new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (!scanning.has(sourceId)) {
          clearInterval(timer)
          resolve()
        }
      }, 500)
    }),
    new Promise<void>(resolve => setTimeout(resolve, SCAN_WAIT_TIMEOUT_MS)),
  ])
}

/** 测试钩子：清空单飞锁（生产不调用） */
export const __resetForTest = (): void => {
  scanning.clear()
  subscribed = false
}
