// iOS toast：ToastAndroid 在 iOS 上是空实现，改经 RNN overlay 显示（任务 6.2）
import { Navigation } from 'react-native-navigation'
import { TOAST_SCREEN } from '@/navigation/screenNames'

const DURATIONS = { long: 3500, short: 2000 } as const

let chain: Promise<void> = Promise.resolve()
let activeId: string | null = null

/**
 * 显示toast
 * @param message 消息
 * @param duration 时长
 * @param position 位置
 */
export const toast = (message: string, duration: 'long' | 'short' = 'short', position: 'top' | 'center' | 'bottom' = 'bottom') => {
  chain = chain.then(async() => {
    if (activeId != null) {
      const prevId = activeId
      activeId = null
      await Navigation.dismissOverlay(prevId).catch(() => {})
    }
    try {
      const id = await Navigation.showOverlay({
        component: {
          name: TOAST_SCREEN,
          passProps: {
            message,
            duration: DURATIONS[duration] ?? DURATIONS.short,
            position,
          },
          options: {
            layout: {
              componentBackgroundColor: 'transparent',
            },
            overlay: {
              interceptTouchOutside: false,
            },
          },
        },
      })
      // toast 显示经 chain 串行化，不存在并发写入
      // eslint-disable-next-line require-atomic-updates
      activeId = id
    } catch {
      // 导航尚未就绪等场景下静默失败，与 Android Toast 的"尽力而为"语义一致
    }
  })
}
