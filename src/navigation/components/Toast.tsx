// iOS toast 覆盖层：经 RNN overlay 显示，行为对齐 Android ToastAndroid（任务 6.2）
import { useEffect } from 'react'
import { View, SafeAreaView, StyleSheet } from 'react-native'
import { Navigation } from 'react-native-navigation'

import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

export interface ToastProps {
  componentId: string
  message: string
  duration: number
  position: 'top' | 'center' | 'bottom'
}

export default ({ componentId, message, duration, position }: ToastProps) => {
  const theme = useTheme()

  useEffect(() => {
    const timer = setTimeout(() => {
      void Navigation.dismissOverlay(componentId)
    }, duration)
    return () => {
      clearTimeout(timer)
    }
  }, [componentId, duration])

  const offset = scaleSizeH(120)
  const toastStyle = {
    ...styles.toast,
    backgroundColor: theme['c-content-background'],
    marginTop: position === 'top' ? offset : 0,
    marginBottom: position === 'bottom' ? offset : 0,
  }

  return (
    <SafeAreaView style={styles.root} pointerEvents="none">
      <View style={{ ...styles.content, justifyContent: position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end' }}>
        <View style={toastStyle}>
          <Text style={styles.text} color={theme['c-primary-font']} numberOfLines={0}>{message}</Text>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  toast: {
    maxWidth: '86%',
    borderRadius: 20,
    paddingLeft: scaleSizeW(16),
    paddingRight: scaleSizeW(16),
    paddingTop: scaleSizeH(10),
    paddingBottom: scaleSizeH(10),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  text: {
    textAlign: 'center',
  },
})
