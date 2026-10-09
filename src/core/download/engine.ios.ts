import { NativeModules } from 'react-native'
import type { DownloadEngine } from './engine'

/**
 * iOS 引擎：绑定原生 `DownloadModule`。
 * 接口与基础文件 `engine.ts` 完全一致（D10 冻结）；
 * P1a 未实现的方法由原生侧返回显式错误，不在这里降级
 */
const DownloadModule = NativeModules.DownloadModule

export const downloadEngine: DownloadEngine = {
  configure: (opts) => DownloadModule.configure(opts),
  start: (task) => DownloadModule.start(task),
  pause: (taskId) => DownloadModule.pause(taskId),
  resume: (taskId, allowsCellular) => DownloadModule.resume(taskId, allowsCellular),
  cancel: (taskId, removeResumeData) => DownloadModule.cancel(taskId, removeResumeData),
  removeResumeData: (taskId) => DownloadModule.removeResumeData(taskId),
  getActiveTasks: () => DownloadModule.getActiveTasks(),
  drainEvents: () => DownloadModule.drainEvents(),
  ack: (lastSeq) => DownloadModule.ack(lastSeq),
}
