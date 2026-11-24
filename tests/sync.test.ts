// End-to-end channel sync: the same saree must have the same price, discount,
// offer, stock and visibility in the website catalogue, online checkout and POS.
// Runs every production migration in an in-memory PostgreSQL (PGlite).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = () => crypto.randomUUID();
const address = { name: "Sync Customer", phone: "9876543210", line1: "12 Test Road", line2: "", city: "Chennai", state: "Tamil Nadu", pin: "600001" };

async function scalar(sql: string, args: unknown[] = []) {
  const r = await db.query<Record<string, any>>(sql, args);
  return Object.values(r.rows[0] || {})[0];
}
async function one(sql: string, args: unknown[] = []) {
  return (await db.query<Record<string, any>>(sql, args)).rows[0] || {};
}
async function user(role = "customer") {
  const id = uid();
  await db.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)", [id, `${id}@example.test`, JSON.stringify({ store_role: role }), JSON.stringify({ name: role })]);
  return id;
}

let admin: string, cashier: string, mainCat: string, subCat: string;

async function saree(stock: number, price: number, sub = subCat) {
  const id = uid();
  await db.query(
    "insert into products(id,sku,slug,name,category,colour,image_path,price_paise,stock_on_hand,published,subcategory_id) values($1::uuid,$1::text,$1::text,'Sync Saree','Silk','Red','/assets/product-01.jpg',$2,$3,true,$4)",
    [id, price, stock, sub],
  );
  return id;
}
/** Website catalogue row (what the storefront reads). */
const web = (p: string) => one("select effective_price_paise,stock_on_hand,reserved,stock_on_hand-reserved as available,category_visible,published from store_catalogue where id=$1", [p]);
/** POS quote for a single saree. */
const posQuote = (p: string, qty = 1, discount = 0) =>
  scalar("select pos_quote($1,$2,$3)", [cashier, JSON.stringify([{ product_id: p, quantity: qty, unit_ids: [] }]), discount]);
/** POS cash sale. */
async function posSale(p: string, qty = 1) {
  const q = await posQuote(p, qty);
  return scalar("select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)", [
    cashier, uid(), JSON.stringify([{ product_id: p, quantity: qty, unit_ids: [] }]), JSON.stringify({ name: "", phone: "", discount_reason: "" }), 0,
    JSON.stringify([{ method: "cash", amount_paise: Number(q.total_paise), reference: "" }]), Number(q.total_paise), false,
  ]);
}
/** Online order (reserves stock until paid). */
async function onlineOrder(customer: string, p: string, qty = 1, coupon: string | null = null) {
  return scalar("select create_checkout($1,$2,$3,$4,'upi',$5)", [customer, uid(), JSON.stringify([{ product_id: p, quantity: qty }]), JSON.stringify(address), coupon]);
}
async function pay(orderId: string) {
  const o = await one("select total_paise from orders where id=$1", [orderId]);
  return scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [orderId, `manual:${orderId}`, null, Number(o.total_paise), "INR", "manual", admin, `REF-${orderId.slice(0, 8)}`]);
}

before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of [
    "202611160001_store.sql", "202611160002_operations.sql", "202611170003_pos_payroll.sql", "202611170004_erp_schema.sql",
    "202611170005_erp_operations.sql", "202611170006_shared_checkout.sql", "202611170007_attendance_payroll.sql", "202611170008_erp_queries.sql",
    "202611170009_admin_erp_system.sql", "202611180010_subcategory_images.sql", "202611200012_offer_targets.sql",
    "202611230013_discounts_banners.sql", "202611230014_pos_festival_offers.sql", "202611240015_pos_customisation.sql",
  ])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  // Same tax (0%) and no shipping on both channels so totals compare directly.
  await db.exec("update store_settings set ordering_enabled=true,checkout_mode='both',whatsapp_phone='919876543210',upi_id='store@bank',upi_name='Store',shipping_paise=0,tax_bps=0");
  await db.exec("update pos_settings set enabled=true,max_discount_bps=2000,tax_bps=0");
  admin = await user("superadmin");
  cashier = await user("manager");
  mainCat = uid();
  subCat = uid();
  await scalar("select erp_save($1,'product_categories',$2,$3)", [admin, mainCat, JSON.stringify({ name: "Sync Silk", slug: "sync-silk", parent_id: null, active: true })]);
  await scalar("select erp_save($1,'product_categories',$2,$3)", [admin, subCat, JSON.stringify({ name: "Sync Bridal", slug: "sync-bridal", parent_id: mainCat, active: true })]);
});
after(async () => {
  await db.close();
});

test("1. price: website, online checkout and POS charge the same price, through every discount change", async () => {
  const p = await saree(10, 100000);
  const customer = await user();
  const check = async (expected: number) => {
    assert.equal((await web(p)).effective_price_paise, expected, "website price");
    assert.equal(Number((await posQuote(p)).subtotal_paise), expected, "POS price");
    const o = await onlineOrder(customer, p);
    assert.equal(Number((await one("select unit_price_paise from order_items where order_id=$1", [o])).unit_price_paise), expected, "online checkout price");
    await scalar("select change_order_status($1,$2,'cancelled','')", [admin, o]);
  };
  await check(100000);
  const all = uid(), cat = uid(), prod = uid();
  const save = (id: string, data: object) => scalar("select erp_save($1,'catalog_discounts',$2,$3)", [admin, id, JSON.stringify({ starts_at: null, ends_at: null, ...data })]);
  await save(all, { name: "All 10", scope: "all", target_id: null, discount_bps: 1000, active: true });
  await check(90000);
  await save(cat, { name: "Cat 20", scope: "category", target_id: mainCat, discount_bps: 2000, active: true });
  await check(80000); // biggest rule wins
  await save(prod, { name: "Hero 25", scope: "product", target_id: p, discount_bps: 2500, active: true });
  await check(75000);
  await db.query("update catalog_discounts set active=false where id in ($1,$2,$3)", [all, cat, prod]);
  await check(100000); // switching off returns every channel to full price
  // A scheduled rule does nothing until it starts
  await save(uid(), { name: "Tomorrow", scope: "all", target_id: null, discount_bps: 5000, active: true, starts_at: new Date(Date.now() + 86400000).toISOString() });
  await check(100000);
});

test("2. stock: POS sales and online orders draw from one shared stock count", async () => {
  const p = await saree(3, 50000);
  const customer = await user();
  await posSale(p);
  let w = await web(p);
  assert.equal(w.available, 2, "website sees the POS sale");

  const o = await onlineOrder(customer, p, 2); // reserves both remaining
  w = await web(p);
  assert.equal(w.reserved, 2);
  assert.equal(w.available, 0, "website shows sold out while reserved");
  await assert.rejects(() => posQuote(p), /OUT_OF_STOCK/, "POS cannot sell stock held by an online order");
  const shopper2 = await user();
  await assert.rejects(() => onlineOrder(shopper2, p, 1), /OUT_OF_STOCK/, "second shopper cannot oversell");

  assert.equal(await pay(o), "paid");
  w = await web(p);
  assert.equal(w.stock_on_hand, 0);
  assert.equal(w.reserved, 0);
  const moves = await one("select count(*)::int n, sum(delta)::int d from inventory_movements where product_id=$1", [p]);
  assert.equal(moves.d, -3, "ledger records POS (-1) and online (-2)");
});

test("3. stock: expired online holds go back to POS; cancellations and returns restock both channels", async () => {
  const p = await saree(2, 40000);
  const customer = await user();
  const held = await onlineOrder(customer, p, 2);
  await assert.rejects(() => posQuote(p), /OUT_OF_STOCK/);
  await db.query("update orders set expires_at=now()-interval '1 minute' where id=$1", [held]);
  await scalar("select expire_reservations()");
  assert.equal(Number((await posQuote(p, 2)).subtotal_paise), 80000, "POS can sell after the hold expires");

  const paid = await onlineOrder(customer, p, 1);
  await pay(paid);
  assert.equal((await web(p)).available, 1);
  await scalar("select change_order_status($1,$2,'cancelled','Customer called')", [admin, paid]);
  assert.equal((await web(p)).available, 2, "cancelled paid order restocks");

  const sale = await posSale(p, 1);
  assert.equal((await web(p)).available, 1);
  await scalar("select pos_return($1,$2,'Wrong colour','RET-123456')", [admin, sale]);
  assert.equal((await web(p)).available, 2, "POS return is visible online immediately");
});

test("4. visibility: hiding a category or subcategory stops sales on both channels", async () => {
  const p = await saree(5, 30000);
  const customer = await user();
  const hide = (id: string, parent: string | null, name: string, slug: string, active: boolean) =>
    scalar("select erp_save($1,'product_categories',$2,$3)", [admin, id, JSON.stringify({ name, slug, parent_id: parent, active })]);
  await hide(subCat, mainCat, "Sync Bridal", "sync-bridal", false);
  assert.equal((await web(p)).category_visible, false);
  await assert.rejects(() => posQuote(p), /PRODUCT_UNAVAILABLE/);
  await assert.rejects(() => onlineOrder(customer, p), /PRODUCT_UNAVAILABLE/);
  await hide(subCat, mainCat, "Sync Bridal", "sync-bridal", true);
  await hide(mainCat, null, "Sync Silk", "sync-silk", false);
  assert.equal((await web(p)).category_visible, false, "hiding the main category hides its subcategories");
  await assert.rejects(() => posQuote(p), /PRODUCT_UNAVAILABLE/);
  await hide(mainCat, null, "Sync Silk", "sync-silk", true);
  assert.equal((await web(p)).category_visible, true);
  assert.equal(Number((await posQuote(p)).subtotal_paise), 30000);
});

test("5. publishing: unpublished sarees are shop-only, archived sarees are not sold anywhere", async () => {
  const p = await saree(4, 25000);
  const customer = await user();
  await db.query("update products set published=false where id=$1", [p]);
  await assert.rejects(() => onlineOrder(customer, p), /PRODUCT_UNAVAILABLE/, "not sold online");
  assert.equal(Number((await posQuote(p)).subtotal_paise), 25000, "still sellable at the counter");
  await db.query("update products set published=true,archived=true where id=$1", [p]);
  await assert.rejects(() => onlineOrder(customer, p), /PRODUCT_UNAVAILABLE/);
  await assert.rejects(() => posQuote(p), /PRODUCT_UNAVAILABLE/);
});

test("6. festival offers: same offer amount online and in POS when 'Apply in POS' is on", async () => {
  const p = await saree(6, 100000);
  const offer = uid();
  await db.query("insert into offers(id,title,kind,value,active,target_type,apply_in_pos) values($1,'Sync fest','percent',15,true,'category',false)", [offer]);
  await db.query("insert into offer_targets(offer_id,target_type,category_id) values($1,'category',$2)", [offer, mainCat]);

  const o1 = await onlineOrder(await user(), p);
  assert.equal(Number((await one("select discount_paise from orders where id=$1", [o1])).discount_paise), 15000, "online gets the offer");
  assert.equal(Number((await posQuote(p)).offer_discount_paise), 0, "switch off: POS does not");

  await db.query("update offers set apply_in_pos=true where id=$1", [offer]);
  const q = await posQuote(p);
  assert.equal(Number(q.offer_discount_paise), 15000, "switch on: POS gets the same amount");
  assert.equal(Number(q.total_paise), 85000);
  const o2 = await onlineOrder(await user(), p);
  assert.equal(Number((await one("select total_paise from orders where id=$1", [o2])).total_paise), Number(q.total_paise), "online total equals POS total");

  // Switching the offer off removes it from both channels
  await db.query("update offers set active=false where id=$1", [offer]);
  assert.equal(Number((await posQuote(p)).offer_discount_paise), 0);
  const o3 = await onlineOrder(await user(), p);
  assert.equal(Number((await one("select discount_paise from orders where id=$1", [o3])).discount_paise), 0);
});
