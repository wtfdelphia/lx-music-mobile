import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, Dimensions } from 'react-native'
import commonState from '@/store/common/state'
import { setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'
import { getStatusbarHeight } from '@/utils/statusbarHeight'

export default memo(() => {
  const currentHeightRef = useRef(commonState.statusbarHeight)
  const sizeRef = useRef([0, 0])
  const dimensionsChangedRef = useRef(true)
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
      global.state_event.off('configUpdated', handleSettingUpdate)
    }
  }, [])
  return (<View style={StyleSheet.absoluteFill} onLayout={handleLayout} />)
}, () => true)
