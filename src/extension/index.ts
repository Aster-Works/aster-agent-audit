/**
 * Commercial extension seam (REFACTOR_PLAN.md Phase 6, D11/D12).
 *
 * The Community build is complete and honest on its own: every capability
 * below reports its REAL state. There are no gates to flip in this repo —
 * a Pro/Team edition is a separate, privately-distributed package that
 * registers a different provider through this interface. Nothing in the
 * public repository pretends to be a paid feature.
 *
 * License verification is verify-only by design: the app carries a public
 * key and checks signatures; issuing licenses (the private key, billing,
 * entitlements) lives in a separate service that is NOT in this repo.
 * See docs/commercial-architecture.md for the service side.
 */

export type Edition = "community" | "pro" | "team";

/** Capabilities an edition provider can light up. Community ships them all off. */
export type Capability =
  | "scheduled-reports"
  | "policy-packs"
  | "signed-evidence-manifest"
  | "multi-workspace"
  | "central-policy"
  | "fleet-aggregation";

export type LicensePayload = {
  version: number;
  licenseId: string;
  edition: Exclude<Edition, "community">;
  issuedAt: string;
  expiresAt?: string;
  features: Capability[];
  customerIdHash?: string;
};

export type LicenseStatus =
  | { state: "community" }
  | { state: "valid"; payload: LicensePayload }
  | { state: "invalid" | "expired"; reason: string };

export interface EditionProvider {
  edition(): Edition;
  has(cap: Capability): boolean;
  license(): LicenseStatus;
}

/** The Community provider: no license, no capabilities, and says so plainly. */
export const communityProvider: EditionProvider = {
  edition: () => "community",
  has: () => false,
  license: () => ({ state: "community" }),
};

let active: EditionProvider = communityProvider;

/** A privately-distributed edition package calls this once at startup. */
export function registerEditionProvider(p: EditionProvider): void {
  active = p;
}

export function edition(): EditionProvider {
  return active;
}
