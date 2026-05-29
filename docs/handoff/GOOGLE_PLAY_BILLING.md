# Google Play Billing — Android server-side verification

Backend endpoint that verifies Google Play subscription purchases server-side and grants
unified Premium membership. Mirrors the existing Stripe/ZPay model and writes to the same
`public.user_membership` table.

- **Endpoint:** `POST /.netlify/functions/verify-google-play-purchase`
- **Source:** `netlify/functions/verify-google-play-purchase.ts`
- **Helper:** `netlify/functions/_shared/google-play.ts`
- **Migration:** `supabase/membership-google-play-schema.sql` (⚠️ not yet applied to production)

## Fixed product constants

Hard-coded in `_shared/google-play.ts` (must match Play Console + mobile client):

| Item | Value |
| --- | --- |
| Android package name | `com.cipmusic.aurasounds` |
| Subscription product | `cip_premium` |
| Monthly base plan | `monthly_599` — USD **$5.99 / month** |
| Annual base plan | `annual_4999` — USD **$49.99 / year** |

## Request / response contract

```http
POST /.netlify/functions/verify-google-play-purchase
Authorization: Bearer <supabase_access_token>
Content-Type: application/json

{ "purchaseToken": "<token from Play Billing>", "productId": "cip_premium" }
```

- `Authorization: Bearer <supabase_access_token>` is **required**. `userId` is taken only from the
  verified Supabase JWT — the client-supplied identity is never trusted (same posture as
  `read-membership`).
- `purchaseToken` is required. `productId` is optional (logging only); the product, base plan,
  expiry, and subscription state are all decided from Google's `subscriptionsv2.get` response.

Success (entitled):
```json
{ "ok": true, "entitled": true, "provider": "google_play",
  "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE", "productId": "cip_premium",
  "basePlanId": "monthly_599", "premiumUntil": "2026-06-29T12:00:00.000Z", "autoRenew": true }
```
Recorded but not entitled (e.g. `ON_HOLD` / `PAUSED` / `EXPIRED` / `PENDING`) returns
`ok:true, entitled:false, premiumUntil:null`. Failures return `ok:false` with a `code`
(`UNAUTHENTICATED`, `INVALID_SESSION`, `MISSING_PURCHASE_TOKEN`, `PURCHASE_NOT_FOUND`,
`PRODUCT_MISMATCH`, `GOOGLE_AUTH_FAILED`, `GOOGLE_API_ERROR`, `*_NOT_CONFIGURED`, …) and a
secrets-free `debug` block.

## How verification works

1. Verify the Supabase access token → `userId`.
2. Sign an RS256 JWT with the service-account private key (Node `crypto`, zero extra npm deps),
   exchange it at `oauth2.googleapis.com/token` for an `androidpublisher`-scoped access token.
3. `GET androidpublisher/v3/applications/com.cipmusic.aurasounds/purchases/subscriptionsv2/tokens/{token}`.
4. Require a `lineItem` with `productId == cip_premium` **and** `basePlanId ∈ {monthly_599, annual_4999}`.
5. Treat `ACTIVE`, `IN_GRACE_PERIOD`, `CANCELED` (still within paid period) as entitled.
6. Upsert the purchase into `membership_google_play_purchases` (idempotency key `purchase_token`).
7. Set `user_membership.premium_until = max(existing, Google expiryTime)` — absolute time, so
   repeated verification can **never** duplicate/stack a grant (unlike ZPay which adds days), and a
   longer grant from another provider (e.g. Stripe annual) is never shortened.
   `membership_status = 'premium'`, `payment_provider = 'google_play'`.

## Required environment variables / secrets (Netlify)

| Variable | Purpose |
| --- | --- |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Service-account JSON key. Raw JSON **or** base64 of the JSON (recommended — avoids newline issues with the `private_key`). |
| `SUPABASE_URL` | Existing — Supabase project URL (server-side). |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing — bypasses RLS for the upserts. |

Encode the key for `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`:
```bash
base64 -i service-account.json | tr -d '\n'
```
Never commit the key or print it in logs (the code logs only HTTP status + truncated bodies).

## Google Cloud / Play Console service-account setup

1. **Play Console → Setup → API access** — link the Google Cloud project (or create one).
2. **Google Cloud Console** — enable the **Google Play Android Developer API** in that project.
3. **Google Cloud Console → IAM & Admin → Service Accounts** — create a service account; create a
   **JSON key** and download it. This JSON is what goes into `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
4. **Play Console → Users and permissions** — invite the service-account email; grant account
   permissions that include **View financial data** and **Manage orders and subscriptions**
   (app-level access to `com.cipmusic.aurasounds` is sufficient).
5. New service-account permissions can take a few hours to propagate before the API returns data.
6. Apply the migration (below) to the Supabase database used by the deployed Netlify functions.

## Migration

`supabase/membership-google-play-schema.sql`:
- adds `user_membership.auto_renew` (idempotent `IF NOT EXISTS`; shared with Stripe),
- creates `membership_google_play_purchases` (PK `purchase_token`).

⚠️ **Not applied to production.** Run it in the Supabase SQL editor only after approval. No
production Supabase data was edited as part of this change.

## EAS Android internal testing build command

From the **mobile** repo, on `feature/google-play-android-release` (do not modify the mobile repo
unless explicitly asked):

```bash
eas build --platform android --profile preview
```

(Use the `production` profile only when building the AAB you intend to upload to a Play track; the
internal-testing/QA build uses the `preview` profile. Verify the profile names in the mobile repo's
`eas.json`.)

## Play Console steps still needed (manual — not performed here)

1. Create subscription product `cip_premium` with base plans `monthly_599` ($5.99/mo) and
   `annual_4999` ($49.99/yr), and activate them.
2. Complete the service-account API access + permissions above.
3. Upload an AAB to the **Internal testing** track and add license testers.
4. Set the Netlify env vars on the deployed site, then apply the migration to Supabase.
5. End-to-end test: purchase in the internal-testing build → client calls
   `verify-google-play-purchase` with the Supabase Bearer token + `purchaseToken` → confirm
   `entitled:true` and that `read-membership` reflects the new `premiumUntil`.

**No Google Play upload, submission, or release was performed by this change.**
