import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    port: 5173,
    proxy: {
      // All Flask API routes proxied to the backend
      '/api': { target: 'https://localhost:5000', changeOrigin: true, secure: false },
      '/chats': { target: 'https://localhost:5000', changeOrigin: true, secure: false },
      '/admin': { target: 'https://localhost:5000', changeOrigin: true, secure: false },
      // Socket.IO — must proxy with ws:true
      '/socket.io': {
        target: 'https://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
