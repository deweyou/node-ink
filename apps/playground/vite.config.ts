import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        react: resolve(appRoot, 'index.html'),
        vanilla: resolve(appRoot, 'vanilla.html'),
      },
    },
  },
});
