# Phase 1A PostgreSQL 17 readiness report — 2026-07-22

Scope: local synthetic testing only. No Production connection, credentials, data,
migration, Netlify setting, Apple setting, or feature flag was used.

## Environment

- PostgreSQL: `postgres (PostgreSQL) 17.10 (Homebrew)`
- Binary directory: `/opt/homebrew/opt/postgresql@17/bin`
- Cluster: temporary `initdb` directory under `/tmp/cipmusic-apple-pg17.*`
- Network: `listen_addresses=''`; Unix socket only
- Port: `55440` (non-default)
- Authentication: local temporary cluster `trust`; TCP rejected
- Service state: `postgresql@17 none`; no Homebrew service started
- Synthetic fixtures only; no copied Production rows or identifiers

## Tested artifact integrity

- Frozen up migration SHA-256:
  `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`
- Fail-closed down migration SHA-256:
  `49f278e3360ccc825a54894d631a6ff9ac029a776b9dd668a8c417006987e566`

The lifecycle results below apply to these exact artifacts. The frozen up
migration remained identical to `origin/main`.

## Command

```bash
POSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin \
  npm run test:apple:readiness:pg17
```

## Matrix

| Step | Result |
|---|---|
| Fresh PG17 cluster and minimal Supabase-compatible bootstrap | PASS |
| Production preflight | `MIGRATION_PREFLIGHT_GO` |
| Frozen up migration | PASS |
| Migration history fixture | PASS |
| Postflight: enums/tables/112 columns/55 constraints/20 indexes | PASS |
| Postflight: functions, owners, `SECURITY DEFINER`, `search_path` | PASS |
| Postflight: RLS, policies, grants and runtime defaults | PASS |
| All Phase 1A data tables initially empty | PASS |
| Rollback preflight on pristine installation | `ROLLBACK_SAFE` |
| Down migration with SHA-bound approval | PASS |
| All Phase 1A objects removed | PASS |
| Synthetic membership/payment objects preserved | PASS |
| Up migration after down/history repair simulation | PASS |
| Second postflight | `MIGRATION_POSTFLIGHT_PASS` |
| Synthetic notification row blocks rollback preflight | `ROLLBACK_UNSAFE` |
| Down migration independently rejects non-empty data | PASS |
| Enabled verification flag blocks rollback preflight | `ROLLBACK_UNSAFE` |
| Down migration independently rejects changed controls | PASS |
| Existing RPC/RLS/replay/idempotency/concurrency suite on PG17 | PASS |

Lifecycle result:

```text
PASS: preflight -> up -> postflight -> rollback preflight -> down -> up -> postflight
PASS: data-present rollback rejected
PASS: feature-flag rollback rejected
PASS: synthetic user_membership/Stripe-ZPay/Google Play objects preserved
PASS: existing RPC/RLS/idempotency/concurrency suite
```

## Timing and locks

- Reported up duration: `<1s` (shell timer rounded to `0s`)
- Reported down duration: `<1s` (shell timer rounded to `0s`)
- Complete readiness suite: `10s`
- No lock timeout, statement timeout, deadlock, blocked waiter, or partial DDL
  occurred.
- Both up and down executed as explicit transactions.
- The harness uses `lock_timeout=5s`, `statement_timeout=5min`, and
  `idle_in_transaction_session_timeout=2min` for the down path; the Production
  runbook requires the same session limits before the up migration.

## Test-development failures resolved before final pass

During harness development, local-only runs caught and corrected:

- an overlong macOS Unix-socket path;
- invalid psql variable-error handling;
- SQL CTE scoping in check matrices;
- ACL checks that incorrectly treated `PUBLIC` as a login role;
- expected constraint/index counts;
- XML extraction of the runtime-control row;
- missing legacy payment-function fingerprint coverage.

These were harness/preflight/down-file issues only. The frozen up migration was
not modified. Failed temporary clusters were stopped; final successful clusters
were stopped and removed automatically. This report is the retained durable test
record.
