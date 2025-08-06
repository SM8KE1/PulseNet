import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'

<<<<<<< HEAD
export default defineConfig({
  base: './',
=======

export default defineConfig({
  base: './', 
>>>>>>> f20846ca6df45af9f0dda655b2d05069573f9dc8
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main.js',
      },
      {
        entry: 'src/preload.js',
        onstart(options) {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
})
