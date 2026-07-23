# Phase 1A PostgreSQL 17 readiness report — 2026-07-22

Scope: local synthetic testing only. No Production connection, credentials, data,
migration, Netlify setting, Apple setting, or feature flag was used. Production
migration has not executed; verification, ledger, writeback, and Notification V2
remain disabled.

## Final rollback architecture

Phase 1A supports no post-commit destructive SQL down migration. The retained
down artifact always raises:

```text
PHASE_1A_POST_COMMIT_DOWN_UNSUPPORTED
Use forward fix or restore the verified Production backup.
```

It takes no locks and performs no DROP, DML, or migration-history change. No
database state, token, GUC, temporary object, attestation, or operator approval
can unlock it. Before COMMIT, the frozen up migration's explicit transaction is
the only rollback boundary. After COMMIT, preserve the schema and use a reviewed
forward fix or complete verified-backup restore.

## Tested artifact integrity

- Frozen up SHA-256:
  `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`
- Permanent down-refusal placeholder SHA-256:
  `3dc93a919616ef6f3f237c64d87bf84e7a0844f7bb6ba886d7e46cad6903e7ad`
- Historical batch compatibility-tripwire SHA-256:
  `b0b097dc3483c886077227e5db0936de3be302dca5d5169b8de85ac16f64b246`
- Manifest SQL file SHA-256:
  `d928c9b93feaf93cc21b8dfc6456a7329744609f5270036c0d776fd24845d579`
- Frozen normalized manifest SHA-256:
  `a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb`

The frozen up file remains byte-identical to `origin/main` and Git blob
`d76750ac9c58fee36d5fba20977b4feba1eb924d`.

Manifest format v2 now includes enum/type owner and every type ACL, including
grantor, grantee, privilege and grantable state. Every column entry likewise
includes all column-level ACLs. OIDs are excluded and all ACL arrays are sorted.

## Real PostgreSQL 17.6/17.10 runtime provenance

The runtime gate downloaded the official archive:

- URL: `https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2`
- SHA-256: `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`
- Configure: `--without-readline --without-zlib --without-icu --with-openssl`
  with a temporary install prefix and Homebrew OpenSSL include/library paths.

It built PostgreSQL 17.6 and `contrib/pgcrypto`, then started fresh isolated 17.6
and 17.10 clusters using distinct binary, data, socket, and port paths. SQL
queries against each live server asserted:

| Runtime | `server_version` | `server_version_num` |
| --- | --- | ---: |
| PostgreSQL 17.6 official source build | `17.6` | `170006` |
| PostgreSQL 17.10 Homebrew | `17.10 (Homebrew)` | `170010` |

Both live servers ran the same bootstrap, frozen up, and manifest SQL. Their
complete normalized JSON documents matched byte-for-byte:

- PostgreSQL 17.6 JSON SHA-256:
  `de4848c0909b7075c1959d13e4c284b55190a71ee613813aa0f369e58e735a82`
- PostgreSQL 17.10 JSON SHA-256:
  `de4848c0909b7075c1959d13e4c284b55190a71ee613813aa0f369e58e735a82`
- Both database-computed frozen manifest SHAs:
  `a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb`

The REL_17_6/REL_17_10 deparser-source comparison remains supplemental evidence,
not the runtime compatibility gate.

## Lifecycle and negative-test matrix

| Area | Result |
| --- | --- |
| Intentional error before up COMMIT | Full transaction rollback; no Phase 1A objects/history; payment snapshot unchanged |
| Retry frozen up | PASS; exact manifest and postflight PASS |
| Fresh post-commit down | Permanent refusal; all schema/data/history preserved |
| Historical batch path | Permanent refusal; no destructive path |
| Empty tables/default flags/exact manifest | Permanent refusal |
| Temp table/GUC/token/manual approval | Permanent refusal |
| Statistics reset/current flag/data | Permanent refusal |
| Single-transaction logical-restore illusion | Permanent refusal |
| Diagnostic | Only `NO_POST_COMMIT_DOWN_SUPPORTED`, `FORWARD_FIX_REQUIRED`, or `BACKUP_RESTORE_RECOMMENDED`; both authorization booleans always false |
| Enum/type owner drift | Manifest/postflight/diagnostic detect; down still refuses |
| Type ACL drift | Manifest/postflight/diagnostic detect; down still refuses |
| Column ACL drift | Manifest/postflight/diagnostic detect; down still refuses |
| Existing schema drift matrix | Column, constraint, index, function, trigger, table/function ACL, RLS, policy and replica identity detected |
| Migration history | GO/NO_GO matrix and real unreadable role PASS |
| Payment preservation | Independent full-row snapshots for membership, Stripe, ZPay and Google Play |
| Payment mutations | INSERT, UPDATE and DELETE independently detected |
| Existing RPC/RLS/grants/replay/idempotency/concurrency suite | PASS |
| Cleanup | PostgreSQL processes stopped; data, source, build, socket, dump and log directories removed before PASS |

The rollback diagnostic is decision support only. It cannot authorize down.
Manual review can select a forward fix or complete backup restore, never DROP.

## Additional quality checks

- Apple TypeScript check: PASS.
- Apple unit tests: 49/49 PASS.
- Standalone PostgreSQL integration suite: PASS.
- Apple function build: PASS for all three functions.
- TypeScript differential: no new errors (`raw 43/43`, normalized `25/25`).
- Bash syntax and `git diff --check`: PASS.
- Official 17.6 archive provenance and live 17.6/17.10 runtime comparison: PASS.
- Supplemental source cleanup and comparison: PASS.
