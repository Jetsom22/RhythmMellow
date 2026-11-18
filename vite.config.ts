import { defineConfig } from 'vite';
// Two pages: the game, and the studio where the music is written and mixed.
export default defineConfig({ base: './', server: { port: 5173 }, build: { rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } } } });
