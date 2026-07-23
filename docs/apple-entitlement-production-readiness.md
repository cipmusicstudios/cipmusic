# App Store entitlement Phase 1A — Production readiness runbook

Status: local preparation only. Nothing in this document authorizes a Production
migration or any Apple feature flag.

PostgreSQL 17.10 isolated lifecycle testing and a real PostgreSQL 17.6/17.10
runtime manifest comparison passed on 2026-07-22. See
`docs/apple-entitlement-pg17-readiness-report-2026-07-22.md`.
The independent Production backup and restore rehearsal also passed; see
`docs/apple-entitlement-production-backup-restore-report-2026-07-22.md`.

## Frozen up migration

- Path: `supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql`
- Approved Git base: `d66b4c5c372486ddd73f236fb51b8aa65228b134`
- File size: 49,615 bytes
- Line count: 1,028
- SHA-256: `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`
- Git blob: `d76750ac9c58fee36d5fba20977b4feba1eb924d`
- Last commit that changed the blob: `708f3f96c9c644ceccff264d6e10f9697361fca5`

The file matches the blob in `origin/main`. It is one explicit transaction and
contains the reviewed enums, tables, constraints, indexes, triggers, functions,
RLS enablement, grants/revokes, and a singleton runtime-control row whose five
controls are disabled/off. It contains no statement that reads or writes
`public.user_membership`, Stripe, Google Play, or ZPay objects.

## Approved down migration

- Path: `supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql`
- SHA-256: `00b610ff1308ab3c76a51ef870c76387f2c82bbfdb3b68a80b7437da484f4298`

The down migration is a fail-closed recovery tool, not an automatic rollback.
It first takes `ACCESS EXCLUSIVE` locks on all eight Phase 1A tables and
`public.user_membership`, then performs every safety read and DROP under those
locks. A five-second lock timeout aborts the entire transaction on contention.
The rollback preflight is diagnostic only. The down file ignores every temp row,
UUID, PID, transaction ID, token, GUC, and operator assertion. Under lock it
independently recomputes the exact manifest, empty tables and physical heaps,
pristine controls, original migration transaction identity (`pg_class.xmin`,
table `relfrozenxid`, and control-row `xmin`), table-write statistics/reset
epoch, migration history, and Apple-looking membership data. Anything other
than database-proven `ROLLBACK_SAFE` aborts; it uses no `CASCADE`.

The canonical manifest implementation is
`supabase/verification/20260722010000_apple_entitlement_manifest.sql` (file
SHA-256 `96dd13dceb1bac56e9562153310c25896b0528592ac171d6e3ad596b12d8462c`).
Generate it only on PostgreSQL 17 after applying the frozen up migration, with
the migration owner as `current_user`, by loading that file and selecting
`pg_temp.phase1a_manifest_sha256()`. The reviewed manifest SHA-256 is
`6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1`.
It stable-sorts and records enum labels/order; complete column properties;
constraint and index deparses; function definition/body, owner, execution
properties, search path and every-role ACL; trigger definitions/enabled state;
table owner, persistence, replica identity/index, RLS/force-RLS/options/every-role
ACL; and policies. OIDs are excluded.

Manifest format v2 records function metadata and `pg_proc.prosrc` separately,
instead of hashing `pg_get_functiondef` presentation whitespace. The remaining
official deparsers are implemented by `ruleutils.c`; PostgreSQL's immutable
`REL_17_6` and `REL_17_10` tags have the identical reviewed source SHA-256
`f1017456a03b2ca194dc964c55476223d224ecc1ba73b7a60204657f7d7b5f23`.
Their sole `format_type.c` delta is unrelated `oidvectortypes()` input
validation. That source review is supplemental. The compatibility gate is the
real two-server runtime comparison in
`npm run test:apple:manifest:pg17-runtime`, which requires exact 17.6 and 17.10
binaries and compares both complete JSON and the frozen SHA.

## Complete object manifest and dependency order

Creation order:

1. Six enum types:
   `app_store_environment`, `app_store_binding_state`,
   `app_store_current_state_quality`, `app_store_status_source`,
   `billing_aggregate_mode`, `billing_entitlement_validity`.
2. Trigger function: `billing_v2_set_updated_at()`.
3. Eight tables:
   `billing_runtime_controls`, `app_store_entitlements`,
   `app_store_transactions`, `app_store_notification_events`,
   `app_store_binding_tombstones`, `billing_entitlements_v2`,
   `billing_account_deletion_requests`, `billing_account_deletion_fences`.
4. Six update triggers:
   `billing_runtime_controls_set_updated_at`,
   `app_store_entitlements_set_updated_at`,
   `app_store_notification_events_set_updated_at`,
   `billing_entitlements_v2_set_updated_at`,
   `billing_account_deletion_requests_set_updated_at`,
   `billing_account_deletion_fences_set_updated_at`.
5. Five service RPCs:
   `billing_get_runtime_controls()`,
   `billing_get_current_entitlement_status(uuid)`,
   `billing_record_app_store_notification(app_store_environment, app_store_environment, uuid, text, text, timestamptz, text, text, text)`,
   `billing_record_app_store_transaction(uuid, app_store_environment, app_store_environment, text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text, text, boolean, text, text, text, text, text, boolean, timestamptz, boolean, timestamptz, timestamptz, timestamptz, text, text, text, text)`,
   `billing_prepare_account_deletion(uuid, uuid)`.

The 20 indexes are:

- `billing_runtime_controls_pkey`
- `app_store_entitlements_pkey`
- `app_store_entitlements_environment_original_transaction_id_key`
- `app_store_entitlements_id_environment_original_transaction__key`
- `app_store_entitlements_user_idx` (partial: non-null `user_id`)
- `app_store_entitlements_status_idx`
- `app_store_transactions_pkey`
- `app_store_transactions_environment_transaction_id_key`
- `app_store_transactions_original_idx`
- `app_store_notification_events_pkey`
- `app_store_notification_events_environment_notification_uuid_key`
- `app_store_notification_events_processing_idx`
- `app_store_binding_tombstones_pkey`
- `app_store_binding_tombstones_environment_original_transacti_key`
- `billing_entitlements_v2_pkey`
- `billing_entitlements_v2_source_source_environment_external__key`
  (`UNIQUE NULLS NOT DISTINCT`)
- `billing_entitlements_v2_user_grant_idx`
- `billing_account_deletion_requests_pkey`
- `billing_account_deletion_fences_pkey`
- `billing_account_deletion_fences_request_id_key`

There are 55 constraints. Their approved names, grouped by table, are:

- `billing_runtime_controls`: `billing_runtime_controls_pkey`,
  `billing_runtime_controls_singleton_check`, `billing_runtime_controls_check`.
- `app_store_entitlements`: `app_store_entitlements_pkey`,
  `app_store_entitlements_user_id_fkey`,
  `app_store_entitlements_environment_original_transaction_id_key`,
  `app_store_entitlements_id_environment_original_transaction__key`,
  `app_store_entitlements_app_account_token_hash_check`,
  `app_store_entitlements_binding_conflict_hash_low_check`,
  `app_store_entitlements_binding_conflict_hash_high_check`,
  `app_store_entitlements_claim_evidence_hash_check`,
  `app_store_entitlements_claim_method_check`,
  `app_store_entitlements_normalized_status_check`,
  `app_store_entitlements_status_fingerprint_check`,
  `app_store_entitlements_conflicting_status_fingerprint_check`,
  `app_store_entitlements_environment_match`,
  `app_store_entitlements_binding_shape`,
  `app_store_entitlements_sandbox_grant`,
  `app_store_entitlements_grant_status`,
  `app_store_entitlements_quarantine_shape`,
  `app_store_entitlements_binding_conflict_shape`.
- `app_store_transactions`: `app_store_transactions_pkey`,
  `app_store_transactions_environment_transaction_id_key`,
  `app_store_transactions_entitlement_id_environment_original_fkey`,
  `app_store_transactions_app_account_token_hash_check`,
  `app_store_transactions_transaction_status_check`,
  `app_store_transactions_summary_hash_check`.
- `app_store_notification_events`: `app_store_notification_events_pkey`,
  `app_store_notification_events_environment_notification_uuid_key`,
  `app_store_notification_events_attempt_count_check`,
  `app_store_notification_events_check`,
  `app_store_notification_events_payload_hash_check`,
  `app_store_notification_events_processing_status_check`.
- `app_store_binding_tombstones`: `app_store_binding_tombstones_pkey`,
  `app_store_binding_tombstones_environment_original_transacti_key`,
  `app_store_binding_tombstones_prior_user_hash_check`,
  `app_store_binding_tombstones_reason_check`,
  `app_store_binding_tombstones_deletion_request_fk`.
- `billing_entitlements_v2`: `billing_entitlements_v2_pkey`,
  `billing_entitlements_v2_user_id_fkey`,
  `billing_entitlements_v2_source_source_environment_external__key`,
  `billing_entitlements_v2_source_check`, `billing_entitlements_v2_status_check`,
  and `billing_entitlements_v2_check` through `billing_entitlements_v2_check4`.
- `billing_account_deletion_requests`:
  `billing_account_deletion_requests_pkey`,
  `billing_account_deletion_requests_user_hash_check`,
  `billing_account_deletion_requests_status_check`.
- `billing_account_deletion_fences`:
  `billing_account_deletion_fences_pkey`,
  `billing_account_deletion_fences_request_id_key`,
  `billing_account_deletion_fences_request_id_fkey`,
  `billing_account_deletion_fences_user_hash_check`.

All eight tables have RLS enabled and intentionally have zero policies. Table
rights are revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
Execute is revoked from `PUBLIC`, `anon`, and `authenticated`; only the five
service RPCs are granted to `service_role`. All six functions pin
`search_path = pg_catalog, public`; five service RPCs are `SECURITY DEFINER`.

## Readiness files

- Production preflight:
  `supabase/verification/20260722010000_apple_entitlement_production_preflight.sql`
- Postflight:
  `supabase/verification/20260722010000_apple_entitlement_postflight.sql`
- Rollback preflight:
  `supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql`
- Down migration:
  `supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql`
- Approved atomic rollback batch:
  `supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_approved_batch.sql`
- PG17 lifecycle harness: `scripts/test-apple-production-readiness-pg17.sh`
- Real PG17.6/17.10 manifest harness:
  `scripts/test-apple-manifest-pg17-runtime-compat.sh`

The Production preflight emits a membership row count/schema fingerprint and a
legacy-payment object fingerprint. Preserve those exact values as postflight
inputs. An operator-provided project ref is an attestation, not cryptographic
proof of the connected Supabase project; independently verify the connection
host/project in the Dashboard/CLI before running it.

## Backup option A — Supabase Pro daily backup

After upgrading, wait until Database > Backups shows a completed backup created
after the upgrade and after the final pre-migration checkpoint. Do not assume an
immediate backup: the service runs daily. Record its timestamp and restore
eligibility. Pro provides seven days of daily backups; paid projects with
physical backups can use Restore to a New Project, which creates a separately
billed database copy and still requires manual reconfiguration of non-database
settings and Storage objects.

A daily backup does not replace PITR. Its recovery point can be nearly a day old;
PITR is a separate paid add-on with finer-grained recovery. Either backup must be
restored to a new isolated project and validated before migration approval.

User actions: approve plan/cost, perform the upgrade, wait for and verify the
backup, start Restore to a New Project, approve the new-project cost, and review
the restored project. No automation may purchase or restore on the user's behalf.

## Backup option B — independent logical backup

Use PostgreSQL 17 `pg_dump`/`pg_restore`; an older client must not dump a newer
server. Keep credentials in a mode-0600 `PGPASSFILE` or a secure secret-injection
tool, never in command arguments, shell history, CI logs, or the output path.

Template (placeholders only):

```bash
umask 077
export PGHOST='<direct-or-session-pooler-host>'
export PGPORT='<port>'
export PGDATABASE='postgres'
export PGUSER='<database-user>'
export PGPASSFILE='/secure/runtime/path/pgpass'

pg_dump --version                         # must report 17.x
pg_dump --format=custom --compress=9 \
  --file='/secure/staging/cipmusic-full.dump' \
  --schema=auth --schema=storage --schema=public \
  --schema=supabase_migrations

pg_dumpall --roles-only --no-role-passwords \
  --file='/secure/staging/cipmusic-roles.sql'

shasum -a 256 /secure/staging/cipmusic-full.dump \
  /secure/staging/cipmusic-roles.sql \
  > /secure/staging/SHA256SUMS

pg_restore --list /secure/staging/cipmusic-full.dump \
  > /secure/staging/cipmusic-full.contents.txt

age -r '<offline-recovery-public-key>' \
  -o /secure/offsite/cipmusic-full.dump.age \
  /secure/staging/cipmusic-full.dump
age -r '<offline-recovery-public-key>' \
  -o /secure/offsite/cipmusic-roles.sql.age \
  /secure/staging/cipmusic-roles.sql

unset PGPASSFILE PGHOST PGPORT PGDATABASE PGUSER
```

Do not use `--no-acl` if grants must be audited. `pg_dumpall --roles-only
--no-role-passwords` records role shape without password hashes; Supabase-managed
roles may need mapping rather than blind recreation. Review the archive list for
`auth`, `storage`, `public`, and `supabase_migrations` coverage. Storage rows are
metadata only; Storage bucket objects require a separate backup.

Restore rehearsal template on a disposable PostgreSQL 17 instance:

```bash
createdb cipmusic_restore_rehearsal
pg_restore --exit-on-error --no-owner \
  --dbname=cipmusic_restore_rehearsal \
  /secure/staging/cipmusic-full.dump
psql --dbname=cipmusic_restore_rehearsal \
  --file=supabase/verification/20260722010000_apple_entitlement_production_preflight.sql \
  --set=expected_project_ref=hngtwkayovuxhiqustsa \
  --set=expected_database=cipmusic_restore_rehearsal \
  --set=expected_role='<restore-role>' \
  --set=external_apple_flags_off=1
```

Validate schema/object counts, auth users, membership/payment row counts,
constraints, grants, extensions, and migration history against the source
manifest. A logical dump is not PITR and contains no changes committed after its
snapshot. Schedule a write freeze or take the final dump immediately before the
maintenance window.

## Rollout gates

### A. Schema installation only

Required: frozen up SHA/blob; verified recoverable backup; completed restore
rehearsal; PG17 readiness suite PASS; approved preflight/postflight/down files;
low-traffic maintenance window; named executor and reviewer; all flags off.

Execution sequence:

1. Verify backup and recovery evidence.
2. Run Production preflight and preserve its baseline JSON.
3. Stop on any NO-GO, long transaction, lock waiter, active DDL, object conflict,
   version mismatch, or unexpected external flag state.
4. In the migration session use `lock_timeout='5s'`,
   `statement_timeout='5min'`, and
   `idle_in_transaction_session_timeout='2min'`.
5. Apply the frozen up migration once through the approved Supabase migration
   mechanism. Do not split the transaction or manually forge history.
6. Run postflight with the preserved baseline values.
7. Require `MIGRATION_POSTFLIGHT_PASS`; otherwise freeze rollout and follow the
   rollback decision tree.
8. Observe database/Netlify errors, locks, latency, and existing payment/auth
   paths for at least 30 minutes. Keep every Apple flag off.

### B. Apple verification enablement

Separately required: reviewed Apple Root CA bytes/checksum, App Store Server API
credentials, bounded timeout/retry behavior, final CORS policy, independent
Netlify kill switch, and verification-only real Sandbox tests. These are not
schema-installation blockers.

### C. Ledger/writeback/Notification V2 enablement

Separately required: real Sandbox transaction/current-status evidence; replay,
idempotency, binding conflict, quarantine, reconciliation, upgrade/downgrade,
refund/revocation and Production/Sandbox isolation tests; aggregate read approval;
explicit membership-writeback approval; notification inbox/replay/projection
validation; monitoring and incident rollback. Do not enable writeback or
Notification V2 merely because schema installation passed.

## Rollback runbook

Before commit, any migration error or timeout must roll back the up transaction;
verify that all Phase 1A objects and history remain absent.

After commit:

1. Freeze all later rollout actions and confirm flags remain off.
2. Run rollback preflight. `ROLLBACK_UNSAFE` means preserve evidence and use a
   restore or reviewed forward fix. `ROLLBACK_REQUIRES_MANUAL_REVIEW` means stop.
3. Manual review is not an override for the destructive down migration. It can
   select a forward fix, preserve the schema, or restore a verified backup only.
4. Execute only the approved batch, through one `psql` process and one backend:

   ```bash
   PGPASSFILE=/secure/path/production.pgpass \
   /opt/homebrew/opt/postgresql@17/bin/psql \
     "host=... port=... dbname=... user=... sslmode=require" \
     -v ON_ERROR_STOP=1 \
     -f supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_approved_batch.sql
   ```

   Use a PostgreSQL Direct connection, or a session pooler only after proving
   single-session continuity. Do not use the Transaction pooler. Do not run
   preflight and down in separate `psql` processes, sessions, SQL files, or
   Supabase SQL Editor clicks. Do not use GUI auto-commit. Never assume two SQL
   Editor executions reuse one backend; if the editor cannot guarantee one
   batch/backend/explicit transaction, it is prohibited for down execution.
5. Verify all Phase 1A objects are absent and legacy membership/payment objects
   are unchanged.
6. Only after schema verification succeeds, run the supported command:

   ```bash
   supabase migration repair 20260722010000 --status reverted
   ```

   This repairs history only; it does not execute the down SQL. Re-run migration
   list/status verification afterwards.

The current Phase 1A schema has no immutable flag-change audit table. The
rollback report outputs controls `updated_at`/`updated_by`, database
`stats_reset`, `n_tup_upd`, current flags and business/data evidence. PostgreSQL
statistics and mutable fields alone are not an audit log. SAFE additionally
requires the original migration XID to agree across all eight table catalog
tuples, every table `relfrozenxid`, and the untouched control row, plus exact
initial write counters and an unambiguous reset epoch. Missing or contradictory
evidence is manual review, never SAFE. Manual review is not an override for the
destructive down migration. After any enablement, simple DROP rollback is
permanently disallowed; preserve the schema, use a reviewed forward fix, or
restore a verified backup.

Official references:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/clone-project>
- <https://supabase.com/docs/guides/deployment/database-migrations>
- <https://supabase.com/docs/reference/cli/supabase-bootstrap#supabase-migration-repair>

## Stop conditions

Stop immediately for timeout/deadlock, partial or unexpected objects, owner/RLS/
grant mismatch, non-default controls, any Phase 1A data, Apple-looking membership
writeback, Production/Sandbox mixing, preflight/postflight failure, payment/auth
regression, or elevated database/Function errors. Do not account-merge, delete
evidence, or improvise `DROP ... CASCADE`.
