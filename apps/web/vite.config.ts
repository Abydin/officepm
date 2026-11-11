import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = fileURLToPath(new URL('./src', import.meta.url));
// The API server `pnpm dev` starts in the repo root. Override to point elsewhere.
const apiTarget = process.env.PM_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': src,
      // Bundle the shared source directly, so a build never ships a stale dist.
      '@officepm/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // Same-origin in dev, so the session cookie and the SSE stream just work.
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        // The entry and the stylesheet keep fixed names, which the server serves
        // from PM_WEB_DIR's root. The lazily loaded screens are split into hashed
        // files under assets/, which the server serves immutable at /assets/*.
        entryFileNames: 'app.js',
        chunkFileNames: path.join('assets', '[name]-[hash].js'),
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith('.css'))
            ? 'styles.css'
            : path.join('assets', '[name]-[hash][extname]'),
      },
    },
  },
});
