# Commercial architecture (design only — not implemented in this repository)

This page specifies how a future Pro/Team edition *would* plug into the seam this
repository already exposes. **None of it is built here.** It is a design document,
not a status page — read [docs/community-pro-team.md](community-pro-team.md) for
what exists today and what candidate features would even be for.

The guiding constraint, stated once so it doesn't need repeating in every section
below: **no piece of paid infrastructure — billing, entitlement checks, private
keys, issuance — belongs in this public repository.** A commercial build is a
separate, privately-distributed thing that happens to import this package's public
extension API. If that boundary is ever crossed, this document is wrong and should
be fixed before the code that crossed it ships.

## Why not just add a feature flag here?

Because a feature flag in a public MIT repository is not a security boundary — it's
a suggestion. Anyone can read the source, flip the flag, and use the "paid" feature
for free; worse, a flag that *looks* like enforcement but isn't is dishonest about
what it does. **No feature gate belongs in a public repository if it doesn't
actually gate anything.** The real gate has to live somewhere the person evaluating
the code cannot simply edit it out — which means outside this repository, behind an
actual license check the private package performs, backed by a service this
repository has no access to.

## Component boundaries

```
┌─────────────────────────────┐   ┌──────────────────────────┐   ┌─────────────────────┐
│ Community core               │   │ Extension API             │   │ Pro package          │
│ (this repo, public, MIT)     │   │ (this repo, public,       │   │ (private npm,        │
│                               │◄──┤  src/extension/*)         │──►│  never in this repo)  │
│ dashboard, collector, risk    │   │                            │   │                       │
│ engine, MCP scan, policy,     │   │ EditionProvider interface  │   │ registerEditionProvider│
│ integrity, reporting          │   │ Capability union type      │   │ implementation +      │
│                               │   │ verifyLicense() (verify-   │   │ scheduled jobs, packs,│
│                               │   │  only, Ed25519)            │   │ signed manifests, etc.│
└───────────────────────────────┘   └────────────┬───────────────┘   └──────────┬────────────┘
                                                    │                             │
                                                    │ license token (offline      │
                                                    │ verify against a public key)│
                                                    │                             │
                                                    ▼                             ▼
                                          ┌──────────────────────────────────────────┐
                                          │ License service (separate, not this repo)  │
                                          │ Stripe Checkout + webhooks · entitlement DB │
                                          │ Ed25519 PRIVATE key, issues signed tokens   │
                                          │ customer portal · renewal/revocation        │
                                          └──────────────────────────────────────────┘
```

### Community core (public, MIT — this repository)

Everything under `src/core`, `src/db`, `src/server`, `src/reporting`, `src/cli`,
`src/web`. Fully functional on its own; never calls into the extension API to ask
"am I allowed to do this" for anything it already does (see
[docs/community-pro-team.md](community-pro-team.md) — nothing free today gets gated
later).

### Extension API (public, MIT — `src/extension/`)

The seam, and *only* the seam:

- `src/extension/index.ts` — `Edition` (`"community" | "pro" | "team"`), `Capability`
  (the fixed candidate-feature vocabulary), `EditionProvider` interface, the
  always-off `communityProvider`, and `registerEditionProvider()` for a privately
  distributed package to call once at startup.
- `src/extension/license.ts` — `verifyLicense(token, publicKeyPem, now)`. Offline
  Ed25519 signature verification only. Token format (deliberately boring, per the
  file's own header comment): `base64url(payloadJson) + "." +
  base64url(ed25519Signature)`. This repository ships the verifier, fully tested
  with ephemeral keys generated in the test suite — **no production public key, no
  private key, and no issuance code live here.**

This module is public precisely because verification-only code reveals nothing
useful to an attacker: knowing how a signature is checked does not let you forge
one without the private key, which never leaves the license service.

### Pro package (private npm, not in this repository)

Would depend on this package (`@asterworks/agent-audit`) as a normal dependency,
call `registerEditionProvider()` with a real implementation, embed the production
Ed25519 **public** key, and layer in whatever Pro/Team capabilities it implements
(scheduled jobs, policy packs, a signed evidence manifest producer, etc. — see
candidate list in [docs/community-pro-team.md](community-pro-team.md)). Nothing
about its internals is specified here; it is out of scope for a public-repo design
doc by construction.

### License service (separate, not in this repository or its distribution)

The one component that actually needs to be trusted, and therefore the one
component this repository has zero code for. It would need, at minimum:

- **Stripe Checkout** for purchase, and **webhooks** to react to
  payment/subscription lifecycle events (created, renewed, canceled, payment failed).
- An **entitlement database** — who bought what, current status, expiry.
- The **Ed25519 private key** that signs `LicensePayload` tokens matching the shape
  `verifyLicense()` already expects (`version`, `licenseId`, `edition`, `issuedAt`,
  `expiresAt?`, `features`, `customerIdHash?` — see `LicensePayload` in
  `src/extension/index.ts`).
- A **customer portal** for self-service plan changes and cancellation.
- **Renewal and revocation** handling — a revoked license needs either a short
  expiry with forced re-issuance, or a revocation list the Pro package can check
  when online. Neither exists yet; this is a design gap to close before any billing
  code is written, not an implementation detail to skip.
- An **offline grace period** — this tool is local-first and must keep working
  without a network call on every invocation. A license, once issued, should verify
  offline for some bounded window (e.g. tied to `expiresAt`) before requiring the
  Pro package to phone home again. The exact window is a product decision, not
  specified here.
- A **privacy policy and terms of service** — required before any payment or
  account data is collected, and out of scope for an engineering document to draft.

None of this exists. Writing it is a prerequisite for selling anything, not a
follow-up task.

## What "verify-only" buys you

Because `src/extension/license.ts` only ever checks a signature against a public
key, this repository can be fully open-source without leaking anything that helps
someone mint a fake license: the private key never ships, not even in the private
Pro package (only the license *service* holds it). A leaked Pro package would leak
its public key — useless for forgery — and its own business logic, not the ability
to issue new licenses.

## Non-goals of this document

- It does not describe UI/UX for a pricing or upgrade flow.
- It does not commit to a timeline, a price, or which candidate features (see
  [docs/community-pro-team.md](community-pro-team.md)) actually ship.
- It does not specify the license service's tech stack beyond the requirements
  list above — that is an implementation choice for if and when this gets built.
