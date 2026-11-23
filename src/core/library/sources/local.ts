/**
 * 本地文件夹来源（design §5.2、§6）：
 * 选择文件夹、创建来源、重新关联。扫描编排统一走 `sync.ts`
 */
import * as native from '../native'
import { buildLocator, buildItemKey } from '../locator'
import { toast } from '@/utils/tools'
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
 * 用户取消（原生返回 null）时返回 null，不建来源。
 * 审核第 14 条：同一目录（解析符号链接后路径相同）不重复添加
 */
export const pickLocalFolder = async(options: { recursive?: boolean } = {}): Promise<LocalFolderPickResult | null> => {
  const picked = await native.pickFolder()
  if (!picked) return null

  // 去重与重叠拦截（审核第 14 条）：与已有本地来源的根目录比对。
  // 同一目录重复添加抛 E_DUPLICATE_FOLDER；目录互相包含（子目录
  // 已被覆盖 / 父目录会重复覆盖）抛 E_OVERLAP_FOLDER。两者都与
  // 用户取消（返回 null）区分，UI 据此提示。
  // 「下载」虚拟来源的根是 Documents 全目录且无 relPath，
  // rootPathForSourceId 返回 nil，不参与这里的路径比对；
  // 选中 Download/ 的重复曲目风险由上面的提示覆盖（§11.6
  // 明确不做硬拦截）
  if (picked.resolvedPath) {
    const sources = await native.getSources().catch(() => [] as LibrarySource[])
    const pickedPath = picked.resolvedPath
    for (const existing of sources) {
      if (existing.type !== 'local') continue
      const existingRoot = await native.rootPathForSourceId(existing.id).catch(() => null)
      if (!existingRoot) continue
      if (existingRoot === pickedPath) throw new Error('E_DUPLICATE_FOLDER')
      const containsExisting = pickedPath.startsWith(existingRoot + '/')
      const containedByExisting = existingRoot.startsWith(pickedPath + '/')
      if (containsExisting || containedByExisting) throw new Error('E_OVERLAP_FOLDER')
    }
  }

  // §11.6：选中 Download/ 目录时提示会与下载来源产生重复曲目
  // （定位符不同，去重不覆盖跨来源），一行提示不做硬拦截
  const rel = picked.relPath ?? ''
  if (rel === 'Download' || rel.startsWith('Download/')) {
    toast(global.i18n.t('library_download_folder_hint'), 'long')
  }

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
 * 重新关联：只替换授权，不改变定位符（design §5.2 `relink`）。
 * 返回 true 成功 / false 失败 / null 用户取消
 */
export const relinkSource = async(sourceId: string): Promise<boolean | null> => {
  return native.relink(sourceId).catch(() => false)
}

/**
 * 曲库歌曲的播放用定位符构造（供来源侧生成行数据时复用）
 */
export const trackLocator = (sourceId: string, relSegments: string[]): string => {
  return buildLocator(sourceId, buildItemKey(relSegments))
}

/**
 * 删除来源：级联删曲目与封面缓存、凭据（§14.4、spec「删除来源」）
 */
export const deleteSource = async(sourceId: string): Promise<boolean> => {
  return native.deleteSource(sourceId).catch(() => false)
}

/**
 * 启用 / 停用来源。走单字段更新，不用整行 saveSource——
 * 后者会用内存旧快照覆盖并发写入的扫描状态
 */
export const setSourceEnabled = async(source: LibrarySource, enabled: boolean): Promise<boolean> => {
  return native.setSourceEnabledNative(source.id, enabled).catch(() => false)
}

/**
 * 重命名来源显示名（F1「编辑」；定位符与授权均不变）。
 * 同样走单字段更新（真机实证整行重写会覆盖扫描报告等字段）
 */
export const renameSource = async(source: LibrarySource, name: string): Promise<boolean> => {
  const trimmed = name.trim()
  if (!trimmed || trimmed === source.name) return false
  return native.renameSourceNative(source.id, trimmed).catch(() => false)
}
