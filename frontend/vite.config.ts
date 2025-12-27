import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@popperjs/core': '@popperjs/core/dist/umd/popper.js',
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7790',
        changeOrigin: true,
      },
    },
  },
})
