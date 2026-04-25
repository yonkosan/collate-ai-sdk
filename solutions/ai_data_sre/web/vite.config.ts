import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api/pipeline/stream': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Disable buffering for SSE
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, _req, _res) => {
            // No transform needed, just ensure no buffering
          });
        },
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
