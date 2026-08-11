import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev only: forward /api/* to the Node server (node server.js on :8080) so
  // the ingest proxy works under `vite dev`. Production serves both from
  // server.js on one origin, so no proxy is needed there.
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
})
