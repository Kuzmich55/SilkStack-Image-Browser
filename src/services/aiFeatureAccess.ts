/**
 * AI Feature Access — single source of truth for UI gating.
 *
 * A feature is available in the UI only when BOTH:
 *   1. The ai-intelligence package was present at build time
 *      (compile-time constant, enables Vite tree-shaking), AND
 *   2. The user has an active premium license (runtime state).
 *
 * Components should use useAiFeaturesEnabled() (reactive) for rendering,
 * and store actions can use isAiFeaturesEnabled() (imperative).
 */

import { useSettingsStore } from '../store/useSettingsStore';

/** Compile-time: is the ai-intelligence package present in this build? */
export const AI_MODULE_AVAILABLE: boolean = import.meta.env.VITE_AI_FEATURES_AVAILABLE;

/** Runtime: does the current license unlock premium features? */
function isPremiumLicense(status: string): boolean {
  return status === 'valid' || status === 'offline-valid';
}

/**
 * Reactive hook for components: true when AI features may be shown/used.
 * Re-renders when the license status changes (e.g. activation, expiry).
 */
export function useAiFeaturesEnabled(): boolean {
  const licenseStatus = useSettingsStore((s) => s.licenseStatus);
  if (!AI_MODULE_AVAILABLE) return false;
  return isPremiumLicense(licenseStatus);
}

/** Imperative variant for store actions / non-component contexts. */
export function isAiFeaturesEnabled(): boolean {
  if (!AI_MODULE_AVAILABLE) return false;
  return isPremiumLicense(useSettingsStore.getState().licenseStatus);
}
