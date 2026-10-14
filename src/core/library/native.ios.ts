/**
 * `LxLibraryModule` 原生方法薄封装（design §5）。
 * 接口契约以 design 为准；模块未注册时统一返回拒绝的 Promise，
 * 不抛 TypeError（模式同 `core/download/engine.ios.ts`）。
 * 导出面必须与基础文件 `native.ts` 对齐（Metro 平台扩展）
 */
import { NativeEventEmitter, NativeModules, type NativeModule } from 'react-native'
import type { LibraryQuerySpec, LibraryQueryResult, LibrarySource, NativeTrackRow, LibraryScanReport, ReadLyricResult } from './types'

const getModule = () => NativeModules.LxLibraryModule as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined

const unavailable = async(): Promise<never> => {
  throw new Error('LxLibraryModule not available')
}

const call = async<R>(name: string, ...args: unknown[]): Promise<R> => {
  const module = getModule()
  if (!module) return unavailable()
  const fn = module[name]
  if (!fn) return unavailable()
  return fn(...args) as Promise<R>
}

export const ping = async(): Promise<boolean> => call<boolean>('ping')

// ---- 来源 ----
export const getSources = async(): Promise<LibrarySource[]> => call<LibrarySource[]>('getSources')
export const saveSource = async(source: LibrarySource): Promise<boolean> => call<boolean>('saveSource', source)
export const deleteSource = async(id: string): Promise<boolean> => call<boolean>('deleteSource', id)
export interface PickFolderResult {
  bookmark: string | null
  label: string
  relPath: string | null
}
export const pickFolder = async(): Promise<PickFolderResult | null> => call<PickFolderResult | null>('pickFolder')
export const relink = async(sourceId: string): Promise<boolean> => call<boolean>('relink', sourceId)
export const acquireSource = async(sourceId: string): Promise<boolean> => call<boolean>('acquire', sourceId)
export const releaseSource = async(sourceId: string): Promise<boolean> => call<boolean>('release', sourceId)

// ---- 扫描 ----
export const startScan = async(sourceId: string, options: { recursive: boolean }): Promise<boolean> => call<boolean>('startScan', sourceId, options)
export const cancelScan = async(sourceId: string): Promise<boolean> => call<boolean>('cancelScan', sourceId)

// ---- 查询与写入 ----
export const query = async(spec: LibraryQuerySpec): Promise<LibraryQueryResult> => call<LibraryQueryResult>('query', spec)
export const upsertTracks = async(sourceId: string, rows: Array<Record<string, unknown>>): Promise<boolean> => call<boolean>('upsertTracks', sourceId, rows)
export const finishSync = async(sourceId: string): Promise<number> => call<number>('finishSync', sourceId)
export const getTrack = async(locator: string): Promise<NativeTrackRow | null> => call<NativeTrackRow | null>('getTrack', locator)
/** 来源曲目数（来源管理列表，§14.4） */
export const countTracks = async(sourceId: string): Promise<number> => call<number>('countTracksForSourceId', sourceId)
/** 全量 itemKey（自动关联差量对账，避免 query limit 截断，S3） */
export const listItemKeys = async(sourceId: string): Promise<string[]> => call<string[]>('listItemKeysForSourceId', sourceId)
// 排除表（§16）：从曲库移除不删文件，重扫 / 对账跳过
export const excludeTrack = async(sourceId: string, itemKey: string): Promise<boolean> => call<boolean>('excludeTrack', sourceId, itemKey)
export const restoreExcluded = async(sourceId: string): Promise<boolean> => call<boolean>('restoreExcluded', sourceId)
export const listExcludedItemKeys = async(sourceId: string): Promise<string[]> => call<string[]>('listExcludedItemKeysForSourceId', sourceId)
export const isExcluded = async(sourceId: string, itemKey: string): Promise<boolean> => call<boolean>('isExcluded', sourceId, itemKey)
export interface DeleteSourceFileResult {
  removedAudio: boolean
  removedLrc: boolean
  sourceType: string
}
/** §16：仅沙箱内来源可删文件，外部来源原生侧直接拒绝 */
export const deleteSourceFile = async(locator: string): Promise<DeleteSourceFileResult> => call<DeleteSourceFileResult>('deleteSourceFile', locator)
export const setOffline = async(locator: string, relPath: string | null): Promise<boolean> => call<boolean>('setOffline', locator, relPath)
export const bumpPlay = async(locator: string): Promise<boolean> => call<boolean>('bumpPlay', locator)
export const deleteTrack = async(locator: string): Promise<boolean> => call<boolean>('deleteTrack', locator)

// ---- 播放 / 封面 / 歌词解析（§8）----
/** 本地来源：acquire、拼路径、查存在，返回 `file://…` 或空串（§8.2） */
export const resolvePlayFileUrl = async(locator: string): Promise<string> => call<string>('resolvePlayFileUrl', locator)
export const artworkPath = async(locator: string): Promise<string> => call<string>('artworkPath', locator)
/** 封面缓存文件名 → file:// URL（专辑 / 艺人聚合行封面，§14.2） */
export const artworkUrlForName = async(cachedName: string): Promise<string> => call<string>('artworkUrlForName', cachedName)
/** 测试钩子：删库重置（仅自测调用），配合 .lx-ci-lib-v1 标记模拟存量库升级 */
export const closeAndDropLibrary = async(): Promise<boolean> => call<boolean>('closeAndDropLibrary')
/** 封面缓存占用字节数与清理（空间管理） */
export const artworkCacheSize = async(): Promise<number> => call<number>('artworkCacheSize')
export const clearArtworkCache = async(): Promise<boolean> => call<boolean>('clearArtworkCache')
export const readLyric = async(locator: string): Promise<ReadLyricResult | null> => call<ReadLyricResult | null>('readLyric', locator)

// ---- Keychain（P2 使用，P1 先落接口，§5.7）----
export const setSecret = async(sourceId: string, secret: string): Promise<void> => { await call('setSecret', sourceId, secret) }
export const getSecret = async(sourceId: string): Promise<string | null> => call<string | null>('getSecret', sourceId)
export const deleteSecret = async(sourceId: string): Promise<void> => { await call('deleteSecret', sourceId) }

// ---- 事件 ----
export interface ScanProgressEvent {
  sourceId: string
  phase: 'enumerate' | 'probe' | 'upsert'
  scanned: number
  total?: number
  imported: number
}
export interface ScanDoneEvent {
  sourceId: string
  report: LibraryScanReport
}

export const subscribeScanEvents = (listener: (event: ScanProgressEvent | ScanDoneEvent) => void): (() => void) => {
  const module = getModule()
  if (!module) return () => {}
  const emitter = new NativeEventEmitter(module as unknown as NativeModule)
  const subs = [
    emitter.addListener('library_scan_progress', listener),
    emitter.addListener('library_scan_done', listener),
  ]
  return () => { subs.forEach(sub => { sub.remove() }) }
}
