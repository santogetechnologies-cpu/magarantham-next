import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const uid = () => crypto.randomUUID();
const address = {
  name: "Test Customer",
  phone: "9876543210",
  line1: "12 Test Road",
  line2: "",
  city: "Chennai",
  state: "Tamil Nadu",
  pin: "600001",
};
async function scalar(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, any>>(sql, args);
  return Object.values(r.rows[0] || {})[0];
}
async function user(role = "customer") {
  const id = uid();
  await db.query(
    "insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)",
    [
      id,
      `${id}@example.test`,
      JSON.stringify({ store_role: role }),
      JSON.stringify({ name: "Test" }),
    ],
  );
  return id;
}
async function product(stock = 3, price = 10000) {
  const id = uid();
  await db.query(
    "insert into products(id,sku,slug,name,category,colour,image_path,price_paise,stock_on_hand,published) values($1::uuid,$1::text,$1::text,'Silk saree','Silk','Red','/assets/product-01.jpg',$2,$3,true)",
    [id, price, stock],
  );
  return id;
}
async function order(
  customer: string,
  product: string,
  key = uid(),
  quantity = 1,
  coupon: string | null = null,
) {
  return scalar("select create_checkout($1,$2,$3,$4,$5,$6)", [
    customer,
    key,
    JSON.stringify([{ product_id: product, quantity }]),
    JSON.stringify(address),
    "upi",
    coupon,
  ]);
}
async function row(table: string, id: string) {
  const r = await db.query<Record<string, any>>(
    `select * from ${table} where id=$1`,
    [id],
  );
  return r.rows[0];
}
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of ["202611160001_store.sql", "202611160002_operations.sql", "202611170003_pos_payroll.sql", "202611170004_erp_schema.sql", "202611170005_erp_operations.sql", "202611170006_shared_checkout.sql", "202611170007_attendance_payroll.sql", "202611170008_erp_queries.sql", "202611170009_admin_erp_system.sql", "202611230013_discounts_banners.sql"])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    "update store_settings set ordering_enabled=true,checkout_mode='both',whatsapp_phone='919876543210',upi_id='store@bank',upi_name='Store'",
  );
  awaitedUser = await user();
  awaitedProduct = await product(10, 0);
});
after(async () => {
  await db.close();
});
test("signup hook rejects unmanaged registration independently of metadata", async () => {
  const result = await scalar("select reject_public_signup('{}')");
  assert.equal(result.error.http_code, 403);
});
test("audited admin configuration uses an allowlist and never grants stock writes", async () => {
  const a = await user("superadmin"),
    m = await user("manager"),
    id = uid();
  const data = {
    sku: `TEST-${id}`,
    slug: `test-${id}`,
    name: "Configured saree",
    category: "Cotton",
    colour: "Red",
    description: "Test saree",
    image_path: "/assets/product-01.jpg",
    price_paise: 75000,
    discount_percent: 5,
    published: true,
    archived: false,
    featured: true,
  };
  assert.equal(
    await scalar("select admin_save($1,$2,$3,$4)", [
      a,
      "products",
      id,
      JSON.stringify(data),
    ]),
    id,
  );
  assert.equal((await row("products", id)).stock_on_hand, 0);
  await assert.rejects(
    () =>
      scalar("select admin_save($1,$2,$3,$4)", [
        m,
        "products",
        id,
        '{"stock_on_hand":100}',
      ]),
    /INVALID_FIELDS/,
  );
  await assert.rejects(
    () =>
      scalar("select admin_save($1,$2,null,$3)", [
        m,
        "store_settings",
        '{"ordering_enabled":false}',
      ]),
    /FORBIDDEN/,
  );
  await scalar("select admin_save($1,$2,null,$3)", [
    a,
    "store_settings",
    '{"announcement":"Updated announcement"}',
  ]);
  assert.equal(
    await scalar("select announcement from store_settings"),
    "Updated announcement",
  );
  assert(
    Number(
      await scalar(
        "select count(*) from audit_log where actor_id=$1 and action='configuration.saved'",
        [a],
      ),
    ) >= 2,
  );
});
test("last active superadmin cannot be suspended and a staff member cannot suspend themselves", async () => {
  const a = await user("superadmin");
  await assert.rejects(
    () => scalar("select staff_update($1,$2,$3,true)", [a, a, []]),
    /FORBIDDEN/,
  );
  const other = await user("superadmin");
  await scalar("select staff_update($1,$2,$3,true)", [a, other, []]);
  assert.equal((await row("profiles", other)).suspended, true);
  await assert.rejects(
    () => scalar("select staff_update($1,$2,$3,true)", [other, a, []]),
    /FORBIDDEN/,
  );
});
test("RLS staff reads require MFA and the orders capability", async () => {
  const c = await user(),
    p = await product(),
    id = await order(c, p),
    m = await user("manager");
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [m]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      '{"aal":"aal1"}',
    ]);
    assert.equal(
      Number(await scalar("select count(*) from orders where id=$1", [id])),
      0,
    );
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      '{"aal":"aal2"}',
    ]);
    assert.equal(
      Number(await scalar("select count(*) from orders where id=$1", [id])),
      1,
    );
  } finally {
    await db.exec("reset role");
  }
  await db.query("update profiles set permissions='{}' where id=$1", [m]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      Number(await scalar("select count(*) from orders where id=$1", [id])),
      0,
    );
  } finally {
    await db.exec("reset role");
  }
});
test("database rate limits allow the limit and reject the next attempt", async () => {
  const key = uid();
  assert.equal(await scalar("select consume_rate_limit($1,2,60)", [key]), true);
  assert.equal(await scalar("select consume_rate_limit($1,2,60)", [key]), true);
  assert.equal(
    await scalar("select consume_rate_limit($1,2,60)", [key]),
    false,
  );
});
test("direct Auth creation becomes superadmin; protected customer update and unrelated metadata preserve roles", async () => {
  const id = uid();
  await db.query(
    "insert into auth.users(id,email) values($1,'admin@example.test')",
    [id],
  );
  assert.equal((await row("profiles", id)).role, "superadmin");
  await db.query(
    "update auth.users set raw_app_meta_data='{" +
      '"store_role":"customer"' +
      "}' where id=$1",
    [id],
  );
  assert.equal((await row("profiles", id)).role, "customer");
  await db.query(
    "update auth.users set raw_user_meta_data='{" +
      '"role":"superadmin"' +
      '}\', raw_app_meta_data=raw_app_meta_data||\'{"provider":"email"}\' where id=$1',
    [id],
  );
  assert.equal((await row("profiles", id)).role, "customer");
  await db.query(
    "update auth.users set email='changed@example.test' where id=$1",
    [id],
  );
  assert.equal((await row("profiles", id)).email, "changed@example.test");
  await assert.rejects(
    () =>
      db.query(
        "update auth.users set raw_app_meta_data='{\"store_role\":null}' where id=$1",
        [id],
      ),
    /INVALID_PROTECTED_ROLE/,
  );
  await assert.rejects(
    () =>
      db.query("update auth.users set raw_app_meta_data='{}' where id=$1", [
        id,
      ]),
    /PROTECTED_ROLE/,
  );
});
test("authoritative totals, discounts, tax, reservations and idempotency", async () => {
  const c = await user(),
    p = await product(3, 10000),
    key = uid();
  await db.query("update products set discount_percent=10 where id=$1", [p]);
  await db.exec("update store_settings set shipping_paise=500,tax_bps=500");
  const id = await order(c, p, key, 2);
  const o = await row("orders", id);
  assert.equal(Number(o.subtotal_paise), 18000);
  assert.equal(Number(o.total_paise), 19400);
  assert.equal((await row("products", p)).reserved, 2);
  assert.equal(await order(c, p, key, 2), id);
  assert.equal((await row("products", p)).reserved, 2);
  await assert.rejects(() => order(c, p, key, 1), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => order(c, p, uid(), 2), /OUT_OF_STOCK/);
  await db.exec("update store_settings set shipping_paise=0,tax_bps=0");
});
test("zero-price placeholder cannot become a free order", async () => {
  await assert.rejects(
    () => order(awaitedUser, awaitedProduct),
    /PRICE_NOT_SET/,
  );
});
let awaitedUser: string, awaitedProduct: string;
// This hook prepares zero-price data before its test without asynchronous test declaration side effects.
test("manual capture deducts stock once even when event identifiers change; forged amount rolls back", async () => {
  const c = await user(),
    p = await product(3),
    a = await user("manager"),
    id = await order(c, p);
  const args = [id, "event-1", null, 10000, "INR", "manual", a, `REF-${id}`];
  await assert.rejects(
    () =>
      scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [
        ...args.slice(0, 3),
        1,
        ...args.slice(4),
      ]),
    /PAYMENT_MISMATCH/,
  );
  assert.equal((await row("products", p)).stock_on_hand, 3);
  assert.equal(
    await scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", args),
    "paid",
  );
  assert.equal(
    await scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [
      id,
      "another-event",
      null,
      10000,
      "INR",
      "manual",
      a,
      `REF-${id}`,
    ]),
    "paid",
  );
  assert.equal((await row("products", p)).stock_on_hand, 2);
  assert.equal((await row("products", p)).reserved, 0);
  await scalar("select change_order_status($1,$2,'cancelled','')", [a, id]);
  assert.equal((await row("products", p)).stock_on_hand, 3);
  await assert.rejects(
    () => scalar("select change_order_status($1,$2,'cancelled','')", [a, id]),
    /INVALID_STATUS_CHANGE/,
  );
  assert.equal((await row("products", p)).stock_on_hand, 3);
});
test("expiry releases once, late payment never resurrects stock", async () => {
  const c = await user(),
    p = await product(1),
    a = await user("manager"),
    id = await order(c, p);
  await db.query(
    "update orders set expires_at=now()-interval '1 minute' where id=$1",
    [id],
  );
  await scalar("select expire_reservations()");
  assert.equal((await row("products", p)).reserved, 0);
  assert.equal((await row("products", p)).stock_on_hand, 1);
  assert.equal(
    await scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [
      id,
      `late:${id}`,
      null,
      10000,
      "INR",
      "manual",
      a,
      `LATE-${id}`,
    ]),
    "late_paid",
  );
  assert.equal((await row("orders", id)).status, "review_required");
  assert.equal((await row("products", p)).stock_on_hand, 1);
});
test("stock adjustment and coupon use limits cannot bypass held stock", async () => {
  const c = await user(),
    p = await product(2),
    a = await user("manager"),
    code = `SAVE${Date.now()}`;
  await db.query(
    "insert into offers(title,code,kind,value,active,max_uses) values('Save',$1,'percent',10,true,1)",
    [code],
  );
  const id = await order(c, p, uid(), 1, code);
  assert.equal(Number((await row("orders", id)).total_paise), 9000);
  await assert.rejects(
    () => order(awaitedUser, p, uid(), 1, code),
    /COUPON_NOT_ELIGIBLE/,
  );
  await assert.rejects(
    () => scalar("select adjust_stock($1,$2,-2,'Correction')", [a, p]),
    /STOCK_BELOW_RESERVED/,
  );
  await scalar("select change_order_status($1,$2,'cancelled','')", [c, id]);
  await order(c, p, uid(), 1, code);
});
test("customers cannot read other orders or execute business RPCs; user metadata cannot change role", async () => {
  const c = await user(),
    other = await user(),
    p = await product(),
    id = await order(c, p);
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    assert.equal(
      Number(await scalar("select count(*) from orders where id=$1", [id])),
      0,
    );
    await assert.rejects(
      () =>
        db.query("update profiles set role='superadmin' where id=$1", [other]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query("select create_checkout($1,$2,$3,$4,$5,$6)", [
          other,
          uid(),
          "[]",
          "{}",
          "upi",
          null,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from store_settings"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});
test("customers cannot confirm their own payment; manager permissions are checked in the database", async () => {
  const c = await user(),
    p = await product(),
    m = await user("manager"),
    id = await order(c, p);
  await assert.rejects(
    () =>
      scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [
        id,
        "forged",
        null,
        10000,
        "INR",
        "manual",
        c,
        "REF-12345",
      ]),
    /FORBIDDEN/,
  );
  await db.query("update profiles set permissions='{}' where id=$1", [m]);
  await assert.rejects(
    () => scalar("select adjust_stock($1,$2,2,'New stock')", [m, p]),
    /FORBIDDEN/,
  );
});
test("paid fulfillment requires tracking and a received return restores units only once", async () => {
  const c = await user(),
    p = await product(2),
    a = await user("manager"),
    id = await order(c, p);
  await scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [
    id,
    `paid:${id}`,
    null,
    10000,
    "INR",
    "manual",
    a,
    `OK-${id}`,
  ]);
  await scalar("select change_order_status($1,$2,'packing','')", [a, id]);
  await assert.rejects(
    () => scalar("select change_order_status($1,$2,'shipped','')", [a, id]),
    /INVALID_STATUS_CHANGE/,
  );
  const carrier = uid();
  await db.query(
    "insert into tracking_providers(id,name,url_template) values($1,'Carrier','https://tracking.example/{tracking_id}')",
    [carrier],
  );
  await scalar("select set_tracking($1,$2,$3,'TRACK123')", [a, id, carrier]);
  for (const status of ["shipped", "delivered", "return_requested", "returned"])
    await scalar("select change_order_status($1,$2,$3,$4)", [
      a,
      id,
      status,
      "Received and checked",
    ]);
  assert.equal((await row("products", p)).stock_on_hand, 2);
  await assert.rejects(
    () =>
      scalar("select change_order_status($1,$2,'returned','Received')", [
        a,
        id,
      ]),
    /INVALID_STATUS_CHANGE/,
  );
  assert.equal((await row("products", p)).stock_on_hand, 2);
  await scalar("select refund_begin($1,$2,'Return received')", [a, id]);
  await scalar("select refund_complete($1,null,$2,$3)", [
    id,
    `R-${id}`,
    `refund:${id}`,
  ]);
  assert.equal((await row("orders", id)).payment_status, "refunded");
});

test('ERP shared discount and split POS payment preserve serialized stock and idempotency',async()=>{
 const actor=await user('manager'), customer=await user(), p=await product(3,10000), category=uid(), sub=uid(), rule=uid(),key=uid();
 await db.query("insert into product_categories(id,name,slug) values($1::uuid,'Silk',$1::text)",[category]);
 await db.query("insert into product_categories(id,parent_id,name,slug) values($1::uuid,$2,'Wedding',$1::text)",[sub,category]);
 await db.query('update products set subcategory_id=$1 where id=$2',[sub,p]);
 await db.query("insert into catalog_discounts(id,name,scope,target_id,discount_bps,active) values($1,'Sale','category',$2,2000,true)",[rule,category]);
 await db.exec('update pos_settings set enabled=true,max_discount_bps=2000,tax_bps=0');
 const unit=await scalar("select id::text from product_units where product_id=$1 and state='in_stock' order by id limit 1",[p]);
 const cart=JSON.stringify([{product_id:p,quantity:1,unit_ids:[unit]}]);
 const quote=await scalar('select pos_quote($1,$2,0)',[actor,cart]);assert.equal(Number(quote.total_paise),8000);
 const tenders=JSON.stringify([{method:'cash',amount_paise:4000,reference:''},{method:'upi',amount_paise:4000,reference:'UPI-123456'}]);
 const args=[actor,key,cart,JSON.stringify({name:'',phone:'',discount_reason:''}),0,tenders,4000,true];
 const sale=await scalar('select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)',args);assert.equal(await scalar('select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)',args),sale);
 assert.equal((await row('products',p)).stock_on_hand,2);assert.equal(await scalar('select state from product_units where id=$1',[unit]),'sold');
 const online=await order(customer,p);assert.equal(Number((await row('orders',online)).total_paise),8000);
 await scalar("select pos_return($1,$2,'Returned safely','REFUND-123')",[actor,sale]);assert.equal(await scalar('select state from product_units where id=$1',[unit]),'in_stock');
});
test('ERP billing role requires linked active employee and never gains inventory permission',async()=>{
 const billing=await user('billing');assert.equal(await scalar("select private.can_actor($1,'pos')",[billing]),false);
 const policy=await scalar('select id from salary_policies limit 1');
 await db.query("insert into employees(code,name,employment,pay_basis,rate_paise,profile_id,policy_id) values($1,'Cashier','full_time','monthly',100000,$2,$3)",[uid(),billing,policy]);
 assert.equal(await scalar("select private.can_actor($1,'pos')",[billing]),true);assert.equal(await scalar("select private.can_actor($1,'inventory')",[billing]),false);
 await db.query('update employees set active=false where profile_id=$1',[billing]);assert.equal(await scalar("select private.can_actor($1,'pos')",[billing]),false);
});
test('ERP purchase receipt is idempotent and creates exactly one barcode per unit',async()=>{
 const actor=await user('manager'),p=await product(0),supplier=uid(),po=uid(),key=uid();
 await db.query("insert into suppliers(id,name) values($1,'Supplier')",[supplier]);
 await scalar('select purchase_save($1,$2,$3,$4)',[actor,po,JSON.stringify({supplier_id:supplier,supplier_invoice:'',note:'',expected_on:null}),JSON.stringify([{product_id:p,quantity:2,unit_cost_paise:5000,tax_bps:0}])]);
 await scalar("select purchase_status($1,$2,'ordered')",[actor,po]);const args=[actor,po,key,'receive',JSON.stringify([{product_id:p,quantity:2}]),''];
 const receipt=await scalar('select purchase_receive($1,$2,$3,$4,$5,$6)',args);assert.equal(await scalar('select purchase_receive($1,$2,$3,$4,$5,$6)',args),receipt);
 assert.equal((await row('products',p)).stock_on_hand,2);assert.equal(Number(await scalar("select count(*) from product_units where product_id=$1 and state='in_stock'",[p])),2);
 await assert.rejects(()=>scalar('select purchase_receive($1,$2,$3,$4,$5,$6)',[actor,po,uid(),'receive',JSON.stringify([{product_id:p,quantity:1}]),'']),/OVER_RECEIPT/);
});
test('ERP payroll uses attendance and locks approved months',async()=>{
 const actor=await user('superadmin'),emp=uid(),policy=uid();
 await db.query("insert into salary_policies(id,name,work_weekdays,paid_leave_units,leave_tiers) values($1,'Test',array[1,2,3,4,5],1,'[{\"from_unit\":1,\"to_unit\":31,\"lop_bps\":10000}]')",[policy]);
 await db.query("insert into employees(id,code,name,employment,pay_basis,rate_paise,policy_id,joined_on) values($1::uuid,$1::text,'Staff','full_time','monthly',2300000,$2,'2024-01-01')",[emp,policy]);
 await db.query("insert into attendance(employee_id,work_on,status,marked_by) select $1,d::date,case when d::date='2025-01-01' or d::date='2025-01-02' then 'leave' else 'full_day' end,$2 from generate_series('2025-01-01'::date,'2025-01-31'::date,interval '1 day') d where extract(dow from d) between 1 and 5",[emp,actor]);
 const calc=await scalar("select payroll_preview($1,$2,'2025-01-01')",[actor,emp]);assert.equal(Number(calc.lop_units),1);assert.equal(Number(calc.earned_base_paise),2200000);
 const run=await scalar("select payroll_from_attendance($1,$2,'2025-01-01',100000,'[]','[]')",[actor,emp]);assert.equal(Number((await row('payroll_runs',run)).net_paise),2300000);
 await scalar("select payroll_finalize($1,$2,'approve','','bank',false)",[actor,run]);
 await assert.rejects(()=>scalar("select attendance_save($1,$2,'2025-01-02',$3)",[actor,emp,JSON.stringify({status:'full_day',leave_units:1,permission_minutes:0,worked_minutes:480,overtime_minutes:0,note:''})]),/PAYROLL_LOCKED/);
 await scalar("select payroll_finalize($1,$2,'paid','BANK-123','bank',true)",[actor,run]);assert.equal(Number(await scalar('select count(*) from expenses where payroll_id=$1',[run])),1);
});
test("checkout applies a targeted festival offer only to its category and picks the best automatic offer", async () => {
  const customer = await user(), cat = uid(), sub = uid(), other = uid(), otherSub = uid();
  await db.query("insert into product_categories(id,name,slug) values($1::uuid,'Silk target',$1::text)", [cat]);
  await db.query("insert into product_categories(id,parent_id,name,slug) values($1::uuid,$2,'Silk sub',$1::text)", [sub, cat]);
  await db.query("insert into product_categories(id,name,slug) values($1::uuid,'Cotton target',$1::text)", [other]);
  await db.query("insert into product_categories(id,parent_id,name,slug) values($1::uuid,$2,'Cotton sub',$1::text)", [otherSub, other]);
  const silk = await product(5, 100000), cotton = await product(5, 50000);
  await db.query("update products set subcategory_id=$1 where id=$2", [sub, silk]);
  await db.query("update products set subcategory_id=$1 where id=$2", [otherSub, cotton]);
  const targeted = uid(), storewide = uid();
  await db.query("insert into offers(id,title,kind,value,active,target_type,priority) values($1,'Silk week','percent',20,true,'category',5)", [targeted]);
  await db.query("insert into offer_targets(offer_id,target_type,category_id) values($1,'category',$2)", [targeted, cat]);
  await db.query("insert into offers(id,title,kind,value,active,target_type) values($1,'Small storewide','percent',5,true,'all')", [storewide]);
  const cart = (items: [string, number][]) => JSON.stringify(items.map(([product_id, quantity]) => ({ product_id, quantity })));
  // Silk 1000 + cotton 500: targeted 20% of 1000 = 200 beats storewide 5% of 1500 = 75
  const a = await scalar("select create_checkout($1,$2,$3,$4,'upi',null)", [customer, uid(), cart([[silk, 1], [cotton, 1]]), JSON.stringify(address)]);
  let o = await row("orders", a);
  assert.equal(Number(o.discount_paise), 20000);
  assert.equal(o.offer_id, targeted);
  // Cotton-only cart: the silk offer cannot apply, so the storewide one does
  const b = await scalar("select create_checkout($1,$2,$3,$4,'upi',null)", [customer, uid(), cart([[cotton, 2]]), JSON.stringify(address)]);
  o = await row("orders", b);
  assert.equal(Number(o.discount_paise), 5000);
  assert.equal(o.offer_id, storewide);
  // A coupon aimed at silk is rejected for a cotton-only cart
  await db.query("insert into offers(title,code,kind,value,active,target_type) values('Silk code','SILKONLY','percent',10,true,'category')");
  await db.query("insert into offer_targets(offer_id,target_type,category_id) select id,'category',$1 from offers where code='SILKONLY'", [cat]);
  await assert.rejects(() => scalar("select create_checkout($1,$2,$3,$4,'upi','SILKONLY')", [customer, uid(), cart([[cotton, 1]]), JSON.stringify(address)]), /COUPON_NOT_ELIGIBLE/);
  await db.query("update offers set active=false where id in ($1,$2) or code='SILKONLY'", [targeted, storewide]);
});
