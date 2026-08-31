import { StatusBar } from 'react-native'
import settingState from '@/store/setting/state'

// Android：getWindowSize 基于可见窗口区域（getWindowVisibleDisplayFrame），
// 已排除状态栏时无需再垫高，否则取 StatusBar.currentHeight；
// alwaysKeepStatusbarHeight=true 强制预留。
// iOS 的窗口语义不同，走 statusbarHeight.ios.ts
export const getStatusbarHeight = async(winHeight: number, layoutHeight: number): Promise<number> => {
  if (!settingState.setting['common.alwaysKeepStatusbarHeight'] &&
    parseFloat(winHeight.toFixed(2)) >= parseFloat(layoutHeight.toFixed(2))) return 0
  return StatusBar.currentHeight ?? 0
}
