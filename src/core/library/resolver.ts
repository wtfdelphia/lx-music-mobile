/**
 * 播放 / 封面 / 歌词解析（design §8）。
 * P1 只实现本地来源分支；远程来源（offline_path、串流 URL、
 * 蜂窝门控）在 P2 随 Subsonic 来源落地。
 * 原生调用失败一律降级返回空值，由调用方走现有回落链路，
 * 不把原生模块不可用放大成播放崩溃
 */
import * as native from './native'
import { parseLocator } from './locator'

/**
 * 播放地址解析（§8.2）。
 * 本地来源：acquire 授权、拼文件 URL、查存在；缺失返回 `''`，
 * 交由 LX 回落在线换源（与现有本地歌曲行为一致）
 */
export const resolvePlayUrl = async(locator: string): Promise<string> => {
  if (!parseLocator(locator)) return ''
  try {
    return await native.resolvePlayFileUrl(locator)
  } catch {
    return ''
  }
}

/**
 * 封面解析（§8.4）。本地来源走 `artworkPath`（缓存缺失时原生侧重建），
 * 返回 `file://` URL；取不到返回 null，调用方回落现有链路
 */
export const resolvePicUrl = async(locator: string): Promise<string | null> => {
  if (!parseLocator(locator)) return null
  try {
    const row = await native.getTrack(locator)
    if (!row) return null
    if (row.sourceType !== 'local') return null // P2：远程封面加认证参数
    const path = await native.artworkPath(locator)
    return path ? `file://${path}` : null
  } catch {
    return null
  }
}

/**
 * 歌词解析（§8.5）。本地来源读内嵌歌词或同名 .lrc（原生侧），
 * 返回原始文本，由调用方交给 `parseLyric`；取不到返回 null
 */
export const resolveLyric = async(locator: string): Promise<string | null> => {
  if (!parseLocator(locator)) return null
  try {
    const result = await native.readLyric(locator)
    if (!result?.lyric) return null
    return result.lyric
  } catch {
    return null
  }
}
