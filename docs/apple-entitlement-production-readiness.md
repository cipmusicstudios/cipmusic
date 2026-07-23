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

## Post-commit rollback policy and fail-closed placeholder

- Path: `supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql`
- SHA-256: `3dc93a919616ef6f3f237c64d87bf84e7a0844f7bb6ba886d7e46cad6903e7ad`

Phase 1A supports no destructive SQL down after the up transaction commits.
Catalog/row XIDs, frozen XIDs, statistics, reset timestamps, empty tables,
current controls, operator attestations, and restore-generated object state are
all reconstructable and cannot prove historical non-use. The retained down file
is only a permanent fail-closed tripwire: it immediately raises
`PHASE_1A_POST_COMMIT_DOWN_UNSUPPORTED` and performs no lock, DROP, DML, or
migration-history change. The historical batch path only invokes this tripwire.
Before COMMIT, PostgreSQL transaction rollback is the sole rollback mechanism.
After COMMIT, preserve the schema and use a reviewed forward fix or restore the
verified complete backup.

The canonical manifest implementation is
`supabase/verification/20260722010000_apple_entitlement_manifest.sql` (file
SHA-256 `d928c9b93feaf93cc21b8dfc6456a7329744609f5270036c0d776fd24845d579`).
Generate it only on PostgreSQL 17 after applying the frozen up migration, with
the migration owner as `current_user`, by loading that file and selecting
`pg_temp.phase1a_manifest_sha256()`. The reviewed manifest SHA-256 is
`a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb`.
It stable-sorts and records enum labels/order, enum owner and every-role type
ACL; complete column properties and every column-level ACL;
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
`npm run test:apple:manifest:pg17-runtime`. It downloads the official 17.6
archive, requires SHA-256
`e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`,
records the configure/build inputs, builds a fresh server, queries both live
servers for `version()`, `server_version`, and `server_version_num`, and compares
both complete JSON documents and the frozen SHA.

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
- Post-commit incident diagnostic (never authorizes down):
  `supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql`
- Permanent down-refusal placeholder:
  `supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql`
- Historical batch compatibility tripwire:
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

### A. Complete Apple entitlement schema installation

Required: frozen up SHA/blob; verified recoverable backup; completed restore
rehearsal; PG17 readiness suite PASS; approved preflight/postflight and permanent
down-refusal artifacts;
low-traffic maintenance window; named executor and reviewer; all flags off.

This is the only complete schema path for the website membership-read closure.
Phase 1A remains frozen at SHA-256
`5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`.
The required aggregate-read follow-up migration and independently frozen SHA are
recorded in [apple-membership-aggregate-read-rollout.md](apple-membership-aggregate-read-rollout.md).
Installing Phase 1A alone is **not** sufficient to enable Apple aggregate/member
read; keep every Apple flag OFF until both exact postflights pass.

Execution sequence (one approved maintenance window, with a named approved
`expected_owner` for both security-definer migration steps):

1. Verify backup and recovery evidence.
2. Run the fresh, read-only Production Phase 1A preflight and preserve its
   baseline JSON. A preflight PASS is evidence only; it is not migration
   authorization.
3. **STOP GATE:** after the fresh Phase 1A preflight passes, stop. Do not enter
   a maintenance window or execute SQL until the user or named responsible
   approver gives a new, explicit Maintenance Window approval for the exact
   two-migration set listed here: frozen Phase 1A followed by
   `20260723090000_apple_membership_aggregate_read.sql`. The preflight must
   never automatically continue into either migration.
4. Stop on any NO-GO, long transaction, lock waiter, active DDL, object conflict,
   version mismatch, or unexpected external flag state.
5. In the approved migration session use `lock_timeout='5s'`,
   `statement_timeout='5min'`, and
   `idle_in_transaction_session_timeout='2min'`.
6. Apply the frozen Phase 1A up migration once through the approved Supabase migration
   mechanism. Do not split the transaction or manually forge history.
7. Run the exact Phase 1A postflight with the preserved baseline values.
8. Require `MIGRATION_POSTFLIGHT_PASS`; otherwise stop immediately, freeze
   rollout, keep every flag off,
   and select a reviewed forward fix or complete backup restore.
9. Run the read-only aggregate follow-up preflight with `expected_owner`; stop on
   any NO-GO, owner mismatch, pre-existing RPC, or Phase 1A dependency failure.
10. Apply `20260723090000_apple_membership_aggregate_read.sql` in the same
    explicitly approved Maintenance Window, once through the same approved
    migration mechanism.
11. Run `20260723090000_apple_membership_aggregate_read_postflight.sql` with the
    same `expected_owner`; require `AGGREGATE_READ_POSTFLIGHT_PASS`.
12. Observe database/Netlify errors, locks, latency, and existing payment/auth
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

## Rollback and incident runbook

### Up migration has not committed

1. Any SQL error, lock/statement timeout, or explicit operator ROLLBACK must
   abort the frozen up migration's current transaction.
2. Verify all eight tables, six enum types, six functions, and migration-history
   record remain absent. Do not run down SQL.
3. Preserve the error evidence, stop rollout, correct the cause, and rerun the
   entire frozen up only after review. Never continue a partial script.

### Up migration has committed

1. Freeze rollout and keep every Apple flag disabled.
2. Preserve all Phase 1A schema, data, controls, and migration history.
3. The diagnostic may return `NO_POST_COMMIT_DOWN_SUPPORTED`,
   `FORWARD_FIX_REQUIRED`, or `BACKUP_RESTORE_RECOMMENDED`; every result includes
   `post_commit_down_supported=false` and `destructive_down_allowed=false`.
4. Apply a separately reviewed forward fix. If the whole database must return to
   its pre-migration checkpoint, restore the verified complete backup with named
   incident-owner approval and explicit acceptance that later transactions will
   be overwritten.
5. Never DROP Phase 1A tables/types/functions, never delete migration history,
   and never use manual review, a token, GUC, current state, or an attestation to
   authorize SQL down.

`supabase migration repair ... --status reverted` is not a normal rollback step.
It may be considered only after a complete database restore or as a separately
approved migration-history repair when the physical schema state has already
been independently established. It must never accompany a Phase 1A DROP path.

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
