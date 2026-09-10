import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Animated, StyleSheet, TouchableWithoutFeedback, View, type LayoutChangeEvent, type DrawerLayoutAndroidProps } from 'react-native'
import { type COMPONENT_IDS } from '@/config/constant'

// iOS：DrawerLayoutAndroid 在 iOS 上解析为 UnimplementedView 桩，
// 实例没有 openDrawer / closeDrawer 方法，点击左上角菜单即抛
// TypeError undefined is not a function（2026-09-01 iPhone 17 Pro
// 真机实测）。本文件按平台扩展惯例提供同接口的 iOS 抽屉：
// Animated 滑出面板 + 遮罩点按关闭，对外暴露与 Android 版一致的
// openDrawer / closeDrawer / fixWidth 命令式接口。

interface Props extends DrawerLayoutAndroidProps {
  visibleNavNames: COMPONENT_IDS[]
  widthPercentage: number
  widthPercentageMax?: number
}

export interface DrawerLayoutFixedType {
  openDrawer: () => void
  closeDrawer: () => void
  fixWidth: () => void
}

// visibleNavNames 是 Android 版修复「导航返回后无法打开」用的参数，
// iOS 版关闭即卸载面板、无此问题，不解构以免 lint 报未使用
const DrawerLayoutFixed = forwardRef<DrawerLayoutFixedType, Props>(({ widthPercentage, widthPercentageMax, children, renderNavigationView, drawerPosition, drawerBackgroundColor, style }, ref) => {
  const [drawerShown, setDrawerShown] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(0)
  const animValue = useRef(new Animated.Value(0)).current
  // 动画目标值：快开快关时防止旧的完成回调误卸载面板
  const targetRef = useRef(0)

  const isRight = drawerPosition == 'right'

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width
    const wp = Math.floor(width * widthPercentage)
    setDrawerWidth(widthPercentageMax ? Math.min(wp, widthPercentageMax) : wp)
  }, [widthPercentage, widthPercentageMax])

  const showDrawer = useCallback(() => {
    setDrawerShown(true)
    targetRef.current = 1
    Animated.timing(animValue, { toValue: 1, duration: 200, useNativeDriver: true }).start()
  }, [animValue])

  const hideDrawer = useCallback(() => {
    targetRef.current = 0
    Animated.timing(animValue, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      // 中途被重新打开打断时不卸载（finished 为 false）
      if (finished && targetRef.current === 0) setDrawerShown(false)
    })
  }, [animValue])

  useImperativeHandle(ref, () => ({
    openDrawer: showDrawer,
    closeDrawer: hideDrawer,
    // Android 版用它修 DrawerLayoutAndroid 导航返回后无法打开的问题；
    // iOS 实现每次布局重算宽度，无此问题，保留接口兼容
    fixWidth: () => {},
  }), [showDrawer, hideDrawer])

  const translateX = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [isRight ? drawerWidth : -drawerWidth, 0],
  })

  return (
    <View style={[styles.container, style]} onLayout={handleLayout}>
      {children}
      {drawerShown ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: animValue, backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <TouchableWithoutFeedback onPress={hideDrawer}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
        </Animated.View>
      ) : null}
      {/* 面板必须无条件挂载，不能按 drawerShown 条件渲染。Leaderboard/SongList
          是命令式填首屏数据（boardsListRef.current?.setList(...)），条件渲染时
          抽屉未开过 → renderNavigationView 从未执行 → ref 恒为 null → 那次
          setList 被 ?. 静默吞掉，列表停在初始空数组。Android 的
          DrawerLayoutAndroid 始终挂载面板，调用方依赖的正是这个语义。
          无条件挂载使 ref 在首次 commit 就绑定，早于调用方 useEffect，无竞态。
          关闭时靠 translateX 移出容器 + 容器 overflow:hidden 裁掉 */}
      <Animated.View
        // CI 自测按此 testID 在原生视图树里核验面板是否常驻挂载
        // （条件渲染的旧实现下抽屉未开过时 found 为假，用例判负）
        testID="lx-drawer-panel"
        pointerEvents={drawerShown ? 'auto' : 'none'}
        style={[
          styles.drawer,
          isRight ? styles.drawerRight : styles.drawerLeft,
          {
            width: drawerWidth,
            backgroundColor: drawerBackgroundColor ?? '#fff',
            transform: [{ translateX }],
          },
        ]}
      >
        {renderNavigationView()}
      </Animated.View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // 面板常驻挂载，关闭时靠 translateX 移到容器外，需裁剪避免溢出可见
    overflow: 'hidden',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  drawerLeft: {
    left: 0,
  },
  drawerRight: {
    right: 0,
  },
})

export default DrawerLayoutFixed
