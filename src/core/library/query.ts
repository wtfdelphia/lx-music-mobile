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

export const queryAlbumTracks = async(sourceId: string, albumKey: string, offset: number, limit: number): Promise<NativeTrackRow[]> => {
  try {
    const result = await native.query({
      kind: 'albumTracks', sourceIds: [sourceId], albumKey, offset, limit: clampLimit(limit),
    })
    return result.rows
  } catch {
    return []
  }
}

export const queryArtistTracks = async(sourceId: string, artistKey: string, offset: number, limit: number): Promise<NativeTrackRow[]> => {
  try {
    const result = await native.query({
      kind: 'artistTracks', sourceIds: [sourceId], artistKey, offset, limit: clampLimit(limit),
    })
    return result.rows
  } catch {
    return []
  }
}
