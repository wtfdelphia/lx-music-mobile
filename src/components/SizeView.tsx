import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, Dimensions, AppState } from 'react-native'
import commonState from '@/store/common/state'
import { setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'
import { getStatusbarHeight } from '@/utils/statusbarHeight'

export default memo(() => {
  const currentHeightRef = useRef(commonState.statusbarHeight)
  const sizeRef = useRef([0, 0])
  const dimensionsChangedRef = useRef(true)
  const viewRef = useRef<View>(null)
  const handleLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent | { nativeEvent: { layout: { width: number, height: number } } }) => {
    // console.log('handleLayout')
    if (!dimensionsChangedRef.current) return
    void getWindowSize().then(size => {
      dimensionsChangedRef.current = false
      // console.log(layout, size)
      sizeRef.current = [size.height, layout.height]
      void getStatusbarHeight(size.height, layout.height).then(height => {
        if (currentHeightRef.current != height) {
          currentHeightRef.current = height
          setStatusbarHeight(height)
        }
      }).catch(() => { /* 状态栏读数失败不得中断布局 */ })
      // console.log(layout, size)
      const currentSize = windowSizeTools.getSize()
      if (currentSize.width != layout.width || currentSize.height != layout.height) {
        windowSizeTools.setWindowSize(layout.width, layout.height)
      }
    }).catch(() => { /* 窗口读数失败不得中断布局 */ })
  }, [])
  useEffect(() => {
    // let timeout: NodeJS.Timeout | null = null
    const subscription = Dimensions.addEventListener('change', () => {
      dimensionsChangedRef.current = true
      // if (timeout) clearTimeout(timeout)
      // timeout = setTimeout(() => {
      //   timeout = null
      //   viewRef.current?.measureInWindow((x, y, width, height) => {
      //     handleLayout({ nativeEvent: { layout: { width, height } } })
      //   })
      // }, 100)
    })

    // 任务 9.19：横屏锁屏→解锁回竖屏后列表仍两排。旋转发生在应用挂起
    // 期间时场景非 active，RN 不发 Dimensions change 事件，门闩保持
    // false，解锁后即使 onLayout 触发也被 handleLayout 首行丢弃，
    // windowSizeTools 停在旋转前尺寸。回到 active 时重新打开门闩，
    // 并主动量一次视图：尺寸与记录不符即按合成 layout 重走完整同步
    // （原生读数 + 状态栏高度 + setWindowSize），不依赖 Dimensions 补发。
    // Android 同款监听无害：尺寸一致时不等式不成立，纯空操作
    // 主动重同步：测量当前视图尺寸，与记录不符即强制重走 handleLayout。
    // handleLayout 首行吃门闩，故在确认需要重排时临拍重开门闩（同拍无
    // 间隙，合法流程已关门闩也不影响本次强制同步）
    const resyncSize = () => {
      viewRef.current?.measureInWindow((_x, _y, width, height) => {
        if (!width || !height) return
        const current = windowSizeTools.getSize()
        if (current.width == width && current.height == height) return
        dimensionsChangedRef.current = true
        handleLayout({ nativeEvent: { layout: { width, height } } })
      })
    }
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state != 'active') return
      dimensionsChangedRef.current = true
      // 两拍覆盖旋转重排晚于 active 的时序差（首拍可能量到旋转前尺寸）
      setTimeout(resyncSize, 300)
      setTimeout(resyncSize, 1200)
    })

    const handleSettingUpdate = (keys: Array<keyof LX.AppSetting>) => {
      if (!keys.includes('common.alwaysKeepStatusbarHeight') || !sizeRef.current[1]) return
      void getStatusbarHeight(sizeRef.current[0], sizeRef.current[1]).then(height => {
        if (currentHeightRef.current != height) {
          currentHeightRef.current = height
          setStatusbarHeight(height)
        }
      }).catch(() => { /* 状态栏读数失败不得中断布局 */ })
    }
    global.state_event.on('configUpdated', handleSettingUpdate)

    return () => {
      subscription.remove()
      appStateSub.remove()
      global.state_event.off('configUpdated', handleSettingUpdate)
    }
  }, [handleLayout])
  return (<View ref={viewRef} style={StyleSheet.absoluteFill} onLayout={handleLayout} />)
}, () => true)
