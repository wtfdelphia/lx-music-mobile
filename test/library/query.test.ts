import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 曲库查询（§5.1）：结构化查询参数、limit 上限、
 * 原生不可用时降级空结果
 */

const mockNative = vi.hoisted(() => ({
  query: vi.fn(async() => ({ rows: [], total: 0 })),
}))

vi.mock('@/core/library/native', () => mockNative)

import { clampLimit, queryTracks, queryAlbums, QUERY_LIMIT_MAX } from '@/core/library/query'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('clampLimit', () => {
  it('caps at the 200 limit', () => {
    expect(clampLimit(10_000)).toBe(QUERY_LIMIT_MAX)
    expect(QUERY_LIMIT_MAX).toBe(200)
  })

  it('keeps valid values', () => {
    expect(clampLimit(50)).toBe(50)
  })

  it('replaces non-positive values with the max', () => {
    expect(clampLimit(0)).toBe(QUERY_LIMIT_MAX)
    expect(clampLimit(-5)).toBe(QUERY_LIMIT_MAX)
  })
})

describe('queryTracks', () => {
  it('passes kind=tracks and clamped limit', async() => {
    await queryTracks({ offset: 0, limit: 999 })
    expect(mockNative.query).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'tracks',
      limit: QUERY_LIMIT_MAX,
    }))
  })

  it('returns empty result when native is unavailable', async() => {
    mockNative.query.mockRejectedValueOnce(new Error('LxLibraryModule not available'))
    expect(await queryTracks({ offset: 0, limit: 50 })).toEqual({ rows: [], total: 0 })
  })
})

describe('queryAlbums', () => {
  it('passes kind=albums', async() => {
    await queryAlbums({ offset: 0, limit: 20 })
    expect(mockNative.query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'albums' }))
  })
})
