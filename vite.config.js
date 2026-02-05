import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'build', // Changed from 'dist' to 'build' to match Vercel's default React expectation
    emptyOutDir: true,
  }
})
