# Apple membership aggregate-read follow-up rollout

Status: local preparation only. This document does not authorize a Production
migration, deployment, or feature-flag change.

## Immutable migration set

Phase 1A remains frozen and unchanged:

- `20260722010000_apple_entitlement_ledger_phase_1a.sql`
- SHA-256: `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`

The separately approved follow-up is required before `read-membership` can
read Apple entitlement summaries:

- `20260723090000_apple_membership_aggregate_read.sql`
- SHA-256: `9422e806a711183f75535feb18c17a2650cd636830253c12762253cf4734725d`

This is a new immutable two-migration set; it does not rewrite or re-label the
Phase 1A frozen hash. The dependency order is strictly Phase 1A, then the
aggregate-read follow-up.

## Controlled checks

- Read-only preflight: `supabase/verification/20260723090000_apple_membership_aggregate_read_preflight.sql`.
- Read-only postflight: `supabase/verification/20260723090000_apple_membership_aggregate_read_postflight.sql`.
- Isolated PostgreSQL test: `npm run test:apple:postgres` performs both a
  fresh Phase 1A → follow-up install and an incremental follow-up install.
  It verifies exact RPC signature, `security definer`, fixed search path,
  anon/authenticated revoke, service-role grant, and production-only grants.

The follow-up never writes `public.user_membership`. Existing Stripe, ZPay,
and manual membership data remain the legacy read path and are not modified.

## Rollback policy

There is no destructive down migration. Before the follow-up commits, the
transaction may be rolled back. After commit, stop on a failed postflight and
use a reviewed forward fix or the verified complete-backup restore process.
