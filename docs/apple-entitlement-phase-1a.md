# App Store entitlement phase 1A

Local implementation only. The migration is a review draft and must not be applied as part of phase 1A.

Production migration preparation, backup options, preflight/postflight SQL, and
the fail-closed down migration are documented in
`docs/apple-entitlement-production-readiness.md`. That runbook does not authorize
Production execution or feature enablement.

The readiness package now uses one frozen PostgreSQL 17 catalog manifest across
postflight, rollback preflight, and the down guard. The rollback locks every
Phase 1A table plus `user_membership` before checking state. A SAFE decision
also requires external immutable proof that flags were never enabled; mutable
controls and resettable PostgreSQL statistics alone can never supply that proof.
Rollback preflight and down must execute in one explicit transaction and backend;
the preflight record is temporary, random, ten-minute bounded, and dropped on
commit. The operator's `SET LOCAL` never-enabled attestation documents process
completion only—it is not a secret, database fact, or authorization boundary.

## Safety boundaries

- All runtime controls default to disabled/off and are read only through a service-role RPC.
- Verification never trusts a client user identifier. The Supabase UUID comes from a verified bearer token.
- Verification-only mode does not persist and never claims membership synchronization.
- Ledger mode first obtains a separate current subscription status from App Store Server API, then writes
  immutable Apple transaction facts and the current entitlement projection. It never writes `user_membership`.
- Production and Sandbox are fixed by endpoint and checked again against verified Apple payloads and database constraints.
- Full JWS, signed notification payloads, receipts, Apple API JWTs and private keys are never persisted.

## Verify endpoint

`POST /.netlify/functions/verify-app-store-transaction`

Request: `{ signedTransactionInfo?: string, transactionId?: string, claimIntent, legacyClaimConfirmed? }`, where
`claimIntent` is `purchase`, `restore`, or `legacy_claim`. If both transaction references are present, the signed
JWS is verified first and its decoded transaction ID must equal `transactionId`. Any client user ID field is rejected.

The transaction JWS proves immutable transaction facts and locates the original transaction chain; it never by
itself grants current Premium. Ledger mode additionally requires a verified All Subscription Statuses response.
If current status cannot be obtained, no entitlement grant or ledger projection is written.

`purchase` and `restore` never enable legacy claim implicitly. `legacy_claim` requires
`legacyClaimConfirmed=true`, a currently granting Apple status, no appAccountToken in either the submitted or
current transaction, no existing binding, and no tombstone. An appAccountToken, when present, must hash to the
authenticated Supabase UUID.

Success modes:

- `verification-only`: transaction JWS verified; current status not queried; `persisted=false`,
  `currentStatusVerified=false`, `membershipSynced=false`.
- `ledger-only`: summary persisted; `persisted=true`, `membershipSynced=false`.

Stable error codes include `FEATURE_DISABLED`, `SERVICE_ENV_INCOMPLETE`, `FEATURE_CONFIG_UNAVAILABLE`,
`UNAUTHENTICATED`, `INVALID_SESSION`, `CLIENT_USER_ID_FORBIDDEN`, `INVALID_JSON`, `BODY_TOO_LARGE`,
`TRANSACTION_REFERENCE_REQUIRED`, `APPLE_ROOT_CA_MISSING`, `APPLE_VERIFICATION_FAILED`,
`APPLE_JWS_HEADER_INVALID`, `APPLE_JWS_ALGORITHM_INVALID`, `APPLE_JWS_CERT_CHAIN_INVALID`,
`TRANSACTION_ID_MISMATCH`, `BUNDLE_ID_MISMATCH`, `PRODUCT_ID_MISMATCH`,
`SUBSCRIPTION_GROUP_MISMATCH`, `ENVIRONMENT_MISMATCH`, `APP_ACCOUNT_TOKEN_MISMATCH`,
`SUBSCRIPTION_BOUND_TO_ANOTHER_ACCOUNT`, `CURRENT_STATUS_REQUIRED`, `CURRENT_STATUS_INVALID`,
`CURRENT_STATE_QUARANTINED`, `LEGACY_CLAIM_CONFIRMATION_REQUIRED`, `LEGACY_CLAIM_NOT_ALLOWED`, and
`LEDGER_WRITE_FAILED`.

## Ledger privacy and ordering

Raw appAccountToken values are never persisted. The ledger stores a domain-separated SHA-256 digest using
`cipmusic:app-account-token:v1:`. This avoids retaining a Supabase UUID but is not as strong as a secret-key HMAC;
introducing and rotating a dedicated HMAC secret remains a later hardening option.

`app_store_transactions` uses a three-column foreign key to bind its entitlement ID, environment, and original
transaction ID to one subscription chain. Current status stores four separate dimensions: signed transaction
evidence time, optional signed renewal evidence time, trusted server observation time, and a deterministic status
fingerprint. Observation time never resolves conflicting status snapshots by itself.

The same signed evidence and fingerprint is idempotent and only refreshes observation metadata. The same signed
evidence with a different fingerprint moves the chain to `quarantined`, stores a canonical pair of conflicting
fingerprints, and makes the Apple source fail closed regardless of arrival order. Only a strictly newer transaction
or renewal signed-evidence version may clear quarantine. `status_source` is audit metadata only; even a caller that
submits `reconciliation` cannot unlock equal evidence. It is excluded from the status fingerprint and may only
refresh observation/audit metadata. The HTTP request returns
`CURRENT_STATE_QUARANTINED`; transaction facts remain auditable.

The status fingerprint covers environment, original/current transaction chain, product, subscription group,
normalized status, grant decision, expiry, and auto-renew. It deliberately excludes observation source and
`app_account_token_hash`: binding evidence is checked independently. A missing incoming token hash never erases a
verified stored hash; a verified non-null hash may fill a previously null value after the normal user-binding checks.
Two different non-null hashes create a persistent fail-closed binding quarantine. The uncontested hash column is
cleared only in that hard-conflict state, while the canonical sorted pair is retained in dedicated non-reversible
hash fields. Generic ledger calls, including `reconciliation`, cannot clear that binding conflict.

A same-evidence active/canceled-active/billing-retry snapshot may deterministically become expired without
quarantine only after its already-persisted verified expiry reaches server `statement_timestamp()`, and only when
product, current transaction, chain, expiry, and auto-renew evidence still match. Premature expiry, revocation,
product changes, or other contradictions remain quarantined.

Stored `source_grants_premium` means only that the verified source snapshot was eligible when written. It is not a
current membership decision. `billing_get_current_entitlement_status` is the sole phase-1A read boundary and
dynamically requires a verified, Production, unexpired source. It is service-role-only and never writes
`user_membership`. Consequently a bounded entitlement becomes false after `valid_until` without another write.

Billing retry uses the same normalization function as Server API status handling: it grants only through the
verified paid-period expiry. Grace grants only when Apple provides a future grace-period expiry.

## Notification endpoints

- Production: `/.netlify/functions/app-store-notifications-v2`
- Sandbox: `/.netlify/functions/app-store-notifications-v2-sandbox`

They share one handler but pass a compile-time endpoint environment. A mismatched verified payload is rejected.
Unknown notification types are accepted into the metadata-only inbox as `accepted-unknown`; no signed payload is stored.
The inbox RPC rejects a reused notification UUID with a different payload hash.

## Root certificates

Reviewed Apple PKI root certificate files must be supplied separately under
`netlify/functions/_shared/apple/apple-root-ca/` as `.cer`, `.der`, or `.pem`. `netlify.toml` includes only those
files as deployment assets. Runtime downloading is prohibited. The repository intentionally contains no
certificate bytes in phase 1A, so real verification fails closed with `APPLE_ROOT_CA_MISSING`.

## Local verification

```bash
npm run typecheck:apple
npm run test:apple
npm run test:apple:postgres
npm run build:apple
```

The PostgreSQL suite requires PostgreSQL 15+ and creates a temporary cluster
that listens only on a Unix socket. See `tests/apple/postgres/README.md` for
binary discovery, explicit CI skip behavior, cleanup, and retained failure logs.

The PKI test creates a temporary EC test chain with the Apple certificate OIDs
required by the official library and validates a real x5c/ES256 signature path.
It never reads the production Root CA directory and does not represent proof of
Apple's production certificate chain.
