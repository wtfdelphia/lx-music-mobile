import { NativeModules } from 'react-native'

// iOS：RN StatusBar.currentHeight 是 Android-only（iOS 为 undefined，被
// ?? 0 静默吞成 0）；且 getWindowSize 走全屏 bounds，Android 的几何
// 判断在 iOS 恒算出 0，头部直接顶进灵动岛。改经 RN 自带
// StatusBarManager.getHeight 读 statusBarFrame 真实高度（points）。
// iOS 恒为 drawBehind 全屏绘制，不存在「窗口已排除状态栏」的场景，
// 几何参数不参与判断。
//
// 关键防御（2026-09-01，iPhone 17 Pro / iOS 26.6 启动即崩回归）：
// 此处任何异常都会经 react-native-exception-handler 接管的全局
// ErrorUtils 上报成致命弹窗。因此 getHeight 调用、回调解构、整段
// 逻辑都必须兜底返回 0，绝不让本模块成为未捕获异常源。

interface StatusBarManagerModule {
  getHeight?: (callback: (result?: { height?: number } | null) => void) => void
}

export const getStatusbarHeight = async(winHeight: number, layoutHeight: number): Promise<number> => {
  try {
    const statusBarManager = NativeModules.StatusBarManager as StatusBarManagerModule | undefined
    if (!statusBarManager || typeof statusBarManager.getHeight !== 'function') return 0
    return await new Promise<number>(resolve => {
      try {
        statusBarManager.getHeight?.(result => {
          const height = result && typeof result.height === 'number' ? result.height : 0
          resolve(height > 0 ? height : 0)
        })
      } catch {
        resolve(0)
      }
    })
  } catch {
    return 0
  }
}
