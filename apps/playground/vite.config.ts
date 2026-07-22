import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: {
    rollupOptions: {
      input: {
        react: resolve(appRoot, 'index.html'),
        vanilla: resolve(appRoot, 'vanilla.html'),
        vue: resolve(appRoot, 'vue.html'),
      },
    },
  },
});
