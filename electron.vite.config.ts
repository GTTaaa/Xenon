import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Preload 运行在沙箱（sandbox: true）下，无法 require node_modules。
      // 关闭依赖外部化，将 @electron-toolkit/preload 等第三方依赖内联进产物，
      // 否则会出现 require("@electron-toolkit/preload") 解析失败导致 window.api 未暴露、窗口白屏。
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
