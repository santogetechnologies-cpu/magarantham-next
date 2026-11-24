-- 202611230013_discounts_banners.sql
-- 1. Shared (POS + online) catalogue discounts gain an "all products" scope.
-- 2. Banners gain a mobile image, more storefront placements, category targeting and layout options.

-- ---------------------------------------------------------------------------
-- 1. Catalogue discounts: scope 'all' (no target)
-- ---------------------------------------------------------------------------
alter table public.catalog_discounts drop constraint if exists catalog_discounts_scope_check;
alter table public.catalog_discounts alter column target_id drop not null;
alter table public.catalog_discounts add constraint catalog_discounts_scope_check
  check (scope in ('all','category','subcategory','product'));
alter table public.catalog_discounts add constraint catalog_discounts_target_check
  check ((scope = 'all') = (target_id is null));

-- Highest active rule wins (product's own discount_percent included). Applies identically to
-- POS quotes/sales, online checkout and the storefront catalogue view.
create or replace function private.product_price(p public.products) returns int language sql stable security definer set search_path='' as $$
 select floor(p.price_paise::numeric*(10000-greatest(p.discount_percent*100,coalesce((
 select max(d.discount_bps) from public.catalog_discounts d left join public.product_categories s on s.id=p.subcategory_id
 where d.active and (d.starts_at is null or d.starts_at<=now()) and (d.ends_at is null or d.ends_at>now()) and
 (d.scope='all' or (d.scope='product' and d.target_id=p.id) or (d.scope='subcategory' and d.target_id=p.subcategory_id) or (d.scope='category' and d.target_id=s.parent_id))
 ),0)))/10000)::int;
$$;
revoke all on function private.product_price(public.products) from public,anon,authenticated;
grant execute on function private.product_price(public.products) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Banners: responsive images + placement
-- ---------------------------------------------------------------------------
alter table public.banners add column if not exists mobile_image_path text not null default '';
alter table public.banners add column if not exists category_id uuid references public.product_categories(id) on delete set null;
alter table public.banners add column if not exists text_align text not null default 'left';
alter table public.banners add column if not exists show_text boolean not null default true;
alter table public.banners add column if not exists theme text not null default 'dark';
alter table public.banners drop constraint if exists banners_position_check;
alter table public.banners add constraint banners_position_check
  check (position in ('home_hero','home','home_bottom','shop','category'));
alter table public.banners add constraint banners_text_align_check check (text_align in ('left','center','right'));
alter table public.banners add constraint banners_theme_check check (theme in ('dark','light'));

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
 when 'banners' then array['title','subtitle','image_path','mobile_image_path','button_label','link_path','position','category_id','text_align','show_text','theme','sort_order','published','starts_at','ends_at']
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
revoke all on function public.admin_save(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save(uuid,text,uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Payroll: an approved (not yet paid) salary can be reopened to draft so the
--    month's bonus / allowances / deductions can be edited again.
-- ---------------------------------------------------------------------------
create or replace function public.payroll_finalize(p_actor uuid,p_run uuid,p_action text,p_reference text,p_method text,p_checked boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.payroll_runs; calc jsonb; category uuid;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);
 select * into r from public.payroll_runs where id=p_run;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtext('payroll:'||r.employee_id::text||r.period::text));
 select * into r from public.payroll_runs where id=p_run for update;
 if p_action='approve' then
  if r.status in ('approved','paid') then return; end if;
  calc:=private.payroll_calculation(r.employee_id,r.period);
  if r.calculation_hash is null or r.calculation_hash<>encode(sha256(convert_to(calc::text,'UTF8')),'hex') then raise exception 'PAYROLL_STALE'; end if;
  update public.payroll_runs set status='approved',approved_by=p_actor,approved_at=now(),updated_at=now() where id=p_run;
 elsif p_action='reopen' then
  if r.status='draft' then return; end if;
  if r.status<>'approved' then raise exception 'PAYROLL_LOCKED'; end if;
  update public.payroll_runs set status='draft',approved_by=null,approved_at=null,updated_at=now() where id=p_run;
 elsif p_action='paid' then
  if r.status='paid' then if r.payment_reference<>p_reference or r.payment_method<>p_method then raise exception 'IDEMPOTENCY_CONFLICT'; end if;return;end if;
  if r.status<>'approved' or not p_checked or length(trim(p_reference)) not between 6 and 100 or p_method not in ('cash','upi','card','bank') then raise exception 'PAYROLL_PAYMENT_REQUIRED';end if;
  update public.payroll_runs set status='paid',paid_by=p_actor,paid_at=now(),payment_reference=p_reference,payment_method=p_method,updated_at=now() where id=p_run;
  select id into category from public.expense_categories where name='Payroll';
  if category is null then insert into public.expense_categories(name) values('Payroll') returning id into category;end if;
  if r.net_paise>0 then insert into public.expenses(request_key,fingerprint,category_id,expense_on,description,amount_paise,method,reference,payee,source,payroll_id,actor_id)
  values(p_run,'payroll:'||p_run::text,category,(now() at time zone 'Asia/Kolkata')::date,'Salary '||r.period::text,r.net_paise,p_method,p_reference,r.employee_snapshot->>'name','payroll',p_run,p_actor) on conflict(payroll_id)do nothing;end if;
 else raise exception 'INVALID_STATUS_CHANGE';end if;
 perform private.audit(p_actor,'payroll.'||p_action,'payroll_runs',p_run::text);
end $$;
revoke all on function public.payroll_finalize(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.payroll_finalize(uuid,uuid,text,text,text,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Online checkout honours festival-offer targets.
--    Previously an automatic offer aimed at one category was applied to the
--    whole cart (first offer by id). Now an offer only discounts the cart lines
--    it targets, and the automatic offer giving the biggest valid discount wins.
--    Line prices are still private.product_price(), i.e. the shared POS + online
--    catalogue discount, so the storefront, POS and checkout agree.
-- ---------------------------------------------------------------------------
-- The app lists offers newest first; the original table had no created_at column.
alter table public.offers add column if not exists created_at timestamptz not null default now();
alter table public.offers add column if not exists target_type text not null default 'all';
alter table public.offers add column if not exists priority int not null default 0;
create table if not exists public.offer_targets (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  target_type text not null check (target_type in ('category', 'subcategory', 'product')),
  category_id uuid references public.product_categories(id) on delete cascade,
  subcategory_id uuid references public.product_categories(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.offer_targets enable row level security;

create or replace function private.offer_applies(off public.offers, pr public.products) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(off.target_type,'all')='all' or exists(
  select 1 from public.offer_targets t left join public.product_categories s on s.id=pr.subcategory_id
  where t.offer_id=off.id and (
   (t.target_type='product' and t.product_id=pr.id) or
   (t.target_type='subcategory' and t.subcategory_id=pr.subcategory_id) or
   (t.target_type='category' and t.category_id=s.parent_id)));
$$;

-- Discount (paise) this offer gives this cart; 0 when it cannot be used.
create or replace function private.offer_discount(off public.offers, p_cart jsonb, p_subtotal bigint, p_customer uuid) returns bigint language plpgsql stable security definer set search_path='' as $$
declare eligible bigint; d bigint;
begin
 if off.id is null or not off.active or (off.starts_at is not null and off.starts_at>now()) or (off.ends_at is not null and off.ends_at<=now())
  or (off.max_uses is not null and off.used_count>=off.max_uses) or p_subtotal<off.min_subtotal_paise
  or (select count(*) from public.orders where customer_id=p_customer and offer_id=off.id and coupon_counted)>=off.per_customer_limit then return 0; end if;
 select coalesce(sum(private.product_price(pr)::bigint*(x->>'quantity')::int),0) into eligible
  from jsonb_array_elements(p_cart) x join public.products pr on pr.id=(x->>'product_id')::uuid
  where private.offer_applies(off,pr);
 if eligible<=0 then return 0; end if;
 d:=case when off.kind='percent' then floor(eligible::numeric*off.value/100)::bigint else least(eligible,off.value::bigint) end;
 return greatest(0,least(p_subtotal,d,coalesce(off.max_discount_paise::bigint,d)));
end $$;

create or replace function public.create_checkout(p_customer uuid,p_key uuid,p_cart jsonb,p_address jsonb,p_channel text,p_coupon text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.store_settings; o public.orders; pr public.products; off public.offers; cand public.offers; line record;
 fingerprint text; oid uuid:=gen_random_uuid(); subtotal bigint:=0; discount bigint:=0; shipping int; tax bigint; unit int; total bigint; selected_offer uuid; d bigint;
begin
 perform pg_advisory_xact_lock_shared(761117030);
 if not exists(select 1 from public.profiles where id=p_customer and not suspended) then raise exception 'ACCOUNT_DISABLED'; end if;
 select * into s from public.store_settings where id;
 if not s.ordering_enabled then raise exception 'ORDERING_DISABLED'; end if;
 if p_channel not in ('whatsapp','upi','razorpay') then raise exception 'INVALID_CHANNEL'; end if;
 if (p_channel='whatsapp' and (s.checkout_mode='online_only' or s.whatsapp_phone='')) or
 (p_channel<>'whatsapp' and s.checkout_mode='whatsapp_only') or
 (p_channel='upi' and (s.online_method<>'manual_upi' or s.upi_id='')) or
 (p_channel='razorpay' and s.online_method<>'razorpay_upi') then raise exception 'CHANNEL_DISABLED'; end if;
 if jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart) not between 1 and 20 then raise exception 'INVALID_CART'; end if;
 if jsonb_typeof(p_address)<>'object' or length(coalesce(p_address->>'name',''))<2 or length(coalesce(p_address->>'phone',''))<7 or length(coalesce(p_address->>'line1',''))<4 or coalesce(p_address->>'pin','')!~'^[1-9][0-9]{5}$' then raise exception 'INVALID_ADDRESS'; end if;
 fingerprint:=encode(sha256(convert_to(p_cart::text||p_address::text||p_channel||coalesce(p_coupon,''),'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext(p_customer::text));
 select * into o from public.orders where customer_id=p_customer and checkout_key=p_key;
 if found then if o.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return o.id; end if;
 if (select count(*) from public.orders where customer_id=p_customer and stock_state='reserved')>=5 then raise exception 'TOO_MANY_PENDING_ORDERS'; end if;
 if exists(select 1 from jsonb_array_elements(p_cart) x where jsonb_typeof(x->'quantity')<>'number' or (x->>'quantity')!~'^[0-9]+$' or (x->>'quantity')::numeric not between 1 and 20) then raise exception 'INVALID_QUANTITY'; end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_cart) x)<>jsonb_array_length(p_cart) then raise exception 'DUPLICATE_ITEM'; end if;
 if p_coupon is not null and trim(p_coupon)<>'' then
   select * into off from public.offers where code=upper(trim(p_coupon)) for update;
   if not found then raise exception 'INVALID_COUPON'; end if;
 end if;
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
   select * into pr from public.products where id=line.pid for update;
   if not found or not pr.published or not private.product_visible(pr) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
   if pr.price_paise<=0 then raise exception 'PRICE_NOT_SET'; end if;
   if pr.stock_on_hand-pr.reserved<line.qty then raise exception 'OUT_OF_STOCK'; end if;
   unit:=private.product_price(pr);
   subtotal:=subtotal+unit::bigint*line.qty;
 end loop;
 if p_coupon is not null and trim(p_coupon)<>'' then
   d:=private.offer_discount(off,p_cart,subtotal,p_customer);
   if d<=0 then raise exception 'COUPON_NOT_ELIGIBLE'; end if;
   selected_offer:=off.id; discount:=d;
 else
   -- Automatic offers are serialized under this lock; the best valid one wins.
   for cand in select * from public.offers where code is null and active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) and (max_uses is null or used_count<max_uses) order by priority desc, id for update loop
     d:=private.offer_discount(cand,p_cart,subtotal,p_customer);
     if d>discount then discount:=d; selected_offer:=cand.id; end if;
   end loop;
 end if;
 if selected_offer is not null then update public.offers set used_count=used_count+1 where id=selected_offer; end if;
 shipping:=case when s.free_shipping_above_paise>0 and subtotal-discount>=s.free_shipping_above_paise then 0 else s.shipping_paise end;
 tax:=round((subtotal-discount)::numeric*s.tax_bps/10000)::bigint;
 total:=subtotal-discount+shipping+tax;
 if total<=0 or total>2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;
 insert into public.orders(id,customer_id,checkout_key,request_hash,channel,address,subtotal_paise,discount_paise,shipping_paise,tax_paise,total_paise,offer_id,coupon_counted,expires_at)
 values(oid,p_customer,p_key,fingerprint,p_channel,p_address,subtotal,discount,shipping,tax,total,selected_offer,selected_offer is not null,now()+make_interval(mins=>s.reservation_minutes));
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
   select * into pr from public.products where id=line.pid;
   unit:=private.product_price(pr);
   insert into public.order_items(order_id,product_id,name,image_path,quantity,unit_price_paise,list_price_paise,line_total_paise) values(oid,pr.id,pr.name,pr.image_path,line.qty,unit,pr.price_paise,unit::bigint*line.qty);
   update public.products set reserved=reserved+line.qty where id=pr.id;
 end loop;
 insert into public.order_events(order_id,actor_id,message) values(oid,p_customer,'Order created. Waiting for payment.');
 perform private.notify(oid,'Order received','Your order was saved. Complete your selected payment step.');
 return oid;
end $$;
revoke all on function private.offer_applies(public.offers,public.products),private.offer_discount(public.offers,jsonb,bigint,uuid) from public,anon,authenticated;
revoke all on function public.create_checkout(uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_checkout(uuid,uuid,jsonb,jsonb,text,text) to service_role;
