-- 202611260022_sample_two_sarees.sql
-- Safely ensure Sarees -> Silk Sarees category hierarchy and insert ONLY 2 sample products (KAN001, SOF002).

do $$
declare
  v_sarees_id uuid;
  v_silk_id uuid;
begin
  -- 1. Ensure 'Sarees' main category exists
  select id into v_sarees_id
  from public.product_categories
  where lower(name) = 'sarees' and parent_id is null
  limit 1;

  if v_sarees_id is null then
    insert into public.product_categories (name, slug, parent_id, active)
    values ('Sarees', 'sarees', null, true)
    on conflict (slug) do update set active = true
    returning id into v_sarees_id;
  end if;

  -- 2. Ensure 'Silk Sarees' subcategory exists under 'Sarees'
  select id into v_silk_id
  from public.product_categories
  where lower(name) = 'silk sarees' and parent_id = v_sarees_id
  limit 1;

  if v_silk_id is null then
    insert into public.product_categories (name, slug, parent_id, active)
    values ('Silk Sarees', 'sarees-silk-sarees', v_sarees_id, true)
    on conflict (slug) do update set parent_id = v_sarees_id, active = true
    returning id into v_silk_id;
  end if;

  -- 3. Insert Product 1: Kanchipuram Silk Saree (KAN001)
  insert into public.products (
    sku, slug, name, category, subcategory_id, fabric, colour, saree_type, design,
    description, image_path, price_paise, compare_at_price_paise, discount_percent,
    stock_on_hand, min_stock_level, published, featured, archived
  )
  values (
    'KAN001',
    'kanchipuram-silk-saree-kan001',
    'Kanchipuram Silk Saree',
    'Sarees',
    v_silk_id,
    'Pure Silk',
    'Maroon',
    'Wedding Saree',
    'Bridal · Zari Work · 850g',
    'Traditional Kanchipuram silk saree with zari work. Occasion: Bridal. Weight: 850g.',
    '/assets/product-01.jpg',
    999900,
    1250000,
    0,
    10,
    2,
    true,
    true,
    false
  )
  on conflict (sku) do nothing;

  -- 4. Insert Product 2: Soft Silk Saree (SOF002)
  insert into public.products (
    sku, slug, name, category, subcategory_id, fabric, colour, saree_type, design,
    description, image_path, price_paise, compare_at_price_paise, discount_percent,
    stock_on_hand, min_stock_level, published, featured, archived
  )
  values (
    'SOF002',
    'soft-silk-saree-sof002',
    'Soft Silk Saree',
    'Sarees',
    v_silk_id,
    'Soft Silk',
    'Pastel Pink',
    'Traditional Saree',
    'Festive · Gold Border · 700g',
    'Pastel pink soft silk saree with elegant gold border. Occasion: Festive. Weight: 700g.',
    '/assets/product-02.jpg',
    450000,
    550000,
    0,
    15,
    2,
    true,
    true,
    false
  )
  on conflict (sku) do nothing;
end $$;
