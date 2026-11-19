-- 202611170009_admin_erp_system.sql
-- Magarantham Silks: Complete Supabase Admin Dashboard & Enterprise ERP Schema Extensions

-- 1. Extend products table with saree-specific & inventory valuation attributes
alter table public.products
  add column if not exists saree_type text not null default 'Kanchipuram Silk',
  add column if not exists fabric text not null default 'Pure Mulberry Silk',
  add column if not exists design text not null default 'Traditional Zari Border',
  add column if not exists purchase_price_paise int not null default 0 check(purchase_price_paise >= 0),
  add column if not exists min_stock_level int not null default 3 check(min_stock_level >= 0),
  add column if not exists compare_at_price_paise int not null default 0 check(compare_at_price_paise >= 0);

-- 2. Product Images table (multi-image gallery with primary flag)
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_path text not null,
  alt text not null default '',
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_images_product on public.product_images(product_id);

-- 3. Extend employees table with profile & HR management fields
alter table public.employees
  add column if not exists email text not null default '',
  add column if not exists photo_url text not null default '',
  add column if not exists address text not null default '',
  add column if not exists emergency_contact text not null default '',
  add column if not exists designation text not null default 'Sales Executive',
  add column if not exists department text not null default 'Retail Sales',
  add column if not exists bank_details jsonb not null default '{}';

-- 4. Employee Leaves table
create table if not exists public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null check(leave_type in ('casual','sick','earned','paid','unpaid','emergency')),
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null check(days > 0),
  reason text not null default '',
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check(end_date >= start_date)
);

create index if not exists idx_employee_leaves_emp on public.employee_leaves(employee_id, start_date);

-- 5. Extend attendance table with timing, locking & shift fields
alter table public.attendance
  add column if not exists check_in text,
  add column if not exists check_out text,
  add column if not exists is_locked boolean not null default false,
  add column if not exists late_arrival boolean not null default false,
  add column if not exists early_departure boolean not null default false;

-- 6. Product Price History table for price audit trail
create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  old_price_paise int not null,
  new_price_paise int not null,
  old_discount_percent int not null default 0,
  new_discount_percent int not null default 0,
  change_reason text not null default 'manual_update',
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_price_history_product on public.product_price_history(product_id, created_at desc);

-- 7. Coupons management table
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code = upper(code)),
  offer_id uuid references public.offers(id) on delete cascade,
  description text not null default '',
  discount_type text not null check(discount_type in ('percent','fixed')),
  discount_value int not null check(discount_value > 0),
  min_purchase_paise int not null default 0,
  max_discount_paise int,
  max_uses int,
  used_count int not null default 0,
  per_customer_limit int not null default 1,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check(expires_at is null or starts_at is null or expires_at > starts_at)
);

-- 8. Inventory Adjustments & Stock Movement Tracking
create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  adjustment_type text not null check(adjustment_type in ('stock_in','stock_out','adjustment','transfer','damaged','returned')),
  delta int not null,
  previous_stock int not null,
  new_stock int not null,
  reason text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_inv_adjustments_product on public.inventory_adjustments(product_id, created_at desc);

-- 9. Storage Buckets for Products & Employees
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('products','products',true,5242880,array['image/jpeg','image/png','image/webp']),
  ('employees','employees',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

-- 10. Enable Row Level Security on newly created tables
alter table public.product_images enable row level security;
alter table public.employee_leaves enable row level security;
alter table public.product_price_history enable row level security;
alter table public.coupons enable row level security;
alter table public.inventory_adjustments enable row level security;

-- RLS Policies
create policy "product_images_read" on public.product_images for select using (true);
create policy "product_images_manage" on public.product_images for all using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);

create policy "employee_leaves_read" on public.employee_leaves for select using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);
create policy "employee_leaves_manage" on public.employee_leaves for all using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);

create policy "price_history_read" on public.product_price_history for select using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);

create policy "coupons_read" on public.coupons for select using (true);
create policy "coupons_manage" on public.coupons for all using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);

create policy "inv_adjustments_read" on public.inventory_adjustments for select using (
  exists(select 1 from public.profiles where id = auth.uid() and role in ('superadmin','manager'))
);

-- 11. Updated admin_save allowing extended product fields, coupons, and leaves
create or replace function public.admin_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cap text; key uuid:=coalesce(p_id,gen_random_uuid()); oldrow jsonb; stmt text; col text; vals text:=''; cols text:=''; allowed text[];
begin
 cap:=case p_entity
   when 'products' then 'catalogue'
   when 'banners' then 'content'
   when 'offers' then 'offers'
   when 'coupons' then 'offers'
   when 'employee_leaves' then 'attendance'
   when 'tracking_providers' then 'shipping'
   when 'bulk_inquiries' then 'bulk'
   when 'store_settings' then '__super'
   else null end;
 if cap is null or not private.can_actor(p_actor,cap) then raise exception 'FORBIDDEN'; end if;
 allowed:=case p_entity
 when 'products' then array['barcode','subcategory_id','sku','slug','name','category','colour','description','image_path','price_paise','discount_percent','published','archived','featured','saree_type','fabric','design','purchase_price_paise','min_stock_level','compare_at_price_paise']
 when 'banners' then array['title','subtitle','image_path','button_label','link_path','position','sort_order','published','starts_at','ends_at']
 when 'offers' then array['title','code','kind','value','min_subtotal_paise','max_discount_paise','max_uses','per_customer_limit','active','starts_at','ends_at']
 when 'coupons' then array['code','description','discount_type','discount_value','min_purchase_paise','max_discount_paise','max_uses','per_customer_limit','starts_at','expires_at','active']
 when 'employee_leaves' then array['employee_id','leave_type','start_date','end_date','days','reason','status']
 when 'tracking_providers' then array['name','url_template','enabled']
 when 'bulk_inquiries' then array['status']
 when 'store_settings' then array['brand_name','tagline','support_email','support_phone','bulk_phone','bulk_min_quantity','whatsapp_phone','checkout_mode','online_method','upi_id','upi_name','ordering_enabled','shipping_paise','free_shipping_above_paise','tax_bps','reservation_minutes','announcement','hero_title','hero_text','hero_image','logo_image'] end;
 if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(allowed)) or p_data='{}' then raise exception 'INVALID_FIELDS'; end if;
 if p_entity='store_settings' then
   select to_jsonb(s) into oldrow from public.store_settings s where id for update;
 else execute format('select to_jsonb(t) from public.%I t where id=$1 for update',p_entity) into oldrow using key; end if;
 if p_entity='bulk_inquiries' and oldrow is null then raise exception 'NOT_FOUND'; end if;
 for col in select jsonb_object_keys(p_data) order by 1 loop
   cols:=cols||case when cols='' then '' else ',' end||format('%I',col);
   vals:=vals||case when vals='' then '' else ',' end||format('%I=x.%I',col,col);
 end loop;
 if oldrow is not null then
   stmt:=format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) x where t.id=%s',p_entity,vals,p_entity,case when p_entity='store_settings' then 'true' else '$2' end);
   execute stmt using p_data,key;
 else
   stmt:=format('insert into public.%I(id,%s) select $2,%s from jsonb_populate_record(null::public.%I,$1) x',p_entity,cols,cols,p_entity);
   execute stmt using p_data,key;
 end if;
 perform private.audit(p_actor,'configuration.saved',p_entity,case when p_entity='store_settings' then 'store' else key::text end,p_data);
 return key;
end;
$$;
