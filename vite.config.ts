import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves the project at https://tribeldragon.github.io/rooster-import/;
  // keep dev at the root so localhost redirect URIs (see README) still match.
  base: command === 'build' ? '/rooster-import/' : '/',
  server: { port: 5173, host: 'localhost' },
  build: {
    rollupOptions: {
      // redirect.html is the Microsoft login redirect URI
      input: { main: resolve(__dirname, 'index.html'), redirect: resolve(__dirname, 'redirect.html') },
    },
  },
}));
