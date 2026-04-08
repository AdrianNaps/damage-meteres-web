import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',  // relative asset paths so file:// loads work in packaged Electron
  envDir: path.resolve(__dirname, '..'),  // read .env from repo root
})
