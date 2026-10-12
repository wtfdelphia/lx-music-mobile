/**
 * 本地文件夹来源（design §5.2、§6）：
 * 选择文件夹、创建来源、重新关联。扫描编排统一走 `sync.ts`
 */
import * as native from '../native'
import { buildLocator, buildItemKey } from '../locator'
import type { LibrarySource } from '../types'

/**
 * UUID v4 小写去横线，32 位十六进制（design §4.1）。
 * 仅用于来源 id，非安全用途
 */
const uuid4Hex = (): string => {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export interface LocalFolderPickResult {
  source: LibrarySource
}

/**
 * 弹出系统文件夹选择器并创建本地来源。
 * 用户取消（原生返回 null）时返回 null，不建来源
 */
export const pickLocalFolder = async(options: { recursive?: boolean } = {}): Promise<LocalFolderPickResult | null> => {
  const picked = await native.pickFolder()
  if (!picked) return null
  const sourceId = uuid4Hex()
  const config = {
    bookmark: picked.bookmark,
    relPath: picked.relPath,
    recursive: options.recursive ?? true,
  }
  const source: LibrarySource = {
    id: sourceId,
    type: 'local',
    name: picked.label,
    enabled: true,
    config: JSON.stringify(config),
    state: 'ok',
    lastScanAt: null,
    lastScanReport: null,
    createdAt: Date.now(),
  }
  await native.saveSource(source)
  return { source }
}

/**
 * 重新关联：只替换授权，不改变定位符（design §5.2 `relink`）
 */
export const relinkSource = async(sourceId: string): Promise<void> => {
  await native.relink(sourceId)
}

/**
 * 曲库歌曲的播放用定位符构造（供来源侧生成行数据时复用）
 */
export const trackLocator = (sourceId: string, relSegments: string[]): string => {
  return buildLocator(sourceId, buildItemKey(relSegments))
}
