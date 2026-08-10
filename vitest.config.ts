/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  // Mirror the alias from vite.config.ts so @ai-images-browser/ai-intelligence
  // resolves in tests (StackCardWrapper / SimilarityStackExpandedViewWrapper
  // import it lazily whenever VITE_AI_FEATURES_AVAILABLE is truthy).
  resolve: {
    alias: {
      '@ai-images-browser/ai-intelligence': resolve(
        __dirname,
        'ai-intelligence',
      ),
    },
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
