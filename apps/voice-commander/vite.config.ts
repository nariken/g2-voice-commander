import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5473 },
  build: { target: 'es2020', outDir: 'dist' },
});
