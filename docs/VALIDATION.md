# Verification record — 17 November 2026

Local environment: Windows, Node 22.19.0; Next.js 16.4.6, React 19.3.1, Supabase JS 2.119.0. Dependencies are pinned by `package-lock.json`.

| Check | Result |
|---|---|
| Dependency installation audit | 0 reported vulnerabilities at installation |
| `npm test` | 30 tests passed; 0 failed (database, ERP workflows, security) |
| `npm run typecheck` | Passed (tsc --noEmit clean) |
| `npm run build` | Passed, all application, ERP and API routes compiled |
| Production server HTTP smoke test | 7 public pages rendered; 2 private APIs rejected unauthenticated access; cross-origin mutation, forged gateway webhook and unauthenticated cron rejected |
| Client bundle secret-name scan | No `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` or `TURNSTILE_SECRET_KEY` references in browser static chunks |
| Catalogue HTTP checks | All 20 product cards and image assets served; Tamil brand and `00 Rs` placeholders present; unconfigured ordering disabled; unknown pages return 404 |
| Workflow workbook | Valid XLSX archive; 16 tabs; 230 field/control groups; 46 editable launch checks; worksheet previews reviewed |

Database tests execute all migrations 0001 through 0008 in PGlite/PostgreSQL, with minimal test-only Auth/Storage stubs. Dedicated tests verify:
- Four roles (`superadmin`, `manager`, `billing`, `customer`) with strict RBAC boundaries and `private.can_actor` capability checks.
- Category & Subcategory setup by superadmin, product nesting under subcategories, and bidirectional sync to online storefront (`store_catalogue`) and POS.
- Shared discounts: category-, subcategory-, and product-level discounts where strongest active percentage applies in both POS and online catalogue without stacking.
- POS workflows: barcode scanning (product & serialized unit stickers), split payments (cash, upi, card), cash change calculation, walk-in customer discounts within `max_discount_bps` limits, idempotent checkouts, and receipt returns restoring unit state and stock.
- Purchase management & barcode generation: PO creation, status transitions, idempotent receiving, exact `MSU[0-9]+` serialized barcode creation per physical unit, label print tracking (`labels_printed`), supplier returns, and supplier payments/refunds.
- Expenses: customizable expense logging across payment methods and categories, noncash reference validation, voiding with mandatory audit reason, and automated payroll expense posting.
- Staff & Payroll: full-time and part-time employee configuration, monthly/daily/hourly pay bases, daily attendance marking (full day, half day, leave, permission, weekly off, holiday, absent), tiered salary policy loss-of-pay calculation, monthly bonuses/allowances/deductions, approved month attendance locking, and salary payment settlement.

Focused source review found and corrected concurrent superadmin suspension, stale Auth email copies, expired gateway checkout openings, multi-order expiration lock ordering and manual refund interruption recovery. The order page checks payment expiry every five seconds; the server independently checks it at gateway initialization. All stock/payment transitions remain transaction protected.

These results do **not** establish a live deployment or provider integration. No project/provider credentials were supplied. Outstanding hosted checks are listed individually in `WORKFLOW-GUIDE.xlsx`: real Supabase Admin API trigger behavior, public signup/hook configuration, confirmation/recovery templates and SMTP delivery, staff MFA cookies, private Storage enforcement, two-user ownership tests, concurrent stock/coupon/suspension transactions, Razorpay UPI device behavior/capture/duplicate delivery/late capture/refund settlement, manual bank verification, scheduler delivery, optional order emails and carrier adapter signatures. The Dockerfile and native Excel application were not run. Browser visual and authenticated interaction testing were not performed for this Next.js conversion; the workbook previews were reviewed separately.

Re-run doctor, smoke tests and launch checks against your staging origin. Keep orders disabled until those checks pass.
