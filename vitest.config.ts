/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  define: {
    'import.meta.env.VITE_AI_FEATURES_AVAILABLE': JSON.stringify('true'),
  },
});
