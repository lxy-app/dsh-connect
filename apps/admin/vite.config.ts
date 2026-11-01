import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /v1 to the Go server so the browser sees a single
// origin and no CORS preflight is needed during local development.
const target = process.env.DSH_CONNECT_SERVER_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  // `vite preview` serves the production build; mirror the dev proxy so the
  // built bundle can be verified against a real backend.
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/v1': {
        target,
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Route-level React.lazy splitting only. Manually grouping antd/rc into
    // vendor chunks introduces chunk cycles ("Cannot destructure property
    // 'Title' ... undefined") and white-screens the production build, so the
    // shared-chunk layout is left to rolldown's default code splitting.
  },
});