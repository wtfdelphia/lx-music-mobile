// iOS 导出走系统另存为面板（任务 9.16）：内置目录浏览器只能浏览与写入
// 应用自身沙箱，用户无法把备份保存到「文件」App 的其他位置；
// UIDocumentPicker export 模式是 iOS 上唯一合规的「保存到任意位置」路径。
// 平台扩展解析：iOS 命中本文件，Android 命中基名 exportPicker.ts
import { exportFile, gzipFile, temporaryDirectoryPath, unlink, writeFile } from '@/utils/fs'

export const systemExportPicker = true

// 打包成 .lxmc（JSON + gzip，与 handleSaveFile 同口径）后经系统另存为面板
// 拷到用户选定位置。暂存产物以目标文件名落盘——另存面板用源文件名做
// 建议名，时间戳名字用户在面板里没法改得明白。返回 saved=false 表示
// 用户取消，调用方按无操作处理，不得弹失败提示；原生呈现预算耗尽等
// 错误走 reject，由调用方落失败提示
export const saveViaSystemExportPicker = async(fileName: string, data: any): Promise<{ saved: boolean, path: string | null }> => {
  const stamp = Date.now()
  const tempJson = `${temporaryDirectoryPath}/lx_export_${stamp}.json`
  const tempGz = `${temporaryDirectoryPath}/${fileName}`
  try {
    await writeFile(tempJson, JSON.stringify(data))
    await gzipFile(tempJson, tempGz)
    const result = await exportFile(tempGz)
    return result == null ? { saved: false, path: null } : { saved: true, path: result.data }
  } finally {
    // 面板回调时系统已完成拷贝（或用户取消），暂存产物可安全清理
    void unlink(tempJson).catch(() => {})
    void unlink(tempGz).catch(() => {})
  }
}
