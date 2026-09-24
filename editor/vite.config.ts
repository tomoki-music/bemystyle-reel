import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: '../public',
  server: {
    port: Number(process.env.VITE_DEV_PORT || 3001),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 3002}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
