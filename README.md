# மகரந்தம் சில்க்ஸ் — Next.js commerce

Next.js App Router, TypeScript, React and Supabase Auth/Postgres/Storage. The original brand palette, Tamil name, supplied logo and 21 existing model photos are included. The old HTML website is left in its own folder.

## Run locally

Use Node 22 or later. In this folder:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Without Supabase values, the public storefront runs with a read-only 20-product preview. Seed prices display **00 Rs** and cannot be ordered. Private screens explain that setup is required. There is no demo admin password or auth bypass.

## Connect Supabase

Use a **new Supabase project**. These migrations assume this store owns its `public` schema; they revoke public/client execution grants on functions in that schema.

1. Set `.env.local` from `.env.example`. The publishable/legacy anon key is public; the service-role/secret key must remain server-only. Set `NEXT_PUBLIC_SITE_URL` to the exact browser origin. Never commit `.env.local`.
2. Apply `supabase/migrations/202611160001_store.sql`, then `202611160002_operations.sql`, as project database owner using Supabase SQL Editor. Alternatively link a Supabase CLI project and run `supabase db push`. `supabase/config.toml` supplies local Auth settings, but **does not automatically configure a hosted project's Auth settings**.
3. In Authentication, set global **Allow new users to sign up OFF**, anonymous sign-ins OFF, unused OAuth providers OFF. Keep the **Email provider ON**, **Confirm email ON**, TOTP enrollment/verification ON. In the CLI config, global `[auth] enable_signup=false` blocks unmanaged signup; `[auth.email] enable_signup=true` keeps the Email provider working for existing users.
4. Configure **Before User Created → Postgres function → public.reject_public_signup**. This second control blocks unmanaged account creation even if the native signup switch is accidentally changed. Admin API user creation bypasses this hook, as required for the website's controlled registration route.
5. Configure custom SMTP and the Site URL/allowed redirects. Allow `https://YOUR-DOMAIN/auth/callback` and the password-recovery callback. In production use exact URLs, no broad wildcards.
6. Set the following **custom email template links**. These are required because the server cannot consume implicit-flow URL fragments. Escape `&` as `&amp;` inside HTML attributes:

   Confirm signup:
   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=signup">Confirm your email</a>
   ```
   Reset password:
   ```html
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password">Reset your password</a>
   ```
7. Run `npm run doctor`, then `npm run seed`. Seeding inserts missing fixed product UUIDs only; it does not reset an existing product's prices or inventory. Bucket policies intentionally allow no browser writes. Authorized server endpoints upload images and issue short-lived private proof links.
8. Create the first user using Supabase Dashboard → Authentication → Add user. A directly created Auth user **without protected `app_metadata.store_role` becomes superadmin**, exactly as requested. Use a strong password, confirm the address in the trusted Dashboard flow, sign in at `/login`, and enroll TOTP at `/mfa`.
9. Create ordinary customers through `/register`; the server tags them `customer` in protected app metadata. Create managers from **Admin → Staff**, then limit their permissions and complete their confirmation/MFA setup. `user_metadata` never grants roles. Existing Auth users from before the migrations are not automatically backfilled; use a fresh project or perform a reviewed explicit migration.
10. Configure production Turnstile site/secret keys. Registration fails closed in production if the secret is absent. Set a random `CRON_SECRET` of at least 32 characters. Set `TRUSTED_IP_HEADER` only if your hosting proxy overwrites that header; otherwise the limiter uses a shared conservative bucket.

The direct-Auth-user rule is deliberately powerful. Only trusted project owners should have Auth admin access or the service key. Global public signup and the hook must remain configured; the database trigger cannot distinguish an untagged trusted Admin creation from an unmanaged signup by inspecting the inserted row alone.

## Configure sales

Open `/admin` after MFA. Products start at zero price/stock. Set real prices, discounts and publication under **Products**, then add units under **Stock** with a reason. Set support and bulk contact numbers, shipping, tax and payment options under **Settings**.

Checkout modes:

| Mode | Customer options |
|---|---|
| `whatsapp_only` | Save an order, open WhatsApp, manually press Send; staff check payment |
| `online_only` | Use the configured online method only |
| `both` | Choose WhatsApp or the configured online method |

Online methods are `manual_upi` or `razorpay_upi`. The UPI payee/name is configurable. Razorpay requires `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in hosting secrets; the admin UI shows readiness flags, never raw keys. Enable automatic capture for UPI payments in your Razorpay account and validate the UPI-only Checkout configuration for your account/device. The server independently rejects other methods and noncaptured payments.

Create Razorpay webhook `POST https://YOUR-DOMAIN/api/webhooks/razorpay` for `payment.captured` and `refund.processed`. Signature verification uses the **raw request body** and the separate webhook secret. Provider API retrieval must match stored order ID, amount, currency, method and capture status. Configure delivery retry/monitoring in Razorpay. Client callbacks and webhook replays cannot deduct stock twice.

WhatsApp does not automatically send a message. Checkout requires consent to share delivery details and the user must press Send in WhatsApp. Manual UPI receipts/UTRs are claims until staff independently reconcile the actual bank credit. Late payments go to review/refund, without recreating stock reservations.

Offers apply after product discounts. One eligible coupon or one automatic offer is used per order. Eligible automatic offers use stable ID order, **not best-price optimization**. Amount fields labeled Rs convert to integer paise; the fixed-offer value field explicitly uses paise. Shipping is calculated after the offer; tax applies to discounted merchandise, excluding shipping. Set tax rates with your business requirements before launch; no automatic tax-jurisdiction engine is included.

## Fulfillment and refunds

Paid orders → packing → save enabled provider and tracking ID → shipped → delivered. Provider links require HTTPS and `{tracking_id}`; IDs are URL-encoded. The optional `/api/webhooks/tracking` is a **custom adapter contract**, not a built-in universal courier integration: sign the raw JSON using HMAC-SHA256 with `TRACKING_WEBHOOK_SECRET` in `x-store-signature`; body fields are `event_id`, `order_id`, `tracking_id`, `status` (`shipped` or `delivered`).

Unpaid customer cancellations release stock. Staff may cancel before shipping. A received physical return restores stock once and requires a note. Refunds are full-order only. Manual refunds are completed externally before staff record the bank reference. Gateway refunds use a durable unique refund row; an unknown network result is sent to manual review, never automatically retried. **Check existing refund** reconciles a known provider refund ID. **Verify gateway payment** can recover a gateway-order initialization whose response was lost by checking provider notes and exact totals. Never create a second charge/refund to resolve an uncertain first one.

Schedule `GET /api/cron/maintenance` every minute with `Authorization: Bearer YOUR_CRON_SECRET`. Each call processes at most 50 expired orders, using one transaction per order, and then up to 25 email outbox items. It is idempotent; multiple schedulers do not double-release units. Set a scheduler timeout suitable for the batch. Optional order emails use `RESEND_API_KEY` plus verified `ORDER_FROM_EMAIL`; Supabase SMTP still handles Auth emails. In-app order updates work without Resend. Email delivery retries up to five times, with provider idempotency keys; monitor failures and your mail provider.

## Check and deploy

```powershell
npm test
npm run typecheck
npm run build
npm start
npm run doctor
npm run test:live
```

The database tests run the real migrations in PGlite/PostgreSQL with minimal Supabase Auth/Storage stubs. They cover role provisioning, RLS isolation, protected RPC access, authoritative totals, reservation/idempotency, coupon limits, stock/payment replay, expiry/late capture and returns/refunds. They do not replace real Supabase Auth hooks, SMTP, Storage, concurrent network or provider settlement tests. `test:live` performs read-only/negative HTTP checks; authenticated and settlement checks are in the workbook launch checklist.

Deploy to a Next.js Node hosting platform or the supplied Dockerfile. Install from the lockfile, set all environment variables, build, then start. Public `NEXT_PUBLIC_*` values are baked into client bundles; set them at build time. Set server secrets at runtime; do not use Docker build arguments for secrets. The Docker build takes only public build arguments. No production deployment has been made. Do not enable orders until the hosted checklist passes.

## Files and guides

- `WORKFLOW-GUIDE.xlsx`: ten themed worksheets, daily workflows, exact control index, editable launch checks.
- `docs/WORKFLOW-GUIDE.md`: searchable version of the operational guide.
- `docs/ui-map.json`: UI field/control inventory.
- `docs/SECURITY.md`: trust boundaries and deployment checks.
- `docs/VALIDATION.md`: actual local verification and outstanding hosted checks.
- `supabase/migrations`: schema, RLS, transactional business operations and buckets.
- `src/lib/admin-fields.ts`: authoritative admin configuration fields/labels/units.

This is a complete implemented codebase for integration and launch verification. Live Supabase connection, native Auth settings, email delivery, real payment settlement, courier adapters and production operations require your project/provider credentials. No claim of absolute security or a zero-leak guarantee is made.
