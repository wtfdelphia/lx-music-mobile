import { describe, expect, it } from 'vitest'
import { toMusicInfo, type LibraryTrackRow } from '@/core/library/toMusicInfo'

const base: LibraryTrackRow = {
  locator: 'lxlib://a1b2c3d4e5f60718293a4b5c6d7e8f90/Music%2Fa.mp3',
  sourceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  sourceType: 'local',
  itemKey: 'Music/a.mp3',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  albumArtist: '周杰伦',
  durationMs: 269_000,
  ext: 'mp3',
  artwork: 'ab12.jpg',
  albumKey: '',
  artistKey: '',
}

describe('toMusicInfo', () => {
  it('maps a local row with locator as id and filePath', () => {
    const info = toMusicInfo({ ...base, artworkDir: '/var/.../Caches/lx-library/artwork' })
    expect(info.id).toBe(base.locator)
    expect(info.source).toBe('local')
    expect(info.meta.filePath).toBe(base.locator)
    expect(info.meta.songId).toBe(base.locator)
    expect(info.meta.ext).toBe('mp3')
    expect(info.name).toBe('晴天')
    expect(info.singer).toBe('周杰伦')
    expect(info.meta.albumName).toBe('叶惠美')
    expect(info.interval).toBe('04:29')
    expect(info.meta.picUrl).toBe('file:///var/.../Caches/lx-library/artwork/ab12.jpg')
  })

  it('falls back to empty singer and album on null fields', () => {
    const info = toMusicInfo({ ...base, artist: null, album: null, artwork: null })
    expect(info.singer).toBe('')
    expect(info.meta.albumName).toBe('')
    expect(info.meta.picUrl).toBeNull()
  })

  it('uses null interval when duration is missing', () => {
    expect(toMusicInfo({ ...base, durationMs: 0 }).interval).toBeNull()
  })

  it('builds remote picUrl via injected callback without auth params', () => {
    const info = toMusicInfo({
      ...base,
      sourceType: 'subsonic',
      artwork: 'album-9',
      buildRemotePicUrl: (id) => `https://srv/rest/getCoverArt?id=${id}&size=600`,
    })
    expect(info.meta.picUrl).toBe('https://srv/rest/getCoverArt?id=album-9&size=600')
  })

  it('keeps picUrl null for remote rows without artwork', () => {
    const info = toMusicInfo({ ...base, sourceType: 'jellyfin', artwork: null, buildRemotePicUrl: () => 'x' })
    expect(info.meta.picUrl).toBeNull()
  })
})
