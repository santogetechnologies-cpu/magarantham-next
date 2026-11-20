-- 202611200012_offer_targets.sql
-- Magarantham Silks: Category, Subcategory & Product-Wise Dynamic Offer System

-- 1. Extend offers table with targeting and priority fields
alter table public.offers
  add column if not exists target_type text not null default 'all' check (target_type in ('all', 'category', 'subcategory', 'product')),
  add column if not exists priority int not null default 0 check (priority >= 0),
  add column if not exists description text;

-- 2. Create offer_targets table for multi-entity targeting
create table if not exists public.offer_targets (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  target_type text not null check (target_type in ('category', 'subcategory', 'product')),
  category_id uuid references public.product_categories(id) on delete cascade,
  subcategory_id uuid references public.product_categories(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3. Indexes for fast target resolution
create index if not exists idx_offer_targets_offer on public.offer_targets(offer_id);
create index if not exists idx_offer_targets_cat on public.offer_targets(category_id) where category_id is not null;
create index if not exists idx_offer_targets_subcat on public.offer_targets(subcategory_id) where subcategory_id is not null;
create index if not exists idx_offer_targets_product on public.offer_targets(product_id) where product_id is not null;
create index if not exists idx_offers_priority on public.offers(priority desc, created_at desc);

-- 4. RLS policies for offer_targets
alter table public.offer_targets enable row level security;

create policy "offer_targets_read" on public.offer_targets for select using (true);
create policy "offer_targets_manage" on public.offer_targets for all using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);
