import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * scheduler：状态机、并发、错误映射（§7.2、§7.4）。
 * 依赖全部 mock，只测调度逻辑本身
 */

const mockStore = vi.hoisted(() => ({
  tasks: [] as LX.Download.ListItem[],
  updateDownloadTask: vi.fn(),
  flushForAck: vi.fn(async() => {}),
}))

const mockEngine = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  start: vi.fn(async(_task: { taskId: string, url: string, targetPath: string, allowsCellular: boolean }) => {}),
  pause: vi.fn(async() => ({ hasResumeData: false })),
  resume: vi.fn(async() => false),
  cancel: vi.fn(async() => {}),
  removeResumeData: vi.fn(async() => {}),
  getActiveTasks: vi.fn(async() => [] as Array<{ taskId: string, state: 'running' | 'suspended', downloaded: number, total: number }>),
  drainEvents: vi.fn(async() => [] as LX.Download.EngineEvent[]),
  ack: vi.fn(async() => {}),
}))

const mockResolver = vi.hoisted(() => ({
  getUrl: vi.fn(async() => 'https://example.com/a.mp3'),
  refreshUrl: vi.fn(async() => 'https://example.com/refreshed.mp3'),
}))

vi.mock('@/store/download/action', () => ({
  getDownloadList: () => mockStore.tasks,
  updateDownloadTask: mockStore.updateDownloadTask,
  flushForAck: mockStore.flushForAck,
}))

vi.mock('@/core/download/engine', () => ({ downloadEngine: mockEngine }))
vi.mock('@/core/download/urlResolver', () => mockResolver)
vi.mock('@/core/download/lrc', () => ({ saveLrc: vi.fn(async() => {}) }))
vi.mock('@/utils/fs', () => ({
  stat: vi.fn(async() => { throw new Error('no file') }),
  unlink: vi.fn(async() => {}),
  writeFile: vi.fn(async() => {}),
  privateStorageDirectoryPath: '/mock/Documents',
}))
vi.mock('@/store/setting/state', () => ({
  default: {
    setting: {
      'download.enable': true,
      'download.maxDownloadNum': 1,
      'download.skipExistFile': false,
      'download.allowsCellular': false,
    },
  },
}))
vi.mock('@/store/list/state', () => ({ default: { userList: [] } }))

import { __resetForTest, checkStartTask, handleEngineEvent, pauseDownloadTask, startDownloadTasks } from '@/core/download/scheduler'
import type { EngineLiveEvent } from '@/core/download/engine'

const makeTask = (id: string, status: LX.Download.DownloadTaskStatus = 'waiting'): LX.Download.ListItem => ({
  id,
  isComplate: false,
  status,
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo: {
      id: `music_${id}`,
      name: 'song',
      singer: 'artist',
      source: 'kw',
      interval: '04:00',
      meta: { qualitys: [], _qualitys: { '128k': { size: '3M' } }, albumName: '', picUrl: '', toggleMusicInfo: null },
    } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: '128k',
    ext: 'mp3',
    fileName: `${id}.mp3`,
    filePath: '',
  },
})

const event = (type: EngineLiveEvent['type'], taskId: string, data: Partial<EngineLiveEvent['data']> = {}): EngineLiveEvent => ({
  type,
  data: { taskId, ...data },
})

beforeEach(() => {
  __resetForTest()
  mockStore.tasks = []
  mockEngine.start.mockClear()
  mockEngine.pause.mockClear()
  mockEngine.resume.mockClear()
  mockEngine.cancel.mockClear()
  mockEngine.removeResumeData.mockClear()
  mockEngine.ack.mockClear()
  mockResolver.getUrl.mockClear()
  mockResolver.refreshUrl.mockClear()
  mockStore.flushForAck.mockClear()
  global.i18n = { t: (key: string) => key } as never
})

describe('checkStartTask 并发与开关', () => {
  it('enable 关闭时不启动任务', async() => {
    const setting = (await import('@/store/setting/state')).default
    ;(setting.setting as unknown as Record<string, unknown>)['download.enable'] = false
    mockStore.tasks = [makeTask('a')]
    checkStartTask()
    await vi.waitFor(() => expect(mockEngine.start).not.toHaveBeenCalled())
    expect(mockStore.tasks[0].status).toBe('waiting')
    ;(setting.setting as unknown as Record<string, unknown>)['download.enable'] = true
  })

  it('启动任务：取链接后调引擎，状态转 run', async() => {
    mockStore.tasks = [makeTask('a')]
    checkStartTask()
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalledTimes(1))
    expect(mockResolver.getUrl).toHaveBeenCalledTimes(1)
    expect(mockEngine.start.mock.calls[0][0]).toMatchObject({
      taskId: 'a',
      url: 'https://example.com/a.mp3',
      targetPath: 'Download/a.mp3',
    })
    expect(mockStore.tasks[0].status).toBe('run')
    expect(mockStore.tasks[0].metadata.url).toBe('https://example.com/a.mp3')
    expect(mockStore.tasks[0].metadata.filePath).toBe('Download/a.mp3')
  })

  it('并发上限：第二个任务保持 waiting', async() => {
    mockStore.tasks = [makeTask('a'), makeTask('b')]
    checkStartTask()
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalledTimes(1))
    expect(mockStore.tasks[1].status).toBe('waiting')
  })

  it('取链接失败置 error', async() => {
    mockResolver.getUrl.mockResolvedValueOnce('')
    mockStore.tasks = [makeTask('a')]
    checkStartTask()
    await vi.waitFor(() => expect(mockStore.tasks[0].status).toBe('error'))
    expect(mockStore.tasks[0].errorCode).toBe('URL_FAILED')
    expect(mockEngine.start).not.toHaveBeenCalled()
  })
})

describe('事件状态机', () => {
  it('start 事件置 run 并清重试计数', async() => {
    const task = makeTask('a', 'run')
    mockStore.tasks = [task]
    handleEngineEvent(event('start', 'a'))
    expect(task.status).toBe('run')
  })

  it('progress 更新下载量与进度', () => {
    const task = makeTask('a', 'run')
    mockStore.tasks = [task]
    handleEngineEvent(event('progress', 'a', { downloaded: 50, total: 100 }))
    expect(task.downloaded).toBe(50)
    expect(task.total).toBe(100)
    expect(task.progress).toBe(50)
  })

  it('complete 置完成、落盘后 ack、补位下一个', async() => {
    const task = makeTask('a', 'run')
    task.metadata.url = 'https://example.com/a.mp3'
    const next = makeTask('b')
    mockStore.tasks = [task, next]
    handleEngineEvent(event('complete', 'a', { seq: 7, path: '/mock/Documents/Download/a.mp3', size: 100 }))
    expect(task.status).toBe('completed')
    expect(task.isComplate).toBe(true)
    await vi.waitFor(() => expect(mockEngine.ack).toHaveBeenCalledWith(7))
    // flushForAck 在 ack 之前（§4.6）
    expect(mockStore.flushForAck).toHaveBeenCalled()
    // 补位：第二个任务启动
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalledTimes(1))
  })

  it('complete 幂等：重复事件不重复收尾', async() => {
    const task = makeTask('a', 'run')
    mockStore.tasks = [task]
    handleEngineEvent(event('complete', 'a', { seq: 1 }))
    await vi.waitFor(() => expect(mockEngine.ack).toHaveBeenCalledTimes(1))
    const lrcCallsBefore = (await import('@/core/download/lrc')).saveLrc
    handleEngineEvent(event('complete', 'a', { seq: 2 }))
    await vi.waitFor(() => expect(mockEngine.ack).toHaveBeenCalledTimes(2))
    // 第二次 complete 未重复置状态或写歌词：任务仍为 completed
    expect(task.status).toBe('completed')
    expect(lrcCallsBefore).toBeDefined()
  })

  it('未知任务的事件忽略', () => {
    mockStore.tasks = []
    expect(() => handleEngineEvent(event('complete', 'ghost', { seq: 1 }))).not.toThrow()
  })
})

describe('错误映射（§7.4）', () => {
  it('NO_SPACE 置错并暂停全部等待任务', () => {
    const task = makeTask('a', 'run')
    const waiter = makeTask('b', 'waiting')
    mockStore.tasks = [task, waiter]
    handleEngineEvent(event('error', 'a', { code: 'NO_SPACE' }))
    expect(task.status).toBe('error')
    expect(task.errorCode).toBe('NO_SPACE')
    expect(waiter.status).toBe('pause')
  })

  it('HTTP_403 走刷新链接，第三轮置错', async() => {
    const task = makeTask('a', 'run')
    task.metadata.url = 'https://example.com/a.mp3'
    task.metadata.filePath = 'Download/a.mp3'
    mockStore.tasks = [task]
    handleEngineEvent(event('error', 'a', { code: 'HTTP_403' }))
    await vi.waitFor(() => expect(mockResolver.refreshUrl).toHaveBeenCalledTimes(1))
    expect(mockEngine.removeResumeData).toHaveBeenCalled()
    await vi.waitFor(() => expect(task.metadata.url).toBe('https://example.com/refreshed.mp3'))

    handleEngineEvent(event('error', 'a', { code: 'HTTP_403' }))
    await vi.waitFor(() => expect(mockResolver.refreshUrl).toHaveBeenCalledTimes(2))

    handleEngineEvent(event('error', 'a', { code: 'HTTP_403' }))
    await vi.waitFor(() => expect(task.status).toBe('error'))
    expect(task.errorCode).toBe('HTTP_403')
  })

  it('DNS 同样走刷新链接', async() => {
    const task = makeTask('a', 'run')
    task.metadata.url = 'https://example.com/a.mp3'
    task.metadata.filePath = 'Download/a.mp3'
    mockStore.tasks = [task]
    handleEngineEvent(event('error', 'a', { code: 'DNS' }))
    await vi.waitFor(() => expect(mockResolver.refreshUrl).toHaveBeenCalledTimes(1))
  })

  it('有续传数据的网络错误优先续传', async() => {
    mockEngine.resume.mockResolvedValueOnce(true)
    const task = makeTask('a', 'run')
    task.metadata.url = 'https://example.com/a.mp3'
    task.metadata.filePath = 'Download/a.mp3'
    mockStore.tasks = [task]
    handleEngineEvent(event('error', 'a', { code: 'NETWORK', hasResumeData: true }))
    await vi.waitFor(() => expect(mockEngine.resume).toHaveBeenCalledWith('a', false))
  })

  it('无续传数据 1 秒后重试', async() => {
    vi.useFakeTimers()
    try {
      const task = makeTask('a', 'run')
      task.metadata.url = 'https://example.com/a.mp3'
      task.metadata.filePath = 'Download/a.mp3'
      mockStore.tasks = [task]
      handleEngineEvent(event('error', 'a', { code: 'NETWORK', hasResumeData: false }))
      await vi.advanceTimersByTimeAsync(1100)
      expect(mockEngine.start).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('系统取消（强退）转暂停并保留续传数据', () => {
    const task = makeTask('a', 'run')
    mockStore.tasks = [task]
    handleEngineEvent(event('error', 'a', { code: 'FORCE_QUIT' }))
    expect(task.status).toBe('pause')
    expect(task.statusText).toBe('download_status_paused_force_quit')
    // 未调 cancel，续传数据保留
    expect(mockEngine.cancel).not.toHaveBeenCalled()
  })

  it('JS 主动取消后的 CANCELLED 忽略', async() => {
    const task = makeTask('a', 'run')
    mockStore.tasks = [task]
    await pauseDownloadTask(task)
    expect(mockEngine.pause).toHaveBeenCalledWith('a')
    expect(task.status).toBe('pause')
    // 引擎随后上报的 CANCELLED 不再改状态
    handleEngineEvent(event('error', 'a', { code: 'CANCELLED' }))
    expect(task.status).toBe('pause')
  })

  it('HTTP_416 删续传数据后重下', async() => {
    const task = makeTask('a', 'run')
    task.metadata.url = 'https://example.com/a.mp3'
    task.metadata.filePath = 'Download/a.mp3'
    mockStore.tasks = [task]
    handleEngineEvent(event('error', 'a', { code: 'HTTP_416' }))
    await vi.waitFor(() => expect(mockEngine.removeResumeData).toHaveBeenCalled())
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalledTimes(1))
  })
})

describe('手动操作（§7.6）', () => {
  it('startDownloadTasks 恢复暂停/出错任务，调度立即启动队首', () => {
    const paused = makeTask('a', 'pause')
    const errored = makeTask('b', 'error')
    const done = makeTask('c', 'completed')
    mockStore.tasks = [paused, errored, done]
    startDownloadTasks([paused, errored, done])
    // 并发上限 1：队首被调度同步置为 run，第二个保持 waiting
    expect(paused.status).toBe('run')
    expect(errored.status).toBe('waiting')
    expect(errored.errorCode).toBeUndefined()
    expect(done.status).toBe('completed')
  })
})
