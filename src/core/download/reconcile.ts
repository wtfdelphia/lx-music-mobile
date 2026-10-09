import { stat } from '@/utils/fs'
import { resolveDownloadPath } from './path'
import { removeFromIndex } from './downloadIndex'

/**
 * 文件对账（§7.8、§下载索引与文件对账）：
 * 对 `completed` 任务逐个 `stat`，文件缺失标 `FILE_MISSING` 并移出索引。
 * 触发时机：冷启动、进入下载页；播放本地失败回退时也顺带触发
 */
export const reconcile = async(tasks: LX.Download.ListItem[]): Promise<boolean> => {
  let changed = false
  for (const task of tasks) {
    if (task.status !== 'completed' || !task.isComplate) continue
    if (task.errorCode === 'FILE_MISSING') continue
    const relPath = task.metadata.filePath
    if (!relPath) continue
    const exists = await stat(resolveDownloadPath(relPath)).then(() => true).catch(() => false)
    if (exists) continue
    task.status = 'error'
    task.statusText = ''
    task.errorCode = 'FILE_MISSING'
    removeFromIndex(task.metadata.musicInfo)
    changed = true
  }
  return changed
}
