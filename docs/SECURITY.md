# Security boundaries

All privileged Supabase operations live behind `server-only` modules. Client components receive public catalogue DTOs or authorized account/order responses. Environment secrets are never returned by admin readiness APIs. Private APIs return `Cache-Control: no-store`.

Every mutation checks exact configured Origin, fresh Auth identity, account suspension, request bounds and Zod schemas. Staff tools additionally require current TOTP assurance `aal2` and a fresh database permission check. Public provider webhooks use their own raw-body HMAC; cron uses a separate Bearer secret. Passwords and proof bytes are never logged. Generic failures return only a random request reference.

Commerce RPCs are executable only by service_role. Client table writes are revoked. RLS protects own-record reads and checks staff MFA. Proofs are stored in a private bucket with signed URLs lasting 60 seconds; arbitrary SVG uploads are rejected. Public media uploads accept magic-byte-matched JPEG/PNG/WebP up to 5 MiB. Media URLs are public by design.

Checkout locks the customer, applicable offer and products in a consistent order. It snapshots prices and addresses, reserves units and binds idempotency keys to the request. All arithmetic uses integer paise. Staff inventory changes cannot remove reserved units. Payment/cancellation/expiry/return transitions lock their order and restore/deduct units once. Gateway event identity is based on the fetched payment/refund entity, not an unauthenticated delivery-header ID. Refund initiation is unique per order and uncertain network results are not automatically retried.

Direct untagged trusted Auth user creation intentionally grants superadmin. Public signup must be disabled independently, and the rejecting Before User Created hook must be installed. Protected `app_metadata.store_role` is authoritative; untrusted user metadata is ignored. Only controlled server routes create tagged customers/managers. Role provisioning and protected metadata changes happen inside Auth transactions. Unknown/null protected roles fail closed. Unrelated provider metadata updates do not reset a role; email changes sync notification addresses. Staff suspension uses a shared transaction lock to prevent concurrent removal of all active superadmins.

Setup checks cannot prove production security by themselves. Before launch verify Auth hook behavior with real Admin API creation and malicious native signup, customer isolation using two sessions, staff MFA/permission removal, expired/replayed gateway payments, concurrent low-stock checkout, private Storage access, bank reconciliation/refund settlement and backups. Keep database owner/service credentials restricted, rotate them after exposure, monitor provider webhook/email failures and configure retention/deletion according to business requirements. Audit rows contain configuration changes and staff identifiers; restrict database access and retention accordingly.

Migrations target a new dedicated project. They revoke public function grants in the public schema; do not apply blindly to an unrelated existing application's shared schema. HTTP CSP blocks object embedding, base overrides, framing and off-origin form submissions; a nonce-based script CSP is not configured because hosted Checkout/CAPTCHA and Next runtime scripts need a deployment-specific policy. Normal React escaping, validated URLs and image restrictions remain in place.

The generic tracking webhook requires a trusted adapter that signs the documented contract. It never fetches arbitrary user-supplied tracking URLs. The final external tracking link uses an encoded tracking ID and HTTPS. Admin permission combinations for payment/shipping work should include `orders` so those staff can open order details. Superadmins retain all capabilities.

## ERP Security Boundaries & Role Hierarchy

1. **Four Primary Roles**:
   - `superadmin`: Unrestricted administrative capabilities. Owns category/subcategory trees, shared catalog discount configuration, staff payroll policies, attendance rule tiers, employee provisioning/linking, POS global settings, and payroll approval/payment execution.
   - `manager`: Operational role with granular permissions (e.g. `pos`, `purchases`, `inventory`, `expenses`, `attendance`, `reports`). Actions are verified by database capability checks (`private.can_actor`) and require MFA assurance `aal2`.
   - `billing`: Dedicated storefront cashier role created or linked directly from Staff Management. Operates exclusively within POS billing (`/admin/pos`) with a mandatory linked active employee record. If the employee is deactivated, POS access is instantaneously revoked at the database level. Billing staff cannot alter inventory counts, receive or return purchase orders, log manual expenses, mark attendance, or alter salary policies. Furthermore, billing cashiers can view only their own POS receipts in recent sales.
   - `customer`: Public storefront customer. Isolated strictly to their own cart, profile, and orders via RLS. All ERP RPCs and private schemas are fully revoked from client execution.

2. **Serialized Stock & Barcode Integrity**:
   - Unique stock stickers utilize the reserved namespace `MSU[0-9]+`. Products cannot use barcodes starting with `MSU`, preventing collision with serialized stock stickers.
   - Receiving purchase orders or adjusting stock triggers deterministic unit record creation (`product_units`). Unit state transitions (`in_stock` -> `sold` -> `in_stock`) are transaction-locked and verified against held/reserved stock.

3. **POS Tenders & Walk-In Discounts**:
   - POS checkout mandates exact tender reconciliation: `cash + upi + card == total_paise`.
   - Noncash tenders enforce transaction reference recording and explicit merchant verification flags.
   - Extra walk-in discounts cannot exceed `max_discount_bps` configured by superadmin, and discounts > 0 mandate an audited justification.

4. **Payroll & Expense Locking**:
   - Attendance edits are blocked for any month that has an `approved` or `paid` payroll run.
   - Finalizing payroll as `paid` automatically posts a corresponding expense record linked to the payroll run. Automated payroll expenses are immutable and cannot be manually voided or tampered with.

There is no penetration-test certification or guarantee of zero defects. Review and run the supplied launch checks in the actual deployment.
