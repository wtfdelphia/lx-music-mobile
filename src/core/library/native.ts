/**
 * 非 iOS 平台的基础文件：一律 reject（design §18）。
 * Metro 平台扩展解析：iOS 命中 `native.ios.ts`，
 * Android / 其他平台命中本文件。导出面与 `native.ios.ts` 对齐
 */
import type { LibraryQuerySpec, LibraryQueryResult, LibrarySource, NativeTrackRow, LibraryScanReport, ReadLyricResult } from './types'

const notSupported = async(): Promise<never> => {
  throw new Error('library not supported on this platform')
}

export const ping = async(): Promise<boolean> => notSupported()
export const getSources = async(): Promise<LibrarySource[]> => notSupported()
export const saveSource = async(_source: LibrarySource): Promise<boolean> => notSupported()
export const renameSourceNative = async(_sourceId: string, _name: string): Promise<boolean> => notSupported()
export const setSourceEnabledNative = async(_sourceId: string, _enabled: boolean): Promise<boolean> => notSupported()
export const deleteSource = async(_id: string): Promise<boolean> => notSupported()
export interface PickFolderResult {
  bookmark: string | null
  label: string
  relPath: string | null
}
export const pickFolder = async(): Promise<PickFolderResult | null> => notSupported()
export const relink = async(_sourceId: string): Promise<boolean> => notSupported()
export const acquireSource = async(_sourceId: string): Promise<boolean> => notSupported()
export const releaseSource = async(_sourceId: string): Promise<boolean> => notSupported()
export const startScan = async(_sourceId: string, _options: { recursive: boolean }): Promise<boolean> => notSupported()
export const cancelScan = async(_sourceId: string): Promise<boolean> => notSupported()
export const query = async(_spec: LibraryQuerySpec): Promise<LibraryQueryResult> => notSupported()
export const upsertTracks = async(_sourceId: string, _rows: Array<Record<string, unknown>>): Promise<boolean> => notSupported()
export const finishSync = async(_sourceId: string): Promise<number> => notSupported()
export const getTrack = async(_locator: string): Promise<NativeTrackRow | null> => notSupported()
export const countTracks = async(_sourceId: string): Promise<number> => notSupported()
export const listItemKeys = async(_sourceId: string): Promise<string[]> => notSupported()
export const excludeTrack = async(_sourceId: string, _itemKey: string): Promise<boolean> => notSupported()
export const restoreExcluded = async(_sourceId: string): Promise<boolean> => notSupported()
export const listExcludedItemKeys = async(_sourceId: string): Promise<string[]> => notSupported()
export const isExcluded = async(_sourceId: string, _itemKey: string): Promise<boolean> => notSupported()
export interface DeleteSourceFileResult {
  removedAudio: boolean
  removedLrc: boolean
  sourceType: string
}
export const deleteSourceFile = async(_locator: string): Promise<DeleteSourceFileResult> => notSupported()
export const setOffline = async(_locator: string, _relPath: string | null): Promise<boolean> => notSupported()
export const bumpPlay = async(_locator: string): Promise<boolean> => notSupported()
export const deleteTrack = async(_locator: string): Promise<boolean> => notSupported()
export const resolvePlayFileUrl = async(_locator: string): Promise<string> => notSupported()
export const artworkPath = async(_locator: string): Promise<string> => notSupported()
export const artworkUrlForName = async(_cachedName: string): Promise<string> => notSupported()
export const closeAndDropLibrary = async(): Promise<boolean> => notSupported()
export const artworkCacheSize = async(): Promise<number> => notSupported()
export const clearArtworkCache = async(): Promise<boolean> => notSupported()
export const readLyric = async(_locator: string): Promise<ReadLyricResult | null> => notSupported()
export const setSecret = async(_sourceId: string, _secret: string): Promise<void> => notSupported()
export const getSecret = async(_sourceId: string): Promise<string | null> => notSupported()
export const deleteSecret = async(_sourceId: string): Promise<void> => notSupported()

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
export const subscribeScanEvents = (_listener: (event: ScanProgressEvent | ScanDoneEvent) => void): (() => void) => () => {}
