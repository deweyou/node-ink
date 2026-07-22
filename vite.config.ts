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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'packages/protocol/src/**/*.{ts,tsx}',
        'packages/engine-web/src/**/*.{ts,tsx}',
        'packages/editor-web/src/**/*.{ts,tsx}',
        'packages/renderer-svg/src/**/*.{ts,tsx}',
        'packages/editor-react/src/**/*.{ts,tsx}',
        'packages/editor-vue/src/**/*.{ts,tsx}',
        'packages/persistence-web/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
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
