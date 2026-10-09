import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
      // RN 主入口是 Flow 源码，测试环境用最小桩替换
      'react-native': fileURLToPath(new URL('./test/mocks/react-native.ts', import.meta.url)),
    },
  },
})
