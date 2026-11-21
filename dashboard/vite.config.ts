import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the API runs on :5080 (dotnet run); the SPA proxies to it.
const api = process.env.BT_API_URL ?? 'http://127.0.0.1:5080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/auth': { target: api, changeOrigin: true },
      '/healthz': { target: api, changeOrigin: true },
      '/openapi': { target: api, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          mantine: ['@mantine/core', '@mantine/hooks'],
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
        },
      },
    },
  },
});
