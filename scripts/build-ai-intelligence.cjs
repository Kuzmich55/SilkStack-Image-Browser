/**
 * Conditional build script for the ai-intelligence package.
 *
 * If the `ai-intelligence/` directory exists (with a package.json), builds it.
 * Otherwise, prints a message and exits successfully — the main app will
 * compile and run without AI features.
 */

const { existsSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const aiDir = path.join(__dirname, '..', 'ai-intelligence');

if (existsSync(path.join(aiDir, 'package.json'))) {
  console.log('[build-ai-intelligence] Building ai-intelligence package...');
  try {
    execSync('npm run build', { cwd: aiDir, stdio: 'inherit' });
    console.log('[build-ai-intelligence] ✓ ai-intelligence built successfully');
  } catch (err) {
    console.error('[build-ai-intelligence] ✗ ai-intelligence build failed');
    console.error(err.message);
    process.exit(1);
  }
} else {
  console.log('[build-ai-intelligence] ai-intelligence package not found — skipping build.');
  console.log('[build-ai-intelligence] The app will run without AI features (LLM tagging, embeddings).');
}
