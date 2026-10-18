import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The agent (port 4000) serves /api, including the live-story WebSocket; dev proxies it so the ui stays same-origin.
export default defineConfig({
  base: '/app/', plugins: [react()],
  envDir: '..', // the root .env; only VITE_* reach the client (VITE_MOCHI_ADMIN_TOKEN, dev only)
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: process.env.MOCHI_AGENT_URL ?? 'http://localhost:4000', ws: true } } },
});
