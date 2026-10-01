import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Narrow bridge for plugin panel windows (see src/main/plugins/ui/panels.ts).
          pluginView: resolve('src/preload/pluginView.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { ...shared, '@': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/renderer/overlay.html'),
          settings: resolve('src/renderer/settings.html'),
          onboarding: resolve('src/renderer/onboarding.html'),
          chat: resolve('src/renderer/chat.html'),
          hud: resolve('src/renderer/hud.html'),
          dialog: resolve('src/renderer/dialog.html'),
          'plugin-view': resolve('src/renderer/plugin-view.html')
        }
      }
    }
  }
})
