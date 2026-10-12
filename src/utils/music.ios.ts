/**
 * iOS 平台扩展（design §8.1）：Android 继续用原 `music.ts`。
 * - `lxlib://` 定位符交给曲库解析器
 * - 旧绝对路径（重签前存的本地歌曲）按当前容器 rebase 后复查存在性
 * - 其余情况保持原逻辑
 */
import { existsFile, privateStorageDirectoryPath } from './fs'
import { isLibraryLocator } from '@/core/library/locator'
import { resolvePlayUrl } from '@/core/library/resolver'

/**
 * 重签后容器 UUID 变化，旧绝对路径里的 `…/Documents/<rel>` 前缀失效。
 * 取 `/Documents/` 之后的相对段，拼到当前容器目录下
 */
const rebaseLegacyPath = (path: string): string | null => {
  const marker = '/Documents/'
  const idx = path.indexOf(marker)
  if (idx < 0) return null
  const rel = path.slice(idx + marker.length)
  if (!rel) return null
  return `${privateStorageDirectoryPath}/${rel}`
}

export const getLocalFilePath = async(musicInfo: LX.Music.MusicInfoLocal): Promise<string> => {
  const { filePath } = musicInfo.meta
  if (isLibraryLocator(filePath)) return resolvePlayUrl(filePath)
  if (await existsFile(filePath)) return filePath
  if (filePath.startsWith('/')) {
    const rebased = rebaseLegacyPath(filePath)
    if (rebased && rebased !== filePath && await existsFile(rebased)) return rebased
  }
  // 直接从应用外 intent 调用打开的文件（Android 遗留分支，保持等价）
  return /\/\d+$/.test(filePath) ? filePath : ''
}
