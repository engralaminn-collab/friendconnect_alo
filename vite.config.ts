import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@firebase/firestore/')) return 'firebase-firestore';
            if (id.includes('/node_modules/@firebase/auth/')) return 'firebase-auth';
            if (id.includes('/node_modules/@firebase/storage/')) return 'firebase-storage';
            if (id.includes('/node_modules/@firebase/app/')) return 'firebase-app';
            if (id.includes('/node_modules/@firebase/')) return 'firebase-shared';
            if (id.includes('/node_modules/firebase/')) return 'firebase-modular';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Browser requests stay relative; Vite proxies the optional first-party API locally.
      proxy: {
        '/api': { target: 'http://127.0.0.1:3210', changeOrigin: false },
        '/socket.io': { target: 'http://127.0.0.1:3210', changeOrigin: false, ws: true },
      },
    },
    preview: {
      host: '0.0.0.0',
      proxy: {
        '/api': { target: 'http://127.0.0.1:3210', changeOrigin: false },
        '/socket.io': { target: 'http://127.0.0.1:3210', changeOrigin: false, ws: true },
      },
    },
  };
});
