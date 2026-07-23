# Apple phase 1A PostgreSQL integration tests

Run the complete isolated database suite with:

```bash
npm run test:apple:postgres
```

The runner creates a temporary PostgreSQL 15+ cluster, disables TCP listening,
creates the minimum Supabase-compatible roles and schemas, applies the phase 1A
migration, and tests rollback, duplicate application, privileges/RLS, ledger
binding and replay protection, notification inbox behavior, account-deletion
preparation, and concurrent claims. It always stops the temporary server.

PostgreSQL binaries are discovered from `PATH`, `pg_config --bindir`, or an
explicit directory:

```bash
POSTGRES_BIN=/opt/postgresql/bin npm run test:apple:postgres
```

Missing PostgreSQL is an actionable failure by default. A CI job that explicitly
chooses not to provide PostgreSQL may set `APPLE_PG_TEST_ALLOW_SKIP=1`; the job
will print a visible `SKIP` reason rather than silently passing.

All runs stop the temporary server and remove the cluster, socket, and logs;
cleanup failure makes the suite fail. A failed run may retain its synthetic local
evidence only when `APPLE_PG_TEST_DEBUG_RETAIN=1` is explicitly set. Fixtures use
reserved, synthetic UUIDs and opaque fake transaction labels; no receipt, JWS,
secret, production identifier, or customer data is accepted by this harness.
