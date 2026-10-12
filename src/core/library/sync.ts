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
 * 扫描全部启用的来源（来源管理「⋮」菜单入口）。
 * 逐个顺序扫描，避免并发打满元数据读取队列
 */
export const scanAllSources = async(): Promise<void> => {
  for (const source of state.sources) {
    if (!source.enabled) continue
    await startSourceScan(source.id)
    while (scanning.has(source.id)) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

/** 测试钩子：清空单飞锁（生产不调用） */
export const __resetForTest = (): void => {
  scanning.clear()
  subscribed = false
}
