// iOS 文件适配层：等价实现 fs.ts 的导出面（任务 1.4 / design D4）。
// 基于 react-native-fs；stat/readDir 合成 name/path/mimeType/canRead 字段。
// gzip 四方法走 GzipModule（任务 6.1）；文件选择走 UtilsModule.selectFile（任务 6.5）。
import RNFS from 'react-native-fs'
import { NativeModules } from 'react-native'

const { GzipModule, UtilsModule } = NativeModules

export type Encoding = 'base64' | 'utf8'
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'

export interface FileType {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  lastModified: number
  canRead: boolean
  mimeType: string
  size: number
}

export interface OpenDocumentOptions {
  extTypes: string[] | null
  toPath?: string
}

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''

// 「文件」App / 深链递来的路径带 `file://` 前缀；RNFS 内部 stat/readFile 会
// 自行剥掉，但 stat 返回的 `path` 字段原样回显输入。下游原生方法
// （GzipModule 等）按纯路径读文件，带前缀即读失败（真机 9.14 热启动
// 「导入失败」）。统一在适配层剥掉，返回纯路径
const stripFileScheme = (p: string) => p.startsWith('file://') ? p.slice('file://'.length) : p

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
  gz: 'application/gzip',
}
const getMimeType = (name: string): string => MIME_MAP[extname(name).toLowerCase()] ?? 'application/octet-stream'

// iOS 无外部存储；路径常量统一落到沙箱（外部存储路径与私有路径同指 Documents）
export const temporaryDirectoryPath = RNFS.CachesDirectoryPath
export const externalStorageDirectoryPath = RNFS.DocumentDirectoryPath
export const privateStorageDirectoryPath = RNFS.DocumentDirectoryPath

export const getExternalStoragePaths = async(_is_removable?: boolean): Promise<string[]> => []

// SAF / managed folder 概念在 iOS 不存在，相关 UI 由平台分支隐藏；
// 此处以空结果/显式 reject 桩化，保证导出面完整且调用不产生 undefined
export const selectManagedFolder = async(_isPersist: boolean = false): Promise<string> => {
  throw new Error('selectManagedFolder is not supported on iOS')
}
// 经 UIDocumentPickerViewController 选择并拷贝进沙箱；取消时 resolve null（与 Android 一致）
export const selectFile = async(options: OpenDocumentOptions): Promise<{ data: string } | null> => {
  return UtilsModule.selectFile({
    extTypes: options.extTypes ?? null,
    toPath: options.toPath ?? null,
  }) as Promise<{ data: string } | null>
}
// 系统另存为面板（任务 9.16）：把沙箱内源文件拷贝到用户选定位置
// （「文件」App 任意目录 / iCloud / 第三方存储提供者）；取消时 resolve null
export const exportFile = async(srcPath: string): Promise<{ data: string } | null> => {
  return UtilsModule.exportFile({ srcPath }) as Promise<{ data: string } | null>
}
// 「文件」App in-place 打开递来的沙箱外安全作用域路径经原生暂存拷进沙箱
// （任务 9.14）：启动阶段原生暂存拿不到访问（四轮真机实测），JS 处理深链
// 时应用已完全启动、访问可发起；沙箱内路径原样返回零拷贝
export interface OpenedFileImportResult {
  path: string
  staged: boolean
  attempts: number
}

export const importOpenedFile = async(path: string): Promise<OpenedFileImportResult> => {
  return UtilsModule.importOpenedFile(path) as Promise<OpenedFileImportResult>
}
export const removeManagedFolder = async(_path: string): Promise<void> => {}
export const getManagedFolders = async(): Promise<string[]> => []
export const getPersistedUriList = async(): Promise<string[]> => []

export const readDir = async(path: string): Promise<FileType[]> => {
  const items = await RNFS.readDir(path)
  return items.map((item) => ({
    name: item.name,
    path: item.path,
    size: item.size,
    isDirectory: item.isDirectory(),
    isFile: item.isFile(),
    lastModified: item.mtime ? item.mtime.getTime() : 0,
    canRead: true,
    mimeType: item.isFile() ? getMimeType(item.name) : '',
  }))
}

export const unlink = async(path: string) => {
  await RNFS.unlink(path)
}

export const mkdir = async(path: string) => {
  await RNFS.mkdir(path)
}

export const stat = async(path: string): Promise<FileType> => {
  const info = await RNFS.stat(path)
  const name = info.name ?? path.split('/').pop() ?? path
  return {
    name,
    path: stripFileScheme(info.path),
    size: info.size,
    isDirectory: info.isDirectory(),
    isFile: info.isFile(),
    lastModified: info.mtime ?? 0,
    canRead: true,
    mimeType: info.isFile() ? getMimeType(name) : '',
  }
}

export const hash = async(path: string, algorithm: HashAlgorithm) => RNFS.hash(path, algorithm)

export const readFile = async(path: string, encoding?: Encoding) => RNFS.readFile(path, encoding)

export const moveFile = async(fromPath: string, toPath: string) => {
  await RNFS.moveFile(fromPath, toPath)
}

// gzip 族：GzipModule（libz，windowBits=31），契约对齐
// react-native-file-system fork 的 Java 实现（任务 6.1）
export const gzipFile = async(fromPath: string, toPath: string) => GzipModule.gzipFile(fromPath, toPath)
export const unGzipFile = async(fromPath: string, toPath: string) => GzipModule.unGzipFile(fromPath, toPath)
export const gzipString = async(data: string, encoding?: Encoding) => GzipModule.gzipString(data, encoding ?? 'utf8')
export const unGzipString = async(data: string, encoding?: Encoding) => GzipModule.unGzipString(data, encoding ?? 'utf8')

export const existsFile = async(path: string) => RNFS.exists(path)

export const rename = async(path: string, name: string) => {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await RNFS.moveFile(path, `${dir}/${name}`)
}

export const writeFile = async(path: string, data: string, encoding?: Encoding) => {
  await RNFS.writeFile(path, data, encoding)
}

export const appendFile = async(path: string, data: string, encoding?: Encoding) => {
  await RNFS.appendFile(path, data, encoding)
}

export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    }
  }
  return RNFS.downloadFile({
    fromUrl: url,
    toFile: path,
    ...options,
  })
}

export const stopDownload = (jobId: number) => {
  RNFS.stopDownload(jobId)
}
