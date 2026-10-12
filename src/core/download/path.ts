import { privateStorageDirectoryPath } from '@/utils/fs'

/**
 * 下载文件统一存相对 Documents（`privateStorageDirectoryPath`）的路径，
 * 读取时拼接（应对重签后沙箱容器路径变化，§6）
 */

/**
 * 相对路径 → 绝对路径
 */
export const resolveDownloadPath = (relPath: string): string => {
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath
  return `${privateStorageDirectoryPath}/${clean}`
}

/**
 * 拼接下载目录子路径（按列表分目录时使用，§6）。
 * 各段已由调用方经文件名清洗
 */
export const joinDownloadPath = (...segments: string[]): string => {
  return segments.filter(s => s.length > 0).join('/')
}
