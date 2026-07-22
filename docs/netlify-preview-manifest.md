# Netlify Preview manifest isolation

Netlify Deploy Preview and branch deploy builds validate and consume the committed public catalog snapshot. They do not rebuild the catalog, contact Supabase during the build, or use a service-role credential. Preview runtime song hydration is disabled so the reviewed snapshot is not silently replaced by Production rows. The UI labels this mode because the snapshot may lag Production.

Production keeps the default `npm run build` command. Its npm `prebuild` lifecycle runs the real metadata-only Production manifest builder, which fails closed when the Supabase URL or service-role credential is absent. Production never falls back to the committed Preview snapshot.

| Context | Command | Manifest source | Missing data behavior |
| --- | --- | --- | --- |
| Local development | `npm run dev` | committed working-tree files | normal Vite behavior |
| Deploy Preview | `npm run build:preview` | validated committed snapshot | fail closed |
| Branch deploy | `npm run build:preview` | validated committed snapshot | fail closed |
| Production | `npm run build` | real Supabase Production builder | fail closed |

Before committing a refreshed snapshot, run `npm run validate:preview-manifest` and review the exact JSON diff. The validator rejects missing or malformed files, schema/count mismatches, duplicate IDs, private practice fields, signed/private storage URLs, credential-shaped content, and URL hosts outside the explicit public allowlist. It never sanitizes or rewrites data automatically.

Rollback is limited to restoring the prior Netlify context commands and removing the Preview-only scripts/banner. No online environment-variable change is part of this design.
