import { NativeModules } from 'react-native'

// iOS：RN StatusBar.currentHeight 是 Android-only（iOS 为 undefined，被
// ?? 0 静默吞成 0）；且 getWindowSize 走全屏 bounds，Android 的几何
// 判断在 iOS 恒算出 0，头部直接顶进灵动岛。改经 RN 自带
// StatusBarManager.getHeight 读 statusBarFrame 真实高度（points）。
// iOS 恒为 drawBehind 全屏绘制，不存在「窗口已排除状态栏」的场景，
// 几何参数不参与判断

interface StatusBarManagerModule {
  getHeight: (callback: (result: { height: number }) => void) => void
}

export const getStatusbarHeight = async(winHeight: number, layoutHeight: number): Promise<number> => {
  const statusBarManager = NativeModules.StatusBarManager as StatusBarManagerModule | undefined
  if (!statusBarManager) return 0
  return new Promise(resolve => {
    statusBarManager.getHeight(({ height }) => {
      resolve(typeof height === 'number' && height > 0 ? height : 0)
    })
  })
}
