/**
 * Build verification — ensures the app builds successfully WITHOUT the
 * ai-intelligence package present.
 *
 * Temporarily hides the ai-intelligence directory, runs the TypeScript
 * compiler + Vite build, then restores the package. If the build fails,
 * it means some AI-dependent code is missing its compile-time guard
 * (import.meta.env.VITE_AI_FEATURES_AVAILABLE) or type stubs are out of
 * date in src/vite-env.d.ts.
 *
 * Usage:  node scripts/verify-build-without-ai.cjs
 */

const { existsSync, renameSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG_JSON = path.join(ROOT, 'ai-intelligence', 'package.json');
const PKG_JSON_BAK = path.join(ROOT, 'ai-intelligence', '_package.json.bak');

let failed = false;

function runStep(label, command, cwd) {
  console.log(`\n[verify:no-ai] ${label}...`);
  try {
    execSync(command, { cwd: cwd || ROOT, stdio: 'inherit' });
    console.log(`[verify:no-ai] ✓ ${label} passed`);
    return true;
  } catch (err) {
    console.error(`[verify:no-ai] ✗ ${label} FAILED`);
    console.error(err.message);
    failed = true;
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

console.log('[verify:no-ai] ─────────────────────────────────────────────');
console.log('[verify:no-ai] Verifying build works without ai-intelligence');
console.log('[verify:no-ai] ─────────────────────────────────────────────');

const aiPresent = existsSync(PKG_JSON);

if (!aiPresent) {
  console.log('[verify:no-ai] ai-intelligence/package.json not found —');
  console.log('[verify:no-ai] already building without AI. Proceeding directly.');
} else {
  console.log('[verify:no-ai] Temporarily hiding ai-intelligence/package.json...');
  renameSync(PKG_JSON, PKG_JSON_BAK);
}

try {
  // Step 1: TypeScript type-check
  runStep('TypeScript compilation (tsc -b)', 'npx tsc -b');

  // Step 2: Vite production build
  runStep('Vite production build (vite build)', 'npx vite build');

} finally {
  // Always restore, even if steps fail
  if (aiPresent && existsSync(PKG_JSON_BAK)) {
    renameSync(PKG_JSON_BAK, PKG_JSON);
    console.log('[verify:no-ai] Restored ai-intelligence/package.json');
  }
}

if (failed) {
  console.log('\n[verify:no-ai] ─────────────────────────────────────────────');
  console.log('[verify:no-ai] ✗ BUILD VERIFICATION FAILED');
  console.log('[verify:no-ai] The app does NOT build without ai-intelligence.');
  console.log('[verify:no-ai] Check that all AI-dependent code is guarded by:');
  console.log('[verify:no-ai]   import.meta.env.VITE_AI_FEATURES_AVAILABLE');
  console.log('[verify:no-ai] ─────────────────────────────────────────────');
  process.exit(1);
} else {
  console.log('\n[verify:no-ai] ─────────────────────────────────────────────');
  console.log('[verify:no-ai] ✓ BUILD VERIFICATION PASSED');
  console.log('[verify:no-ai] The app builds correctly without ai-intelligence.');
  console.log('[verify:no-ai] ─────────────────────────────────────────────');
}
