import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The agent (port 4000) serves /api, including the live-story WebSocket; dev proxies it so the ui stays same-origin.
export default defineConfig({
  base: '/app/', plugins: [react()],
  envDir: '..', // the root .env; only VITE_* reach the client (VITE_MOCHI_ADMIN_TOKEN, dev only)
  // /story/:id and /dashboard/:id (published links) are agent redirects into #/story|dashboard/:id, same-origin here too.
  server: { port: 5173, strictPort: true, proxy: Object.fromEntries(['/api', '/story/', '/dashboard/'].map((p) => [p, { target: process.env.MOCHI_AGENT_URL ?? 'http://localhost:4000', ws: p === '/api' }])) },
});
