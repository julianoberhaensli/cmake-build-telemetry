import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// kept equal to the repository's VERSION file by scripts/version.cmake (checked in CI)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// During development the API runs on :5080 (dotnet run); the SPA proxies to it.
const api = process.env.BT_API_URL ?? 'http://127.0.0.1:5080';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
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
