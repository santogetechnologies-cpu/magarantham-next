// Colour stock for individual sarees: one barcode + one price per saree, pieces split by colour
// (some possibly undefined). POS billing and the website must draw from the same pieces.
// Runs every production migration in an in-memory PostgreSQL (PGlite).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = () => crypto.randomUUID();
const address = { name: "Colour Customer", phone: "9876543210", line1: "12 Test Road", line2: "", city: "Nagercoil", state: "Tamil Nadu", pin: "629003" };

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
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: Error) => e.message.includes(code), `expected ${code}`);
}

let admin: string, cashier: string, subCat: string;

/** An individual saree with N pieces and no colours yet (as imported from a supplier bill). */
async function saree(stock: number, price = 850000) {
  const id = uid();
  await db.query(
    "insert into products(id,sku,slug,name,category,colour,image_path,price_paise,stock_on_hand,published,subcategory_id,barcode) values($1::uuid,$1::text,$1::text,'Kanchipuram Korvai','Heritage','','/assets/product-01.jpg',$2,$3,true,$4,$5)",
    [id, price, stock, subCat, `KV-${id.slice(0, 8)}`],
  );
  return id;
}
const colours = (p: string) =>
  db.query<Record<string, any>>("select id,colour,quantity,reserved,image_path from product_colours where product_id=$1 order by sort_order,lower(colour)", [p]).then((r) => r.rows);
const byName = async (p: string) => Object.fromEntries((await colours(p)).map((c) => [c.colour, c]));
const catalogue = (p: string) => one("select stock_on_hand,reserved,undefined_quantity,online_available,online_ready,colours from store_catalogue where id=$1", [p]);
const saveColours = (p: string, rows: object[], total: number | null = null) =>
  scalar("select colour_stock_save($1,$2,$3,$4,$5)", [admin, p, JSON.stringify(rows), total, "test"]);

async function posSale(p: string, qty: number, picks?: { colour_id: string | null; quantity: number }[]) {
  const cart = [{ product_id: p, quantity: qty, unit_ids: [], ...(picks ? { colours: picks } : {}) }];
  const q = await scalar("select pos_quote($1,$2,$3)", [cashier, JSON.stringify(cart), 0]);
  return scalar("select pos_checkout($1,$2,$3,$4,$5,$6,$7,$8)", [
    cashier, uid(), JSON.stringify(cart), JSON.stringify({ name: "", phone: "", discount_reason: "" }), 0,
    JSON.stringify([{ method: "cash", amount_paise: Number(q.total_paise), reference: "" }]), Number(q.total_paise), false,
  ]);
}
const onlineOrder = (customer: string, lines: { product_id: string; colour_id?: string; quantity: number }[]) =>
  scalar("select create_checkout($1,$2,$3,$4,'upi',null)", [customer, uid(), JSON.stringify(lines), JSON.stringify(address)]);
async function pay(orderId: string) {
  const o = await one("select total_paise from orders where id=$1", [orderId]);
  return scalar("select record_payment($1,$2,$3,$4,$5,$6,$7,$8)", [orderId, `manual:${orderId}`, null, Number(o.total_paise), "INR", "manual", admin, `REF-${orderId.slice(0, 8)}`]);
}

let legacyProduct: string;

before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    // The opening-stock import records purchases under the first superadmin.
    if (file === "202611270024_opening_stock_categories.sql") admin = await user("superadmin");
    if (file === "202611270023_colour_stock.sql") {
      // A saree that existed before colour stock: a single-colour product with stock.
      legacyProduct = uid();
      await db.query(
        "insert into products(id,sku,slug,name,category,colour,image_path,price_paise,stock_on_hand,published) values($1::uuid,$1::text,$1::text,'Legacy Silk','Silk','Maroon','/assets/product-02.jpg',500000,4,true)",
        [legacyProduct],
      );
    }
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  await db.exec("update store_settings set ordering_enabled=true,checkout_mode='both',whatsapp_phone='919876543210',upi_id='store@bank',upi_name='Store',shipping_paise=0,tax_bps=0");
  await db.exec("update pos_settings set enabled=true,max_discount_bps=2000,tax_bps=0");
  cashier = await user("manager");
  const mainCat = uid();
  subCat = uid();
  await scalar("select erp_save($1,'product_categories',$2,$3)", [admin, mainCat, JSON.stringify({ name: "Colour Test Silk", slug: "colour-test-silk", parent_id: null, active: true })]);
  await scalar("select erp_save($1,'product_categories',$2,$3)", [admin, subCat, JSON.stringify({ name: "Colour Test Kanchi", slug: "colour-test-kanchi", parent_id: mainCat, active: true })]);
});
after(async () => {
  await db.close();
});

test("1. existing single-colour sarees keep selling online after the upgrade", async () => {
  const c = await colours(legacyProduct);
  assert.equal(c.length, 1);
  assert.equal(c[0].colour, "Maroon");
  assert.equal(c[0].quantity, 4);
  const web = await catalogue(legacyProduct);
  assert.equal(web.online_ready, true);
  assert.equal(web.online_available, 4);
  assert.equal(web.undefined_quantity, 0);
});

test("2. imported saree with no colours: all pieces undefined, hidden online, still billable at POS", async () => {
  const p = await saree(10);
  const web = await catalogue(p);
  assert.equal(web.undefined_quantity, 10);
  assert.equal(web.online_ready, false);
  assert.equal(web.online_available, 0);
  // Online checkout cannot sell undefined pieces.
  await rejects(onlineOrder(await user(), [{ product_id: p, quantity: 1 }]), "COLOUR_REQUIRED");
  // The counter can still bill it by barcode; pieces come from undefined.
  await posSale(p, 2);
  const after = await catalogue(p);
  assert.equal(after.stock_on_hand, 8);
  assert.equal(after.undefined_quantity, 8);
  assert.equal(Number(await scalar("select count(*) from product_units where product_id=$1 and state='in_stock'", [p])), 8);
});

test("3. 10 pieces = 3 green + 5 red + 2 violet; a colour shows online only once it has a photo", async () => {
  const p = await saree(10);
  await saveColours(p, [
    { colour: "Green", colour_hex: "#2E7D32", quantity: 3, image_path: "/assets/product-03.jpg" },
    { colour: "Red", colour_hex: "#C62828", quantity: 5, image_path: "/assets/product-04.jpg" },
    { colour: "Violet", colour_hex: "#7C3AED", quantity: 2, image_path: "" },
  ]);
  const web = await catalogue(p);
  assert.equal(web.undefined_quantity, 0);
  assert.equal(web.online_available, 8, "violet has no photo yet, so only green + red sell online");
  assert.equal(web.colours.length, 3);
  // More coloured pieces than pieces in stock is refused.
  const c = await byName(p);
  await rejects(saveColours(p, [
    { id: c.Green.id, colour: "Green", quantity: 4, image_path: c.Green.image_path },
    { id: c.Red.id, colour: "Red", quantity: 5, image_path: c.Red.image_path },
    { id: c.Violet.id, colour: "Violet", quantity: 2, image_path: "" },
  ]), "COLOUR_STOCK_EXCEEDS_TOTAL");
  // Duplicate colour names are refused.
  await rejects(saveColours(p, [{ colour: "Green", quantity: 1 }, { colour: "green", quantity: 1 }]), "DUPLICATE_COLOUR");
});

test("4. scanning one barcode and billing a violet saree leaves the website at the right count", async () => {
  const p = await saree(10);
  await saveColours(p, [
    { colour: "Green", quantity: 3, image_path: "/assets/product-03.jpg" },
    { colour: "Red", quantity: 5, image_path: "/assets/product-04.jpg" },
    { colour: "Violet", quantity: 2, image_path: "/assets/product-05.jpg" },
  ]);
  const c = await byName(p);
  // No undefined pieces left, so the cashier must pick a colour.
  await rejects(posSale(p, 1), "COLOUR_REQUIRED");
  await posSale(p, 1, [{ colour_id: c.Violet.id, quantity: 1 }]);
  const after = await byName(p);
  assert.equal(after.Violet.quantity, 1);
  assert.equal(after.Green.quantity, 3);
  assert.equal(after.Red.quantity, 5);
  const web = await catalogue(p);
  assert.equal(web.stock_on_hand, 9);
  assert.equal(web.online_available, 9);
  const violetOnline = web.colours.find((x: any) => x.colour === "Violet");
  assert.equal(violetOnline.quantity - violetOnline.reserved, 1, "website now shows 1 violet");
  // The bill records which colour was sold.
  const sale = await one("select items from pos_sales order by created_at desc limit 1");
  assert.equal(sale.items[0].colours[0].colour, "Violet");
  // Selling more violet than exists is refused.
  await rejects(posSale(p, 2, [{ colour_id: c.Violet.id, quantity: 2 }]), "COLOUR_OUT_OF_STOCK");
});

test("5. online orders reserve the exact colour; POS cannot sell those pieces; pay, cancel and return keep colours right", async () => {
  const p = await saree(6);
  await saveColours(p, [
    { colour: "Red", quantity: 4, image_path: "/assets/product-04.jpg" },
    { colour: "Green", quantity: 2, image_path: "/assets/product-03.jpg" },
  ]);
  const c = await byName(p);
  const customer = await user();
  const o = await onlineOrder(customer, [
    { product_id: p, colour_id: c.Red.id, quantity: 3 },
    { product_id: p, colour_id: c.Green.id, quantity: 1 },
  ]);
  let now = await byName(p);
  assert.equal(now.Red.reserved, 3);
  assert.equal(now.Green.reserved, 1);
  assert.equal((await catalogue(p)).online_available, 2);
  // Only 1 red is free at the counter now.
  await rejects(posSale(p, 2, [{ colour_id: c.Red.id, quantity: 2 }]), "COLOUR_OUT_OF_STOCK");
  // Paying removes exactly the reserved colours.
  assert.equal(await pay(o), "paid");
  now = await byName(p);
  assert.equal(now.Red.quantity, 1);
  assert.equal(now.Red.reserved, 0);
  assert.equal(now.Green.quantity, 1);
  assert.equal((await catalogue(p)).stock_on_hand, 2);
  const items = await db.query<Record<string, any>>("select colour,quantity from order_items where order_id=$1 order by colour", [o]);
  assert.deepEqual(items.rows.map((r) => `${r.colour}:${r.quantity}`), ["Green:1", "Red:3"]);
  // Cancelling before dispatch puts the pieces back in the same colours.
  await scalar("select change_order_status($1,$2,'cancelled','')", [admin, o]);
  now = await byName(p);
  assert.equal(now.Red.quantity, 4);
  assert.equal(now.Green.quantity, 2);
  assert.equal((await catalogue(p)).stock_on_hand, 6);
});

test("6. unpaid orders that expire or are cancelled release the colour hold", async () => {
  const p = await saree(3);
  await saveColours(p, [{ colour: "Gold", quantity: 3, image_path: "/assets/product-06.jpg" }]);
  const c = await byName(p);
  const customer = await user();
  const o = await onlineOrder(customer, [{ product_id: p, colour_id: c.Gold.id, quantity: 2 }]);
  assert.equal((await byName(p)).Gold.reserved, 2);
  await scalar("select change_order_status($1,$2,'cancelled','')", [customer, o]);
  assert.equal((await byName(p)).Gold.reserved, 0);
  const o2 = await onlineOrder(customer, [{ product_id: p, colour_id: c.Gold.id, quantity: 1 }]);
  await db.query("update orders set expires_at=now()-interval '1 minute' where id=$1", [o2]);
  await scalar("select expire_reservations()");
  assert.equal((await byName(p)).Gold.reserved, 0);
  assert.equal((await one("select reserved from products where id=$1", [p])).reserved, 0);
});

test("7. a POS return puts the billed colour back; a colour without a photo is never sold online", async () => {
  const p = await saree(4);
  await saveColours(p, [
    { colour: "Pink", quantity: 2, image_path: "/assets/product-07.jpg" },
    { colour: "Blue", quantity: 1, image_path: "" },
  ]);
  const c = await byName(p);
  await rejects(onlineOrder(await user(), [{ product_id: p, colour_id: c.Blue.id, quantity: 1 }]), "COLOUR_UNAVAILABLE");
  // 1 undefined + 1 pink on one bill.
  const sale = await posSale(p, 2, [{ colour_id: c.Pink.id, quantity: 1 }]);
  let now = await byName(p);
  assert.equal(now.Pink.quantity, 1);
  assert.equal((await catalogue(p)).undefined_quantity, 0);
  await scalar("select pos_return($1,$2,$3,$4)", [admin, sale, "Customer changed mind", "CASH-RETURN-1"]);
  now = await byName(p);
  assert.equal(now.Pink.quantity, 2);
  const web = await catalogue(p);
  assert.equal(web.stock_on_hand, 4);
  assert.equal(web.undefined_quantity, 1);
});

test("8. total pieces and colours are edited together; manual stock-outs cannot eat coloured pieces", async () => {
  const p = await saree(2);
  // Received 3 more green pieces: total 5, green 3, undefined 2.
  const r = await saveColours(p, [{ colour: "Green", quantity: 3, image_path: "/assets/product-03.jpg" }], 5);
  assert.equal(r.undefined, 2);
  assert.equal(Number(await scalar("select count(*) from product_units where product_id=$1 and state='in_stock'", [p])), 5);
  // Removing 2 undefined pieces is fine, a 3rd would have to come out of green.
  await scalar("select adjust_stock($1,$2,$3,$4)", [admin, p, -2, "Damaged pieces"]);
  await rejects(scalar("select adjust_stock($1,$2,$3,$4)", [admin, p, -1, "Damaged piece"]), "COLOUR_STOCK_EXCEEDS_TOTAL");
  // A colour an online order is holding cannot be deleted or reduced below the hold.
  const c = await byName(p);
  await onlineOrder(await user(), [{ product_id: p, colour_id: c.Green.id, quantity: 2 }]);
  await rejects(saveColours(p, [], null), "COLOUR_HAS_RESERVATIONS");
  await rejects(saveColours(p, [{ id: c.Green.id, colour: "Green", quantity: 1, image_path: "/assets/product-03.jpg" }]), "COLOUR_BELOW_RESERVED");
  assert.equal((await one("select colour from products where id=$1", [p])).colour, "Green");
});

test("9. category tree from the classification is in the database and editable", async () => {
  const mains = await db.query<Record<string, any>>(
    "select m.name, count(s.id)::int subs from product_categories m left join product_categories s on s.parent_id=m.id where m.parent_id is null and m.slug in ('heritage-traditional-sarees','casual-everyday-wear-sarees','party-wear-designer-sarees','printed-artisanal-sarees','handloom-sarees','regional-signature-weaves') group by m.name order by min(m.created_at)",
  );
  assert.deepEqual(mains.rows.map((r) => `${r.name}:${r.subs}`), [
    "Heritage & Traditional Sarees:6",
    "Casual & Everyday Wear Sarees:6",
    "Party Wear & Designer Sarees:4",
    "Printed & Artisanal Sarees:7",
    "Handloom Sarees:2",
    "Regional & Signature Weaves:6",
  ]);
  // Same sub name under two mains gets two distinct slugs.
  assert.equal(Number(await scalar("select count(*) from product_categories where lower(name) in ('kanchipuram','kanchipuram silk sarees')")), 2);
  // A saree can be moved to another category / subcategory.
  const p = await one("select id from products where sku='MS-WK-07'");
  const target = await one("select s.id, m.name main from product_categories s join product_categories m on m.id=s.parent_id where s.name='Kanchipuram' and m.slug='regional-signature-weaves'");
  await scalar("select admin_save($1,'products',$2,$3)", [admin, p.id, JSON.stringify({ subcategory_id: target.id })]);
  const moved = await one("select category, subcategory_id from products where id=$1", [p.id]);
  assert.equal(moved.subcategory_id, target.id);
  assert.equal(moved.category, target.main);
});

test("10. opening stock: every bill line is one saree with undefined colours, cost = selling price, linked to its purchase", async () => {
  const totals = await db.query<Record<string, any>>(
    "select split_part(sku,'-',2) bill, count(*)::int sarees, sum(stock_on_hand)::int pieces, sum(stock_on_hand*purchase_price_paise)::bigint cost, bool_and(price_paise=purchase_price_paise) same_price, bool_and(barcode=sku) barcode_is_sku from products where sku ~ '^MS-(WK|CB|SD|AK)-' group by 1 order by 1",
  );
  assert.deepEqual(
    totals.rows.map((r) => [r.bill, r.sarees, r.pieces, Number(r.cost) / 100, r.same_price, r.barcode_is_sku]),
    [
      ["AK", 4, 112, 296080, true, true],
      ["CB", 25, 107, 526800, true, true],
      ["SD", 36, 114, 418840, true, true],
      ["WK", 30, 62, 549100, true, true],
    ],
  );
  const web = await one("select bool_or(online_ready) any_online, sum(undefined_quantity)::int undef from store_catalogue where sku ~ '^MS-(WK|CB|SD|AK)-'");
  assert.equal(web.any_online, false, "no colour/photo yet, so nothing is on the website");
  assert.equal(web.undef, 395);
  // Purchases: one received bill each, MSU stickers belong to the bill.
  const bills = await db.query<Record<string, any>>("select p.supplier_invoice, p.status, (select sum(quantity*unit_cost_paise) from purchase_items i where i.purchase_id=p.id)::bigint cost, (select count(*) from product_units u where u.purchase_id=p.id)::int stickers from purchases p order by p.supplier_invoice");
  assert.deepEqual(
    bills.rows.map((r) => [r.supplier_invoice, r.status, Number(r.cost) / 100, r.stickers]),
    [
      ["203", "received", 296080, 112],
      ["OPENING-CB-P1", "received", 526800, 107],
      ["OPENING-WK", "received", 549100, 62],
      ["SDHS-685/26-27", "received", 418840, 114],
    ],
  );
  // Every opening saree is in a subcategory of the new tree.
  assert.equal(Number(await scalar("select count(*) from products where sku ~ '^MS-(WK|CB|SD|AK)-' and subcategory_id is null")), 0);
  // Running the import again adds nothing.
  const before = Number(await scalar("select count(*) from products"));
  await db.exec(await readFile(new URL("../supabase/migrations/202611270024_opening_stock_categories.sql", import.meta.url), "utf8"));
  assert.equal(Number(await scalar("select count(*) from products")), before);
  assert.equal(Number(await scalar("select count(*) from purchases")), 4);
});

test("11. an opening-stock saree gets colours later: 80 Luxury Soft Silk = colours + undefined, scan shows both", async () => {
  const p = await one("select id from products where sku='MS-AK-01'");
  await saveColours(p.id, [
    { colour: "Green", quantity: 30, image_path: "/assets/product-03.jpg" },
    { colour: "Red", quantity: 20, image_path: "/assets/product-04.jpg" },
  ]);
  const web = await catalogue(p.id);
  assert.equal(web.undefined_quantity, 30);
  assert.equal(web.online_available, 50);
  assert.equal(web.online_ready, true);
});
