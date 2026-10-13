/**
 * 曲库列表查询（design §6）：原生结构化查询的薄封装。
 * 防抖与分页游标由调用方（UI hook）持有
 */
import * as native from './native'
import type { LibraryQuerySpec, LibraryQueryResult, NativeTrackRow } from './types'

/** limit 上限 200，与原生层强制一致（design §5.1） */
export const QUERY_LIMIT_MAX = 200

export const clampLimit = (limit: number): number => {
  if (limit <= 0) return QUERY_LIMIT_MAX
  return Math.min(limit, QUERY_LIMIT_MAX)
}

export const queryTracks = async(spec: Omit<LibraryQuerySpec, 'kind'>): Promise<LibraryQueryResult> => {
  try {
    return await native.query({ ...spec, kind: 'tracks', limit: clampLimit(spec.limit) })
  } catch {
    return { rows: [], total: 0 }
  }
}

export const queryAlbums = async(spec: Omit<LibraryQuerySpec, 'kind'>): Promise<LibraryQueryResult> => {
  try {
    return await native.query({ ...spec, kind: 'albums', limit: clampLimit(spec.limit) })
  } catch {
    return { rows: [], total: 0 }
  }
}

export const queryArtists = async(spec: Omit<LibraryQuerySpec, 'kind'>): Promise<LibraryQueryResult> => {
  try {
    return await native.query({ ...spec, kind: 'artists', limit: clampLimit(spec.limit) })
  } catch {
    return { rows: [], total: 0 }
  }
}

/**
 * 专辑曲目下钻。`sourceIds` 传当前来源筛选；无筛选传空数组，
 * 跨来源聚合同一专辑（原生侧空数组即不过滤）
 */
export const queryAlbumTracks = async(sourceIds: string[], albumKey: string, offset: number, limit: number): Promise<NativeTrackRow[]> => {
  try {
    const result = await native.query({
      kind: 'albumTracks', sourceIds: sourceIds.length ? sourceIds : undefined, albumKey, offset, limit: clampLimit(limit),
    })
    return result.rows
  } catch {
    return []
  }
}

/**
 * 艺人曲目下钻，sourceIds 语义同 `queryAlbumTracks`
 */
export const queryArtistTracks = async(sourceIds: string[], artistKey: string, offset: number, limit: number): Promise<NativeTrackRow[]> => {
  try {
    const result = await native.query({
      kind: 'artistTracks', sourceIds: sourceIds.length ? sourceIds : undefined, artistKey, offset, limit: clampLimit(limit),
    })
    return result.rows
  } catch {
    return []
  }
}
