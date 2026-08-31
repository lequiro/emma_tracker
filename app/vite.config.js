import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served from https://lequiro.github.io/emma_tracker/ ,
// so every asset URL needs that prefix.
export default defineConfig({
  base: '/emma_tracker/',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'assets' },
});
