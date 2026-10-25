import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project URLs and inside iframes.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
