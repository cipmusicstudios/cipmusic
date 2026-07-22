# Apple entitlement Production backup and restore rehearsal — 2026-07-22

## Verdict

`PRODUCTION_BACKUP_RESTORE_REHEARSAL_PASS`

The independent logical backup and PostgreSQL 17 restore rehearsal completed
without a Production write. This satisfies the Phase 1A schema migration backup
gate, but it is not approval to run the migration.

Related frozen readiness artifacts, neither executed against Production during
this rehearsal:

- up migration SHA-256:
  `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`;
- historical down migration SHA-256 at rehearsal time (not current):
  `49f278e3360ccc825a54894d631a6ff9ac029a776b9dd668a8c417006987e566`;
- current approved down migration SHA-256:
  `ebac9bbad6630c2dd49bbcbc5aeb3c65697ea9f817e577771935feb7720400e5`.

## Connection and safety

| Check | Result |
| --- | --- |
| Project ref attestation | `hngtwkayovuxhiqustsa` |
| Connection type | Supabase Direct connection (host value redacted) |
| Database / port / SSL mode | `postgres` / `5432` / `require` |
| Production server | PostgreSQL `17.6` |
| Client `psql`, `pg_dump`, `pg_restore` | PostgreSQL `17.10` (Homebrew) |
| Read-only enforcement | `default_transaction_read_only=on`; `transaction_read_only=on` |
| SSL | enabled |
| Production writes | 0 |
| Credential disclosure | none |

Every Production client was started with environment-backed connection fields,
the mode-0600 `PGPASSFILE`, SSL required, and `PGOPTIONS` setting
`default_transaction_read_only=on`. No connection URI or secret value was
printed. PostgreSQL clients alone accessed the password file.

## Production preflight

The repository preflight returned `MIGRATION_PREFLIGHT_GO` in 0.57 seconds.
It confirmed PostgreSQL 17, expected database and role, the operator project-ref
attestation, migration `20260722010000` absent, all Phase 1A target tables/types/
functions absent, `extensions.digest(text,text)` available, no long transaction,
no lock waiter, no active DDL, `public.user_membership` present, and external
Apple flags attested off.

Preserved preflight baselines:

- `public.user_membership`: 11 rows
- membership schema fingerprint: `d70a4c83f06cddd7cb3d2059d13b8026`
- payment-object fingerprint: `257d801d26f698ed069378f450a70450`
- payment-function fingerprint: `d41d8cd98f00b204e9800998ecf8427e`

## Backup and encryption

| Item | Result |
| --- | --- |
| Format and scope | custom format, compression 9; `public`, `auth`, `storage`, `supabase_migrations` |
| Dump duration | 8.84 seconds |
| Plaintext size | 681337 bytes |
| Archive TOC | readable; 481 entries |
| Data entries | 43 |
| Function / trigger / policy / ACL entries | 22 / 5 / 20 / 59 |
| Plaintext SHA-256 | `e32aee8acdbeaed7d7e1e278ea55207504d17de18a4a854ffb69e0f6ead5962e` |
| age encryption | PASS; under 0.01 seconds for this archive |
| Encrypted size | 681697 bytes |
| Encrypted SHA-256 | `c53e0dbd575ecd38423a6892346621693e5d7dc14730894d19580fde7a7f1310` |
| Decrypt-and-hash verification | PASS; plaintext SHA-256 matched |
| Plaintext cleanup | original and verification copies deleted |

The checkpoint is approximately `2026-07-22T12:25:39-0700`. Transactions
committed after that checkpoint are not present in this logical backup.

## Isolated PostgreSQL 17 restore

The restore used a new PostgreSQL `17.10` cluster outside the repository and
outside `/opt/homebrew/var/postgresql@17`. It was started directly, not as a
Homebrew service, with `listen_addresses=''`, a Unix socket, and port `55439`.
The successful clean `pg_restore --exit-on-error` completed in 0.16 seconds.

Required local preparation was explicit:

- created `pgcrypto` and `uuid-ossp` in schema `extensions`;
- created no-login, no-password placeholders for the Supabase managed owners
  and ACL grantees referenced by the archive;
- restored owners and ACLs rather than suppressing them;
- treated every restore error as fatal.

The restored repository preflight returned `MIGRATION_PREFLIGHT_GO`.

## Verification matrix

| Area | Production | Restored | Result |
| --- | ---: | ---: | --- |
| `auth` tables / functions / RLS tables | 23 / 4 / 16 | 23 / 4 / 16 | MATCH |
| `public` tables / functions / triggers / policies / RLS tables | 11 / 1 / 1 / 20 / 11 | same | MATCH |
| `storage` tables / functions / triggers / RLS tables | 8 / 17 / 4 / 8 | same | MATCH |
| `supabase_migrations` tables | 1 | 1 | MATCH |
| All 43 table row counts and UTC-normalized row fingerprints | baseline | restore | MATCH |
| `auth.users` rows | 141 | 141 | MATCH |
| `public.user_membership` rows | 11 | 11 | MATCH |
| Google Play purchase rows | 6 | 6 | MATCH |
| Membership order rows | 36 | 36 | MATCH |
| Storage bucket metadata rows | 9 | 9 | MATCH |
| Storage object metadata rows | 1630 | 1630 | MATCH |
| Supabase migration-history rows | 3 | 3 | MATCH |
| Relations, owners and normalized ACLs | fingerprint | fingerprint | MATCH |
| Columns, constraints, indexes, enums and default ACLs | fingerprint | fingerprint | MATCH |
| Functions/RPC, triggers, RLS and policies | fingerprint | fingerprint | MATCH |

Stripe-related membership columns/indexes and their containing table data
matched. Google Play objects and data matched. No ZPay-named object or function
was present in either source or restore, so absence matched. Function definitions
were parsed through PostgreSQL catalogs and the restored preflight executed
successfully; no business RPC or external provider call was invoked.

## Extensions and managed-component boundary

Production reported `pgcrypto`, `uuid-ossp`, `pg_stat_statements`,
`supabase_vault`, and `plpgsql`. The selected four-schema archive required and
successfully used `pgcrypto`, `uuid-ossp`, and `plpgsql`. `pg_stat_statements`
and `supabase_vault` are Supabase-managed components outside the selected schema
archive and were not claimed as independently restorable by this artifact.

The logical backup includes Storage metadata rows, not the underlying bucket
files. It also excludes Edge Functions source, Netlify variables, Auth provider
configuration, OAuth secrets, Dashboard settings, and PITR history.

## Warnings and errors

The final clean restore emitted no warning and no restore error. During setup:

1. An initial server start was rejected because the Unix-socket path exceeded
   the macOS limit; no restore ran. A short `/tmp` socket path resolved it.
2. Two discarded trial databases identified missing local placeholder roles
   (`postgres`, then `dashboard_user`). `--exit-on-error` stopped immediately;
   each database was discarded and the final restore began from a new empty
   database with the complete role set.
3. Physical dropped-column attribute-number gaps in two `auth` tables are not
   preserved by logical dump. After canonicalizing away those non-logical gaps,
   column names, types, defaults, constraints, indexes and data all matched.
4. ACL array ordering and policy role OIDs differ across clusters; normalized
   role-name/ACL comparison matched exactly.

None is an unexplained critical error or a Production-side change.

## Timing and recovery objective

| Stage | Measured |
| --- | ---: |
| Production preflight | 0.57 s |
| Dump | 8.84 s |
| Encryption | <0.01 s |
| Successful restore | 0.16 s |
| Source fingerprint audit | 1.68 s |
| Clean local decrypt/init/restore/audit workflow | <1 s on this Mac |

Command execution was roughly 14 seconds; operator review and diagnostic wall
time was about 10 minutes. For this 681 KB archive on the tested Mac, use a
conservative five-minute rehearsal RTO to allow credential retrieval, local
cluster startup and verification. This is not a guarantee for a larger future
database or a remote recovery host.

## Cleanup and remaining gates

The plaintext dump and decrypt-check copy were deleted. The temporary PostgreSQL
instance was stopped and all temporary data and socket files were removed. The
encrypted archive, checksum file and non-sensitive manifest remain outside Git;
this report is the only new repository artifact from the rehearsal.

Backup admission for Phase 1A is PASS. Migration still requires explicit user
approval of a maintenance window, confirmation that flags remain off immediately
before execution, a fresh preflight at that checkpoint, operator readiness for
postflight and rollback preflight/down procedure, and acceptance that this is a
point-in-time logical snapshot rather than PITR. No migration was run.
