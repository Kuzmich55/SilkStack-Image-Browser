/**
 * AI Feature Access — single source of truth for all premium gating.
 *
 * Every premium-dependent decision (UI visibility, feature execution)
 * must route through one of the helpers below so that the app behaves
 * identically whether the ai-intelligence module is absent at build time
 * OR the user lacks an active license at runtime.
 *
 *   compile-time  │  runtime (license)  │  result
 *   ──────────────┼─────────────────────┼─────────
 *   module absent │  any                │  false
 *   module present│  no license         │  false
 *   module present│  premium active     │  true
 *
 * Components:  useAiFeaturesEnabled()        — reactive, re-renders on license change
 * Stores:      isAiFeaturesEnabled()         — imperative, reads current state
 * Stacking:    useStackingEnabled()          — user pref AND premium gate combined
 */

import { useSettingsStore } from '../store/useSettingsStore';

/** Compile-time: is the ai-intelligence package present in this build? */
export const AI_MODULE_AVAILABLE: boolean = import.meta.env.VITE_AI_FEATURES_AVAILABLE;

/** Runtime: does the current license unlock premium features? */
function isPremiumLicense(status: string): boolean {
  return status === 'valid' || status === 'offline-valid';
}

function isPremiumAvailable(): boolean {
  if (!AI_MODULE_AVAILABLE) return false;
  return isPremiumLicense(useSettingsStore.getState().licenseStatus);
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
  return isPremiumAvailable();
}

/**
 * Reactive hook: the effective stacking toggle state — the user's
 * preference ANDed with the premium gate.
 *
 * Without premium (or the module), stacking MUST be off regardless of
 * the persisted setting, so that images don't silently group based on
 * stale stackGroupId/similarityGroupId data from a previous license
 * session.
 */
export function useStackingEnabled(): boolean {
  const userPref = useSettingsStore((s) => s.isStackingEnabled);
  const licenseStatus = useSettingsStore((s) => s.licenseStatus);
  if (!AI_MODULE_AVAILABLE) return false;
  if (!isPremiumLicense(licenseStatus)) return false;
  return userPref;
}
