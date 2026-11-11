import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'events': path.resolve(__dirname, 'src/shims/events.ts'),
      'node:events': path.resolve(__dirname, 'src/shims/events.ts'),
      'stream': path.resolve(__dirname, 'src/shims/stream.ts'),
      'node:stream': path.resolve(__dirname, 'src/shims/stream.ts'),
      'crypto': path.resolve(__dirname, 'src/shims/crypto.ts'),
      'node:crypto': path.resolve(__dirname, 'src/shims/crypto.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
} as ReturnType<typeof defineConfig>);
