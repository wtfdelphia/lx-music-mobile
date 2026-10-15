/**
 * 曲库状态写入面（add-ios-local-library §6）。
 * 状态为内存态：来源与曲目持久化在原生 sqlite，
 * JS 侧只保留视图所需的派生状态
 */
import state, { type InitState, type ScanProgress } from './state'
import type { LibrarySource, NativeTrackRow, LibraryScanReport } from '@/core/library/types'

export const setSources = (sources: LibrarySource[]): void => {
  state.sources = sources
  global.app_event.librarySourcesUpdated()
}

export const setScanProgress = (progress: ScanProgress): void => {
  state.scanProgress = { ...state.scanProgress, [progress.sourceId]: progress }
  global.app_event.libraryScanProgressUpdated()
}

export const clearScanProgress = (sourceId: string): void => {
  if (!(sourceId in state.scanProgress)) return
  const next = { ...state.scanProgress }
  delete next[sourceId]
  state.scanProgress = next
  global.app_event.libraryScanProgressUpdated()
}

export const setScanReport = (sourceId: string, report: LibraryScanReport): void => {
  state.scanReports = { ...state.scanReports, [sourceId]: report }
  global.app_event.librarySourcesUpdated()
}

export const setRows = (rows: NativeTrackRow[], total: number): void => {
  state.rows = rows
  state.rowsTotal = total
  global.app_event.libraryRowsUpdated()
}

/** 分页追加（审核第 2 条）：视图不变时追加下一页，触发同样的更新事件 */
export const appendRows = (rows: NativeTrackRow[], total: number): void => {
  state.rows = [...state.rows, ...rows]
  state.rowsTotal = total
  global.app_event.libraryRowsUpdated()
}

export const setTabId = (tabId: InitState['tabId']): void => {
  state.tabId = tabId
  global.app_event.libraryRowsUpdated()
}

export const setFilterSourceId = (sourceId: string | null): void => {
  state.filterSourceId = sourceId
  global.app_event.libraryRowsUpdated()
}

export const setKeyword = (keyword: string): void => {
  state.keyword = keyword
  global.app_event.libraryRowsUpdated()
}

export const setInited = (inited: boolean): void => {
  state.inited = inited
  global.app_event.librarySourcesUpdated()
}
