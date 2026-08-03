/**
 * License Service — minimal open-source types and defaults.
 *
 * The Zustand store needs LicenseState / LicenseStatus to type the
 * persisted license fields, and getDefaultLicenseState() for
 * initialization / reset.  Everything else — verification logic,
 * Gumroad API calls, and the License tab UI — lives in the closed-source
 * ai-intelligence module and is only reachable when that module is
 * present at build time AND the user activates a license.
 */

// ── Types ─────────────────────────────────────────────────────────────

/** Possible license states. */
export type LicenseStatus =
  | 'unchecked'       // No key has been entered or validated yet
  | 'valid'           // Key is valid and premium features are unlocked
  | 'invalid'         // Key was rejected by Gumroad (wrong / fake)
  | 'expired'         // Subscription-based license has lapsed
  | 'revoked'         // License was refunded or cancelled
  | 'offline-valid'   // Previously validated but can't reach API (still trusted)
  | 'verifying';      // Currently checking with the API

/** The stored license state persisted alongside other settings. */
export interface LicenseState {
  licenseKey: string;
  licenseStatus: LicenseStatus;
  licenseEmail: string;
  licensePurchaseDate: string | null;
  licenseLastValidated: number; // Date.now() timestamp
}

// ── Default state ─────────────────────────────────────────────────────

export function getDefaultLicenseState(): LicenseState {
  return {
    licenseKey: '',
    licenseStatus: 'unchecked',
    licenseEmail: '',
    licensePurchaseDate: null,
    licenseLastValidated: 0,
  };
}
