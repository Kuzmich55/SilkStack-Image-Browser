/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  define: {
    'import.meta.env.VITE_AI_FEATURES_AVAILABLE': JSON.stringify('true'),
    'import.meta.env.VITE_IMH_LICENSE_SECRET': JSON.stringify(
      process.env.VITE_IMH_LICENSE_SECRET ||
        process.env.IMH_LICENSE_SECRET ||
        'test-secret-do-not-use-in-production',
    ),
  },
});
