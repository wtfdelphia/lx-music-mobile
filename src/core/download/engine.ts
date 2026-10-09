/**
 * 下载引擎接口与基础实现。P1a 按完整形态冻结（D10）：
 * pause / resume / removeResumeData / getActiveTasks / drainEvents / ack
 * 依赖原生 `DownloadModule` 的后续能力，P1a 在 iOS 上由原生返回显式错误，
 * 非 iOS 平台一律拒绝。原生侧实现完成后本文件不改接口、只改绑定。
 *
 * 平台扩展：iOS 上 `@/core/download/engine` 经 Metro 解析到 `engine.ios.ts`，
 * 两个文件的导出面必须一致（接口、`downloadEngine`、`isDownloadSupported`）
 */

/**
 * 实时事件（`LxDownloadEvent`）。complete / error 同时进事件日志，
 * 可经 `drainEvents` 补领；start / progress 只实时投递
 */
export interface EngineLiveEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'bgFinished'
  data: {
    taskId: string
    seq?: number
    total?: number
    downloaded?: number
    path?: string
    size?: number
    code?: LX.Download.DownloadErrorCode
    httpStatus?: number
    message?: string
    hasResumeData?: boolean
  }
}

export interface DownloadEngine {
  subscribe: (listener: (event: EngineLiveEvent) => void) => () => void
  configure: (opts: { maxConcurrent: number }) => Promise<void>
  start: (task: { taskId: string, url: string, targetPath: string, allowsCellular: boolean, headers?: Record<string, string> }) => Promise<void>
  pause: (taskId: string) => Promise<{ hasResumeData: boolean }>
  resume: (taskId: string, allowsCellular: boolean) => Promise<boolean>
  cancel: (taskId: string, removeResumeData: boolean) => Promise<void>
  removeResumeData: (taskId: string) => Promise<void>
  getActiveTasks: () => Promise<Array<{ taskId: string, state: 'running' | 'suspended', downloaded: number, total: number }>>
  drainEvents: () => Promise<LX.Download.EngineEvent[]>
  ack: (lastSeq: number) => Promise<void>
}

export { isDownloadSupported } from './support'

const notSupported = async(): Promise<never> => {
  throw new Error('download engine not supported on this platform')
}

/**
 * 非 iOS 的空实现：所有方法拒绝（`not supported`）。
 * Android 下载另立 change（`AGENTS.md:158`），不在此文件实现
 */
export const downloadEngine: DownloadEngine = {
  subscribe: () => () => {},
  configure: notSupported,
  start: notSupported,
  pause: notSupported,
  resume: notSupported,
  cancel: notSupported,
  removeResumeData: notSupported,
  getActiveTasks: notSupported,
  drainEvents: notSupported,
  ack: notSupported,
}
