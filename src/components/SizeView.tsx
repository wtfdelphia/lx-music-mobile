import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, Dimensions, AppState, Platform } from 'react-native'
import commonState from '@/store/common/state'
import { setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'
import { getStatusbarHeight } from '@/utils/statusbarHeight'

// iOS 双通道幂等同步：Dimensions change 与 View onLayout 是两条独立
// 异步通道，到达顺序无保证。旧实现的门闩只在 Dimensions 先到时打开，
// onLayout 先到会被门闩丢弃，之后不再触发，尺寸冻结到下次回到
// active——这就是横竖屏切换偶尔才生效的根因。iOS 键盘不改变根视图
// 尺寸，门闩过滤对 iOS 无意义，直接拆除；两通道各自同步，谁先到谁
// 生效，后到的判断尺寸相同即跳过（幂等）。
// Android 保留门闩：adjustResize 下键盘也会触发 onLayout，需过滤。
const syncSize = (width: number, height: number) => {
  const w = Math.round(width)
  const h = Math.round(height)
  if (!w || !h) return
  const cur = windowSizeTools.getSize()
  // 先取整再比较：layout 值带小数而 setWindowSize 存取整值，
  // 不取整会恒不相等，导致每次 onLayout 重复派发、重复渲染
  if (cur.width != w || cur.height != h) windowSizeTools.setWindowSize(w, h)
}

export default memo(() => {
  const currentHeightRef = useRef(commonState.statusbarHeight)
  const sizeRef = useRef([0, 0])
  const dimensionsChangedRef = useRef(true)
  const viewRef = useRef<View>(null)
  const handleLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent | { nativeEvent: { layout: { width: number, height: number } } }) => {
    // console.log('handleLayout')
    if (Platform.OS === 'ios') {
      // iOS：绕过门闩直接同步尺寸，与 Dimensions 通道幂等
      syncSize(layout.width, layout.height)
      // 状态栏高度沿用异步读数链路，不受门闩影响
      void getWindowSize().then(size => {
        sizeRef.current = [size.height, layout.height]
        void getStatusbarHeight(size.height, layout.height).then(height => {
          if (currentHeightRef.current != height) {
            currentHeightRef.current = height
            setStatusbarHeight(height)
          }
        }).catch(() => { /* 状态栏读数失败不得中断布局 */ })
      }).catch(() => { /* 窗口读数失败不得中断布局 */ })
      return
    }
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
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      dimensionsChangedRef.current = true
      // iOS：Dimensions 通道直接携带新尺寸，旋转瞬间即可同步，
      // 不用等布局完成；与 onLayout 通道幂等（后到者尺寸相同即跳过）
      if (Platform.OS === 'ios') syncSize(window.width, window.height)
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
