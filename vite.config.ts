import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['.agents/**', '.claude/**', 'docs/**'],
    semi: true,
    singleQuote: true,
  },
  lint: {
    plugins: ['typescript'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
  },
  run: {
    tasks: {
      'rust:check': {
        command: './scripts/check-rust.sh',
        cache: false,
      },
      'wasm:build': {
        command: './scripts/build-wasm.sh',
        cache: false,
      },
    },
  },
});
