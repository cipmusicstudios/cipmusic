# Phase 1A PostgreSQL 17 readiness report — 2026-07-22

Scope: local synthetic testing only. No Production connection, credentials, data,
migration, Netlify setting, Apple setting, or feature flag was used. Production
migration has not executed; verification, ledger, writeback, and Notification V2
remain disabled.

## Runtime environments

- PostgreSQL 17.10: `postgres (PostgreSQL) 17.10 (Homebrew)`, binaries at
  `/opt/homebrew/opt/postgresql@17/bin`.
- PostgreSQL 17.6: official `postgresql-17.6.tar.bz2` from
  `https://ftp.postgresql.org/pub/source/v17.6/`, archive SHA-256
  `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`,
  verified against the adjacent official `SHA256` file.
- 17.6 configure/build: `CPPFLAGS=-I/opt/homebrew/opt/openssl@3/include`,
  `LDFLAGS=-L/opt/homebrew/opt/openssl@3/lib`, `./configure --without-readline
  --without-zlib --without-icu --with-openssl --prefix=<temporary-install>`,
  `make -j4`, `make install`, then build/install `contrib/pgcrypto`.
- Both runtimes used fresh `initdb` clusters under `/tmp`, Unix sockets only,
  `listen_addresses=''`, host authentication rejected, and synthetic fixtures.
  No Homebrew PostgreSQL service or inherited `PGPASSFILE` was used.

## Tested artifact integrity

- Frozen up SHA-256:
  `5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4`
- Fail-closed down SHA-256:
  `00b610ff1308ab3c76a51ef870c76387f2c82bbfdb3b68a80b7437da484f4298`
- Approved rollback batch SHA-256:
  `8370af223fc86be42be143669df3d78f4e6b840ca3fc90b42d55710a0e214a0f`
- Manifest SQL file SHA-256:
  `96dd13dceb1bac56e9562153310c25896b0528592ac171d6e3ad596b12d8462c`
- Frozen normalized manifest SHA-256:
  `6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1`

The frozen up file remained byte-identical to `origin/main` and Git blob
`d76750ac9c58fee36d5fba20977b4feba1eb924d`.

## Real 17.6/17.10 runtime compatibility

Both exact server versions ran the same bootstrap, frozen up, and manifest SQL.
The complete normalized JSON files matched byte-for-byte:

- PostgreSQL 17.6 JSON SHA-256:
  `bb996135cd284b002d0311f84ce15c5cd0632172e811268f7df8b424512968d3`
- PostgreSQL 17.10 JSON SHA-256:
  `bb996135cd284b002d0311f84ce15c5cd0632172e811268f7df8b424512968d3`
- Both database-computed frozen manifest SHAs:
  `6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1`

`test:apple:manifest:pg17-minor` still checks selected upstream source as
supplemental evidence. It is not the runtime compatibility gate.

## Lifecycle and negative-test matrix

| Area | Result |
|---|---|
| PG17.10 preflight → up → postflight → down → up → postflight | PASS |
| Pristine database-only rollback decision | `ROLLBACK_SAFE` |
| Data present/current flag enabled | `ROLLBACK_UNSAFE`; down rejected |
| Flag on→off, `updated_by` cleared, statistics reset | `ROLLBACK_REQUIRES_MANUAL_REVIEW`; down rejected |
| Insert→delete→VACUUM→single-table stats reset | physical/XID evidence remains; down rejected |
| Forged same-name temp table/SAFE row/PID/XID/UUID/time/SHA/GUC/token | ignored; down rejected |
| Down evidence | manifest, empty rows/heaps, original catalog/table/control XID, write counters/reset epoch, history, membership |
| Manifest drift | column, constraint, index, body/security/search path, trigger, ACL, force-RLS, policy rejected |
| Custom-role table ACL and function EXECUTE ACL | postflight/preflight/down all rejected |
| Replica identity FULL drift | postflight/preflight/down all rejected |
| Migration history | structured GO/NO_GO and exact reason-set parsing; real unreadable role covered |
| Payment preservation | independent per-table count/full-row hash for membership, Stripe, ZPay, Google Play |
| Payment mutations | ZPay INSERT, Stripe UPDATE, Google Play DELETE, membership UPDATE detected |
| Failed down | manifest, all Phase 1A tables/rows/control row, notification row, payment data and history preserved |
| Rollback-first races A/C/D | granted `pg_locks` synchronization; each repeated 3 times |
| Writer-first race B | granted `pg_locks` synchronization; repeated 3 times; expected lock timeout only |
| Background exit propagation | every `wait` checked; unexpected background failure is fatal |
| Cleanup | server stop and directory deletion checked; cleanup failure prevents PASS |
| Existing RPC/RLS/replay/idempotency/concurrency suite | PASS |

The final PG17.10 readiness suite completed in 56 seconds. Up and down each measured
under one second at shell timer resolution. Race coordination uses observable
granted locks rather than a fixed start-delay guess.

## Additional quality checks

- Apple TypeScript check: PASS.
- Apple unit tests: 49/49 PASS.
- Standalone PostgreSQL integration suite: PASS.
- Apple function build: PASS for all three functions.
- TypeScript differential: no new errors (`raw 43/43`, normalized `25/25`).
- Bash syntax and `git diff --check`: PASS.
- Source compatibility supplement and real runtime compatibility: PASS.

The rollback preflight is diagnostic only. No session-local or operator-supplied
state can authorize down. Manual review is not an override for destructive down;
it can only select schema preservation, a reviewed forward fix, or restoration
from a verified backup.
