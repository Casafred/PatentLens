import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    outDir: '../../src/features/patent2pic',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1900,
    rollupOptions: { output: { manualChunks: {
      x6: ['@antv/x6'],
      'element-plus': ['element-plus'],
      elk: ['elkjs/lib/elk.bundled.js'],
    } } },
  },
})
