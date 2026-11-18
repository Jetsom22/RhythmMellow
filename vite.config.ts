import { defineConfig } from 'vite';
// Three pages: the game, the studio where the music is written and mixed (sound session),
// and the level-design workbench (level session).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { rollupOptions: { input: { main: 'index.html', studio: 'studio.html', workbench: 'workbench.html' } } },
});
