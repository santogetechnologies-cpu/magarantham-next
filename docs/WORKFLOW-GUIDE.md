# மகரந்தம் சில்க்ஸ் — Workflow guide

This guide accompanies the supplied Next.js / Supabase application. Exact visible controls are listed in the button and field index. Production setup and payment checks remain human verification tasks until recorded.

## Start Here

### Read first: Store identity

மகரந்தம் சில்க்ஸ் / Magarantham Silks. Brand colors: peach #fae0c9, burgundy #77051a, gold #976017.

Role: All readers.

### Scope: How to use this guide

Use the role tabs for daily workflows, the ButtonIndex for exact visible controls, Setup for installation, and LaunchChecks for editable evidence before launch.

Role: All readers.

### Important: Zero-priced seed products

Seed catalog prices and stock are placeholders. Enter real sale prices and available stock before enabling online checkout. Rs 00 does not mean the product is free.

Role: Superadmin / manager.

### Important: Payment evidence

A UPI screenshot or UTR is a customer claim. Staff must independently reconcile the bank credit before accepting a manual payment.

Role: Staff.

### Important: Deployment status

No live credentials were supplied. Setup, SMTP, production auth, live Razorpay capture, delivery, refunds and backups must be verified in the target project.

Role: Installer.

### Permissions: Role authority

Only trusted app_metadata.store_role is used for role provisioning. Never put staff roles in user_metadata or trust a browser-supplied role.

Role: Installer / superadmin.

### Permissions: Customer

Can manage their own account, addresses, cart and orders. Cannot access staff operations or another customer's private records.

Role: Customer.

### Permissions: Manager

Can use only operations granted to that manager. Hidden controls are not authorization: server and database checks also enforce access.

Role: Manager.

### Permissions: Superadmin

Owns staff creation, access and sensitive configuration. A user created directly through the trusted Supabase Dashboard Auth flow is provisioned as superadmin when no trusted store_role is set, as explicitly requested.

Role: Superadmin.

### Routine: Daily opening

Review pending manual payments, expiring reservations, new orders, stock, published banners/offers and customer notices. Check notification failures.

Role: Staff.

### Routine: Daily closing

Reconcile bank and gateway receipts against orders, record refund references, review stock adjustments and audit changes, and verify scheduled processing ran.

Role: Staff.

### Permissions: Billing staff

A billing login links to an active employee and can create POS bills and review only its own POS bills. It cannot manage inventory, supplier purchases, expenses, attendance, payroll or staff access. MFA is required. Employee records without a login can still have attendance and payroll.

Role: Billing / superadmin.

### Training: Editable examples

Examples contains yellow inputs for strongest catalog discount, split tender balance, supplier balance and a bounded monthly salary demonstration. Change one input at a time and read the calculated status. Preserve actual transaction evidence and run operational launch checks in the application.

Role: Staff.

## Setup

### 1: Prerequisites

Use Node.js 22 or newer, npm, a Supabase project, and a deployment host supporting Next.js server routes. Keep development and production Supabase/payment projects separate.

Role: Installer.

### 2: Install packages

In the application directory run npm install. Copy .env.example to .env.local and fill actual project identifiers and server secrets. Do not commit .env.local.

Role: Installer.

### 3: Public environment

NEXT_PUBLIC_SUPABASE_URL is the project URL. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is the publishable/anon key. NEXT_PUBLIC_SITE_URL must match the deployed canonical origin and auth redirects.

Role: Installer.

### 4: Server environment

SUPABASE_SERVICE_ROLE_KEY is server-only. Never use a NEXT_PUBLIC_ prefix for service, payment, webhook, CAPTCHA or email secrets.

Role: Installer.

### 5: Database

Apply the supplied Supabase migration files in filename order to an empty project. Confirm tables, constraints, RLS, storage policies, functions, profile provisioning and auth hooks are present before seeding.

Role: Installer.

### 6: Disable public Supabase signup

Supabase Authentication: global Allow new users to sign up OFF, Email provider ON, Confirm email ON, anonymous sign-ins OFF, and OAuth providers disabled. In config.toml use [auth] enable_signup=false and [auth.email] enable_signup=true with enable_confirmations=true. The email flag maps to external_email_enabled and must stay true for password login and confirmation resend. Configure the mandatory Before User Created Postgres hook to reject public signup with HTTP 403.

Role: Installer.

### 7: Trusted creation

Website registration must call the server route, which uses Auth admin createUser with trusted app_metadata.store_role=customer and email_confirm=false. Resend the signup verification email through configured SMTP. Admin createUser bypasses the public signup hook.

Role: Installer.

### 8: Auth metadata timing

The profile trigger must handle the app_metadata update that Auth admin creation performs after INSERT within its transaction. Do not assume the first inserted row already contains the intended role.

Role: Installer.

### 9: Email

Keep Email provider enabled and Confirm email enabled. Configure Supabase custom SMTP, sender identity and production site/redirect URLs. Test signup confirmation, confirmation resend, password login and password reset from an external mailbox. RESEND_API_KEY and ORDER_FROM_EMAIL optionally send order email; they do not replace Supabase auth SMTP.

Role: Installer.

### 10: CAPTCHA and IP

Set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY for production registration. Set TRUSTED_IP_HEADER only to the header your trusted proxy overwrites. An empty header setting uses a conservative shared limiter.

Role: Installer.

### 11: First superadmin

Create the first account through Supabase Dashboard Authentication Users, with a strong password and controlled email. The requested direct-Dashboard provisioning path grants superadmin when trusted store_role is absent. Immediately log in, enroll staff MFA and test access.

Role: Superadmin / installer.

### 12: Seed catalog

Run npm run seed after environment and migrations are valid. Inspect seeded products, categories, images and settings. Replace placeholder prices and stock with real values before sale.

Role: Installer / superadmin.

### 13: Manual UPI

Enter the shop's verified UPI ID and beneficiary name through settings. Confirm the generated payment instructions/QR are correct using the shop's banking application. Assign a payment verifier.

Role: Superadmin.

### 14: Gateway UPI

Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from the matching test/live account. Set RAZORPAY_WEBHOOK_SECRET to the secret configured for this deployment's webhook. Expose only the key ID where required by checkout.

Role: Installer.

### 15: Webhook

Configure Razorpay webhook POST /api/webhooks/razorpay at the deployed origin with matching RAZORPAY_WEBHOOK_SECRET and required payment/refund events. Server verifies the raw-body signature. Test duplicate, invalid-signature, wrong-amount and late-payment events; a browser success callback alone does not establish payment.

Role: Installer.

### 16: Scheduled work

Set CRON_SECRET to at least 32 random bytes. Schedule GET /api/cron/maintenance with Authorization: Bearer followed by that secret (for example every 5 minutes). Each run expires at most 50 orders through separate expire_reservations RPC transactions, one expired reservation per call, stopping when none remain; it then processes configured email outbox jobs. Verify JSON expired/sent counts and scheduler logs. Repeat scheduling drains larger expiry backlogs.

Role: Installer.

### 17: Local validation

Run npm run doctor, npm run typecheck, npm test and npm run build. Run npm run dev for local browsing. With a dedicated test project, run npm run test:live and record actual outcomes.

Role: Installer.

### 18: Deploy

Install production environment variables in the host, deploy the built Next.js app, configure HTTPS/domain and auth redirect allowlist, and recheck SMTP, CAPTCHA, webhook and cron against the deployed origin.

Role: Installer.

### 19: Backups

Enable an appropriate Supabase backup/PITR plan, back up storage assets separately where needed, record environment variable names securely, and test restoration into a separate project. Never store secrets in this workbook.

Role: Installer.

### 20: Handover

Keep the first superadmin recovery process controlled, store gateway/SMTP recovery credentials securely, assign daily reconciliation and refund owners, and complete every launch check before public promotion.

Role: Owner.

### 21: Carrier webhook

Optional automatic carrier integration posts to /api/webhooks/tracking. Configure TRACKING_WEBHOOK_SECRET, sign the raw JSON with HMAC-SHA256 in x-store-signature, and send event_id, order_id, tracking_id, and status shipped or delivered. Verify tracking/order/payment match and idempotency in staging. Courier URL templates still provide customer tracking without this integration.

Role: Installer.

### 22: Required auth email templates

Supabase Authentication Email Templates must use server-readable token_hash links. Copy the exact Confirm signup and Recovery links in the following two rows. Set SiteURL to the actual canonical site. Do not keep the default ConfirmationURL for these flows: admin-created users may receive implicit tokens in a URL fragment, which the server callback cannot read. Test both actual email links end to end.

Role: Installer.

### 23: Confirm signup template link

{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup

Role: Installer.

### 24: Recovery template link

{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password

Role: Installer.

### 25: ERP migration upgrade

Back up before upgrade. Apply all supplied migrations 001 through 008 in filename order, using each file as its own transaction; 004 adds the billing enum before later files use it. Existing category text is migrated into main categories and All styles subcategories. Existing on-hand stock is backfilled with one unique unit code per piece. Reconcile stock counts and active employee policies before POS use.

Role: Installer / superadmin.

### 26: POS and printer setup

In POS settings review shop identity, bill prefix, tax rate, maximum extra walk-in discount, 58/80 mm receipt width and enable toggle. Configure a Code 39-capable scanner. Under Barcode labels test one actual sticker at 100% print scale with quiet margins before a batch.

Role: Superadmin / installer.

## Operations

### Staff login: MFA

Staff authenticate by email/password, then enroll or verify a TOTP authenticator. Scan the enrollment QR with an authenticator app, enter its current six-digit code, and retain account recovery access. A password-only session cannot perform staff writes.

Role: Superadmin / manager.

### Staff access: Create manager

Use manager creation from an MFA-verified superadmin session. Supply name, email and an initial password of 12–128 characters. Server creation sets trusted manager metadata and requests email confirmation. Review and restrict permissions immediately in the staff access controls; the database default grants all configured manager capability groups. Share the password privately, then have the manager confirm email, change password and enroll MFA.

Role: Superadmin.

### Staff access: Suspend manager

Suspend the account or remove access in the staff controls. Verify the affected account cannot perform new server writes even if a browser tab remains open. Review outstanding orders assigned to that person.

Role: Superadmin.

### Catalog: Create product

Open Products and Add product. Enter SKU, optional product barcode, required Subcategory, lowercase Page name, Saree name, colour, description, image, real rupee price, product discount and publication/featured/archive flags. Main category follows subcategory. Save changes, then add stock with a reason or receive a purchase. New products start with zero stock and cannot sell at zero price.

Role: Authorized staff.

### Catalog: Edit and archive

Open an existing product, correct the fields and save. Review rate, offer and channel effects. Archive discontinued products to remove them from new sales while retaining historical order lines.

Role: Authorized staff.

### Pricing: Discounts

Use a nonnegative real price. Do not invent a list price or discount. Automatic offers and coupon offers do not stack. Confirm which eligible benefit the checkout selects and check the final amount before payment.

Role: Authorized staff.

### Inventory: Stock adjustment

Record the signed adjustment and a clear reason, such as stock received, damaged item or physical count correction. Check available stock after reservations. Do not overwrite stock merely to hide an unexplained discrepancy.

Role: Authorized staff.

### Inventory: Reservations

Checkout reserves stock for a limited period. Available stock differs from physical stock while orders are pending. Expired unpaid reservations must release through scheduled cleanup. Reconcile late payments before fulfillment.

Role: Staff.

### Channels: WhatsApp only

Choose store checkout mode whatsapp_only to offer WhatsApp orders. Customer saves an unpaid order with delivery details and consent, which reserves stock, then opens WhatsApp from the order page and presses Send. Staff independently check payment before confirmation.

Role: Authorized staff.

### Channels: Online UPI only

Choose store checkout mode online_only for direct purchase. Real price, available stock, verified customer, ordering_enabled and a configured UPI method are prerequisites.

Role: Authorized staff.

### Channels: Both

Choose store checkout mode both to offer enquiry and purchase choices. Keep the displayed product, rate and availability consistent across the two channels.

Role: Authorized staff.

### Marketing: Banner scheduling

Open Banners and Add banner. Enter Title, Short text, Image URL, Button text, internal Button page, home/shop position and display order. Tick Publish banner, set optional start/end in your browser local time, then Save changes. The form displays saved schedule values in browser local time; the server stores timestamps for schedule enforcement. Check the storefront before, within and after the intended window.

Role: Authorized staff.

### Marketing: Offer scheduling

Open Offers and Add offer. Enter coupon code or leave blank for automatic, choose percent/fixed, value and limits/window, tick Enable offer and Save changes. Fixed Discount value uses paise: 10000 = Rs 100. Other fields explicitly labeled Rs convert rupees to paise. Product discounts apply first, then one coupon or one automatic offer; automatic offers are selected by ID order.

Role: Authorized staff.

### Communications: Bulk enquiries

Review each customer bulk enquiry with name, phone, quantity and message. Contact the customer through the configured shop contact route, then update the enquiry status to contacted or closed. This is an enquiry workflow rather than an automated mass-message sender.

Role: Authorized staff.

### Communications: Notices and settings

In Settings maintain shop support/bulk/WhatsApp contacts, UPI details, public Announcement, home text and image URLs. Use Save settings, then inspect the public pages. Payment secrets, SMTP, CAPTCHA and cron are environment/project configuration. The settings form does not contain a custom policy editor or arbitrary customer-message sender.

Role: Authorized staff / superadmin.

### Permissions: Manager capability keys

Manager capability keys are catalogue, inventory, orders, payments, content, offers, shipping, bulk, pos, purchases, expenses, attendance and reports. Superadmin owns categories/shared discount configuration, employee/policy/payroll, global settings and login access. Billing is limited to POS with an active employee link. The server checks current role, permission and MFA on protected operations.

Role: Superadmin / manager.

### Catalog fields: Validation reference

SKU and product barcode must not collide with another product code or reserved MSU-plus-digits unit namespace. Subcategory must be a valid child of a main category. Image uses local /assets or HTTPS. Price is integer paise in storage; the UI accepts rupees. Product discount is 0–90%. Shared catalog rules may supply a stronger rate. Published controls online visibility; archived blocks new sales.

Role: Authorized catalogue / inventory staff.

### Settings: Shipping, tax and reservation

Shipping charge and free-shipping threshold are stored in paise. A zero free-shipping threshold disables that threshold. Tax is stored in basis points (100 basis points = 1%). Reservation duration must be 10 to 1440 minutes. Check the UI labels before entering values so rupees, paise, percent and basis points are not confused.

Role: Superadmin.

### Offer fields: Amount and limits

Offer code is uppercase; a blank code is an automatic offer. Percent offers are at most 90%. Fixed values, minimum subtotal and maximum discount use integer paise in storage. Max uses and per-customer limit must be positive. End time must follow start time. Checkout selects one coupon or one automatic offer rather than combining them.

Role: Authorized offers staff.

### Media: Upload image

Upload an actual JPEG, PNG or WebP image up to 5 MiB from the staff media control. This requires content permission and MFA. Copy the returned public URL into the product, banner, logo or hero image field, then save the owning record. Upload alone does not publish the image.

Role: Authorized content staff.

## Orders Payments

### Manual UPI: Customer submission

Customer follows displayed shop UPI details, completes payment in their UPI app, then enters a UTR/reference of 6–80 letters, digits, spaces or hyphens and uploads an actual JPEG, PNG or WebP payment proof up to 5 MiB. The order remains submitted/awaiting bank verification. Gateway orders do not accept manual proof.

Role: Customer.

### Manual UPI: Bank verification

Open the pending payment, independently inspect the shop bank/UPI ledger, match amount, reference, date and beneficiary, and check that the reference has not already paid another order. Accept only after the credit is confirmed.

Role: Authorized payment staff.

### Manual UPI: Investigate unmatched proof

If credit cannot be matched, leave payment unconfirmed and contact the customer through the published shop contact route. This interface has no Reject proof button. A plausible screenshot is insufficient. Investigate reference, beneficiary and exact amount before using Confirm manual payment.

Role: Authorized payment staff.

### Razorpay UPI: Order creation

The server calculates price, eligibility and available inventory and creates a gateway order. Customer completes the offered UPI flow. Payment links refresh expiry every 5 seconds, and the server independently enforces the exact stock-hold expiry before gateway setup. Do not pay after expiry or enter gateway secrets in the browser.

Role: Customer / server.

### Razorpay UPI: Paid confirmation

Server-side signature/payment verification and signed gateway webhook processing establish payment state. Check the order page after returning from the gateway. A closed popup or customer claim is not payment confirmation.

Role: Server / staff.

### Razorpay UPI: Late paid event

If payment arrives after a reservation expires, do not silently oversell. Review stock and the recorded late-payment/refund handling. Reconcile the gateway transaction and resolve/refund according to the supported workflow.

Role: Authorized staff.

### Fulfillment: Progress order

Review the verified-paid order, allocate stock, pack and dispatch through only the transitions offered by the current order state. Do not skip payment verification. Record the courier and tracking identifier before communicating shipment.

Role: Authorized order staff.

### Tracking: Provider template

Use an HTTPS courier URL template containing exactly {tracking_id}. Save an enabled provider, then select it and enter the order tracking ID (2–100 characters). The order must be confirmed, packing or shipped when tracking is saved. Open the generated link to verify the correct provider record.

Role: Authorized staff.

### Cancellation: Before dispatch

Use the cancellation action only when offered for the current order. Enter the required reason. Confirm stock/reservation release and whether a paid order also requires a refund. Cancelling an order does not by itself prove money was refunded.

Role: Customer / staff, as permitted.

### Returns: Request and review

Customer supplies a return reason through their order controls where eligible. Staff review the policy, evidence and current order state. Record the decision and communicate next steps. Returned stock must be inspected before restocking.

Role: Customer / authorized staff.

### Refund: Reconcile settlement

Use the supported full refund action for the payment type. Gateway refunds must be reconciled with the actual provider outcome. Manual UPI refunds require actual bank action and verification, then Record completed manual refund with the bank reference. If local recording was interrupted, retrying that action reuses its existing refund record. Review failed/pending refunds until settled; do not repeat an actual bank transfer.

Role: Authorized payment staff.

### Notifications: Delivery

Check customer account notifications and configured transactional email. Retry failed queued deliveries through scheduled processing. Never treat a queued notification as proof that a customer received it.

Role: Staff.

### Order states: Exact permitted transitions

Verified payment confirms an order. Staff: confirmed to packing, packing to shipped only with tracking ID and paid status, shipped to delivered. Customer cancellation is limited to awaiting_payment. Authorized staff may cancel awaiting_payment, confirmed or packing. Delivered may move to return_requested; authorized staff receive the return with a reason of at least 3 characters, which restores stock and marks refund_pending. Invalid transitions are rejected.

Role: Customer / authorized staff.

### Checkout limits: Quantity and pending orders

A cart supports 1 to 20 distinct products and 1 to 20 units per product. A customer may have at most 5 pending orders with stock reserved. Duplicate products in a request and changed data under the same checkout idempotency key are rejected.

Role: Customer / support.

## Customer

### Register: Create account

Open registration, enter name (2–80 characters), email and a strong password of 12–128 characters, complete CAPTCHA where enabled, and submit. Use an email you can access. The protected server creates an unconfirmed customer account and requests a signup email. The generic response intentionally does not reveal whether an address already exists.

Role: Customer.

### Verify: Confirm email

Open the Supabase confirmation email and follow its link. If it expires, use the supported resend flow. Check spam and contact the shop if emails do not arrive. Do not create repeated accounts to bypass a delivery failure.

Role: Customer.

### Log in: Email and password

Use the registered email/password. Complete verification before protected checkout if requested. Use password reset when needed and sign out on shared devices.

Role: Customer.

### Password: Reset

Request reset for the account email, follow the time-limited email link, choose the new password and sign in again. Never share the reset link or password with shop staff.

Role: Customer.

### Browse: Find a product

Use the actual collection/category, search, filter and sort controls shown in the storefront. Open product details and inspect images, price, fabric, availability and purchase channel.

Role: Customer.

### Account: Addresses

In Account, open Addresses, enter an address label and Full name, Phone number, Address line 1, optional line 2, City, State and six-digit Indian PIN code, then Save address. Existing cards offer Delete address. To correct a saved address through the UI, delete and add it again. Review the checkout address separately before saving an order.

Role: Customer.

### Cart: Review

Add eligible products, adjust quantities within available stock or remove a line. Review price and total again before checkout. A cart is not a stock reservation and price/stock may be rechecked by the server.

Role: Customer.

### Checkout: Address and offer

Select or enter a valid address, enter an eligible coupon if offered, review the final payable amount and choose an enabled payment method. Automatic and coupon discounts do not stack.

Role: Customer.

### Checkout: Payment

Press Save order & view final total. This saves an unpaid order and reserves stock; it does not charge money. On the order page review the final amount, then complete the selected payment/WhatsApp step. For manual UPI, pay and submit UTR/proof. For gateway UPI, complete the gateway flow and wait for verified confirmation. Keep the order number and reference.

Role: Customer.

### Orders: Track

Open the account order list, select an order and read its payment and fulfillment status. Use the tracking link after dispatch. Check account notifications for staff updates.

Role: Customer.

### Support: Cancellation or return

Use the relevant action when the order state and shop policy allow it. Supply a clear reason and monitor the decision. Contact the shop with the order number if no action is offered.

Role: Customer.

### WhatsApp: Enquire

At checkout select WhatsApp order and tick consent to share order and delivery details. Save the order and review the final total. On its order page open WhatsApp, review the prefilled message and press Send yourself. The saved order reserves stock until its expiry; opening WhatsApp alone neither sends the message nor confirms payment.

Role: Customer.

### Account: Profile, wishlist and notifications

Change display name (2–80 characters). Save products to wishlist or remove them through the offered controls. Mark notifications read. Keep at most 10 saved addresses; address editing/removal affects the account address book, while an existing order retains its address snapshot.

Role: Customer.

## Troubleshooting

### Cannot log in: Email unverified or credentials

Confirm the correct email/password and email verification. Try the reset flow. Installer checks Supabase auth redirect URLs and SMTP logs; do not disable verification as a workaround.

Role: Customer / installer.

### Registration fails: Hook / service configuration

Public Supabase signup must fail. Website registration uses admin createUser with trusted customer metadata. Check server-only key, CAPTCHA, rate limits and update-aware profile trigger. Keep global signup OFF while Email provider and Confirm email stay ON; disabling Email provider prevents password login/confirmation resend.

Role: Installer.

### Staff write denied: MFA or permission

Verify current TOTP MFA, active account and granted operation. Sign out/in after access changes. Do not bypass the server check or expose service keys to the browser.

Role: Staff / superadmin.

### Checkout unavailable: Rate, stock or channel

Check real price greater than zero, available stock after reservations, product publication/archive state, store Order channels, Enable orders, verified customer and configured payment settings.

Role: Staff.

### Payment pending: No independently confirmed credit

Manual UPI requires bank reconciliation. Gateway UPI requires valid server verification/webhooks. Check the gateway transaction, signature secret, order ID and reservation expiry before fulfillment.

Role: Payment staff / installer.

### Stock remains reserved: Scheduled cleanup

Check CRON_SECRET authorization and scheduler logs. Each maintenance run processes at most 50 expired orders, one reservation per RPC transaction, before email jobs. Keep the scheduler repeating to drain a larger backlog. Investigate payment races before manually changing inventory.

Role: Installer.

### Banner missing: Publication or schedule

Check publication state, start/end window, image URL and destination. Schedule controls display browser local time. Confirm the intended interval and that the current time falls inside it.

Role: Staff.

### Coupon not applied: Eligibility

Check code spelling, active window, minimum spend, total usage and per-customer usage limits. Verify automatic versus coupon selection, because benefits do not stack. Automatic offers are selected by ID order, after product discount.

Role: Staff / customer.

### Tracking fails: Template or ID

Check the provider URL template and the order's tracking identifier. Open the generated link and correct the data rather than replacing the whole template with an unsafe customer-supplied URL.

Role: Staff.

### Email not delivered: SMTP/provider queue

Auth email uses Supabase SMTP; order email uses the configured transactional provider. Check each provider independently, sender verification, rate limits and failed queue records.

Role: Installer.

### Restore required: Backup validation

Restore database and asset backups into a separate project, apply matching app configuration, then check role boundaries, orders, balances, images and auth before changing production traffic.

Role: Installer.

## Superadmin

### Access: Bootstrap

Create the first account through trusted Supabase Dashboard Auth, sign in at the staff login and enroll/verify TOTP MFA before privileged changes. Website customer registration always supplies the trusted customer role.

Role: Superadmin.

### Team: Create manager

From staff creation enter name, email and initial password of 12–128 characters. Creation requests confirmation email. Review and restrict the new manager permissions immediately in the separate staff controls, because the default includes all configured manager capabilities. Never use the public registration page for staff.

Role: Superadmin.

### Team: Change permissions

Select the account, choose allowed capability keys and save. Review direct-request denial for a removed capability. Permissions govern writes on the server and database, even where shared read screens remain available.

Role: Superadmin.

### Team: Suspend or restore

Set the suspended control and save. A suspended profile is blocked by current server checks. The current actor cannot suspend themself through staff_update, and the last active superadmin cannot be suspended.

Role: Superadmin.

### Store: Sensitive settings

Maintain ordering_enabled, store checkout_mode, online_method, verified payment contacts, reservation duration, shipping, tax and store identity. Test in a staging project before enabling customer orders.

Role: Superadmin.

### Control: Audit and reconciliation

Review privileged changes, inventory movements and order events. Reconcile payment and refund references against actual bank/gateway records. Keep a controlled recovery account and review staff access regularly.

Role: Superadmin.

### ERP: Shop configuration and payroll

Maintain categories/subcategories, shared discounts, expense categories, employee records, optional login links, salary policies and POS settings. Review monthly attendance and draft payroll before approval. Only record salary paid after actual payment; payroll creates one matching expense.

Role: Superadmin.

## Manager

### Start: MFA and current account

Log in with the account created by the superadmin and enroll/verify TOTP. A password-only or suspended session cannot perform protected writes.

Role: Manager.

### Scope: Work within granted operations

Use only the capability groups granted to this account. Ask the superadmin for a specific missing capability when a server denies access. A visible link does not grant permission.

Role: Manager.

### Catalogue: Product work

With catalogue permission, maintain product fields and publication/archive/featured flags. Product creation starts with zero stock; use inventory adjustment with a reason to add real stock.

Role: Manager with catalogue.

### Inventory: Physical stock

With inventory permission, enter a signed stock change and reason. New balance cannot be below the quantity already reserved. Inspect movement history before correcting discrepancies.

Role: Manager with inventory.

### Orders: Fulfillment

With orders permission, move paid confirmed orders through packing, shipped and delivered. Shipping requires a tracking ID, and shipping capability is required to set tracking.

Role: Manager with orders / shipping.

### Payments: Verify and refund

With payments permission, independently verify bank credit before approving manual UPI proof. Process only eligible full refunds, retain references and review late-paid cases.

Role: Manager with payments.

### Marketing: Content and offers

With content permission maintain banners; with offers permission maintain promotions. Store-wide sensitive settings and staff access remain superadmin responsibilities.

Role: Manager with content / offers.

### Contacts: Bulk enquiry follow-up

With bulk permission review the inquiry and update new/contacted/closed status after actual customer contact.

Role: Manager with bulk.

### ERP: Additional capability groups

pos allows counter bills; purchases allows suppliers, orders, receipts/returns and payment records; expenses allows manual expense postings/voids; attendance allows actual day entries; reports allows operational reports with additional metric restrictions. Managers do not manage employee records, salary policy or payroll approval.

Role: Manager with granted capability.

## Billing

### Start: Account setup

Superadmin creates or links a billing login from Staff management. Confirm email, sign in, enroll authenticator and verify current code. An inactive linked employee or suspended profile blocks protected access.

Role: Billing staff.

### Daily: Counter sales

Open POS billing. Scan unique piece stickers or select quantity-based products, verify quote and available stock, allocate cash/UPI/card and complete a balanced bill. Billing can review/reprint only its own bills. Use Account to change password or sign out.

Role: Billing staff.

### Escalation: Returns and administration

Ask authorized POS+inventory staff to receive a full sale return and record completed refund. Billing-only accounts cannot restock, change prices/discount policies, manage suppliers/expenses/payroll or grant access.

Role: Billing staff.

## Stock Purchases

### Categories: Two levels

Create a main category with no parent, then subcategories under it. A subcategory cannot parent itself or contain a third level. Map each product to a valid subcategory; the product's main category follows that relationship. Inactive main/subcategories remove affected products from sale.

Role: Superadmin.

### Discounts: One strongest catalog discount

The shared product price uses the greatest active applicable percentage among product discount, category rule, subcategory rule and product rule. These percentages do not stack. The result is floored to an integer paise per unit. Online checkout and POS use this same catalog price; online order-level offers and a permitted POS bill discount are separate later steps.

Role: Superadmin / authorized catalogue staff.

### Inventory: Shared physical stock

Online orders reserve available inventory. Confirmed online payments and completed POS sales consume shared physical stock. Available units equal on hand minus reserved. Receiving a purchase adds stock; a permitted supplier return removes stock. Do not count reserved units as available for POS or supplier returns.

Role: Inventory / POS / purchases staff.

### Barcodes: One code per physical unit

Stock increases generate a unique MSU-prefixed unit barcode for each piece. A product's general SKU/barcode identifies its product type; each serialized unit identifies one physical piece. Keep MSU followed by digits reserved for generated unit codes. Print and attach the appropriate quantity of distinct unit stickers, not duplicate copies of one physical-unit identity.

Role: Authorized stock staff.

### Suppliers: Maintain supplier record

Create name, phone, email, address and optional GSTIN, then mark active for new purchase selection. Review supplier details before entering an invoice. Recording a GSTIN does not calculate or validate statutory filing obligations.

Role: Purchases staff.

### Purchases: Draft and order

Select an active supplier and add 1–100 distinct product lines, quantity 1–10000 each, unit cost and tax basis points. A nonblank supplier invoice is unique per supplier, ignoring case. Save while draft; lines are locked after ordering. Ordering alone does not increase stock or create a payable for unreceived goods.

Role: Purchases staff.

### Purchases: Receive goods

Receive only physically checked quantities from an ordered/partial/received purchase. Receipt cannot exceed ordered quantity. Every receipt adds stock and new unit barcodes. Partial receipts leave purchase partial; all ordered quantities received mark it received. Retry the same interrupted submission rather than recreating the receipt, so the request key prevents duplicate stock.

Role: Purchases staff.

### Purchases: Return to supplier

Record only goods actually returned and a reason of at least 3 characters. Returned quantity cannot exceed received quantity, available unreserved stock or unsold in-stock units belonging to this purchase. Return removes those units and reduces the received-goods balance. A sold piece or another purchase's stock cannot substitute for the original receipt units.

Role: Purchases staff.

### Purchases: Pay or record supplier refund

Balance equals net received quantity times unit cost plus rounded line tax, less payments plus recorded refunds. A positive balance is payable; a negative balance is recoverable from supplier. Record the actual completed transfer, method, 6–100 character reference and reconciliation confirmation. Paid/refund amount cannot exceed the matching outstanding balance. The app records money movement; it does not send the bank transfer.

Role: Purchases staff.

### Purchases: Cancellation

Cancel only a draft or ordered purchase with no received quantity. A partially or fully received purchase must use the receipt/return workflow. Preserve its historical receipts, payments and unit identities.

Role: Purchases staff.

## Expenses

### Setup: Expense categories

Superadmin maintains active expense categories. Choose a specific category for each expense; inactive categories cannot receive new manual postings.

Role: Superadmin.

### Posting: Log actual expense

Enter category, expense date, description, amount, method, reference and payee. Amount must be positive. Noncash methods require a reference of at least 6 characters. Confirm the source evidence, then save once. A retry with the same unchanged request key returns the existing posting.

Role: Expenses staff.

### Correction: Void with reason

Manual expenses can be voided with an explanation of at least 3 characters. Keep the original posting for audit and create a corrected entry if needed. Payroll-generated expenses are locked to their payroll source and cannot be voided as an ordinary manual expense.

Role: Expenses staff.

### Reports: Operational date range

Reports uses India dates. POS gross receipts and returns follow their respective event dates; POS tender receipts are gross sale-day amounts. Online totals include orders created in the range that are currently paid. Stock and supplier outstanding are current balances. Report expense/stock/purchase metrics require the matching capability. Export loaded CSV after reviewing its scope.

Role: Reports staff.

## POS

### Access: Billing role

An employee may have no login. A billing login must link to an active employee and is limited to POS. Manager permissions are assigned separately. Every protected staff operation still requires MFA and current account/employee access. Billing does not grant inventory, expenses or payroll access.

Role: Superadmin / billing staff.

### Bill: Add and scan pieces

Use the actual POS search/barcode controls to add products. A generated unit barcode identifies one in-stock physical piece; a product SKU/general barcode identifies its product type. Duplicate or unavailable unit identities must be corrected before saving. A bill supports 1–100 distinct products, 1–100 units each, with stock rechecked on the server.

Role: POS staff.

### Discount: Walk-in reduction

Catalog pricing first selects one strongest applicable percentage, floored per unit to paise. A separate POS walk-in amount is allowed only within the superadmin configured maximum basis-point percentage of subtotal. Positive walk-in discounts require a reason of at least 3 characters. No online coupon is applied to POS by this flow.

Role: POS staff.

### Payment: Split cash, UPI and card

Use one positive allocation per chosen method, at most cash, UPI and card. Allocations must sum exactly to final total after discount and tax. For UPI/card independently check actual receipt and supply a 6–100 character reference. The app records a checked counter payment; it does not initiate Razorpay checkout for a POS tender.

Role: POS staff.

### Cash: Tender and change

Cash received may exceed the cash amount allocated to the bill; change equals cash received minus cash allocation. With no cash allocation, cash received must be zero. Do not add change to the UPI/card allocation or count physical cash received twice.

Role: POS staff.

### Save: Complete once

Review customer details, pieces, discount reason and tender references, then save the bill. A successful transaction creates a numbered invoice and consumes shared stock/physical units exactly once. On interrupted submission retry the unchanged request rather than recreating the bill; changed data under the same request key is rejected.

Role: POS staff.

### Receipt: Print bill

Open the saved invoice/receipt and use its print action. Receipt settings retain shop identity, invoice prefix, paper width and footer. Check configured 58 mm or 80 mm output against the actual printer before daily use.

Role: POS staff.

### Return: Full POS return

Only staff with both POS and inventory permission may return a completed sale. Receive and inspect all pieces, complete the actual refund separately, then record a 3–500 character reason and 6–100 character refund reference. This full-return action restores original units once and marks the sale returned. Billing-only accounts cannot perform it.

Role: POS + inventory staff.

## Attendance Payroll

### Employee: Without or with login

Superadmin creates the employee record with code/name, full-time or part-time type, monthly/daily/hourly rate, normal daily minutes, overtime rate, recurring allowance/deduction components, joining/ending dates and active salary policy. Payroll does not require a website login. Optionally link a manager or billing account; one employee link per account.

Role: Superadmin.

### Policy: Working calendar and divisor

Work weekdays use 0=Sunday through 6=Saturday. Calendar divisor counts every date in the full month; scheduled divisor counts configured work weekdays in the full month. Base is prorated for employment dates. Under scheduled mode, work on a weekly off is paid only through explicitly recorded overtime to avoid a second base day.

Role: Superadmin.

### Policy: Leave tiers

Paid leave quota uses half-unit increments. Each leave is assessed in 0.5-unit steps. The paid quota is consumed first. Ordinal mode selects a tier using that half-unit ordinal in the month; monthly_total mode selects a tier using the total marked leave units in the month. Inclusive tier ranges cannot overlap; uncovered units use the default leave LOP rate. Basis points 10000 mean a fully unpaid leave unit, 5000 half unpaid, and 0 fully paid.

Role: Superadmin.

### Policy: Half day and permission

Monthly/daily half-day pay follows configured half-day pay basis points; hourly pay follows entered worked minutes. Permission consumes the paid permission-minute allowance chronologically; excess minutes cause proportional, half-day or full-day LOP according to the policy. Holiday pay follows holiday_paid; absence is unpaid.

Role: Superadmin / attendance staff.

### Attendance: Mark actual day

Choose employee/date and full_day, half_day, leave, permission, weekly_off, holiday or absent. Enter relevant worked, leave, permission and overtime quantities plus note. Dates must be within employment and cannot be future in Asia/Kolkata. Half-day worked minutes cannot exceed half the normal day; permission must be positive and no longer than the normal day. Overtime is allowed only with full_day, half_day or permission.

Role: Attendance staff.

### Completeness: Close the month

Payroll can be generated only after the full month has closed in Asia/Kolkata. Every scheduled day during employment requires an attendance record; an unmarked scheduled date blocks calculation. Nonworking dates without records default to weekly_off. Resolve missing or wrong entries before generating payroll.

Role: Attendance staff / superadmin.

### Payroll: Preview and generate draft

Superadmin previews the attendance calculation, reviews day-level paid/LOP units, divisor, earned base and overtime, then adds a monthly bonus and any extra allowance/deduction components. Recurring employee components are included too. Gross equals earned base plus overtime plus allowances including bonus; net equals gross minus deductions. Negative net is rejected.

Role: Superadmin.

### Rounding: Calculation amounts

Monthly base and LOP use the configured monthly rate, eligible/lost units and full-month divisor. Daily base/LOP use the daily rate and units. Hourly base/LOP use normal/paid minutes divided by 60. Each amount and overtime are rounded to integer paise before totaling. The workbook examples teach the configured shop calculation.

Role: Superadmin.

### Approval: Review current snapshot

Before approval, inspect attendance/policy/employee and monetary components. Approval recalculates and compares the saved calculation hash. If attendance or employee/policy data changed after draft generation, regenerate the draft before approving. Approved/paid payroll locks that employee month against attendance edits and draft replacement.

Role: Superadmin.

### Payment: Mark actual salary paid

Pay the employee outside the app first, verify actual receipt, then record method cash/UPI/card/bank, a 6–100 character reference and confirmation. Only approved payroll can become paid. Marking paid records one payroll-source expense when net is positive; it does not send a bank transfer. An identical repeat is idempotent; a different reference/method on paid payroll is rejected.

Role: Superadmin.

## Button and field index

### All public pages — Menu / Open full menu

Open the full collection navigation dialog.

All visitors

### All public pages — Close × / Close menu

Close the full menu. Escape also closes the dialog.

All visitors

### All public pages — Brand logo / name

Return to the home page.

All visitors

### All public pages — All sarees / All collections

Open /shop with all published products.

All visitors

### All public pages — Account / My account

Open your account; sign in when required.

All visitors

### All public pages — Bag / Shopping bag

Open /cart. Header count is the sum of quantities.

All visitors

### All public pages — Wedding sarees / Everyday sarees

Open Bridal or Cotton filtered collection.

All visitors

### All public pages — Bulk purchase

Open the bulk inquiry and shop phone page.

All visitors

### All public pages — Sign in

Open email/password login.

All visitors

### All public pages — Collection category links

Open /shop?category= with that category selected.

All visitors

### Home / — Shop sarees / View all sarees / See all styles

Open the shop.

All visitors

### Home / — Shop collection / collection image

Open the corresponding saree category.

All visitors

### Home / — Shop bridal sarees

Open Bridal category.

All visitors

### Home / — Saree type cloud links

Open the selected type in the shop.

All visitors

### Home / — Banner button text

Open the internal destination configured by staff. Only published in-window banners display.

All visitors

### Shop /shop — Search sarees

Type a name, colour or category fragment. Filtering is case-insensitive.

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — Saree type

Choose All or an available category.

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — Sort by

Choose Featured, Price: low to high, or Price: high to low.

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — Category chips

All, Kanchipuram, Bridal, Soft Silk, Cotton, Organza or Linen appears when present. Click to filter.

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — Product image / product name

Open /products/[slug].

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — ♡ / Save [product name]

Add the product to Favourites. Requires an authenticated active account.

Browse: all visitors. Wishlist: authenticated account.

### Shop /shop — Add to bag ＋ / Add [name] to bag

Add one unit to the local bag. Disabled when ordering is paused, rate is zero or available stock is below one.

Browse: all visitors. Wishlist: authenticated account.

### Product /products/[slug] — ← All sarees

Return to shop.

All visitors

### Product /products/[slug] — Add to bag ＋

Add one unit; ordering, nonzero rate and available stock are required.

All visitors

### Product /products/[slug] — Ask about bulk orders

Open /bulk.

All visitors

### Product /products/[slug] — Delivery & payment

Expand delivery/payment explanation.

All visitors

### Product /products/[slug] — Returns & help

Expand return/help explanation.

All visitors

### Bag /cart — Shop sarees

Open shop from the empty bag.

All visitors; bag is local browser data

### Bag /cart — Product name

Open product detail.

All visitors; bag is local browser data

### Bag /cart — Quantity

Enter 1–20 units; server rechecks stock at order save.

All visitors; bag is local browser data

### Bag /cart — Remove

Set this product quantity to zero and remove its line.

All visitors; bag is local browser data

### Bag /cart — Continue to order

Open checkout. A paused store still refuses order creation.

All visitors; bag is local browser data

### Bag /cart — Clear bag

Remove every bag line.

All visitors; bag is local browser data

### Checkout /checkout — Add sarees first

Open shop if bag is empty.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Sign in

Open login before order submission.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Use a saved address

Choose Enter a new address or a saved label to fill shipping inputs.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Full name

Required recipient name, maximum 80 characters.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Phone number

Required phone, 7–20 characters using digits, optional +, spaces, parentheses or hyphens.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Address line 1

Required street/building, maximum 180 characters.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Address line 2 (optional)

Optional additional address, maximum 180 characters.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — City

Required, maximum 80 characters.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — State

Required, maximum 80 characters.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — PIN code

Six digits; first digit cannot be zero.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Coupon code (optional)

Enter up to 40 characters. Invalid or ineligible coupon blocks order save.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — WhatsApp order · staff check your payment

Available unless store mode is online_only. Saves a WhatsApp-channel unpaid order.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — UPI · staff check your payment

Available in online-enabled mode when online_method=manual_upi.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — UPI · secure online payment

Available in online-enabled mode when online_method=razorpay_upi.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — I agree to share my order and delivery details…

Required for WhatsApp checkout. Customer will still press Send in WhatsApp.

Authenticated active account; order creation requires ordering enabled

### Checkout /checkout — Save order & view final total

Server validates account/cart/stock/rate/address/coupon, calculates total and reserves stock. Opens unpaid order. This does not charge money.

Authenticated active account; order creation requires ordering enabled

### Bulk /bulk — Call [bulk number]

Open telephone dialer if a number is configured.

Phone link: all visitors. Inquiry: authenticated account.

### Bulk /bulk — Your name

Required, maximum 80 characters.

Phone link: all visitors. Inquiry: authenticated account.

### Bulk /bulk — Phone number

Enter the contact phone.

Phone link: all visitors. Inquiry: authenticated account.

### Bulk /bulk — Number of sarees

1–100000; starts with the shop bulk minimum quantity.

Phone link: all visitors. Inquiry: authenticated account.

### Bulk /bulk — What do you need?

Required inquiry text, maximum 2000 characters.

Phone link: all visitors. Inquiry: authenticated account.

### Bulk /bulk — Send inquiry

Save the inquiry for shop follow-up. Sign in first; limited to 5 per hour.

Phone link: all visitors. Inquiry: authenticated account.

### Auth /login /register /forgot-password /reset-password — Your name

Registration only; 2–80 characters.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Email address

Valid email, maximum 254 characters. Not shown for new password.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Password · at least 12 characters

12–128 characters. Not shown on forgot-password.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — CAPTCHA

Complete registration challenge when configured. Production registration requires valid server CAPTCHA.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Create account

Submit protected website registration. Check confirmation email before sign-in.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Sign in

Authenticate and route customers to Account or staff to MFA.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Send reset email

Request a time-limited password reset email. Response does not reveal whether account exists.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Save password

Save new password from authenticated/recovery session.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Sign in / Create account / Forgot password? links

Open the related auth page.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Need a new confirmation email?

Enter email on login page.

Public auth forms; password update requires a valid session

### Auth /login /register /forgot-password /reset-password — Resend confirmation

Request another signup confirmation email; throttled to 3 per hour per email.

Public auth forms; password update requires a valid session

### Staff MFA /mfa — Set up authenticator

Enroll TOTP when no verified factor exists. Scan QR or privately enter shown secret in an authenticator app.

Authenticated staff account; no in-app MFA bypass

### Staff MFA /mfa — 6-digit code

Enter current authenticator code. Only six digits accepted.

Authenticated staff account; no in-app MFA bypass

### Staff MFA /mfa — Verify & open admin

Challenge/verify TOTP then open staff admin. Existing verified factor is reused.

Authenticated staff account; no in-app MFA bypass

### Staff MFA /mfa — Authenticator QR / secret

Sensitive enrollment display. Keep private; lost factor recovery is by project owner in Supabase Auth.

Authenticated staff account; no in-app MFA bypass

### Account /account — Open admin

Shown only to staff. Open staff tools; MFA and permission checks still apply.

Authenticated active account; only own data

### Account /account — Sign out

Sign out this local session and return home.

Authenticated active account; only own data

### Account /account — Orders

Open own order cards.

Authenticated active account; only own data

### Account /account — Order card MS-[number]

Open /account/orders/[id].

Authenticated active account; only own data

### Account /account — Favourites

View saved products.

Authenticated active account; only own data

### Account /account — Remove favourite

Remove this wishlist entry.

Authenticated active account; only own data

### Account /account — Addresses

View address book and add/delete controls.

Authenticated active account; only own data

### Account /account — Delete address

Delete that address-book entry. Existing orders retain their saved address.

Authenticated active account; only own data

### Account /account — Address label

Label up to 40 characters, default Home.

Authenticated active account; only own data

### Account /account — Full name

Required recipient name, maximum 80 characters.

Authenticated active account; only own data

### Account /account — Phone number

Required phone, 7–20 characters using digits, optional +, spaces, parentheses or hyphens.

Authenticated active account; only own data

### Account /account — Address line 1

Required street/building, maximum 180 characters.

Authenticated active account; only own data

### Account /account — Address line 2 (optional)

Optional additional address, maximum 180 characters.

Authenticated active account; only own data

### Account /account — City

Required, maximum 80 characters.

Authenticated active account; only own data

### Account /account — State

Required, maximum 80 characters.

Authenticated active account; only own data

### Account /account — PIN code

Six digits; first digit cannot be zero.

Authenticated active account; only own data

### Account /account — Save address

Add one complete address, at most 10 saved addresses. No edit-existing button is present.

Authenticated active account; only own data

### Account /account — Notifications

Show own account notifications.

Authenticated active account; only own data

### Account /account — View order

Open the order related to the notification.

Authenticated active account; only own data

### Account /account — Mark as read

Set read time for this notification.

Authenticated active account; only own data

### Account /account — Profile

Show name and password controls.

Authenticated active account; only own data

### Account /account — Name

Display name, 2–80 characters.

Authenticated active account; only own data

### Account /account — Save name

Save display name.

Authenticated active account; only own data

### Account /account — Change password

Open /reset-password for current session.

Authenticated active account; only own data

### Customer order /account/orders/[id] — ← Back to orders / Back to orders

Return to Account.

Authenticated order owner

### Customer order /account/orders/[id] — Track with [provider]

Open generated HTTPS provider link in new tab when tracking exists.

Authenticated order owner

### Customer order /account/orders/[id] — Send order on WhatsApp

Open prefilled order/address message. Review it and press Send in WhatsApp. Shown on awaiting-payment WhatsApp orders.

Authenticated order owner

### Customer order /account/orders/[id] — Open UPI app

Launch shop UPI intent with exact amount/order reference. On desktop use displayed UPI ID and total on phone.

Authenticated order owner

### Customer order /account/orders/[id] — Pay by UPI

Open Razorpay UPI checkout. Await server verification. If money was taken and status is pending, do not pay twice.

Authenticated order owner

### Customer order /account/orders/[id] — UPI transaction reference / UTR

6–80 letters, digits, spaces or hyphens. Must match actual bank transaction.

Authenticated order owner

### Customer order /account/orders/[id] — Payment screenshot (JPEG, PNG or WebP, up to 5 MB)

Choose a real permitted image, no more than 5 MiB. Manual/WhatsApp order only, when proof is allowed.

Authenticated order owner

### Customer order /account/orders/[id] — Submit payment proof

Upload private proof and mark payment submitted. Staff still verify bank credit. Proof may be submitted for permitted pending/failed/submitted expired or cancelled orders so late credits can be investigated.

Authenticated order owner

### Customer order /account/orders/[id] — Cancel unpaid order

Available only while awaiting_payment. Releases reservation.

Authenticated order owner

### Customer order /account/orders/[id] — Reason for return

Required return request text, maximum 500 characters.

Authenticated order owner

### Customer order /account/orders/[id] — Request a return

Available on delivered orders; records return_requested. Physical receipt/refund is a separate staff process.

Authenticated order owner

### /admin/products — SKU

Unique stock identifier, maximum 50 characters.

Staff MFA + catalogue permission

### /admin/products — Product barcode (optional; SKU also scans)

Optional unique ASCII product barcode, maximum 48 characters. SKU also scans. Never use the reserved MSU plus digits namespace for a product code.

Staff MFA + catalogue permission

### /admin/products — Subcategory

Select an active child category. The main category follows this mapping; manage hierarchy under Categories.

Staff MFA + catalogue permission

### /admin/products — Page name (lowercase-with-hyphens)

Unique lowercase letters/numbers with single hyphen separators, maximum 120 characters.

Staff MFA + catalogue permission

### /admin/products — Saree name

Required product/provider name.

Staff MFA + catalogue permission

### /admin/products — Colour

Product colour, maximum 50 characters.

Staff MFA + catalogue permission

### /admin/products — Description

Required product description, maximum 2000 characters.

Staff MFA + catalogue permission

### /admin/products — Image URL

Use /assets/... or an HTTPS image URL. Upload separately then paste returned URL.

Staff MFA + catalogue permission

### /admin/products — Price (Rs)

Enter rupees with up to two decimals. Form converts to paise. Zero displays 00 Rs and blocks order save.

Staff MFA + catalogue permission

### /admin/products — Product discount (%)

Integer percentage 0–90. Product discount applies before order offer.

Staff MFA + catalogue permission

### /admin/products — Publish product

Tick to publish; untick to hide. Publication and schedule jointly control banners.

Staff MFA + catalogue permission

### /admin/products — Show in home collection

Tick to include product in home featured collection.

Staff MFA + catalogue permission

### /admin/products — Archive product

Tick to prevent new sales while preserving historical orders.

Staff MFA + catalogue permission

### /admin/products — Add product ＋

Open a blank record form. A product starts with zero stock; add stock separately.

Staff MFA + catalogue permission

### /admin/products — Edit

Load row fields into the edit form; also used for bulk inquiry status.

Staff MFA + catalogue permission

### /admin/products — Save changes

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + catalogue permission

### /admin/products — Cancel editing

Close the form without saving pending edits.

Staff MFA + catalogue permission

### /admin/banners — Title

Required public banner/offer title.

Staff MFA + content permission

### /admin/banners — Short text

Optional banner text, maximum 300 characters.

Staff MFA + content permission

### /admin/banners — Image URL

Use /assets/... or an HTTPS image URL. Upload separately then paste returned URL.

Staff MFA + content permission

### /admin/banners — Button text

Required banner button text, maximum 40 characters.

Staff MFA + content permission

### /admin/banners — Button page (starts with /)

Internal path starting with one slash. External URLs are rejected.

Staff MFA + content permission

### /admin/banners — Show on

home or shop.

Staff MFA + content permission

### /admin/banners — Display order

Integer -100 to 100; controls banner ordering.

Staff MFA + content permission

### /admin/banners — Publish banner

Tick to publish; untick to hide. Publication and schedule jointly control banners.

Staff MFA + content permission

### /admin/banners — Start time (optional)

Optional scheduled start, entered and displayed in browser local time; saved as a timestamp.

Staff MFA + content permission

### /admin/banners — End time (optional)

Optional scheduled end, later than start.

Staff MFA + content permission

### /admin/banners — Add banner ＋

Open a blank record form. A product starts with zero stock; add stock separately.

Staff MFA + content permission

### /admin/banners — Edit

Load row fields into the edit form; also used for bulk inquiry status.

Staff MFA + content permission

### /admin/banners — Save changes

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + content permission

### /admin/banners — Cancel editing

Close the form without saving pending edits.

Staff MFA + content permission

### /admin/offers — Offer name

Required public banner/offer title.

Staff MFA + offers permission

### /admin/offers — Coupon code (blank = automatic)

Blank means automatic offer. Coupon code 2–40 uppercase letters/digits/underscore/hyphen.

Staff MFA + offers permission

### /admin/offers — Discount type

percent or fixed. Fixed amount is entered as paise in Discount value.

Staff MFA + offers permission

### /admin/offers — Discount value (% or paise for fixed)

Percent: 1–90. Fixed: positive integer paise; 10000 means Rs 100. Not a rupee-converted field.

Staff MFA + offers permission

### /admin/offers — Minimum purchase (Rs)

Minimum eligible purchase in rupees; form converts to paise.

Staff MFA + offers permission

### /admin/offers — Maximum discount (Rs, optional)

Optional cap in rupees; blank means uncapped by this field.

Staff MFA + offers permission

### /admin/offers — Total use limit (optional)

Optional positive total redemption limit.

Staff MFA + offers permission

### /admin/offers — Uses per customer

Positive integer, at most 1000.

Staff MFA + offers permission

### /admin/offers — Enable offer

Tick to enable offer, subject to validity and limits.

Staff MFA + offers permission

### /admin/offers — Start time (optional)

Optional scheduled start, entered and displayed in browser local time; saved as a timestamp.

Staff MFA + offers permission

### /admin/offers — End time (optional)

Optional scheduled end, later than start.

Staff MFA + offers permission

### /admin/offers — Add offer ＋

Open a blank record form. A product starts with zero stock; add stock separately.

Staff MFA + offers permission

### /admin/offers — Edit

Load row fields into the edit form; also used for bulk inquiry status.

Staff MFA + offers permission

### /admin/offers — Save changes

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + offers permission

### /admin/offers — Cancel editing

Close the form without saving pending edits.

Staff MFA + offers permission

### /admin/shipping — Provider name

Required product/provider name.

Staff MFA + shipping permission

### /admin/shipping — HTTPS tracking URL with {tracking_id}

HTTPS URL containing exactly {tracking_id}; may be blank to store tracking without a link.

Staff MFA + shipping permission

### /admin/shipping — Enable provider

Tick to make provider selectable.

Staff MFA + shipping permission

### /admin/shipping — Add provider ＋

Open a blank record form. A product starts with zero stock; add stock separately.

Staff MFA + shipping permission

### /admin/shipping — Edit

Load row fields into the edit form; also used for bulk inquiry status.

Staff MFA + shipping permission

### /admin/shipping — Save changes

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + shipping permission

### /admin/shipping — Cancel editing

Close the form without saving pending edits.

Staff MFA + shipping permission

### /admin/settings — Brand name

Public brand name, maximum 100 characters.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Short store description

Short store description, maximum 180 characters.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Support email

Valid support email or blank.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Support phone

Support contact phone or blank.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Bulk purchase contact number

Public bulk call contact or blank.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Bulk minimum quantity

Bulk inquiry suggested minimum, 1–100000.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — WhatsApp number (country code, digits only)

Country code and digits only, no plus/spaces; required for active WhatsApp channel.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Order channels

whatsapp_only, online_only or both. This is store-wide.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Online payment method

manual_upi or razorpay_upi. Gateway credentials remain server environment secrets.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — UPI ID

Verified shop UPI ID. Required with manual UPI online ordering.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — UPI payee name

Actual UPI beneficiary/payee name.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Enable orders

Tick only after real prices, stock and payment setup are checked.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Shipping fee (Rs)

Shipping fee in rupees, converted to paise.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Free shipping minimum (Rs, 0 = off)

Rupee threshold after discount; 0 disables threshold-based free shipping.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Tax rate (basis points: 100 = 1%)

Integer basis points, 0–10000. 100 = 1%.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Stock hold time (minutes)

10–1440 minutes stock hold.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Announcement

Required public announcement, maximum 300 characters.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Home heading

Home heading, maximum 120 characters.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Home short text

Home short text, maximum 300 characters.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Hero image URL

Local asset or HTTPS hero image URL.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Logo image URL

Local asset or HTTPS logo URL.

Staff MFA + superadmin permission (superadmin only)

### /admin/settings — Save settings

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + superadmin permission (superadmin only)

### /admin/bulk — Inquiry status

new, contacted or closed. Contact customer before recording contacted.

Staff MFA + bulk permission

### /admin/bulk — Edit

Load row fields into the edit form; also used for bulk inquiry status.

Staff MFA + bulk permission

### /admin/bulk — Save changes

Validate and persist every form field. Review status/error notice. Saving upload URL alone does not upload a file.

Staff MFA + bulk permission

### /admin/bulk — Cancel editing

Close the form without saving pending edits.

Staff MFA + bulk permission

### Admin shared navigation — Overview / Products / Stock / Orders / Banners / Offers / Tracking / Bulk inquiries / Settings / Staff / Activity log

Open matching admin route. Navigation includes only current permitted groups. Settings, Staff and Activity log are superadmin only.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — Manage quick links

Open the matching operation from Overview.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — View store

Open public home.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — Refresh

Reload current server records. Overview readiness indicates presence of environment values only, not tested connectivity.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — JPEG, PNG or WebP · up to 5 MB

Select public shop image. Available on configuration screens to content-authorized staff.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — Upload image

Upload a real image up to 5 MiB into public store-media.

Staff MFA; media requires content permission; routes also enforce each capability

### Admin shared navigation — Uploaded image URL (copy into an image field)

Read-only returned URL; focus selects it. Copy to the owning image field and Save changes/settings.

Staff MFA; media requires content permission; routes also enforce each capability

### /admin/inventory — Product

Select SKU/name for the physical adjustment.

Staff MFA + inventory

### /admin/inventory — Change in units (positive adds, negative removes)

Nonzero integer -100000 to 100000. Stock after adjustment cannot fall below reserved.

Staff MFA + inventory

### /admin/inventory — Reason

Required 3–300 character explanation.

Staff MFA + inventory

### /admin/inventory — Save stock adjustment

Apply signed change and audit it. Review on-hand/reserved/available table.

Staff MFA + inventory

### /admin/orders — Filter order status

All orders or one of awaiting payment, confirmed, packing, shipped, delivered, cancelled, expired, review required, return requested, returned.

Staff MFA + orders

### /admin/orders — Open order

Open /admin/orders/[id] with payment, tracking and state controls limited by permission.

Staff MFA + orders

### /admin/staff — Name / Email / Temporary password (12–128 characters)

New manager identity and initial password. Name is 2–80 characters.

Superadmin MFA only

### /admin/staff — Create manager & send confirmation

Create trusted manager, request confirmation email. Starts with all configured manager capabilities; restrict immediately below.

Superadmin MFA only

### /admin/staff — catalogue / inventory / orders / payments / content / offers / shipping / bulk / pos / purchases / expenses / attendance / reports

Manager capability checkboxes. Disabled for non-manager accounts and your own card. Review and restrict a new manager before first use.

Superadmin MFA only

### /admin/staff — Suspend account

Block this account after Save account access. Your own suspension checkbox is disabled.

Superadmin MFA only

### /admin/staff — Save account access

Save permissions and suspension. Disabled for your own account; server protects last superadmin.

Superadmin MFA only

### Staff order /admin/orders/[id] — ← Back to orders / Track with [provider]

Return to staff list or open customer tracking URL.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — View payment proofs

Load private proof links and claimed references.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Open private proof (60 seconds)

Open short-lived signed URL. Keep customer payment evidence private.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Bank payment reference

Enter independently verified actual bank reference, 6–80 allowed characters.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — I checked the bank record, payee and exact amount…

Tick only after confirming real credit. Required for manual confirmation.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Confirm manual payment

Record bank-verified payment. Late arrival releases reservation and enters review/refund handling instead of fulfillment.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Razorpay payment ID

Enter actual pay_ identifier for gateway reconciliation.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Verify gateway payment

Fetch gateway records, verify amount/order/currency/UPI/capture, then reconcile.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Refund reason

Required 3–500 characters. Full refund only when payment state is refund_pending or late_paid.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Completed bank refund reference

For manual refund enter actual completed refund reference, at least 6 characters.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — I have completed the refund outside the app…

Manual refund attestation. Tick only after actual bank refund and verification.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Record completed manual refund

Record completed bank refund; this button does not transfer funds.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Start full gateway refund

Start full Razorpay refund. Review provider outcome; never repeat blindly after timeout.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Razorpay refund ID

Existing rfnd_ identifier for refund recovery/check.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Check existing refund

Reconcile already-started refund, especially manual_review; do not start another refund.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Provider

Select enabled tracking provider. Setting tracking requires shipping capability.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Tracking ID

2–100 characters; order must be confirmed, packing or shipped.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Save tracking

Save provider/ID and notify customer.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Next status

Choose only current allowed transition. Confirmed: packing/cancelled; packing: shipped/cancelled; shipped: delivered; delivered: return requested; return requested: returned; awaiting payment: cancelled.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Update note / received return details

Up to 500 characters. Receiving a return requires at least 3 characters and actual physical inspection.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### Staff order /admin/orders/[id] — Update order status

Perform validated transition. Shipping requires paid status and tracking ID. Terminal/review states disable this button.

View: staff MFA + orders. Proof/payment/refund: payments. Tracking: shipping. Status: orders.

### All pages / footer — Skip to content

Keyboard accessibility link moves to the main content anchor.

All visitors; destination pages enforce authentication

### All pages / footer — All sarees / Bridal sarees / Cotton sarees / Bulk purchase

Open shop, prefiltered Bridal/Cotton shop or bulk inquiry page.

All visitors; destination pages enforce authentication

### All pages / footer — My orders / My account

Open Account, which defaults to Orders.

All visitors; destination pages enforce authentication

### All pages / footer — Support phone

Open telephone dialer if a support number is configured.

All visitors; destination pages enforce authentication

### All pages / footer — Support email

Open an email composer if support email is configured.

All visitors; destination pages enforce authentication

### All pages / footer — Staff sign in

Open /admin; unauthenticated staff are directed through login/MFA before protected tools.

All visitors; destination pages enforce authentication

### Admin record lists — Load more records

Append the next page of up to 100 server records. Repeat until no further page is offered. Current route/filter and capability checks still apply.

Staff MFA + capability for the current list

### Account /account — Load more

Append the next page of up to 100 records for the current account tab. Repeat until no further page is offered.

Authenticated account; only own records

### /admin/categories — Category name

Enter the displayed record value. Review required fields and save.

Staff MFA + superadmin role

### /admin/categories — Page name (lowercase-with-hyphens)

Unique lowercase letters/numbers separated by hyphens.

Staff MFA + superadmin role

### /admin/categories — Main category (blank creates a main category)

Blank creates a main category; otherwise select a main category to make a second-level subcategory. No third level or self-parenting.

Staff MFA + superadmin role

### /admin/categories — Show this category

Turn on for new selection/sales; review the effect before saving.

Staff MFA + superadmin role

### /admin/categories — Add new record ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + superadmin role

### /admin/categories — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/categories — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/categories — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/categories — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/categories — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### /admin/discounts — Discount name

Enter the displayed record value. Review required fields and save.

Staff MFA + superadmin role

### /admin/discounts — Apply to

category, subcategory or product. Changing scope clears the target selection.

Staff MFA + superadmin role

### /admin/discounts — Category / subcategory / product

Select the exact category/subcategory/product matching Apply to.

Staff MFA + superadmin role

### /admin/discounts — Discount (%)

Enter percent from 0.01 to 90.00; stored as basis points. Strongest applicable catalog percentage wins, rather than stacking.

Staff MFA + superadmin role

### /admin/discounts — Enable in POS and online shop

Turn on for new selection/sales; review the effect before saving.

Staff MFA + superadmin role

### /admin/discounts — Start time (optional)

Optional schedule start in browser local time.

Staff MFA + superadmin role

### /admin/discounts — End time (optional)

Optional schedule end, strictly later than start.

Staff MFA + superadmin role

### /admin/discounts — Add new record ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + superadmin role

### /admin/discounts — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/discounts — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/discounts — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/discounts — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/discounts — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### /admin/suppliers — Supplier name

Enter the displayed record value. Review required fields and save.

Staff MFA + purchases capability

### /admin/suppliers — Phone

Contact number; ERP fields allow at most 25 characters.

Staff MFA + purchases capability

### /admin/suppliers — Email

Valid email or blank.

Staff MFA + purchases capability

### /admin/suppliers — Address

Supplier/shop address, at most 2000 characters.

Staff MFA + purchases capability

### /admin/suppliers — GSTIN (optional)

Optional shop/supplier GSTIN, at most 30 characters.

Staff MFA + purchases capability

### /admin/suppliers — Active supplier

Turn on for new selection/sales; review the effect before saving.

Staff MFA + purchases capability

### /admin/suppliers — Add new record ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + purchases capability

### /admin/suppliers — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + purchases capability

### /admin/suppliers — Edit record

Load this record for editing.

Staff MFA + purchases capability

### /admin/suppliers — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + purchases capability

### /admin/suppliers — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + purchases capability

### /admin/suppliers — Load more records

Append another page of up to 100 records when offered.

Staff MFA + purchases capability

### /admin/expense-categories — Expense category name

Enter the displayed record value. Review required fields and save.

Staff MFA + superadmin role

### /admin/expense-categories — Enable category

Turn on for new selection/sales; review the effect before saving.

Staff MFA + superadmin role

### /admin/expense-categories — Add new record ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + superadmin role

### /admin/expense-categories — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/expense-categories — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/expense-categories — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/expense-categories — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/expense-categories — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### /admin/employees — Staff code

Unique staff code, at most 40 characters.

Staff MFA + superadmin role

### /admin/employees — Staff name

Enter the displayed record value. Review required fields and save.

Staff MFA + superadmin role

### /admin/employees — Phone

Contact number; ERP fields allow at most 25 characters.

Staff MFA + superadmin role

### /admin/employees — Employment type

full_time or part_time; this does not automatically change the salary basis.

Staff MFA + superadmin role

### /admin/employees — Salary basis

monthly, daily or hourly. The rate field is interpreted in this selected unit.

Staff MFA + superadmin role

### /admin/employees — Monthly / daily / hourly rate (Rs)

Enter rupees for the selected salary basis. Form converts to paise.

Staff MFA + superadmin role

### /admin/employees — Daily working time (minutes)

Normal working day length, 60–1440 minutes.

Staff MFA + superadmin role

### /admin/employees — Overtime hourly rate (Rs)

Overtime rate in rupees per hour; converted to paise.

Staff MFA + superadmin role

### /admin/employees — Attendance & salary policy

Select an active attendance/salary policy.

Staff MFA + superadmin role

### /admin/employees — Joining date

Actual employee joining date.

Staff MFA + superadmin role

### /admin/employees — Last working date (optional)

Optional last employment date; cannot precede joining.

Staff MFA + superadmin role

### /admin/employees — Recurring monthly allowances

Recurring employee components. Add named rupee amounts; combined with extra monthly allowances and bonus.

Staff MFA + superadmin role

### /admin/employees — Recurring monthly deductions

Recurring employee components. Add named rupee amounts; combined with extra monthly deductions.

Staff MFA + superadmin role

### /admin/employees — Active staff member

Turn on for new selection/sales; review the effect before saving.

Staff MFA + superadmin role

### /admin/employees — Add staff member ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + superadmin role

### /admin/employees — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/employees — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/employees — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/employees — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/employees — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### /admin/salary-policies — Policy name

Enter the displayed record value. Review required fields and save.

Staff MFA + superadmin role

### /admin/salary-policies — Monthly salary divisor

scheduled counts configured weekdays across the full month; calendar counts every date. Employment dates prorate eligible units.

Staff MFA + superadmin role

### /admin/salary-policies — Scheduled working days

Tick one or more Sunday–Saturday checkboxes. Sunday is 0, Saturday 6. No duplicate weekdays.

Staff MFA + superadmin role

### /admin/salary-policies — Paid leave units per month

Monthly paid leave quota, 0–31 units in half-unit increments.

Staff MFA + superadmin role

### /admin/salary-policies — Leave rule applies by

ordinal looks up the current half-unit leave ordinal; monthly_total looks up total monthly leave for each nonquota unit.

Staff MFA + superadmin role

### /admin/salary-policies — Leave loss-of-pay rules

Add nonoverlapping inclusive half-unit ranges and loss-of-pay percentages. Paid quota applies first.

Staff MFA + superadmin role

### /admin/salary-policies — Loss of pay outside rules (%)

Enter 0–100 percent LOP outside configured ranges; 100 means fully unpaid.

Staff MFA + superadmin role

### /admin/salary-policies — Half-day salary paid (%)

Percent salary paid for a half-day monthly/daily record, 0–100. Hourly uses actual worked minutes.

Staff MFA + superadmin role

### /admin/salary-policies — Paid permission time per month (minutes)

Paid monthly permission allowance, 0–14400 minutes. Consumed in date order.

Staff MFA + superadmin role

### /admin/salary-policies — Permission time above allowance

Excess permission: proportional minutes, half_day or full_day loss.

Staff MFA + superadmin role

### /admin/salary-policies — Pay marked holidays

Tick if marked holidays count as paid under the shop policy.

Staff MFA + superadmin role

### /admin/salary-policies — Active policy

Turn on for new selection/sales; review the effect before saving.

Staff MFA + superadmin role

### /admin/salary-policies — Add new record ＋

Open a new record form. New employee defaults to today and first active policy; review every field.

Staff MFA + superadmin role

### /admin/salary-policies — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/salary-policies — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/salary-policies — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/salary-policies — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/salary-policies — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### /admin/pos-settings — Enable POS billing

Tick only after rates, stock, tender checks and printer setup are verified.

Staff MFA + superadmin role

### /admin/pos-settings — Shop name

Shop name for receipt snapshots.

Staff MFA + superadmin role

### /admin/pos-settings — English shop name

English shop name for receipt snapshots.

Staff MFA + superadmin role

### /admin/pos-settings — Shop address

Supplier/shop address, at most 2000 characters.

Staff MFA + superadmin role

### /admin/pos-settings — Phone

Contact number; ERP fields allow at most 25 characters.

Staff MFA + superadmin role

### /admin/pos-settings — GSTIN (optional)

Optional shop/supplier GSTIN, at most 30 characters.

Staff MFA + superadmin role

### /admin/pos-settings — Bill number prefix

1–20 uppercase letters, digits or hyphens. Used in new numbered invoices.

Staff MFA + superadmin role

### /admin/pos-settings — Receipt footer

Receipt footer, at most 300 characters.

Staff MFA + superadmin role

### /admin/pos-settings — POS tax (%)

Enter POS percent, 0–100. Stored as basis points. Use the shop configured rate.

Staff MFA + superadmin role

### /admin/pos-settings — Maximum extra walk-in discount (%)

Maximum extra walk-in percent, 0–90, applied to already discounted catalog subtotal.

Staff MFA + superadmin role

### /admin/pos-settings — Receipt paper width (mm)

Choose 58 or 80 mm for receipt width.

Staff MFA + superadmin role

### /admin/pos-settings — Edit POS settings

Load the singleton POS configuration form. The generic Add new record control is disabled here.

Staff MFA + superadmin role

### /admin/pos-settings — Refresh records

Reload the first 100-row page and current record states.

Staff MFA + superadmin role

### /admin/pos-settings — Edit record

Load this record for editing.

Staff MFA + superadmin role

### /admin/pos-settings — Save record

Validate and save form fields, then refresh references and records.

Staff MFA + superadmin role

### /admin/pos-settings — Cancel editing

Close the form without submitting unsaved changes.

Staff MFA + superadmin role

### /admin/pos-settings — Load more records

Append another page of up to 100 records when offered.

Staff MFA + superadmin role

### Allowance/deduction component editors — Add item ＋

Append a named component row; up to 15 extra or recurring components per input group.

Superadmin; employee recurring components and payroll extra components

### Allowance/deduction component editors — Item name

Required name, at most 100 characters.

Superadmin; employee recurring components and payroll extra components

### Allowance/deduction component editors — Amount (Rs)

Nonnegative rupee amount, converted to integer paise.

Superadmin; employee recurring components and payroll extra components

### Allowance/deduction component editors — Remove item

Remove that unsaved component row. Save the owning employee or payroll draft to persist changes.

Superadmin; employee recurring components and payroll extra components

### /admin/salary-policies — leave rules — Sunday / Monday / Tuesday / Wednesday / Thursday / Friday / Saturday

Set scheduled work weekdays. At least one is required.

Superadmin MFA

### /admin/salary-policies — leave rules — Add leave rule ＋

Append a tier; review overlap before saving.

Superadmin MFA

### /admin/salary-policies — leave rules — From leave unit / To leave unit

Inclusive 0.5-step range from 0.5 to 31. Ranges cannot overlap.

Superadmin MFA

### /admin/salary-policies — leave rules — Loss of pay (%)

0–100 percent; 100 is fully unpaid, 50 is half unpaid.

Superadmin MFA

### /admin/salary-policies — leave rules — Remove rule

Remove that unsaved tier. Save record to persist the policy.

Superadmin MFA

### /admin/employees — login setup — Create / link login

Shown for an active employee with no profile link. Payroll and attendance do not require a login.

Superadmin MFA

### /admin/employees — login setup — Link an existing staff login (optional)

Select an unlinked billing/manager account, or choose Create a new login.

Superadmin MFA

### /admin/employees — login setup — Role for a new login

Billing staff or Manager. Billing is POS-only and must link to an active employee.

Superadmin MFA

### /admin/employees — login setup — Email for a new login

Valid email for the new account.

Superadmin MFA

### /admin/employees — login setup — Temporary password for a new login

12–128 characters. Share privately; user confirms email and enrolls MFA.

Superadmin MFA

### /admin/employees — login setup — Create or link staff login

Create trusted Auth account and link it, or link the selected existing account. New accounts receive requested confirmation email.

Superadmin MFA

### /admin/employees — login setup — Cancel login setup

Close setup without submitting.

Superadmin MFA

### /admin/pos — Refresh stock & prices

Reload catalog/settings. Visible page also refreshes every 20 seconds; save still rechecks stock.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Focus barcode scanner

Place cursor in scan input.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Scan unit sticker, product barcode or type SKU

Scan/type exact code, then Enter. Unit identity must be in stock and not already in bill.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Add scanned item

Resolve code and add the unit/product.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Find a product

Filter current product cards by name, SKU, category or subcategory.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Category / subcategory

Choose a main or child category; All products removes filter.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Product card

Add quantity-based item. Disabled if zero price or no available stock.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Qty

1–100 whole units; disabled for serialized-unit lines because count follows scanned stickers.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Remove line

Remove all units for that product. Required before switching between quantity and unit-sticker mode.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Walk-in customer name (optional)

At most 80 characters.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Customer phone (optional)

At most 25 characters.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Extra walk-in discount (Rs)

Separate rupee bill discount, within configured percentage cap.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Discount reason (required / if used)

At least 3 characters when discount is positive, at most 300.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — CASH amount (Rs) / UPI amount (Rs) / CARD amount (Rs)

Allocate final bill total across selected positive tenders.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Use remaining

On each tender fills the amount not allocated to the other two. CASH also initializes Cash received to the cash allocation.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — UPI transaction reference / CARD transaction reference

Required 6–100 characters when that noncash tender is positive.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Cash received from customer (Rs)

Actual notes received; change is received less allocated cash. With no cash tender enter 0.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — I checked the UPI/card receipt and exact amount…

Required for any noncash tender. Verify the actual merchant receipt independently.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Complete bill & save stock

Server validates and commits invoice, tenders and stock once. Disabled until quote/tenders/cash balance.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Clear current bill

Reset cart, bill discount, tender amounts and cash received.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Refresh recent bills

Reload most recent bill page. Billing sees only own bills; permitted managers/superadmin see all.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Open / reprint bill

Open saved immutable bill snapshot.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Load more bills

Append next page of up to 50 bills.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Print receipt

Open system print dialog for current 58/80 mm receipt.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Close receipt

Close receipt and return form.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Record full sale return

Open full-return form for completed bill. Billing-only role cannot use this.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Received return details / reason

3–500 characters, after receiving all physical pieces.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Completed refund reference

6–100 characters for actual refund completed outside app.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — All items were physically received and the full refund…

Required confirmation; this action records a completed outside refund.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/pos — Confirm full return & restock

Restore original units once and mark whole sale returned. No partial return control is present.

Staff MFA + pos; billing needs active employee link. Full return additionally requires inventory and is unavailable to billing.

### /admin/purchases — New purchase ＋

Create draft with one initial line.

Staff MFA + purchases capability

### /admin/purchases — Refresh purchases

Reload first purchase page.

Staff MFA + purchases capability

### /admin/purchases — Manage suppliers

Open supplier records.

Staff MFA + purchases capability

### /admin/purchases — Supplier

Choose active supplier.

Staff MFA + purchases capability

### /admin/purchases — Supplier invoice number (optional)

At most 100 characters. Nonblank values unique per supplier ignoring case.

Staff MFA + purchases capability

### /admin/purchases — Expected delivery date (optional)

Optional date.

Staff MFA + purchases capability

### /admin/purchases — Purchase note

At most 2000 characters.

Staff MFA + purchases capability

### /admin/purchases — Product

Choose one distinct product per line.

Staff MFA + purchases capability

### /admin/purchases — Quantity

1–10000 whole pieces.

Staff MFA + purchases capability

### /admin/purchases — Unit cost (Rs)

Nonnegative rupee cost, converted to paise.

Staff MFA + purchases capability

### /admin/purchases — Purchase tax (%)

0–100 percent, converted to basis points.

Staff MFA + purchases capability

### /admin/purchases — Remove purchase line

Remove unsaved line; disabled when only one line remains.

Staff MFA + purchases capability

### /admin/purchases — Add purchase line ＋

Append line; at most 100 distinct product lines.

Staff MFA + purchases capability

### /admin/purchases — Save purchase draft

Persist editable draft. Does not change stock.

Staff MFA + purchases capability

### /admin/purchases — Cancel editing

Discard unsaved form changes.

Staff MFA + purchases capability

### /admin/purchases — Open purchase

Open selected order, receipt totals and due/credit.

Staff MFA + purchases capability

### /admin/purchases — Close purchase details

Close selected details panel.

Staff MFA + purchases capability

### /admin/purchases — Confirm purchase order

Draft to ordered; locks draft fields.

Staff MFA + purchases capability

### /admin/purchases — Edit draft

Reopen fields while purchase remains draft.

Staff MFA + purchases capability

### /admin/purchases — Cancel purchase order

Cancel draft/ordered purchase only before any receipt.

Staff MFA + purchases capability

### /admin/purchases — Print received stock labels

Open Barcode labels prefiltered to purchase; inventory permission is required there.

Staff MFA + purchases capability

### /admin/purchases — Action

Receive stock or Return unsold stock to supplier.

Staff MFA + purchases capability

### /admin/purchases — Per-product quantity inputs

Enter 0 to skip or positive actual quantity. Receive cannot exceed outstanding; return cannot exceed unreturned received units, available stock or purchase units.

Staff MFA + purchases capability

### /admin/purchases — Receipt / return note

Return requires at least 3 characters; at most 1000.

Staff MFA + purchases capability

### /admin/purchases — Receive selected quantities

Commit receipt and generate one unique unit code per added piece.

Staff MFA + purchases capability

### /admin/purchases — Return selected quantities

Remove eligible original-purchase units and reduce supplier balance.

Staff MFA + purchases capability

### /admin/purchases — Amount (Rs)

Positive completed payment/refund, no larger than absolute outstanding due/credit.

Staff MFA + purchases capability

### /admin/purchases — Payment method

cash, upi, card or bank.

Staff MFA + purchases capability

### /admin/purchases — Bank reference / cash voucher

6–100 characters for actual completed movement.

Staff MFA + purchases capability

### /admin/purchases — I checked and completed this payment or refund…

Required outside-app transfer/reconciliation confirmation.

Staff MFA + purchases capability

### /admin/purchases — Save supplier payment / refund

Record paid when due positive or refund when due negative. Does not initiate transfer.

Staff MFA + purchases capability

### /admin/purchases — Load more purchases

Append next page of up to 100 orders.

Staff MFA + purchases capability

### /admin/expenses — Expense category

Choose active category.

Staff MFA + expenses capability

### /admin/expenses — Date

Actual expense date, initially current Asia/Kolkata date.

Staff MFA + expenses capability

### /admin/expenses — Description

Required, at most 500 characters.

Staff MFA + expenses capability

### /admin/expenses — Payee / shop (optional)

At most 120 characters.

Staff MFA + expenses capability

### /admin/expenses — Amount paid (Rs)

Positive actual amount.

Staff MFA + expenses capability

### /admin/expenses — Payment method

cash, upi, card or bank.

Staff MFA + expenses capability

### /admin/expenses — Receipt / payment reference

At most 100 characters; noncash requires at least 6.

Staff MFA + expenses capability

### /admin/expenses — Save expense

Post once using durable request key. Paid payroll is logged automatically; do not duplicate salary expense.

Staff MFA + expenses capability

### /admin/expenses — Void expense

Open correction form for posted manual expense only.

Staff MFA + expenses capability

### /admin/expenses — Correction reason

3–500 characters.

Staff MFA + expenses capability

### /admin/expenses — Confirm expense void

Mark original manual entry void and retain audit.

Staff MFA + expenses capability

### /admin/expenses — Keep expense

Close void form without changing record.

Staff MFA + expenses capability

### /admin/expenses — Refresh expenses

Reload first page. Managers see manual expenses; payroll-source expenses are restricted.

Staff MFA + expenses capability

### /admin/expenses — Export loaded expenses CSV

Download only currently loaded rows. Load more before export when needed.

Staff MFA + expenses capability

### /admin/expenses — Load more expenses

Append next page of up to 100 expenses.

Staff MFA + expenses capability

### ERP shared navigation — POS billing / Categories / Shared discounts / Suppliers / Purchases / Barcode labels / Expenses / Expense categories / Staff management / Attendance / Payroll / Salary rules / POS settings / Reports

Open the named /admin module. Sidebar includes only permitted operations. Categories, shared discounts, employee records, payroll, salary rules, POS settings and expense categories are superadmin-only.

Staff MFA; billing sidebar includes POS only

### ERP shared navigation — View online shop / Online shop

Open public home or shop.

Staff MFA; billing sidebar includes POS only

### ERP shared navigation — My account / sign out

Open Account to change password or sign out.

Staff MFA; billing sidebar includes POS only

### /admin/attendance — Staff member

Select employee whose attendance you are marking/reviewing.

Staff MFA + attendance capability

### /admin/attendance — Attendance month

Choose the list month. Changing the list month does not change the actual entry Date automatically.

Staff MFA + attendance capability

### /admin/attendance — Date

Actual attendance date, within employment and no later than today in Asia/Kolkata.

Staff MFA + attendance capability

### /admin/attendance — Attendance status

full day, half day, leave, permission, weekly off, holiday or absent.

Staff MFA + attendance capability

### /admin/attendance — Leave units

Full day leave (1) or Half day leave (0.5), shown for leave status.

Staff MFA + attendance capability

### /admin/attendance — Permission minutes

Positive minutes no greater than employee normal daily minutes; shown for permission.

Staff MFA + attendance capability

### /admin/attendance — Worked minutes (used for hourly pay)

0 to normal day length; a half day cannot exceed half normal minutes.

Staff MFA + attendance capability

### /admin/attendance — Approved overtime minutes

0–1440; only full/half/permission status supports overtime.

Staff MFA + attendance capability

### /admin/attendance — Attendance note

Optional explanation, at most 2000 characters.

Staff MFA + attendance capability

### /admin/attendance — Save attendance

Create/update employee/date. Approved or paid payroll month rejects further edits.

Staff MFA + attendance capability

### /admin/attendance — Mark a full day for several staff

Expand batch full-day form.

Staff MFA + attendance capability

### /admin/attendance — Actual attendance date

Batch date, no future date.

Staff MFA + attendance capability

### /admin/attendance — Staff name checkboxes

Choose active staff whose actual full-day attendance was checked.

Staff MFA + attendance capability

### /admin/attendance — I checked that each selected staff member worked a full day…

Required confirmation. Batch replaces existing entries for the selected date.

Staff MFA + attendance capability

### /admin/attendance — Mark selected staff full day

Save each selected employee independently. Read saved/failed counts; investigate partial failures before payroll.

Staff MFA + attendance capability

### /admin/attendance — Refresh attendance

Reload first page for selected employee/month.

Staff MFA + attendance capability

### /admin/attendance — Edit attendance

Load an existing day into the entry form. Review status-dependent quantities before saving.

Staff MFA + attendance capability

### /admin/attendance — Load more attendance

Append next page of up to 100 day records.

Staff MFA + attendance capability

### /admin/payroll — Staff member

Choose employee; no login is required for salary.

Superadmin MFA only

### /admin/payroll — Salary month

Closed month only. Request uses the first day of that month.

Superadmin MFA only

### /admin/payroll — Bonus for this month (Rs)

Nonnegative monthly bonus in rupees, converted to paise.

Superadmin MFA only

### /admin/payroll — Extra allowances for this month / Extra deductions for this month

Use Add item, Item name, Amount (Rs), Remove item component controls. Recurring employee components are included automatically.

Superadmin MFA only

### /admin/payroll — Preview attendance calculation

Compute current attendance/policy snapshot; missing scheduled day or unclosed month blocks calculation.

Superadmin MFA only

### /admin/payroll — Generate / update payroll draft

Generate from current attendance and current extra fields. Replaces monthly extras on regeneration; approved/paid payroll is locked.

Superadmin MFA only

### /admin/payroll — Show every attendance day

Expand date-level paid/LOP units and notes.

Superadmin MFA only

### /admin/payroll — Refresh payroll runs

Reload first page.

Superadmin MFA only

### /admin/payroll — Export loaded payroll CSV

Export only currently loaded runs and payment references. Load more first if needed.

Superadmin MFA only

### /admin/payroll — View payslip

Open saved salary breakdown, components and status.

Superadmin MFA only

### /admin/payroll — Edit draft extras

Restore saved monthly bonus, extra allowances and extra deductions to the form. Regenerate to save edits.

Superadmin MFA only

### /admin/payroll — Approve payroll

Recompute/hash-check draft against current employee/policy/attendance. Stale draft must be regenerated.

Superadmin MFA only

### /admin/payroll — Record salary payment

Open payment form for approved run. Complete payment outside app first.

Superadmin MFA only

### /admin/payroll — Payment method

bank, upi, cash or card.

Superadmin MFA only

### /admin/payroll — Payment reference / cash voucher

6–100 characters for actual completed salary payment.

Superadmin MFA only

### /admin/payroll — I completed and checked the salary payment outside the app

Required confirmation of real movement.

Superadmin MFA only

### /admin/payroll — Mark salary paid & log expense

Record paid state and one payroll-source expense for positive net. This does not initiate a transfer.

Superadmin MFA only

### /admin/payroll — Cancel payment entry

Close payment form without posting.

Superadmin MFA only

### /admin/payroll — Load more payroll runs

Append next page of up to 100 runs.

Superadmin MFA only

### /admin/payroll — Print payslip

Open system print dialog with current saved payslip.

Superadmin MFA only

### /admin/payroll — Close payslip

Close payslip preview.

Superadmin MFA only

### /admin/labels — Product

All products or one product.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Purchase ID (optional)

Optional valid purchase UUID; opened prefilled from purchase details.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Stickers in this batch (maximum 500)

Load 1–500 unique in-stock unit identities. This is a number of distinct pieces, not copies per barcode.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Paper

A4 sticker sheet (2 columns) or Single-label roll.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Sticker width (mm, 80–95)

Match supported label stock; paper choice initializes width.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Sticker height (mm, 30–60)

Match physical label height.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Load stock labels

Load first matching batch. Reprinting never adds stock.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Print labels

Record print request for loaded identities, then open browser print dialog. App cannot confirm physical printing.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Refresh this label batch

Reload current cursor batch.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — Next label batch

Replace preview with next set of distinct units.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/labels — First label batch

Return to first batch when cursor is beyond first.

Staff MFA + inventory. Enable Code 39 on scanner; test one label at 100% scale with quiet margins.

### /admin/reports — From / To

Inclusive India-date range, maximum 366 days.

Staff MFA + reports capability; only permitted metric groups are returned

### /admin/reports — Run report

Fetch summary. POS sales/returns use respective event dates, tenders show gross sale-day receipts, online totals use creation-period orders currently paid, stock and supplier balances are current.

Staff MFA + reports capability; only permitted metric groups are returned

### /admin/reports — Export report CSV

Export the currently displayed summary and gross POS tender receipts.

Staff MFA + reports capability; only permitted metric groups are returned

## Editable workbook examples

Open Examples and change yellow value cells. The catalog/POS model selects the maximum percentage, floors each unit to paise, caps a separate walk-in discount and checks split tender/cash change. The supplier model calculates a single received line after returns, rounded line tax, payments and refunds. The monthly salary model supports 0–3 leave units in half steps with one inclusive tier, paid quota, permission excess, half-day pay, overtime, bonus, allowances and deductions. Switch ordinal/monthly_total to compare the same calculation. The app supports its full policy ranges; this demonstration is deliberately bounded. Check the example status after edits and verify real transaction evidence separately.

## Launch checks

Record actual results, owner, evidence and date in the Excel LaunchChecks tab. New checks start Not checked; existing recorded results are preserved.

- **Environment:** Node 22+, installed packages, canonical HTTPS URL and matching development/production environments documented.

- **Secrets:** No server secret appears in public variables, source, browser bundle, logs or this workbook.

- **Migrations:** All supplied migrations apply in order to the intended project and schema constraints/RLS are active.

- **Public signup rejected:** Global Allow new users signup OFF; Email provider ON; Confirm email ON; anonymous/OAuth disabled; config [auth] enable_signup=false and [auth.email] enable_signup=true; direct public signup returns 403 through Before User Created hook.

- **Trusted customer registration:** Website server admin-create flow creates only customer metadata and an unconfirmed account, then sends verification through SMTP.

- **Profile provisioning:** Trusted customer and manager creation retain the intended role after app_metadata UPDATE; Dashboard-created account follows requested superadmin path.

- **Auth delivery:** Custom signup/recovery templates use /auth/callback?token_hash={{ .TokenHash }} with type=signup or type=recovery&next=/reset-password. External mailbox confirms registration, resends confirmation, resets password and follows HTTPS redirects. Email provider stays ON and confirmed password login works.

- **CAPTCHA / throttling:** Production CAPTCHA and registration rate limiting reject failed and excessive attempts.

- **Staff MFA:** Staff enroll and verify TOTP; a password-only session cannot execute staff writes.

- **Role isolation:** Customer cannot read another customer's data. Manager cannot grant privileges or invoke operations without permission, including direct requests.

- **Suspension:** Suspended staff cannot make new protected writes from an existing session.

- **Catalog:** All live product rates, discount inputs, stock, descriptions, images and category assignments reviewed. No placeholder Rs 00 items can check out.

- **Channels:** WhatsApp-only, online-only and both configurations render and enforce the intended choices.

- **Stock race:** Concurrent checkout cannot oversell. Failed or expired checkout releases reservations exactly once.

- **Offers:** Coupon and automatic offer eligibility, limits and expiry tested; discounts do not stack.

- **Manual UPI:** Correct beneficiary/UPI ID shown; proof stays pending; duplicate/mismatched UTR rejected; independent bank reconciliation precedes approval.

- **Gateway test:** Matching test credentials complete a UPI test order and server verification establishes payment state.

- **Webhook protection:** Invalid signature rejected; duplicate events idempotent; wrong order/amount rejected; late-paid event follows refund/stock-safe handling.

- **Refund:** Manual and gateway refund workflows record actual reference and settlement. Failed/pending refund remains visible.

- **Orders:** Permitted transitions, cancellation, return requests, stock accounting and customer visibility tested.

- **Tracking:** Configured courier template and tracking ID generate the correct trusted destination.

- **Schedules:** Banner/offer start and end windows tested with intended timezone.

- **Notifications:** Cron authorization, max50 one-order expiry transactions per run, repeated backlog draining, queued email retry, account notifications and bulk inquiry follow-up verified.

- **Quality checks:** Record actual npm run doctor, npm run typecheck, npm test, npm run build and dedicated-project npm run test:live outcomes.

- **Deployed UI:** Desktop/mobile forms, keyboard focus, labels, empty/error states, image loading, public links and cart journey tested at deployed origin.

- **Backups:** Database/asset backup policy enabled and restore rehearsal completed in a separate project.

- **Live payment launch:** Owner has approved real merchant credentials after test mode; a controlled live payment and refund reconciled with actual settlement.

- **Handover:** Owners assigned for reconciliation, dispatch, return/refund, notification failures, access reviews and incident response.

- **ERP upgrade and migration order:** Backup and restore verified; 001–008 applied in order with enum migration committed separately; existing category mappings and serialized unit counts reconciled.

- **Four role boundaries:** Customer sees own web data. Billing requires active employee link and sees own POS bills only. Manager is limited to assigned capabilities. Superadmin owns payroll/policy/staff configuration. Verify direct-request denial and MFA.

- **Hierarchy and discount parity:** Main/subcategory selection, inactive hierarchy exclusion, required child mapping and strongest active catalog rate tested. Online/POS agree on per-unit floored price and nonstacking percentage rules.

- **Unit identity and scanner:** Every physical piece has one unique MSU Code 39 sticker. Product/SKU namespace collisions, duplicate scanned piece, already-sold unit and mixed unit/quantity line are rejected.

- **Label printing:** Test actual A4/roll size, 100% scale, quiet margins and scan result. Print-request logging does not claim actual physical printing. Verify next/first batches and no duplicate piece identities.

- **Concurrent POS and online stock:** Online reservation and counter sale cannot oversell. Supplier returns cannot remove reserved or sold purchase units. Sale return restores original identities once.

- **POS discounts and tenders:** Walk-in amount stays inside cap and has reason. Cash/UPI/card split totals final quote, noncash references verified, cash change correct, retry does not duplicate invoice or stock.

- **POS receipt and full return:** 58/80 mm saved receipt prints/reprints; billing sees only own bills. Full return requires POS+inventory, all goods received and actual refund reference, and restocks once.

- **Supplier purchase lifecycle:** Draft/order/partial receipt/full receipt/cancel limits tested. Overreceipt, duplicate receipt retry and duplicate supplier invoice rejected; ordered draft fields lock.

- **Supplier returns and payments:** Return only original unsold purchase units; received-cost/tax balance reconciles. Paid/refund amounts cannot exceed due/credit. Actual outside payment and reference verified.

- **Expense posting and exports:** Active categories required; noncash reference enforced; repeated request does not duplicate. Manual void needs reason; payroll-source entry cannot be manually voided. CSV exports loaded rows only.

- **Employee and login linkage:** Employee can run payroll without login. Optional billing/manager link unique; temporary password, confirmation and MFA tested. Inactive employee link blocks protected staff access.

- **Attendance correctness:** All statuses and allowed quantities tested, including half leave/day, permission and overtime. No future/outside-employment date; batch save failures exposed; approved month rejects edits.

- **Salary policy boundaries:** Calendar/scheduled divisor, partial employment, paid leave quota, ordinal/monthly_total inclusive tiers, uncovered default LOP, permission allowance/excess and holiday/half-day pay verified against independent examples.

- **Payroll generate approve pay:** Only closed complete month computes. Draft extras reload without duplication, stale calculation cannot approve, approved/paid run locks edits, actual payment reference required and one matching salary expense posts.

- **Examples and reports:** Change yellow example inputs and verify strongest discount, unbalanced split, supplier credit and both LOP modes. Confirm report period/current-balance semantics and permission-limited metrics.

- **Online regression after ERP:** Existing register/confirmation/login/reset, cart/address, WhatsApp/manual proof and Razorpay webhook/refund workflows still work with shared category/discount/unit stock rules.
