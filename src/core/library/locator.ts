/**
 * 定位符（design §4）：`lxlib://<sourceId>/<itemKey>`，纯函数。
 * - `sourceId`：UUID v4 去横线，32 位小写十六进制
 * - `itemKey`：本地来源为相对路径（逐段独立 percent 编码后用 `/` 连接），
 *   远程来源为服务端曲目 ID 的单段编码
 * 解码后任一段为 `.`、`..` 或空串即非法；相对路径统一 NFC 规范化
 */

const SCHEME = 'lxlib://'
const SOURCE_ID_RXP = /^[0-9a-f]{32}$/

export interface ParsedLocator {
  sourceId: string
  /** 解码并 NFC 规范化后的 itemKey（本地为相对路径，远程为服务端 ID） */
  itemKey: string
}

export const isLibraryLocator = (str: string): boolean => str.startsWith(SCHEME)

const assertSegment = (segment: string) => {
  if (!segment || segment === '.' || segment === '..') {
    throw new Error(`invalid locator segment: ${JSON.stringify(segment)}`)
  }
}

/**
 * 构造 itemKey。本地来源传相对路径各段；远程来源传单元素数组
 * （服务端曲目 ID）。各段先 NFC 规范化再独立 percent 编码
 */
export const buildItemKey = (segments: string[]): string => {
  if (!segments.length) throw new Error('empty locator segments')
  return segments.map(seg => {
    assertSegment(seg)
    return encodeURIComponent(seg.normalize('NFC'))
  }).join('/')
}

export const buildLocator = (sourceId: string, itemKey: string): string => {
  if (!SOURCE_ID_RXP.test(sourceId)) throw new Error(`invalid sourceId: ${sourceId}`)
  if (!itemKey) throw new Error('empty itemKey')
  return `${SCHEME}${sourceId}/${itemKey}`
}

/**
 * 解析定位符。非法输入（前缀或 sourceId 格式不符、编码段解码失败、
 * 解码后任一段为空或 `.`、`..`）返回 null，不抛异常
 */
export const parseLocator = (locator: string): ParsedLocator | null => {
  if (!isLibraryLocator(locator)) return null
  const body = locator.slice(SCHEME.length)
  const slash = body.indexOf('/')
  if (slash === -1) return null
  const sourceId = body.slice(0, slash)
  if (!SOURCE_ID_RXP.test(sourceId)) return null
  const encodedKey = body.slice(slash + 1)
  if (!encodedKey) return null
  const decoded: string[] = []
  for (const seg of encodedKey.split('/')) {
    if (!seg) return null
    let val: string
    try {
      val = decodeURIComponent(seg)
    } catch {
      return null
    }
    if (!val) return null
    // 解码后的段可能含 `%2F` 还原出的 `/`：拆开逐段校验，
    // 防止 `a%2F..%2Fb` 这类编码穿越绕过遍历校验
    for (const sub of val.split('/')) {
      if (!sub || sub === '.' || sub === '..') return null
    }
    decoded.push(val.normalize('NFC'))
  }
  return { sourceId, itemKey: decoded.join('/') }
}
