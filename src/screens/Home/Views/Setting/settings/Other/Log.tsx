import { memo, useRef, useState, useEffect } from 'react'
import { View } from 'react-native'
import { getLogs, clearLogs } from '@/utils/log'
// import { gzip, ungzip } from 'pako'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { createStyle, toast } from '@/utils/tools'
import { shareText } from '@/utils/nativeModules/utils'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import CheckBoxItem from '../../components/CheckBoxItem'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'

export default memo(() => {
  const t = useI18n()
  const alertRef = useRef<ConfirmAlertType>(null)
  const [logText, setLogText] = useState('')
  const isUnmountedRef = useRef(true)
  const [isEnableSyncErrorLog, setIsEnableSyncErrorLog] = useState(global.lx.isEnableSyncLog)
  const [isEnableUserApiLog, setIsEnableUserApiLog] = useState(global.lx.isEnableUserApiLog)

  // 日志文件不存在时 readFile 会 reject（首次启动尚未 initLogFile、或缓存
  // 目录被系统清理）。旧实现无 catch，此时弹窗恒空且无任何提示，
  // 与「日志真的是空的」无法区分——把失败原因显出来
  const getErrorLog = () => {
    void getLogs().then(log => {
      if (isUnmountedRef.current) return
      const logArr = log.split(/^----lx log----\n|\n----lx log----\n|\n----lx log----$/)
      // console.log(logArr)
      logArr.reverse()
      setLogText(logArr.join('\n\n').replace(/^\n+|\n+$/, ''))
    }).catch((err: any) => {
      if (isUnmountedRef.current) return
      setLogText(t('setting_other_log_tip_read_failed', { detail: err?.message ?? String(err) }))
    })
  }

  const openLogModal = () => {
    getErrorLog()
    alertRef.current?.setVisible(true)
  }

  const handleCleanLog = () => {
    void clearLogs().then(() => {
      toast(t('setting_other_log_tip_clean_success'))
      getErrorLog()
    })
  }

  // 日志落在 Caches 目录（见 utils/fs.ios.ts），iOS 上既不进 iTunes 文件共享
  // 也不进「文件」App，用户只能在弹窗里干看。走系统分享面板导出全文，
  // 让真机故障（播放错误、av stream probe、userApi）能带走归因证据
  // 失败必须可见：原生呈现被吞（见 UtilsModule.m shareText 注释）或
  // 日志读取失败时，旧实现全程静默，真机表现为「点了没反应」，
  // 排查真机故障时连取证入口本身都拿不到证据
  const handleExportLog = () => {
    void getLogs().then(async(log) => {
      if (!log) {
        toast(t('setting_other_log_tip_null'))
        return
      }
      await shareText(t('setting_other_log_btn_export'), t('setting_other_log'), log)
    }).catch((err: any) => {
      toast(t('setting_other_log_tip_export_failed', { detail: err?.message ?? String(err) }), 'long')
    })
  }

  const handleSetEnableSyncErrorLog = (enable: boolean) => {
    setIsEnableSyncErrorLog(enable)
    global.lx.isEnableSyncLog = enable
  }

  const handleSetEnableUserApiLog = (enable: boolean) => {
    setIsEnableUserApiLog(enable)
    global.lx.isEnableUserApiLog = enable
  }


  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  return (
    <>
      <SubTitle title={t('setting_other_log')}>
        <View style={styles.checkBox}>
          <CheckBoxItem check={isEnableSyncErrorLog} label={t('setting_other_log_sync_log')} onChange={handleSetEnableSyncErrorLog} />
          <CheckBoxItem check={isEnableUserApiLog} label={t('setting_other_log_user_api_log')} onChange={handleSetEnableUserApiLog} />
        </View>
        <View style={styles.btn}>
          <Button onPress={openLogModal}>{t('setting_other_log_btn_show')}</Button>
          <Button onPress={handleExportLog}>{t('setting_other_log_btn_export')}</Button>
        </View>
      </SubTitle>
      <ConfirmAlert
        ref={alertRef}
        cancelText={t('setting_other_log_btn_hide')}
        confirmText={t('setting_other_log_btn_clean')}
        onConfirm={handleCleanLog}
        showConfirm={!!logText}
        reverseBtn={true}
        >
        <View onStartShouldSetResponder={() => true}>
          {
            logText
              ? <Text selectable size={13}>{ logText }</Text>
              : <Text size={13}>{t('setting_other_log_tip_null')}</Text>
          }
        </View>
      </ConfirmAlert>
    </>
  )
})

const styles = createStyle({
  checkBox: {
    // paddingTop: 10,
    paddingBottom: 15,
    marginLeft: -25,
  },
  btn: {
    flexDirection: 'row',
  },
})
