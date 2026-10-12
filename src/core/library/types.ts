/**
 * 曲库共享类型（design §5.1、§5.3）。
 * 行字段与 `LxLibraryStore` 的 track 表一一对应；
 * JS 层消费时再注入封面目录 / 封面 URL 拼装回调
 */

export type LibrarySourceType = 'local' | 'subsonic' | 'jellyfin' | 'emby' | 'download'

export type LibrarySourceState = 'ok' | 'needs_reauth' | 'unreachable' | 'scanning'

export interface LibrarySource {
  id: string
  type: LibrarySourceType
  name: string
  enabled: boolean
  /** JSON 文本：baseUrl / username / folderLabel / recursive 等，不含密码 */
  config: string
  state: LibrarySourceState
  lastScanAt: number | null
  /** JSON 摘要 */
  lastScanReport: string | null
  createdAt: number
}

export interface NativeTrackRow {
  locator: string
  sourceId: string
  sourceType: LibrarySourceType
  itemKey: string
  title: string
  artist: string | null
  album: string | null
  albumArtist: string | null
  durationMs: number
  ext: string | null
  /** 本地：缓存封面文件名；远程：coverArt id */
  artwork: string | null
}

export type LibraryQueryKind = 'tracks' | 'albums' | 'artists' | 'albumTracks' | 'artistTracks'

export interface LibraryQuerySpec {
  kind: LibraryQueryKind
  sourceIds?: string[]
  keyword?: string
  sort?: 'title' | 'artist' | 'album' | 'added'
  /** 专辑曲目用 */
  albumKey?: string
  /** 艺人曲目用 */
  artistKey?: string
  offset: number
  /** 上限 200，由原生层强制 */
  limit: number
}

export interface LibraryQueryResult {
  rows: NativeTrackRow[]
  total: number
}

/** 明细列表：最多 200 条，另附总数（design §5.3 事件） */
export interface LibraryReportList<T> {
  items: T[]
  total: number
}

export interface LibraryScanReport {
  imported: number
  updated: number
  removed: number
  unsupported: LibraryReportList<string>
  notDownloaded: LibraryReportList<string>
  failed: LibraryReportList<{ path: string, reason: string }>
  unreadableDirs: LibraryReportList<string>
}

export interface ReadLyricResult {
  lyric: string
  source: 'embedded' | 'sidecar'
}
