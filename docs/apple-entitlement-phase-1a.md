# App Store entitlement phase 1A

Local implementation only. The migration is a review draft and must not be applied as part of phase 1A.

## Safety boundaries

- All runtime controls default to disabled/off and are read only through a service-role RPC.
- Verification never trusts a client user identifier. The Supabase UUID comes from a verified bearer token.
- Verification-only mode does not persist and never claims membership synchronization.
- Ledger mode writes Apple transaction summaries and `billing_entitlements_v2`; it never writes `user_membership`.
- Production and Sandbox are fixed by endpoint and checked again against verified Apple payloads and database constraints.
- Full JWS, signed notification payloads, receipts, Apple API JWTs and private keys are never persisted.

## Verify endpoint

`POST /.netlify/functions/verify-app-store-transaction`

Request: `{ signedTransactionInfo?: string, transactionId?: string }`. If both are present, the signed JWS is
verified first and its decoded transaction ID must equal `transactionId`. Any client user ID field is rejected.

Success modes:

- `verification-only`: Apple data verified; `persisted=false`, `membershipSynced=false`.
- `ledger-only`: summary persisted; `persisted=true`, `membershipSynced=false`.

Stable error codes include `FEATURE_DISABLED`, `SERVICE_ENV_INCOMPLETE`, `FEATURE_CONFIG_UNAVAILABLE`,
`UNAUTHENTICATED`, `INVALID_SESSION`, `CLIENT_USER_ID_FORBIDDEN`, `INVALID_JSON`, `BODY_TOO_LARGE`,
`TRANSACTION_REFERENCE_REQUIRED`, `APPLE_ROOT_CA_MISSING`, `APPLE_VERIFICATION_FAILED`,
`APPLE_JWS_HEADER_INVALID`, `APPLE_JWS_ALGORITHM_INVALID`, `APPLE_JWS_CERT_CHAIN_INVALID`,
`TRANSACTION_ID_MISMATCH`, `BUNDLE_ID_MISMATCH`, `PRODUCT_ID_MISMATCH`,
`SUBSCRIPTION_GROUP_MISMATCH`, `ENVIRONMENT_MISMATCH`, `APP_ACCOUNT_TOKEN_MISMATCH`,
`SUBSCRIPTION_BOUND_TO_ANOTHER_ACCOUNT`, and `LEDGER_WRITE_FAILED`.

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
