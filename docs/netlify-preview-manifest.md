# Netlify Preview manifest isolation

Netlify Deploy Preview and branch deploy builds validate and consume the committed public catalog snapshot. They do not rebuild the catalog, contact Supabase during the build, or use a service-role credential. Preview runtime song hydration is disabled so the reviewed snapshot is not silently replaced by Production rows. The UI labels this mode because the snapshot may lag Production.

Production keeps the default `npm run build` command. Its npm `prebuild` lifecycle runs the real metadata-only Production manifest builder, which fails closed when the Supabase URL or service-role credential is absent. Production never falls back to the committed Preview snapshot.

| Context | Command | Manifest source | Missing data behavior |
| --- | --- | --- | --- |
| Local development | `npm run dev` | committed working-tree files | normal Vite behavior |
| Deploy Preview | `npm run build:preview` | validated committed snapshot | fail closed |
| Branch deploy | `npm run build:preview` | validated committed snapshot | fail closed |
| Production | `npm run build` | real Supabase Production builder | fail closed |

The build contract requires Netlify's `CONTEXT`, `VITE_DEPLOY_CONTEXT`, and manifest mode to agree: Preview accepts only `deploy-preview|branch-deploy` plus `committed-preview-snapshot`; Production accepts only `production` plus `production-generated`. An inconsistent combination fails before the manifest builder. An entirely unset combination remains valid for ordinary local development.

## Snapshot provenance and ownership

The repository maintainer or catalog owner owns snapshot refreshes. A snapshot may only be produced by the controlled Production manifest workflow, whose mapper includes rows only when `is_published === true`. The validator never downloads, sanitizes, or rewrites data.

Every snapshot update PR must run `npm run validate:preview-manifest`, show the previous and new track count and `generatedAt`, list added and removed track counts, and include an explicit public-data review. UUID-shaped track IDs, artist IDs, and public cover-path identifiers are allowed catalog identifiers. User, account, owner, customer, order, payment, transaction, receipt, contact, token, secret, private metadata, and internal-note fields are forbidden.

Snapshots expire after 90 days. The validator fails closed using `generatedAt`; there is no automatic or environment-variable bypass. A stale snapshot must be regenerated through the controlled workflow and reviewed in its own diff.

The currently committed snapshot was generated on 2026-06-19 and is within the 90-day policy as of 2026-07-22.

The validator rejects missing or malformed files, symlinks and path escapes, unknown schema fields, schema/count mismatches, duplicate IDs/slugs, private practice fields, signed/private storage URLs, credential-shaped content, and URL hosts outside field-specific public allowlists.

The no-network test blocks the Node global fetch, HTTP(S), net, TLS, common DNS entry points, child-process forks, and known network CLI tools. It is a regression canary, not an operating-system sandbox; direct third-party transports or deliberately obfuscated subprocesses are outside its claim. The repository does not directly depend on `undici`; Node's global fetch path is covered.

Rollback is limited to restoring the prior Netlify context commands and removing the Preview-only scripts/banner. No online environment-variable change is part of this design.
