// import { createStyle } from '@/utils/tools'
import { useImperativeHandle, forwardRef, useState, useMemo } from 'react'
import { Modal, TouchableWithoutFeedback, View, type ModalProps as _ModalProps } from 'react-native'
import { useStatusbarHeight } from '@/store/common/hook'
// import { useWindowSize } from '@/utils/hooks'

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
//   // mask: {
//   //   position: 'absolute',
//   //   top: 0,
//   //   left: 0,
//   //   bottom: 0,
//   //   right: 0,
//   //   // width: '100%',
//   //   // height: '100%',
//   // },
// })

export interface ModalProps extends Omit<_ModalProps, 'visible'> {
  onHide?: () => void
  /**
   * 按返回键是否隐藏
   */
  keyHide?: boolean
  /**
   * 点击背景是否隐藏
   */
  bgHide?: boolean
  /**
   * 背景颜色
   */
  bgColor?: string
  /**
   * 是否填充状态栏
   */
  statusBarPadding?: boolean
}


export interface ModalType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<ModalType, ModalProps>(({
  onHide = () => {},
  keyHide = true,
  bgHide = true,
  bgColor = 'rgba(0,0,0,0)',
  statusBarPadding = true,
  children,
  ...props
}: ModalProps, ref) => {
  const [visible, setVisible] = useState(false)
  // const { window: windowSize } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const handleRequestClose = () => {
    if (keyHide) {
      setVisible(false)
      onHide()
    }
  }
  const handleBgClose = () => {
    if (bgHide) {
      setVisible(false)
      onHide()
    }
  }

  useImperativeHandle(ref, () => ({
    setVisible(_visible) {
      if (visible == _visible) return
      setVisible(_visible)
      if (!_visible) onHide()
    },
  }))

  const memoChildren = useMemo(() => children, [children])

  return (
    <Modal
      animationType="fade"
      transparent={true}
      hardwareAccelerated={true}
      statusBarTranslucent={true}
      // iPhone 上 RN Modal 的宿主 VC 方向掩码来自 supportedOrientations，
      // 缺省时 RCTModalHostView 返回竖屏独占（RCTModalHostView.m:211-215）
      // ——横屏下任何弹窗一呈现就被系统强制转回竖屏（真机 2026-09-07：
      // 自定义源管理、排行榜音源下拉均因此无法在横屏操作）。与
      // Info.plist 的 UISupportedInterfaceOrientations 三口径对齐；
      // Android 侧无此原生属性，行为不变
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      visible={visible}
      onRequestClose={handleRequestClose}
      {...props}
    >
      {/* <StatusBar /> */}
      {/* <View style={{ flex: 1, paddingTop: statusBarPadding ? StatusBar.currentHeight : 0 }}> */}
      <TouchableWithoutFeedback style={{ flex: 1, paddingTop: statusBarPadding ? statusBarHeight : 0 }} onPress={handleBgClose}>
        <View style={{ flex: 1, backgroundColor: bgColor }}>
          {memoChildren}
        </View>
      </TouchableWithoutFeedback>
      {/* </View> */}
    </Modal>
  )
})
