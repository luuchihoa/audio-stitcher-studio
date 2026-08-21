import { defineConfig } from 'vite';

export default defineConfig({
  // Sử dụng đường dẫn tương đối './' để chạy hoàn hảo trên GitHub Pages sub-path
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
