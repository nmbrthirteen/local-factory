import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.FACTORY_API ?? 'http://localhost:4310';
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path('./web/src'), '@shared': path('./shared') } },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      // The API only accepts requests whose Host and Origin match its own address.
      '/api': { target: api, changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', api)) },
    },
  },
});
