import { Platform } from 'react-native'

/**
 * 下载能力平台开关：iOS 专属（§平台隔离）。
 * 独立成文件避免平台扩展文件自引用环：
 * `engine.ios.ts` 不能从 `./engine` 导入值，
 * iOS 上 Metro 会把该导入解析回 `engine.ios.ts` 自身
 */
export const isDownloadSupported = () => Platform.OS === 'ios'
