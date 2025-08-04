import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // Use relative paths for assets
  plugins: [
    react(),
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'src/main.js',
      },
      {
        entry: 'src/preload.js',
        onstart(options) {
          // Onstart hook work like server hook
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
})
