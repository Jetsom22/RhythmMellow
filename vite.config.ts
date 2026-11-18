import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { port: 5173 },
  // workbench.html: the level-design workbench (level session)
  build: { rollupOptions: { input: { main: 'index.html', workbench: 'workbench.html' } } },
});
