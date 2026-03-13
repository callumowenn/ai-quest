import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // allows LAN access
    port: 5173,
    allowedHosts: ['pi4life.local'],
    proxy: {
      '/turn': 'http://localhost:3001',
      '/generate': 'http://localhost:3001',
    },
  },
})
