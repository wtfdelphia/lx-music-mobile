/**
 * 曲库状态（add-ios-local-library §6）。
 * 来源列表、扫描进度、当前 Tab、筛选与搜索条件
 */
import type { LibrarySource, NativeTrackRow, LibraryScanReport } from '@/core/library/types'

export type LibraryTabId = 'tracks' | 'albums' | 'artists' | 'recent'

export interface ScanProgress {
  sourceId: string
  phase: 'enumerate' | 'probe' | 'upsert'
  scanned: number
  total?: number
  imported: number
}

export interface InitState {
  /** 全部来源（含停用） */
  sources: LibrarySource[]
  /** 扫描进度，按 sourceId */
  scanProgress: Record<string, ScanProgress | undefined>
  /** 最近一次扫描报告，按 sourceId */
  scanReports: Record<string, LibraryScanReport | undefined>
  /** 曲库页当前 Tab */
  tabId: LibraryTabId
  /** 来源筛选（空 = 全部来源） */
  filterSourceId: string | null
  /** 搜索关键词 */
  keyword: string
  /** 初始化是否完成（原生模块就绪后） */
  inited: boolean
  /** 最近一次查询结果（当前视图），供跨组件共享 */
  rows: NativeTrackRow[]
  rowsTotal: number
}

const state: InitState = {
  sources: [],
  scanProgress: {},
  scanReports: {},
  tabId: 'tracks',
  filterSourceId: null,
  keyword: '',
  inited: false,
  rows: [],
  rowsTotal: 0,
}

export default state
