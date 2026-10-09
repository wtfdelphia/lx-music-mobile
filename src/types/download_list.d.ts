
// interface DownloadList {

// }


declare namespace LX {
  namespace Download {
    type DownloadTaskStatus = 'run'
    | 'waiting'
    | 'pause'
    | 'error'
    | 'completed'

    type FileExt = 'mp3' | 'flac' | 'wav' | 'ape'

    interface ProgressInfo {
      progress: number
      speed: string
      downloaded: number
      total: number
    }

    interface DownloadTaskActionBase <A> {
      action: A
    }
    interface DownloadTaskActionData<A, D> extends DownloadTaskActionBase<A> {
      data: D
    }
    type DownloadTaskAction<A, D = undefined> = D extends undefined ? DownloadTaskActionBase<A> : DownloadTaskActionData<A, D>

    type DownloadTaskActions = DownloadTaskAction<'start'>
    | DownloadTaskAction<'complete'>
    | DownloadTaskAction<'refreshUrl'>
    | DownloadTaskAction<'statusText', string>
    | DownloadTaskAction<'progress', ProgressInfo>
    | DownloadTaskAction<'error', {
      error?: string
      message?: string
    }>

    interface ListItem {
      id: string
      isComplate: boolean
      status: DownloadTaskStatus
      statusText: string
      downloaded: number
      total: number
      progress: number
      speed: string
      metadata: {
        musicInfo: LX.Music.MusicInfoOnline
        url: string | null
        quality: LX.Quality
        ext: FileExt
        fileName: string
        /**
         * 相对 Documents 的路径（iOS 沙箱），读取时拼接
         */
        filePath: string
        /**
         * 来源列表，用于按列表分目录
         */
        listId?: string
      }
    }

    /**
     * 原生下载引擎上报的错误码
     */
    type DownloadErrorCode =
      | 'URL_FAILED'
      | `HTTP_${number}`
      | 'DNS'
      | 'NETWORK'
      | 'TIMEOUT'
      | 'NO_SPACE'
      | 'WRITE_FAILED'
      | 'FILE_MISSING'
      | 'FORCE_QUIT'
      | 'SYSTEM_CANCELLED'
      | 'CANCELLED'

    /**
     * 原生引擎任务事件
     */
    interface EngineEvent {
      seq: number
      type: 'complete' | 'error'
      data: {
        taskId: string
        path?: string
        size?: number
        code?: DownloadErrorCode
        httpStatus?: number
        message?: string
        hasResumeData?: boolean
      }
    }

    interface saveDownloadMusicInfo {
      list: ListItem[]
      addMusicLocationType: LX.AddMusicLocationType
    }
  }
}
