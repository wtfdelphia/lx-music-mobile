import { Linking } from 'react-native'
import { errorDialog } from './utils'
import { handleMusicAction } from './musicAction'
import { handlePlayerAction, type PlayerAction } from './playerAction'
import { handleSonglistAction } from './songlistAction'
import { extname, stat, importOpenedFile } from '@/utils/fs'
import { handleFileMusicAction, handleFileJSAction, handleFileLXMCAction } from './fileAction'


const handleLinkAction = async(link: string) => {
  // console.log(link)
  const [url, search] = link.split('?')
  const [type, action, ...paths] = url.replace('lxmusic://', '').split('/')
  const params: {
    paths: string[]
    data?: string
    [key: string]: any
  } = {
    paths: [],
  }
  if (search) {
    for (const param of search.split('&')) {
      const [key, value] = param.split('=')
      params[key] = value
    }
    if (params.data) params.data = JSON.parse(decodeURIComponent(params.data))
  }
  params.paths = paths.map(p => decodeURIComponent(p))
  console.log(params)
  switch (type) {
    case 'music':
      await handleMusicAction(action, params)
      break
    case 'songlist':
      await handleSonglistAction(action, params)
      break
    case 'player':
      await handlePlayerAction(action as PlayerAction)
      break
    // default: throw new Error('Unknown type: ' + type)
  }
}

const handleFileAction = async(link: string) => {
  // 任务 9.14：「文件」App in-place 打开递来的沙箱外安全作用域路径先经
  // 原生暂存拷进沙箱再处理；沙箱内路径（共享文档、已暂存产物）恒等透传。
  // 启动阶段原生暂存在冷启动拿不到访问（四轮真机实测），必须放在
  // JS 处理时点（此时应用已完全启动、访问可发起）
  const { path: stagedPath } = await importOpenedFile(link)
  const file = await stat(stagedPath)
  // console.log(file)
  switch (extname(file.name)) {
    case 'json':
    case 'lxmc':
      await handleFileLXMCAction(file)
      break
    case 'js':
      await handleFileJSAction(file)
      break
    case 'ogg':
    case 'flac':
    case 'wav':
    case 'mp3':
      await handleFileMusicAction(file)
      break
    default:
      if (!file.mimeType?.startsWith('audio/')) throw new Error('Unknown file type')
      await handleFileMusicAction(file)
      break
  }
}

// const handleHttpAction = async(link: string) => {
// }


const runLinkAction = async(link: string) => {
  if (link.startsWith('lxmusic://')) {
    try {
      await handleLinkAction(link)
    } catch (err: any) {
      errorDialog(err.message)
      // focusWindow()
    }
  } else if (link.startsWith('file://') || link.startsWith('content://')) {
    try {
      await handleFileAction(link)
    } catch (err: any) {
      errorDialog(err.message)
      // focusWindow()
    }
  }
  //  else if (/^https?:\/\//.test(link)) {
  //   try {
  //     await handleHttpAction(link)
  //   } catch (err: any) {
  //     errorDialog(err.message)
  //     // focusWindow()
  //   }
  // }
}

export const initDeeplink = async() => {
  Linking.addEventListener('url', ({ url }) => {
    void runLinkAction(url)
    console.log('deeplink', url)
  })
  const initialUrl = await Linking.getInitialURL()
  if (initialUrl == null) return
  console.log('deeplink', initialUrl)
  void runLinkAction(initialUrl)
}
