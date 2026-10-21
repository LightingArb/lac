import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { liveData } from './server/live';

export default defineConfig(({ mode }) => ({
  plugins: [react(), liveData({ ...loadEnv(mode, resolve(process.cwd(), '..'), ''), ...process.env } as Record<string, string>)],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
