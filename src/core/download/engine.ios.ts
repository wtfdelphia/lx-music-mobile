import { NativeModules } from 'react-native'
import type { DownloadEngine } from './engine'

/**
 * iOS 引擎：绑定原生 `DownloadModule`。
 * 接口与基础文件 `engine.ts` 完全一致（D10 冻结）；
 * P1a 未实现的方法由原生侧返回显式错误，不在这里降级。
 * 导出面必须与 `engine.ts` 对齐：Metro 按平台扩展解析，
 * iOS 上 `@/core/download/engine` 命中本文件，少导出即丢符号
 */

// P1a 阶段原生模块尚未注册；每个调用点现查，模块就绪后自动生效。
// 缺失时统一返回拒绝的 Promise 而非抛 TypeError，保持接口契约
const getModule = () => NativeModules.DownloadModule

const unavailable = async(): Promise<never> => {
  throw new Error('DownloadModule not available')
}

const withModule = <Args extends unknown[], R>(fn: (module: any, ...args: Args) => Promise<R>) => {
  return async(...args: Args): Promise<R> => {
    const module = getModule()
    if (!module) return unavailable()
    return fn(module, ...args)
  }
}

export const downloadEngine: DownloadEngine = {
  configure: withModule((m, opts) => m.configure(opts)),
  start: withModule((m, task) => m.start(task)),
  pause: withModule((m, taskId) => m.pause(taskId)),
  resume: withModule((m, taskId, allowsCellular) => m.resume(taskId, allowsCellular)),
  cancel: withModule((m, taskId, removeResumeData) => m.cancel(taskId, removeResumeData)),
  removeResumeData: withModule((m, taskId) => m.removeResumeData(taskId)),
  getActiveTasks: withModule((m) => m.getActiveTasks()),
  drainEvents: withModule((m) => m.drainEvents()),
  ack: withModule((m, lastSeq) => m.ack(lastSeq)),
}

export { isDownloadSupported } from './support'
export type { DownloadEngine }
