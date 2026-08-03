/**
 * License Service — Gumroad integration for premium feature gating.
 *
 * Flow:
 *   1. User purchases a license on Gumroad → receives a license key via email.
 *   2. User enters the key in Settings → app validates via Gumroad API.
 *   3. On success, the license status is cached locally for offline use.
 *   4. Periodic re-validation (every 7 days) catches refunds / cancellations.
 *
 * Architecture:
 *   - Verification calls go through the Electron main process (IPC) to avoid
 *     CORS restrictions. In non-Electron contexts (dev server), a direct
 *     fetch is attempted with a fallback message.
 *   - The cached status is stored in Zustand settings (persisted to disk).
 */

// ── Configuration ─────────────────────────────────────────────────────

/** Your Gumroad product permalink — set this to your actual product ID. */
export const GUMROAD_PRODUCT_PERMALINK = 'images';

/**
 * How long a cached validation result is trusted before requiring
 * a fresh check against the Gumroad API (in milliseconds).
 * Default: 7 days.
 */
const VALIDATION_CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

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

/** A decoded Gumroad license payload (what the API returns). */
export interface GumroadLicensePayload {
  success: boolean;
  message?: string;
  uses?: number;
  purchase?: {
    seller_id: string;
    product_id: string;
    product_name: string;
    permalink: string;
    product_permalink: string;
    email: string;
    price: number;
    gumroad_fee: number;
    currency: string;
    quantity: number;
    discover_fee_charged: boolean;
    can_contact: boolean;
    referrer: string;
    card: Record<string, unknown>;
    order_number: number;
    sale_id: string;
    sale_timestamp: string;
    purchaser_id: string;
    subscription_id: string;
    variants: string;
    license_key: string;
    is_multiseat_license: boolean;
    ip_country: string;
    recurrence: string;
    is_gift_receiver_purchase: boolean;
    refunded: boolean;
    disputed: boolean;
    dispute_won: boolean;
    id: string;
    created_at: string;
    custom_fields: unknown[];
    subscription_cancelled_at: string | null;
    subscription_failed_at: string | null;
  };
}

// ── Verification ──────────────────────────────────────────────────────

/**
 * Validate a license key against the Gumroad API.
 *
 * This is the primary verification path. In Electron, it goes through IPC
 * to the main process. In a plain browser / dev server, it tries a direct
 * fetch (Gumroad's API generally allows CORS).
 *
 * @returns The parsed API response, or a synthetic error payload.
 */
export async function verifyLicenseKey(
  licenseKey: string,
  productPermalink: string = GUMROAD_PRODUCT_PERMALINK,
): Promise<GumroadLicensePayload> {
  // Prefer Electron IPC (main process proxy) to avoid CORS issues.

  if (window.electronAPI?.verifyGumroadLicense) {
    try {
      const result = await window.electronAPI.verifyGumroadLicense(
        productPermalink,
        licenseKey,
      );
      // The IPC handler returns the raw Gumroad JSON payload — cast is safe
      // because we control both the preload bridge and the main-process handler.
      return result as unknown as GumroadLicensePayload;
    } catch (err) {
      console.warn('[license] IPC verification failed, falling back to direct fetch:', err);
    }
  }

  // Direct browser call — works fine for development or when CORS is not an issue.
  const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      product_permalink: productPermalink,
      license_key: licenseKey,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Gumroad API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// ── Cached status helpers ──────────────────────────────────────────────

/**
 * Determine if a previously cached license result is still fresh enough
 * to trust without a network call.
 */
export function isValidationCacheFresh(lastValidated: number): boolean {
  return Date.now() - lastValidated < VALIDATION_CACHE_DURATION_MS;
}

/**
 * Determine whether premium features should be unlocked based on
 * the current license state.
 */
export function isPremiumUnlocked(status: LicenseStatus): boolean {
  return status === 'valid' || status === 'offline-valid';
}

/**
 * Derive the executable license status from a Gumroad API response.
 */
export function statusFromGumroadResponse(
  payload: GumroadLicensePayload,
): { status: LicenseStatus; email: string; purchaseDate: string | null } {
  if (!payload.success) {
    return { status: 'invalid', email: '', purchaseDate: null };
  }

  const purchase = payload.purchase;
  if (!purchase) {
    return { status: 'invalid', email: '', purchaseDate: null };
  }

  // Check for refund / dispute
  if (purchase.refunded || purchase.disputed) {
    return { status: 'revoked', email: purchase.email, purchaseDate: purchase.sale_timestamp };
  }

  // Check for cancelled subscription (only matters for recurring products)
  if (purchase.subscription_cancelled_at) {
    return { status: 'revoked', email: purchase.email, purchaseDate: purchase.sale_timestamp };
  }

  // Check for failed subscription renewal
  if (purchase.subscription_failed_at) {
    return { status: 'expired', email: purchase.email, purchaseDate: purchase.sale_timestamp };
  }

  return {
    status: 'valid',
    email: purchase.email,
    purchaseDate: purchase.sale_timestamp,
  };
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
