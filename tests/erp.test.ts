import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = () => crypto.randomUUID();

async function scalar(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, any>>(sql, args);
  return Object.values(r.rows[0] || {})[0];
}

async function query(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, any>>(sql, args);
  return r.rows;
}

async function queryOne(sql: string, args: unknown[] = []) {
  const rows = await query(sql, args);
  return rows[0] || {};
}

async function user(role = "customer") {
  const id = uid();
  await db.query(
    "insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)",
    [
      id,
      `${id}@example.test`,
      JSON.stringify({ store_role: role }),
      JSON.stringify({ name: `User ${role}` }),
    ],
  );
  return id;
}

async function makeProduct(stock = 5, price = 20000, subcategoryId: string | null = null) {
  const id = uid();
  await db.query(
    "insert into products(id,sku,slug,name,category,colour,image_path,price_paise,stock_on_hand,published,subcategory_id) values($1::uuid,$1::text,$1::text,'Silk Saree','Silk','Blue','/assets/product-01.jpg',$2,$3,true,$4)",
    [id, price, stock, subcategoryId],
  );
  return id;
}

before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of [
    "202611160001_store.sql",
    "202611160002_operations.sql",
    "202611170003_pos_payroll.sql",
    "202611170004_erp_schema.sql",
    "202611170005_erp_operations.sql",
    "202611170006_shared_checkout.sql",
    "202611170007_attendance_payroll.sql",
    "202611170008_erp_queries.sql",
    "202611170009_admin_erp_system.sql",
    "202611230013_discounts_banners.sql",
  ]) {
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }
  await db.exec(
    "update store_settings set ordering_enabled=true,checkout_mode='both',whatsapp_phone='919876543210',upi_id='store@bank',upi_name='Store'",
  );
  await db.exec(
    "update pos_settings set enabled=true,max_discount_bps=2000,tax_bps=500,paper_mm=80",
  );
});

after(async () => {
  await db.close();
});

test("Superadmin: Category and subcategory configuration syncs to product catalogue and POS", async () => {
  const superadmin = await user("superadmin");
  const manager = await user("manager");
  const mainCat = uid();
  const subCat = uid();

  // Superadmin can create main category
  await scalar("select erp_save($1,'product_categories',$2,$3)", [
    superadmin,
    mainCat,
    JSON.stringify({ name: "Kanchipuram Silk", slug: "kanchipuram-silk", parent_id: null, active: true }),
  ]);

  // Non-superadmin cannot create category
  await assert.rejects(
    () =>
      scalar("select erp_save($1,'product_categories',$2,$3)", [
        manager,
        uid(),
        JSON.stringify({ name: "Fail Cat", slug: "fail-cat", parent_id: null, active: true }),
      ]),
    /FORBIDDEN/,
  );

  // Superadmin creates subcategory under main category
  await scalar("select erp_save($1,'product_categories',$2,$3)", [
    superadmin,
    subCat,
    JSON.stringify({ name: "Bridal Sarees", slug: "bridal-sarees", parent_id: mainCat, active: true }),
  ]);

  // Invalid parent or cyclic hierarchy is rejected
  await assert.rejects(
    () =>
      scalar("select erp_save($1,'product_categories',$2,$3)", [
        superadmin,
        uid(),
        JSON.stringify({ name: "Invalid Sub", slug: "invalid-sub", parent_id: subCat, active: true }),
      ]),
    /INVALID_CATEGORY_PARENT/,
  );

  // Add multiple products under subcategory
  const p1 = await makeProduct(5, 500000, subCat); // Rs 5000
  const p2 = await makeProduct(3, 800000, subCat); // Rs 8000

  // Check sync: category column automatically syncs to main category name
  const row1 = await queryOne("select * from products where id=$1", [p1]);
  assert.equal(row1.category, "Kanchipuram Silk");
  assert.equal(row1.subcategory_id, subCat);

  // Catalog view reflects subcategory and category names
  const catView = await queryOne("select * from store_catalogue where id=$1", [p1]);
  assert.equal(catView.subcategory_name, "Bridal Sarees");
  assert.equal(catView.category_name, "Kanchipuram Silk");
  assert.equal(catView.category_visible, true);
});

test("Superadmin: Shared discounts apply across category, subcategory and product with POS/Online sync", async () => {
  const superadmin = await user("superadmin");
  const mainCat = uid();
  const subCat = uid();

  await scalar("select erp_save($1,'product_categories',$2,$3)", [
    superadmin,
    mainCat,
    JSON.stringify({ name: "Tussar Silk", slug: `tussar-${mainCat.slice(0, 8)}`, parent_id: null, active: true }),
  ]);
  await scalar("select erp_save($1,'product_categories',$2,$3)", [
    superadmin,
    subCat,
    JSON.stringify({ name: "Party Wear", slug: `party-${subCat.slice(0, 8)}`, parent_id: mainCat, active: true }),
  ]);

  const p1 = await makeProduct(5, 100000, subCat); // Rs 1000 base
  await makeProduct(5, 200000, subCat); // Rs 2000 base

  // Discount 10% on main category
  const dCategory = uid();
  await scalar("select erp_save($1,'catalog_discounts',$2,$3)", [
    superadmin,
    dCategory,
    JSON.stringify({
      name: "Category 10% Sale",
      scope: "category",
      target_id: mainCat,
      discount_bps: 1000,
      active: true,
      starts_at: null,
      ends_at: null,
    }),
  ]);

  // View should show 10% off for both products (p1 = 900 Rs)
  let v1 = await queryOne("select effective_price_paise from store_catalogue where id=$1", [p1]);
  assert.equal(v1.effective_price_paise, 90000);

  // Now create 20% discount on subcategory (stronger discount wins)
  const dSubcat = uid();
  await scalar("select erp_save($1,'catalog_discounts',$2,$3)", [
    superadmin,
    dSubcat,
    JSON.stringify({
      name: "Subcat 20% Sale",
      scope: "subcategory",
      target_id: subCat,
      discount_bps: 2000,
      active: true,
      starts_at: null,
      ends_at: null,
    }),
  ]);

  v1 = await queryOne("select effective_price_paise from store_catalogue where id=$1", [p1]);
  assert.equal(v1.effective_price_paise, 80000); // 20% off Rs 1000 = Rs 800

  // In POS, pos_quote respects the shared discount
  const quote = await scalar("select pos_quote($1,$2,0)", [
    superadmin,
    JSON.stringify([{ product_id: p1, quantity: 1, unit_ids: [] }]),
  ]);
  // Subtotal Rs 800 + 5% tax (Rs 40) = Rs 840 (84000 paise)
  assert.equal(Number(quote.subtotal_paise), 80000);
  assert.equal(Number(quote.tax_paise), 4000);
  assert.equal(Number(quote.total_paise), 84000);
});

test("POS: Split payments, cash change, walk-in discounts, serialized units and returns", async () => {
  const cashier = await user("manager");
  const p = await makeProduct(5, 100000); // Rs 1000, tax_bps is 500 (5%) => item Rs 1000 + Rs 50 tax = Rs 1050
  // fetch one serialized unit
  const unit = await queryOne("select id, barcode from product_units where product_id=$1 and state='in_stock' order by id limit 1", [p]);
  assert(String(unit.barcode).startsWith("MSU"));

  // POS quote with walk-in discount of Rs 50 (5000 paise)
  const cart = [{ product_id: p, quantity: 1, unit_ids: [String(unit.id)] }];
  const quote = await scalar("select pos_quote($1,$2,5000)", [
    cashier,
    JSON.stringify(cart),
  ]);
  // Subtotal = 100000, Discount = 5000, Tax = (100000 - 5000) * 5% = 4750, Total = 95000 + 4750 = 99750 (Rs 997.50)
  assert.equal(Number(quote.discount_paise), 5000);
  assert.equal(Number(quote.total_paise), 99750);

  // Discount exceeding max_discount_bps is rejected
  await assert.rejects(
    () =>
      scalar("select pos_quote($1,$2,50000)", [
        cashier,
        JSON.stringify(cart),
      ]),
    /DISCOUNT_LIMIT/,
  );

  // Split payment tenders: Rs 500 UPI + Rs 497.50 Cash
  const tenders = [
    { method: "upi", amount_paise: 50000, reference: "UPI-TXN-987654" },
    { method: "cash", amount_paise: 49750, reference: "" },
  ];
  // Cashier receives Rs 500 in cash, change = Rs 2.50 (250 paise)
  const reqKey = uid();
  const saleId = await scalar("select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)", [
    cashier,
    reqKey,
    JSON.stringify(cart),
    JSON.stringify({ name: "Walk-in Guest", phone: "9876543210", discount_reason: "Festive goodwill" }),
    5000,
    JSON.stringify(tenders),
    50000, // cash received = 50000
    true,  // bank checked
  ]);

  // Idempotent checkout with same key returns same saleId
  const saleIdReplay = await scalar("select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)", [
    cashier,
    reqKey,
    JSON.stringify(cart),
    JSON.stringify({ name: "Walk-in Guest", phone: "9876543210", discount_reason: "Festive goodwill" }),
    5000,
    JSON.stringify(tenders),
    50000,
    true,
  ]);
  assert.equal(saleId, saleIdReplay);

  // Check sale row
  const sale = await queryOne("select * from pos_sales where id=$1", [saleId]);
  assert.equal(sale.total_paise, 99750);
  assert.equal(sale.change_paise, 250);
  assert.equal(sale.status, "completed");

  // Serialized unit is marked 'sold' and product stock decreased
  const unitRow = await queryOne("select state from product_units where id=$1", [unit.id]);
  assert.equal(unitRow.state, "sold");
  const prodRow = await queryOne("select stock_on_hand from products where id=$1", [p]);
  assert.equal(prodRow.stock_on_hand, 4);

  // POS Return restores the serialized unit back to 'in_stock' and restores stock_on_hand
  await scalar("select pos_return($1,$2,'Customer exchanged saree','REF-RET-001')", [
    cashier,
    saleId,
  ]);
  const unitRestored = await queryOne("select state from product_units where id=$1", [unit.id]);
  assert.equal(unitRestored.state, "in_stock");
  const prodRestored = await queryOne("select stock_on_hand from products where id=$1", [p]);
  assert.equal(prodRestored.stock_on_hand, 5);
});

test("Purchases & Barcodes: Multi-product receiving creates exact MSU barcodes and updates balances", async () => {
  const manager = await user("manager");
  const supplierId = uid();
  await scalar("select erp_save($1,'suppliers',$2,$3)", [
    manager,
    supplierId,
    JSON.stringify({ name: "Weaver Co-op", phone: "9876543210", email: "weaver@example.test", address: "Kanchi Street", gstin: "", active: true }),
  ]);

  const p1 = await makeProduct(0, 100000);
  const p2 = await makeProduct(0, 150000);

  const poId = uid();
  await scalar("select purchase_save($1,$2,$3,$4)", [
    manager,
    poId,
    JSON.stringify({ supplier_id: supplierId, supplier_invoice: "INV-2026-001", note: "Festival order", expected_on: null }),
    JSON.stringify([
      { product_id: p1, quantity: 3, unit_cost_paise: 60000, tax_bps: 0 },
      { product_id: p2, quantity: 2, unit_cost_paise: 90000, tax_bps: 0 },
    ]),
  ]);

  // Order status transition: draft -> ordered
  await scalar("select purchase_status($1,$2,'ordered')", [manager, poId]);

  // Partial receive: receive 2 units of p1 and 2 units of p2
  const receiveKey1 = uid();
  await scalar("select purchase_receive($1,$2,$3,'receive',$4,'First truck')", [
    manager,
    poId,
    receiveKey1,
    JSON.stringify([
      { product_id: p1, quantity: 2 },
      { product_id: p2, quantity: 2 },
    ]),
  ]);

  // Check barcodes: exactly 2 barcodes for p1 and 2 for p2 created with purchase_id
  const unitsP1 = await query("select * from product_units where purchase_id=$1 and product_id=$2", [poId, p1]);
  const unitsP2 = await query("select * from product_units where purchase_id=$1 and product_id=$2", [poId, p2]);
  assert.equal(unitsP1.length, 2);
  assert.equal(unitsP2.length, 2);
  assert(unitsP1.every((u) => String(u.barcode).startsWith("MSU") && u.state === "in_stock"));

  // Check label printing tracking
  await scalar("select labels_printed($1,$2)", [
    manager,
    [String(unitsP1[0].id), String(unitsP1[1].id)],
  ]);
  const printedUnit = await queryOne("select printed_at from product_units where id=$1", [unitsP1[0].id]);
  assert(printedUnit.printed_at !== null);

  // Supplier balance: 2 * 60000 + 2 * 90000 = 120000 + 180000 = 300000 paise due
  const balances = await query("select * from purchase_balances($1,$2)", [manager, [poId]]);
  assert.equal(Number(balances[0].due_paise), 300000);

  // Record supplier payment: pay Rs 3000 (300000 paise) via bank
  const payKey = uid();
  await scalar("select purchase_pay($1,$2,$3,'paid',300000,'bank','VOUCHER-BANK-001',true)", [
    manager,
    poId,
    payKey,
  ]);
  const balancesAfterPay = await query("select * from purchase_balances($1,$2)", [manager, [poId]]);
  assert.equal(Number(balancesAfterPay[0].due_paise), 0);
});

test("Expenses: Custom logging, noncash reference requirement, and audit voiding", async () => {
  const manager = await user("manager");
  const expCatRow = await queryOne("select id from expense_categories where active=true limit 1");
  const expCat = expCatRow.id;
  const expKey = uid();

  // Noncash payment without valid reference of at least 6 characters is rejected
  await assert.rejects(
    () =>
      scalar("select expense_post($1,$2,$3)", [
        manager,
        expKey,
        JSON.stringify({
          category_id: expCat,
          expense_on: "2026-11-17",
          description: "Shop electricity bill",
          amount_paise: 450000,
          method: "upi",
          reference: "123", // too short
          payee: "TNEB",
        }),
      ]),
    /PAYMENT_REFERENCE_REQUIRED/,
  );

  // Valid expense post
  const expId = await scalar("select expense_post($1,$2,$3)", [
    manager,
    expKey,
    JSON.stringify({
      category_id: expCat,
      expense_on: "2026-11-17",
      description: "Shop electricity bill",
      amount_paise: 450000,
      method: "upi",
      reference: "TNEB-UPI-2026",
      payee: "TNEB",
    }),
  ]);
  assert(expId);

  // Voiding expense requires reason
  await scalar("select expense_void($1,$2,'Bill was paid twice by mistake')", [
    manager,
    expId,
  ]);
  const voided = await queryOne("select status, void_reason from expenses where id=$1", [expId]);
  assert.equal(voided.status, "void");
  assert.equal(voided.void_reason, "Bill was paid twice by mistake");
});

test("Staff & Attendance & Salary Policy: Leave tiers, permissions, overtime, and monthly payroll run", async () => {
  const superadmin = await user("superadmin");
  const policyId = uid();
  const empFull = uid();

  // Policy with custom leave tiers:
  // Paid leave: 1 unit free
  // Tier 1: 1.0 to 2.0 leaves: 100% LOP (10000 bps)
  // Tier 2: 2.5 to 5.0 leaves: 100% LOP (10000 bps)
  // Tier 3: 5.5 to 10.0 leaves: 50% LOP (5000 bps)
  // Paid permission: 60 minutes free, permission_lop: proportional
  await db.query(
    `insert into salary_policies(id,name,work_weekdays,paid_leave_units,leave_rule_mode,leave_tiers,default_leave_lop_bps,half_day_pay_bps,paid_permission_minutes,permission_lop)
     values($1,'Tiered Retail Policy',array[1,2,3,4,5,6],1,'ordinal',
     '[{"from_unit":1,"to_unit":2,"lop_bps":10000},{"from_unit":2.5,"to_unit":5,"lop_bps":10000},{"from_unit":5.5,"to_unit":10,"lop_bps":5000}]'::jsonb,
     10000,5000,60,'proportional')`,
    [policyId],
  );

  // Full-time monthly employee: Rs 26,000 / month (2600000 paise), 26 scheduled days
  await db.query(
    `insert into employees(id,code,name,employment,pay_basis,rate_paise,policy_id,joined_on,daily_minutes,overtime_rate_paise)
     values($1::uuid,$1::text,'Kavitha','full_time','monthly',2600000,$2,'2025-01-01',480,15000)`,
    [empFull, policyId],
  );

  // Populate January 2025 attendance for Kavitha:
  const days = [
    { day: "2025-01-02", status: "leave", leave_units: 1, worked: 0, perm: 0, ot: 0 },
    { day: "2025-01-03", status: "leave", leave_units: 1, worked: 0, perm: 0, ot: 0 },
    { day: "2025-01-04", status: "half_day", leave_units: 0.5, worked: 240, perm: 0, ot: 0 },
    { day: "2025-01-06", status: "permission", leave_units: 1, worked: 360, perm: 120, ot: 0 },
    { day: "2025-01-07", status: "full_day", leave_units: 1, worked: 480, perm: 0, ot: 60 },
  ];

  await db.query(
    `insert into attendance(employee_id,work_on,status,leave_units,permission_minutes,worked_minutes,overtime_minutes,marked_by)
     select $1, d::date, 'full_day', 1, 0, 480, 0, $2
     from generate_series('2025-01-01'::date,'2025-01-31'::date,interval '1 day') d
     where extract(dow from d) between 1 and 6`,
    [empFull, superadmin],
  );

  // Apply our specific test day overrides
  for (const d of days) {
    await db.query(
      `update attendance set status=$1, leave_units=$2, worked_minutes=$3, permission_minutes=$4, overtime_minutes=$5 where employee_id=$6 and work_on=$7::date`,
      [d.status, d.leave_units, d.worked, d.perm, d.ot, empFull, d.day],
    );
  }

  // Preview calculation
  const preview = await scalar("select payroll_preview($1,$2,'2025-01-01')", [superadmin, empFull]);
  assert(Number(preview.lop_units) > 0);
  assert(Number(preview.overtime_paise) === 15000); // 1 hour OT at Rs 150/hr = Rs 150 = 15000 paise

  // Run payroll with bonus and allowance
  const runId = await scalar(
    "select payroll_from_attendance($1,$2,'2025-01-01',50000,'[{\"label\":\"Festival bonus\",\"amount_paise\":50000}]'::jsonb,'[]'::jsonb)",
    [superadmin, empFull],
  );
  assert(runId);

  // Approve payroll
  await scalar("select payroll_finalize($1,$2,'approve','','bank',false)", [superadmin, runId]);

  // An approved salary can be reopened, edited with a new bonus/deduction, and approved again
  await scalar("select payroll_finalize($1,$2,'reopen','','bank',false)", [superadmin, runId]);
  assert.equal((await queryOne("select status from payroll_runs where id=$1", [runId])).status, "draft");
  const before = await queryOne("select net_paise from payroll_runs where id=$1", [runId]);
  await scalar(
    "select payroll_from_attendance($1,$2,'2025-01-01',80000,'[{\"label\":\"Festival bonus\",\"amount_paise\":50000}]'::jsonb,'[{\"label\":\"Advance\",\"amount_paise\":20000}]'::jsonb)",
    [superadmin, empFull],
  );
  const after = await queryOne("select net_paise,bonus_paise,status from payroll_runs where id=$1", [runId]);
  assert.equal(Number(after.net_paise), Number(before.net_paise) + 30000 - 20000);
  assert.equal(Number(after.bonus_paise), 80000);
  await scalar("select payroll_finalize($1,$2,'approve','','bank',false)", [superadmin, runId]);

  // Approved payroll month locks attendance modification!
  await assert.rejects(
    () =>
      scalar("select attendance_save($1,$2,'2025-01-02',$3)", [
        superadmin,
        empFull,
        JSON.stringify({ status: "full_day", leave_units: 1, permission_minutes: 0, worked_minutes: 480, overtime_minutes: 0, note: "" }),
      ]),
    /PAYROLL_LOCKED/,
  );

  // Pay payroll and verify automated expense creation
  await scalar("select payroll_finalize($1,$2,'paid','BANK-SALARY-JAN','bank',true)", [
    superadmin,
    runId,
  ]);
  const exp = await queryOne("select * from expenses where payroll_id=$1", [runId]);
  assert(exp.id);
  assert.equal(exp.source, "payroll");
  assert.equal(exp.reference, "BANK-SALARY-JAN");

  // Attempting to void an automated payroll expense directly is blocked
  await assert.rejects(
    () => scalar("select expense_void($1,$2,'try to void')", [superadmin, exp.id]),
    /EXPENSE_LOCKED/,
  );
});

test("4 Logins & RBAC Security Review: Billing staff restricted to POS only with linked employee", async () => {
  const superadmin = await user("superadmin");
  const billingUser = await user("billing");
  const customerUser = await user("customer");

  // Customer cannot access can_actor or any ERP functions
  assert.equal(await scalar("select private.can_actor($1,'pos')", [customerUser]), false);

  // Billing user without active employee link cannot access POS
  assert.equal(await scalar("select private.can_actor($1,'pos')", [billingUser]), false);

  // Link billing user to active employee
  const policyRow = await queryOne("select id from salary_policies limit 1");
  const policyId = policyRow.id;
  const empId = uid();
  await db.query(
    "insert into employees(id,code,name,employment,pay_basis,rate_paise,policy_id,profile_id,active) values($1::uuid,$1::text,'Billing Cashier','full_time','monthly',1500000,$2,$3,true)",
    [empId, policyId, billingUser],
  );

  // Now billing user has POS capability
  assert.equal(await scalar("select private.can_actor($1,'pos')", [billingUser]), true);

  // But billing user strictly lacks inventory, purchases, expenses, attendance, superadmin capabilities
  assert.equal(await scalar("select private.can_actor($1,'inventory')", [billingUser]), false);
  assert.equal(await scalar("select private.can_actor($1,'purchases')", [billingUser]), false);
  assert.equal(await scalar("select private.can_actor($1,'expenses')", [billingUser]), false);
  assert.equal(await scalar("select private.can_actor($1,'attendance')", [billingUser]), false);
  assert.equal(await scalar("select private.can_actor($1,'__super')", [billingUser]), false);

  // If employee is deactivated, billing user immediately loses POS capability
  await db.query("update employees set active=false where id=$1", [empId]);
  assert.equal(await scalar("select private.can_actor($1,'pos')", [billingUser]), false);
});

test("Shared discounts: 'all products' scope applies to POS and online, strongest rule wins", async () => {
  const superadmin = await user("superadmin");
  const mainCat = uid(), subCat = uid();
  await scalar("select erp_save($1,'product_categories',$2,$3)", [superadmin, mainCat, JSON.stringify({ name: "All Scope Main", slug: `all-main-${mainCat.slice(0, 8)}`, parent_id: null, active: true })]);
  await scalar("select erp_save($1,'product_categories',$2,$3)", [superadmin, subCat, JSON.stringify({ name: "All Scope Sub", slug: `all-sub-${subCat.slice(0, 8)}`, parent_id: mainCat, active: true })]);
  const p = await makeProduct(4, 100000, subCat);
  const allRule = uid();
  await scalar("select erp_save($1,'catalog_discounts',$2,$3)", [superadmin, allRule, JSON.stringify({ name: "Store-wide 5%", scope: "all", target_id: null, discount_bps: 500, active: true, starts_at: null, ends_at: null })]);
  let v = await queryOne("select effective_price_paise from store_catalogue where id=$1", [p]);
  assert.equal(v.effective_price_paise, 95000);
  const quote = await scalar("select pos_quote($1,$2,0)", [superadmin, JSON.stringify([{ product_id: p, quantity: 1, unit_ids: [] }])]);
  assert.equal(Number(quote.subtotal_paise), 95000);
  // 'all' rule must not carry a target, other scopes must
  await assert.rejects(() => scalar("select erp_save($1,'catalog_discounts',$2,$3)", [superadmin, uid(), JSON.stringify({ name: "Bad", scope: "all", target_id: mainCat, discount_bps: 500, active: true, starts_at: null, ends_at: null })]));
  await assert.rejects(() => scalar("select erp_save($1,'catalog_discounts',$2,$3)", [superadmin, uid(), JSON.stringify({ name: "Bad", scope: "product", target_id: null, discount_bps: 500, active: true, starts_at: null, ends_at: null })]), /INVALID_DISCOUNT_TARGET/);
  // a stronger product rule beats the store-wide rule
  await scalar("select erp_save($1,'catalog_discounts',$2,$3)", [superadmin, uid(), JSON.stringify({ name: "Hero piece", scope: "product", target_id: p, discount_bps: 2500, active: true, starts_at: null, ends_at: null })]);
  v = await queryOne("select effective_price_paise from store_catalogue where id=$1", [p]);
  assert.equal(v.effective_price_paise, 75000);
  await db.query("update catalog_discounts set active=false");
});

test("Banners: responsive image, new placements and layout fields save through admin_save", async () => {
  const superadmin = await user("superadmin");
  const id = uid();
  await scalar("select admin_save($1,'banners',$2,$3)", [superadmin, id, JSON.stringify({ title: "Deepavali", subtitle: "", image_path: "/assets/hero.jpg", mobile_image_path: "/assets/product-01.jpg", button_label: "Shop", link_path: "/shop", position: "home_hero", category_id: null, text_align: "center", show_text: true, theme: "light", sort_order: 1, published: true, starts_at: null, ends_at: null })]);
  const b = await queryOne("select * from banners where id=$1", [id]);
  assert.equal(b.position, "home_hero");
  assert.equal(b.mobile_image_path, "/assets/product-01.jpg");
  assert.equal(b.text_align, "center");
  await assert.rejects(() => scalar("select admin_save($1,'banners',$2,$3)", [superadmin, uid(), JSON.stringify({ title: "Bad", image_path: "/x.jpg", position: "sidebar" })]));
});
