import { describe, expect, it } from 'vitest'
import { QUALITYS, clipFileNameLength, clipNameLength, createDownloadInfo, formatMusicName, getExt, getMusicType } from '@/core/download/utils'

const makeMusic = (overrides: Partial<{
  id: string
  name: string
  singer: string
  source: LX.Music.MusicInfoOnline['source']
  qualitys: Record<string, { size: string | null }>
}> = {}): LX.Music.MusicInfoOnline => ({
  id: overrides.id ?? 'kw_001',
  name: overrides.name ?? '测试歌曲',
  singer: overrides.singer ?? '测试歌手',
  source: overrides.source ?? 'kw',
  interval: '04:00',
  meta: {
    qualitys: [],
    _qualitys: overrides.qualitys ?? { '128k': { size: '3.5M' } },
    albumName: '',
    picUrl: '',
    toggleMusicInfo: null,
  },
})

const qualityList: LX.QualityList = {
  kw: ['128k', '320k', 'flac'],
  tx: ['128k'],
}

describe('getMusicType 音质降级', () => {
  it('请求音质源支持且歌曲拥有时原样返回', () => {
    const m = makeMusic({ qualitys: { '128k': { size: '3M' }, '320k': { size: '8M' }, flac: { size: '20M' } } })
    expect(getMusicType(m, 'flac', qualityList)).toBe('flac')
  })

  it('源不支持请求音质时改用该源列表最后一项再向下找', () => {
    const m = makeMusic({ qualitys: { '128k': { size: '3M' }, '320k': { size: '8M' } } })
    // 请求 flac24bit（源不支持）→ 源最后一项 flac → 歌曲没有 → 降到 320k
    expect(getMusicType(m, 'flac24bit', qualityList)).toBe('320k')
  })

  it('沿 QUALITYS 往下找歌曲拥有的第一档', () => {
    const m = makeMusic({ qualitys: { '128k': { size: '3M' }, '192k': { size: '5M' }, '320k': { size: '8M' } } })
    expect(getMusicType(m, '320k', qualityList)).toBe('320k')
  })

  it('歌曲一档都没有时回 128k', () => {
    const m = makeMusic({ qualitys: {} })
    expect(getMusicType(m, 'flac', qualityList)).toBe('128k')
  })

  it('未知源回 128k', () => {
    const m = makeMusic({ source: 'bd' as LX.Music.MusicInfoOnline['source'] })
    expect(getMusicType(m, 'flac', qualityList)).toBe('128k')
  })
})

describe('getExt', () => {
  it('各音质映射到正确扩展名', () => {
    expect(getExt('flac24bit')).toBe('flac')
    expect(getExt('flac')).toBe('flac')
    expect(getExt('ape')).toBe('ape')
    expect(getExt('wav')).toBe('wav')
    expect(getExt('320k')).toBe('mp3')
    expect(getExt('128k')).toBe('mp3')
  })
})

describe('文件名生成', () => {
  it('formatMusicName 三种模板', () => {
    expect(formatMusicName('歌名 - 歌手', '晴天', '周杰伦')).toBe('晴天 - 周杰伦')
    expect(formatMusicName('歌手 - 歌名', '晴天', '周杰伦')).toBe('周杰伦 - 晴天')
    expect(formatMusicName('歌名', '晴天', '周杰伦')).toBe('晴天')
  })

  it('clipNameLength 按「、」截断歌手名', () => {
    const long = Array.from({ length: 40 }, (_, i) => `歌手${i}`).join('、')
    const clipped = clipNameLength(long)
    expect(clipped.length).toBeLessThanOrEqual(80 + 3) // 允许最后一个「、歌手N」略超，按桌面版逻辑
    expect(long.length).toBeGreaterThan(80)
    // 短名不截断
    expect(clipNameLength('周杰伦')).toBe('周杰伦')
    // 不含「、」不截断
    expect(clipNameLength('a'.repeat(200))).toBe('a'.repeat(200))
  })

  it('clipFileNameLength 按字符截断到 150', () => {
    expect(clipFileNameLength('a'.repeat(200)).length).toBe(150)
    expect(clipFileNameLength('a'.repeat(150))).toBe('a'.repeat(150))
  })
})

describe('createDownloadInfo 任务键', () => {
  it('任务键为 歌曲id_音质_扩展名', () => {
    const info = createDownloadInfo(makeMusic(), '128k', '歌名 - 歌手', qualityList)
    expect(info.id).toBe('kw_001_128k_mp3')
  })

  it('同歌同音质键一致（去重依据）', () => {
    const a = createDownloadInfo(makeMusic(), '128k', '歌名', qualityList)
    const b = createDownloadInfo(makeMusic(), '128k', '歌手 - 歌名', qualityList)
    expect(a.id).toBe(b.id)
  })

  it('不同音质键不同', () => {
    const m = makeMusic({ qualitys: { '128k': { size: '3M' }, flac: { size: '20M' } } })
    const low = createDownloadInfo(m, '128k', '歌名', qualityList)
    const high = createDownloadInfo(m, 'flac', '歌名', qualityList)
    expect(low.id).not.toBe(high.id)
    expect(high.metadata.ext).toBe('flac')
  })

  it('初始状态为 waiting，内存字段归零', () => {
    const info = createDownloadInfo(makeMusic(), '128k', '歌名', qualityList, 'mylist')
    expect(info.status).toBe('waiting')
    expect(info.isComplate).toBe(false)
    expect(info.progress).toBe(0)
    expect(info.metadata.listId).toBe('mylist')
    expect(info.metadata.filePath).toBe('')
  })

  it('文件名过滤非法字符', () => {
    const info = createDownloadInfo(makeMusic({ name: '歌曲/名:称*?', singer: '歌#手"' }), '128k', '歌名 - 歌手', qualityList)
    expect(info.metadata.fileName).not.toMatch(/[/\\:*?#"<>|]/)
    expect(info.metadata.fileName.endsWith('.mp3')).toBe(true)
  })

  it('超长歌手名经截断后文件名不超界', () => {
    const longSinger = Array.from({ length: 50 }, (_, i) => `歌手${i}`).join('、')
    const info = createDownloadInfo(makeMusic({ singer: longSinger }), '128k', '歌名 - 歌手', qualityList)
    const base = info.metadata.fileName.slice(0, -4) // 去掉 .mp3
    expect(base.length).toBeLessThanOrEqual(150)
  })

  it('QUALITYS 为完整 7 档', () => {
    expect([...QUALITYS]).toEqual(['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'])
  })
})
