import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: 'localhost' },
  build: {
    rollupOptions: {
      // redirect.html is the Microsoft login redirect URI
      input: { main: resolve(__dirname, 'index.html'), redirect: resolve(__dirname, 'redirect.html') },
    },
  },
});
