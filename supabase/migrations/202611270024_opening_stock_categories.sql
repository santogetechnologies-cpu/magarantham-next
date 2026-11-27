-- 202611270024_opening_stock_categories.sql
-- 1. Saree category tree (Magarantham Silks classification). Editable/removable in Admin -> Catalogue.
-- 2. Opening stock from the four supplier bills (95 individual sarees, 395 pieces).
--    * one product per bill line = one barcode, one price; colours are NOT known yet, so every
--      piece starts as "undefined" and the saree stays off the website until a colour + photo is set;
--    * selling price = cost price (bill rate) for now;
--    * a received purchase per bill (when a superadmin exists) so labels, supplier dues and history work;
--    * barcode = SKU, e.g. MS-WK-07 (Wedding/Korvai bill line 7).
-- Safe to run again: an invoice that is already imported, and any existing SKU, is skipped.

-- ---------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------
do $$
declare m record; s text; main_id uuid; sub_slug text; n int; ord int := 0;
begin
 perform pg_advisory_xact_lock(761117010);
 for m in select * from (values
   (1, 'Heritage & Traditional Sarees', 'heritage-traditional-sarees', array['Kanchipuram Silk Sarees','Banarasi Sarees','Gadwal Sarees','Uppada Sarees','Mysore Silk Sarees','Chanderi Sarees']),
   (2, 'Casual & Everyday Wear Sarees', 'casual-everyday-wear-sarees', array['Linen Sarees','Cotton Sarees','Kota Sarees','Mul Cotton Sarees','Daily Wear Sarees','Semi Silk Sarees']),
   (3, 'Party Wear & Designer Sarees', 'party-wear-designer-sarees', array['Organza Sarees','Cut Work Sarees','Embroidered Sarees','Fancy Sarees']),
   (4, 'Printed & Artisanal Sarees', 'printed-artisanal-sarees', array['Printed Sarees','Floral Print Sarees','Kalamkari Sarees','Ajrakh Sarees','Bandhani Sarees','Kantha Work Sarees','Embroidery Work Sarees']),
   (5, 'Handloom Sarees', 'handloom-sarees', array['Soft Silk Sarees','Tussar Silk Sarees']),
   (6, 'Regional & Signature Weaves', 'regional-signature-weaves', array['Gadwal','Banarasi','Kanchipuram','Uppada','Mysore','Chanderi'])
 ) v(ord, name, slug, subs) order by ord loop
   main_id := null;
   select id into main_id from public.product_categories
    where parent_id is null and (slug = m.slug or lower(btrim(name)) = lower(m.name)) order by (slug = m.slug) desc limit 1;
   if main_id is null then
     insert into public.product_categories(name, slug, parent_id, active, created_at)
     values (m.name, m.slug, null, true, clock_timestamp()) returning id into main_id;
   end if;
   foreach s in array m.subs loop
     if not exists(select 1 from public.product_categories where parent_id = main_id and lower(btrim(name)) = lower(s)) then
       sub_slug := m.slug || '-' || trim(both '-' from lower(regexp_replace(s, '[^a-zA-Z0-9]+', '-', 'g')));
       n := 1;
       while exists(select 1 from public.product_categories where slug = sub_slug) loop
         n := n + 1;
         sub_slug := m.slug || '-' || trim(both '-' from lower(regexp_replace(s, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || n;
       end loop;
       insert into public.product_categories(name, slug, parent_id, active, created_at)
       values (s, sub_slug, main_id, true, clock_timestamp());
     end if;
   end loop;
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Opening stock
-- ---------------------------------------------------------------------------
create temporary table seed_bills(code text primary key, ord int, supplier text, supplier_address text, invoice text, note text, bill_date date, tax_bps int);
insert into seed_bills values
 ('WK', 1, 'Silk supplier (Wedding & Korvai bill)', '', 'OPENING-WK',
  'Opening stock. Wedding / Korvai silk bill: 30 lines, 62 pcs, Rs 5,49,100 + 5% GST = Rs 5,76,555. Supplier name/number not visible on the photo - edit the supplier and invoice no.', null, 500),
 ('CB', 2, 'Coimbatore silk supplier', 'Coimbatore', 'OPENING-CB-P1',
  'Opening stock. Coimbatore bill PAGE 1 of 2: 25 lines, 107 pcs, Rs 5,26,800 before tax. Page 2 was not provided - add its lines with a new purchase.', null, 500),
 ('SD', 3, 'SDHS supplier', '', 'SDHS-685/26-27',
  'Opening stock. Invoice SDHS-685/26-27 dated 16-11-2026, Professional Couriers LR STY501045/5 dated 11-11-2026, e-way bill 572106651353: 36 lines, 114 pcs, Rs 4,18,840 + 5% GST = Rs 4,39,782.', date '2026-11-16', 500),
 ('AK', 4, 'Supplier - Bill No. 203 (AKR Transport)', '', '203',
  'Opening stock. Bill no. 203 dated 13-11-2026, 3 bales via AKR: 4 lines, 112 pcs, Rs 2,96,080 less 2% discount (Rs 5,921.60) + 5% GST = net Rs 3,04,666.', date '2026-11-13', 500);

create temporary table seed_main(slug text primary key, name text);
insert into seed_main values
 ('heritage-traditional-sarees', 'Heritage & Traditional Sarees'),
 ('casual-everyday-wear-sarees', 'Casual & Everyday Wear Sarees'),
 ('party-wear-designer-sarees', 'Party Wear & Designer Sarees'),
 ('printed-artisanal-sarees', 'Printed & Artisanal Sarees'),
 ('handloom-sarees', 'Handloom Sarees');

-- code, line, product name, HSN, qty, rate (Rs), main category slug, subcategory, fabric
create temporary table seed_lines(code text, line int, name text, hsn text, qty int, rate int, main_slug text, sub_name text, fabric text, primary key(code, line));
insert into seed_lines values
 -- Wedding & Korvai bill (HSN 50072010, silk)
 ('WK', 1, 'Pure Fancy Border Silk Saree', '50072010', 4, 12500, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 2, 'Pure Tissue Silk Saree', '50072010', 6, 8700, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Tissue Silk'),
 ('WK', 3, 'Wedding Saree', '50072010', 1, 9900, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 4, 'Tissue Saree PM', '50072010', 1, 6950, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Tissue Silk'),
 ('WK', 5, 'Tissue PM Fancy Border Saree', '50072010', 1, 8200, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Tissue Silk'),
 ('WK', 6, 'Wedding Saree', '50072010', 2, 8900, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 7, 'Korvai Border Saree', '50072010', 2, 9600, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 8, 'Korvai Border Saree', '50072010', 2, 8800, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 9, 'Korvai Border Saree', '50072010', 1, 6750, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 10, 'Korvai Border Saree', '50072010', 2, 7800, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 11, 'Korvai Border Saree', '50072010', 4, 8400, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 12, 'Korvai Border Saree', '50072010', 1, 9500, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 13, 'Wedding Saree', '50072010', 4, 16200, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 14, 'Wedding Saree', '50072010', 2, 14000, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 15, 'Wedding Saree', '50072010', 2, 17950, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 16, 'Wedding Saree', '50072010', 2, 8900, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 17, 'Wedding Saree', '50072010', 1, 10300, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 18, 'Wedding Saree', '50072010', 1, 13500, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 19, 'Wedding Saree', '50072010', 1, 10600, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 20, 'Wedding Saree', '50072010', 1, 12000, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 21, 'White Jari Allself Turning Saree', '50072010', 1, 8200, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 22, 'Soft Silk Saree', '50072010', 2, 10000, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('WK', 23, 'Cont D/W Butta & Lines Saree', '50072010', 2, 7200, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 24, 'Korvai Border PM Saree', '50072010', 1, 7400, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 25, 'Soft Silk Offer Saree', '50072010', 6, 3500, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('WK', 26, 'Soft Silk Offer Saree', '50072010', 1, 6400, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('WK', 27, 'Pure Silk Offer Saree', '50072010', 1, 9800, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 28, 'Pure Silk Offer Saree', '50072010', 1, 5500, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Silk'),
 ('WK', 29, 'Soft Silk Offer Saree', '50072010', 4, 3000, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('WK', 30, 'Soft Silk Offer Saree', '50072010', 2, 2100, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 -- Coimbatore bill, page 1 of 2
 ('CB', 1, 'Jaquard Border Pure Dye Silk Saree', '50072010', 2, 8400, 'heritage-traditional-sarees', 'Kanchipuram Silk Sarees', 'Pure Dye Silk'),
 ('CB', 2, 'SH Koriyan Border Saree', '50072010', 3, 6000, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 3, 'Ikkath Saree', '50072010', 4, 5000, 'printed-artisanal-sarees', 'Printed Sarees', 'Silk'),
 ('CB', 4, 'SH PL Gap Border Saree', '50072010', 6, 4500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 5, 'PL All Self Saree', '50072010', 3, 5500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 6, 'SS Turning Border Saree', '50072010', 6, 5500, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('CB', 7, 'Jackad Border Saree', '50072010', 4, 4200, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 8, 'SH Mina Elephant Saree', '50072010', 2, 6300, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 9, 'Jackad Border Saree', '50072010', 7, 6500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 10, 'SV Turning Silk Saree', '50072010', 22, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 11, 'DS Ganga Saree', '50072010', 2, 7500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 12, 'Turning Border Saree', '50072010', 2, 5500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 13, 'PL Cap Border Saree', '50072010', 4, 5200, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 14, 'Silk Cotton Saree', '50072010', 16, 2000, 'casual-everyday-wear-sarees', 'Semi Silk Sarees', 'Silk Cotton'),
 ('CB', 15, 'SH Koriyan Border Saree', '50072010', 1, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 16, 'DF Plain Saree', '50072010', 2, 4500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 17, 'Handloom Silk Saree', '52083121', 3, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Handloom Silk Cotton'),
 ('CB', 18, 'Butta Saree', '50072010', 2, 3500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 19, 'Fancy Saree', '50072010', 5, 8200, 'party-wear-designer-sarees', 'Fancy Sarees', 'Silk'),
 ('CB', 20, 'Jackad Border Saree', '50072010', 1, 6500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 21, 'SS Plain Saree', '50072010', 1, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('CB', 22, 'NT All Self PL Saree', '50072010', 2, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 23, 'Handloom Saree', '50072010', 5, 5000, 'handloom-sarees', 'Soft Silk Sarees', 'Handloom Silk'),
 ('CB', 24, 'PL Mix Saree', '50072010', 1, 4500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('CB', 25, 'SH PL Gap Border Saree', '50072010', 1, 3800, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 -- SDHS-685/26-27
 ('SD', 1, 'SK Pure Mix B/W Tower Turning Saree', '50072010', 8, 5050, 'handloom-sarees', 'Soft Silk Sarees', 'Pure Mix Silk'),
 ('SD', 2, 'SK B/W Meena Mayil Saree', '50072010', 3, 4150, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 3, 'SK Pure Mix Dupion Multi Saree', '50072010', 6, 4250, 'handloom-sarees', 'Soft Silk Sarees', 'Dupion Silk'),
 ('SD', 4, 'Pure Mix Mayil Border Saree', '50072010', 3, 5300, 'handloom-sarees', 'Soft Silk Sarees', 'Pure Mix Silk'),
 ('SD', 5, 'SK 120 Border Putta Saree', '50072010', 5, 4550, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 6, 'SK Pure Mix B/W Visiri Putta Saree', '50072010', 3, 4200, 'handloom-sarees', 'Soft Silk Sarees', 'Pure Mix Silk'),
 ('SD', 7, 'SK Pure Mix B/W 3D Box Saree', '50072010', 2, 4250, 'handloom-sarees', 'Soft Silk Sarees', 'Pure Mix Silk'),
 ('SD', 8, 'Sathya B/W Coin Putta Saree', '50072010', 7, 4300, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 9, 'HLM Muthu Double Border Saree', '50072010', 3, 6800, 'handloom-sarees', 'Soft Silk Sarees', 'Handloom Silk'),
 ('SD', 10, 'HLM Pooja Saree', '50072010', 3, 6800, 'handloom-sarees', 'Soft Silk Sarees', 'Handloom Silk'),
 ('SD', 11, 'HLM Shruthi Neem Border Saree', '50072010', 2, 6800, 'handloom-sarees', 'Soft Silk Sarees', 'Handloom Silk'),
 ('SD', 12, 'Soft Guna Dupion Saree', '50072010', 5, 6800, 'handloom-sarees', 'Soft Silk Sarees', 'Dupion Silk'),
 ('SD', 13, 'Soft Sakthi 3x1 Jari Lines Saree', '50072010', 2, 7550, 'handloom-sarees', 'Soft Silk Sarees', 'Soft Silk'),
 ('SD', 14, 'Kumar A/C Check 2W Saree', '50072010', 2, 2750, 'casual-everyday-wear-sarees', 'Daily Wear Sarees', 'Silk'),
 ('SD', 15, 'Lavanya Jari Check Saree', '50072010', 3, 4300, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 16, 'Padmasri Saree', '50072010', 3, 3700, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 17, 'Vanmathi Fancy Saree', '50072010', 2, 3700, 'party-wear-designer-sarees', 'Fancy Sarees', 'Silk'),
 ('SD', 18, 'Moon Stripes Saree', '50072010', 3, 3980, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 19, 'Chain Flower Saree', '50072010', 5, 3550, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 20, 'Karunya 3x1 Allself Saree', '50072010', 3, 3950, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 21, 'Bala Meena Mayil Saree', '50072010', 2, 3500, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('SD', 22, 'Cotton Saree BA-103', '52102130', 2, 1225, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 23, 'Cotton Saree SS-103', '52102130', 2, 1225, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 24, 'Cotton Saree BA-603', '52102130', 4, 1900, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 25, 'Cotton Saree BA-603', '52102130', 4, 1900, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 26, 'Cotton Saree BA-604', '52102130', 3, 1925, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 27, 'Cotton Saree BA-612', '52102130', 3, 2200, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 28, 'Cotton Saree SS-108', '52102130', 3, 1250, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 29, 'Cotton Saree PR-702', '52102130', 2, 1375, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 30, 'Cotton Saree PR-702', '52102130', 2, 1375, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 31, 'Cotton Saree VT-308', '52102130', 2, 1350, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 32, 'Cotton Saree AV-302 J/B', '52102130', 2, 1275, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 33, 'Cotton Saree VT-305', '52102130', 2, 1600, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 34, 'Cotton Saree SS-303', '52102130', 2, 1450, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 35, 'Cotton Saree VT-303', '52102130', 3, 1450, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 ('SD', 36, 'Cotton Saree VT-304', '52102130', 3, 1425, 'casual-everyday-wear-sarees', 'Cotton Sarees', 'Cotton'),
 -- Bill No. 203 (HSN 5407)
 ('AK', 1, 'Luxury Soft Silk Saree', '5407', 80, 1850, 'casual-everyday-wear-sarees', 'Semi Silk Sarees', 'Art Silk'),
 ('AK', 2, 'Pure Silk Saree', '5407', 10, 6250, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('AK', 3, 'Pure Silk Saree', '5407', 19, 4280, 'handloom-sarees', 'Soft Silk Sarees', 'Silk'),
 ('AK', 4, 'Luxury Butta Saree', '5407', 3, 1420, 'casual-everyday-wear-sarees', 'Semi Silk Sarees', 'Art Silk');

do $$
declare
  actor uuid; bill record; ln record; sup_id uuid; pur_id uuid; pid uuid; sub_id uuid; main_id uuid; main_name text;
  v_sku text; receipt_lines jsonb;
begin
  select id into actor from public.profiles where role::text = 'superadmin' and not suspended order by created_at limit 1;
  for bill in select * from seed_bills order by ord loop
    -- Supplier (matched by name so an edited/renamed supplier is not duplicated on a re-run)
    select id into sup_id from public.suppliers where lower(name) = lower(bill.supplier) limit 1;
    if sup_id is null then
      insert into public.suppliers(name, address, active) values (bill.supplier, bill.supplier_address, true) returning id into sup_id;
    end if;
    -- Whole bill already imported?
    if exists(select 1 from public.purchases where supplier_id = sup_id and lower(supplier_invoice) = lower(bill.invoice))
       or exists(select 1 from public.products where sku like 'MS-' || bill.code || '-%') then
      continue;
    end if;
    pur_id := null;
    if actor is not null then
      insert into public.purchases(supplier_id, supplier_invoice, note, status, created_by, expected_on)
      values (sup_id, bill.invoice, bill.note, 'received', actor, bill.bill_date) returning id into pur_id;
    end if;
    receipt_lines := '[]';
    for ln in select * from seed_lines where code = bill.code order by line loop
      v_sku := 'MS-' || ln.code || '-' || lpad(ln.line::text, 2, '0');
      if exists(select 1 from public.products where sku = v_sku or barcode = v_sku) then continue; end if;
      main_id := null; sub_id := null;
      select c.id, c.name into main_id, main_name from public.product_categories c join seed_main sm on sm.slug = ln.main_slug
       where c.parent_id is null and (c.slug = sm.slug or lower(btrim(c.name)) = lower(sm.name)) order by (c.slug = sm.slug) desc limit 1;
      select id into sub_id from public.product_categories where parent_id = main_id and lower(btrim(name)) = lower(ln.sub_name) limit 1;
      -- Units (MSU stickers) created for this stock belong to this purchase.
      perform set_config('store.sale_id', '', true); perform set_config('store.order_id', '', true);
      perform set_config('store.unit_ids', '[]', true); perform set_config('store.purchase_id', coalesce(pur_id::text, ''), true);
      insert into public.products(sku, barcode, slug, name, category, subcategory_id, colour, description, image_path,
        price_paise, purchase_price_paise, compare_at_price_paise, discount_percent, stock_on_hand, min_stock_level,
        published, featured, archived, saree_type, fabric, design)
      values (v_sku, v_sku,
        trim(both '-' from lower(regexp_replace(ln.name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || lower(v_sku),
        ln.name, coalesce(main_name, 'Sarees'), sub_id, '',
        'Supplier bill ' || bill.invoice || ', line ' || ln.line || '. HSN ' || ln.hsn || '.',
        '', ln.rate * 100, ln.rate * 100, 0, 0, ln.qty, 0,
        true, false, false, coalesce(ln.sub_name, ''), ln.fabric, '')
      returning id into pid;
      insert into public.inventory_movements(product_id, actor_id, delta, reason)
      values (pid, actor, ln.qty, 'Opening stock - bill ' || bill.invoice || ' line ' || ln.line);
      if pur_id is not null then
        insert into public.purchase_items(purchase_id, product_id, quantity, received, unit_cost_paise, tax_bps)
        values (pur_id, pid, ln.qty, ln.qty, ln.rate * 100, bill.tax_bps);
        receipt_lines := receipt_lines || jsonb_build_array(jsonb_build_object('product_id', pid, 'quantity', ln.qty));
      end if;
    end loop;
    if pur_id is not null and jsonb_array_length(receipt_lines) > 0 then
      insert into public.purchase_receipts(purchase_id, request_key, fingerprint, kind, lines, actor_id, note)
      values (pur_id, gen_random_uuid(), 'opening-stock-' || bill.code, 'receive', receipt_lines, actor, 'Opening stock import');
      perform private.audit(actor, 'purchase.receive', 'purchases', pur_id::text, jsonb_build_object('opening_stock', bill.invoice));
    end if;
  end loop;
  perform set_config('store.purchase_id', '', true);
end $$;

drop table if exists seed_lines;
drop table if exists seed_main;
drop table if exists seed_bills;
