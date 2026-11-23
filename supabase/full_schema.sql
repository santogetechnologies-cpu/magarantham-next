-- === 202611160001_store.sql ===
-- Apply as the project database owner. No customer/staff browser can mutate commerce tables.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create type public.app_role as enum ('customer','manager','superadmin');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null default '', display_name text not null default '',
 role public.app_role not null default 'customer', suspended boolean not null default false,
 permissions text[] not null default array['catalogue','inventory','orders','payments','content','offers','shipping','bulk'],
 created_at timestamptz not null default now()
);
create function public.reject_public_signup(event jsonb) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Please create your account through the store website.'));
$$;
revoke all on function public.reject_public_signup(jsonb) from public,anon,authenticated;
grant execute on function public.reject_public_signup(jsonb) to supabase_auth_admin;
-- REQUIRED: native signups OFF + configure reject_public_signup as Before User Created hook.
-- Admin API creation bypasses that public-signup hook. It applies app_metadata after INSERT,
-- inside the same transaction; the protected UPDATE trigger below handles that ordering.
create function private.sync_auth_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.app_role;
begin
 if tg_op='UPDATE' and new.email is distinct from old.email then update public.profiles set email=coalesce(new.email,'') where id=new.id; end if;
 if tg_op='UPDATE' and (new.raw_app_meta_data->'store_role') is not distinct from (old.raw_app_meta_data->'store_role') then return new; end if;
 if new.raw_app_meta_data ? 'store_role' then
   if new.raw_app_meta_data->>'store_role' not in ('customer','manager','superadmin') or new.raw_app_meta_data->>'store_role' is null then
     raise exception 'INVALID_PROTECTED_ROLE';
   end if;
   r := (new.raw_app_meta_data->>'store_role')::public.app_role;
 elsif tg_op='INSERT' then r := 'superadmin';
 else raise exception 'PROTECTED_ROLE_CANNOT_BE_REMOVED'; end if;
 insert into public.profiles(id,email,display_name,role)
 values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'name',''),80),r)
 on conflict(id) do update set role=excluded.role,email=excluded.email;
 return new;
end $$;
create trigger store_auth_insert after insert on auth.users for each row execute function private.sync_auth_profile();
create trigger store_auth_role_update after update of raw_app_meta_data,email on auth.users for each row execute function private.sync_auth_profile();
create function private.can_actor(actor uuid,cap text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=actor and not p.suspended and (p.role='superadmin' or (p.role='manager' and cap=any(p.permissions))));
$$;
create function public.staff_access(cap text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal','')='aal2' and private.can_actor(auth.uid(),cap);
$$;
revoke all on function public.staff_access(text) from public;
grant execute on function public.staff_access(text) to authenticated;
create table public.store_settings (
 id boolean primary key default true check(id), brand_name text not null default 'மகரந்தம் சில்க்ஸ்',
 tagline text not null default 'Sarees for every occasion.', support_email text not null default '',
 support_phone text not null default '', bulk_phone text not null default '', bulk_min_quantity int not null default 10 check(bulk_min_quantity>0),
 whatsapp_phone text not null default '', checkout_mode text not null default 'whatsapp_only' check(checkout_mode in ('whatsapp_only','online_only','both')),
 online_method text not null default 'manual_upi' check(online_method in ('manual_upi','razorpay_upi')),
 upi_id text not null default '', upi_name text not null default '', ordering_enabled boolean not null default false,
 shipping_paise int not null default 0 check(shipping_paise>=0), free_shipping_above_paise int not null default 0 check(free_shipping_above_paise>=0),
 tax_bps int not null default 0 check(tax_bps between 0 and 10000), reservation_minutes int not null default 60 check(reservation_minutes between 10 and 1440),
 announcement text not null default 'Silk, cotton, bridal and more. View all 20 styles.',
 hero_title text not null default 'Sarees for every occasion.', hero_text text not null default 'Silk, cotton, bridal and more. Find a saree you love.',
 hero_image text not null default '/assets/hero.jpg', logo_image text not null default '/assets/brand-logo.png',
 updated_at timestamptz not null default now()
);
insert into public.store_settings(id) values(true);
create table public.products (
 id uuid primary key default gen_random_uuid(), sku text not null unique, slug text not null unique,
 name text not null, category text not null, colour text not null, description text not null default '',
 image_path text not null, price_paise int not null default 0 check(price_paise between 0 and 100000000),
 discount_percent int not null default 0 check(discount_percent between 0 and 90),
 stock_on_hand int not null default 0 check(stock_on_hand>=0), reserved int not null default 0 check(reserved>=0 and reserved<=stock_on_hand),
 published boolean not null default false, archived boolean not null default false, featured boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.banners (
 id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null default '', image_path text not null,
 button_label text not null default 'Shop sarees', link_path text not null default '/shop',
 position text not null default 'home' check(position in ('home','shop')), sort_order int not null default 0,
 published boolean not null default false, starts_at timestamptz, ends_at timestamptz,
 created_at timestamptz not null default now(), check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create table public.offers (
 id uuid primary key default gen_random_uuid(), title text not null, code text unique,
 kind text not null check(kind in ('percent','fixed')), value int not null check(value>0),
 min_subtotal_paise int not null default 0 check(min_subtotal_paise>=0), max_discount_paise int check(max_discount_paise>=0),
 max_uses int check(max_uses>0), used_count int not null default 0 check(used_count>=0), per_customer_limit int not null default 1 check(per_customer_limit>0),
 active boolean not null default false, starts_at timestamptz, ends_at timestamptz,
 target_type text not null default 'all' check (target_type in ('all', 'category', 'subcategory', 'product')),
 priority int not null default 0 check (priority >= 0),
 description text,
 check(kind<>'percent' or value<=90), check(ends_at is null or starts_at is null or ends_at>starts_at),
 check(code is null or code=upper(code))
);
create table public.offer_targets (
 id uuid primary key default gen_random_uuid(),
 offer_id uuid not null references public.offers(id) on delete cascade,
 target_type text not null check (target_type in ('category', 'subcategory', 'product')),
 category_id uuid references public.product_categories(id) on delete cascade,
 subcategory_id uuid references public.product_categories(id) on delete cascade,
 product_id uuid references public.products(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table public.tracking_providers (
 id uuid primary key default gen_random_uuid(), name text not null, url_template text not null default '', enabled boolean not null default true
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 customer_id uuid not null references public.profiles(id), checkout_key uuid not null, request_hash text not null,
 channel text not null check(channel in ('whatsapp','upi','razorpay')),
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','confirmed','packing','shipped','delivered','cancelled','expired','review_required','return_requested','returned')),
 payment_status text not null default 'pending' check(payment_status in ('pending','submitted','paid','failed','late_paid','refund_pending','refunded')),
 stock_state text not null default 'reserved' check(stock_state in ('reserved','consumed','released')),
 address jsonb not null, subtotal_paise bigint not null, discount_paise bigint not null default 0,
 shipping_paise int not null, tax_paise bigint not null, total_paise bigint not null check(total_paise>0),
 offer_id uuid references public.offers(id), coupon_counted boolean not null default false,
 provider_order_id text unique, provider_payment_id text unique, payment_reference text,
 tracking_provider_id uuid references public.tracking_providers(id), tracking_id text not null default '',
 expires_at timestamptz not null, paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(customer_id,checkout_key)
);
create unique index unique_manual_reference on public.orders(lower(payment_reference)) where payment_reference is not null and payment_reference<>'';
create index orders_customer_created on public.orders(customer_id,created_at desc);
create index orders_pending_expiry on public.orders(expires_at) where stock_state='reserved';
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), product_id uuid not null references public.products(id),
 name text not null, image_path text not null, quantity int not null check(quantity between 1 and 20),
 unit_price_paise int not null, list_price_paise int not null, line_total_paise bigint not null, unique(order_id,product_id)
);
create table public.order_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), actor_id uuid,
 message text not null, customer_visible boolean not null default true, created_at timestamptz not null default now()
);
create table public.payment_proofs (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), customer_id uuid not null references public.profiles(id),
 storage_path text not null, reference text not null, created_at timestamptz not null default now()
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id), actor_id uuid,
 order_id uuid references public.orders(id), delta int not null, reason text not null, created_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), order_id uuid references public.orders(id),
 title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.wishlist (customer_id uuid references public.profiles(id) on delete cascade,product_id uuid references public.products(id) on delete cascade,primary key(customer_id,product_id));
create table public.addresses (id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.profiles(id) on delete cascade,label text not null,address jsonb not null,created_at timestamptz not null default now());
create table public.bulk_inquiries (id uuid primary key default gen_random_uuid(),customer_id uuid references public.profiles(id),name text not null,phone text not null,quantity int not null check(quantity>0),message text not null,status text not null default 'new' check(status in ('new','contacted','closed')),created_at timestamptz not null default now());
create table public.audit_log (id uuid primary key default gen_random_uuid(),actor_id uuid,action text not null,entity text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now());
create table private.payment_events (event_id text primary key,created_at timestamptz not null default now());
create table private.rate_limits (key text primary key,window_start timestamptz not null,count int not null);
create table private.email_outbox (id uuid primary key default gen_random_uuid(),customer_id uuid not null,title text not null,body text not null,attempts int not null default 0,available_at timestamptz not null default now(),state text not null default 'pending');
create table public.refunds (id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),provider_refund_id text unique,status text not null default 'requested' check(status in ('requested','processing','processed','manual_review')),reference text,note text not null,created_at timestamptz not null default now());
create function private.audit(actor uuid,action_name text,entity_name text,entity_key text,extra jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into public.audit_log(actor_id,action,entity,entity_id,details) values(actor,action_name,entity_name,entity_key,extra);
$$;
create function private.notify(order_key uuid,title_text text,body_text text) returns void language plpgsql security definer set search_path='' as $$
declare customer uuid;
begin
 select customer_id into customer from public.orders where id=order_key;
 insert into public.notifications(customer_id,order_id,title,body) values(customer,order_key,title_text,body_text);
 insert into private.email_outbox(customer_id,title,body) values(customer,title_text,body_text);
end $$;
create function public.consume_rate_limit(p_key text,p_limit int,p_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare c int;
begin
 insert into private.rate_limits(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set count=case when private.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else private.rate_limits.count+1 end,
 window_start=case when private.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else private.rate_limits.window_start end returning count into c;
 return c<=p_limit;
end $$;

-- Lock order: offers, then products in UUID order. Reserve and compute all money here.
create function public.create_checkout(p_customer uuid,p_key uuid,p_cart jsonb,p_address jsonb,p_channel text,p_coupon text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.store_settings; o public.orders; pr public.products; off public.offers; line record;
 fingerprint text; oid uuid:=gen_random_uuid(); subtotal bigint:=0; discount bigint:=0; shipping int; tax bigint; unit int; total bigint; selected_offer uuid;
begin
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
 -- Serializes limited-use coupons. Automatic offers are checked again under this lock.
 if p_coupon is not null and trim(p_coupon)<>'' then
   select * into off from public.offers where code=upper(trim(p_coupon)) for update;
   if not found then raise exception 'INVALID_COUPON'; end if;
 else
   select * into off from public.offers where code is null and active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) and (max_uses is null or used_count<max_uses) order by id limit 1 for update;
 end if;
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
   select * into pr from public.products where id=line.pid for update;
   if not found or not pr.published or pr.archived then raise exception 'PRODUCT_UNAVAILABLE'; end if;
   if pr.price_paise<=0 then raise exception 'PRICE_NOT_SET'; end if;
   if pr.stock_on_hand-pr.reserved<line.qty then raise exception 'OUT_OF_STOCK'; end if;
   unit:=floor(pr.price_paise::numeric*(100-pr.discount_percent)/100)::int;
   subtotal:=subtotal+unit::bigint*line.qty;
 end loop;
 if off.id is not null then
   if not off.active or (off.starts_at is not null and off.starts_at>now()) or (off.ends_at is not null and off.ends_at<=now()) or (off.max_uses is not null and off.used_count>=off.max_uses) or subtotal<off.min_subtotal_paise or
   (select count(*) from public.orders where customer_id=p_customer and offer_id=off.id and coupon_counted)>=off.per_customer_limit then
      if p_coupon is not null and trim(p_coupon)<>'' then raise exception 'COUPON_NOT_ELIGIBLE'; end if;
   else
     selected_offer:=off.id;
     discount:=case when off.kind='percent' then floor(subtotal::numeric*off.value/100)::bigint else off.value end;
     discount:=least(subtotal,discount,coalesce(off.max_discount_paise,discount));
     update public.offers set used_count=used_count+1 where id=off.id;
   end if;
 end if;
 shipping:=case when s.free_shipping_above_paise>0 and subtotal-discount>=s.free_shipping_above_paise then 0 else s.shipping_paise end;
 tax:=round((subtotal-discount)::numeric*s.tax_bps/10000)::bigint;
 total:=subtotal-discount+shipping+tax;
 if total<=0 or total>2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;
 insert into public.orders(id,customer_id,checkout_key,request_hash,channel,address,subtotal_paise,discount_paise,shipping_paise,tax_paise,total_paise,offer_id,coupon_counted,expires_at)
 values(oid,p_customer,p_key,fingerprint,p_channel,p_address,subtotal,discount,shipping,tax,total,selected_offer,selected_offer is not null,now()+make_interval(mins=>s.reservation_minutes));
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
   select * into pr from public.products where id=line.pid;
   unit:=floor(pr.price_paise::numeric*(100-pr.discount_percent)/100)::int;
   insert into public.order_items(order_id,product_id,name,image_path,quantity,unit_price_paise,list_price_paise,line_total_paise) values(oid,pr.id,pr.name,pr.image_path,line.qty,unit,pr.price_paise,unit::bigint*line.qty);
   update public.products set reserved=reserved+line.qty where id=pr.id;
 end loop;
 insert into public.order_events(order_id,actor_id,message) values(oid,p_customer,'Order created. Waiting for payment.');
 perform private.notify(oid,'Order received','Your order was saved. Complete your selected payment step.');
 return oid;
end $$;

create function private.release_stock(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record;
begin
 select * into o from public.orders where id=p_order for update;
 if o.stock_state<>'reserved' then return; end if;
 if o.coupon_counted then perform 1 from public.offers where id=o.offer_id for update; end if;
 for line in select * from public.order_items where order_id=p_order order by product_id loop
   perform 1 from public.products where id=line.product_id for update;
   update public.products set reserved=reserved-line.quantity where id=line.product_id;
 end loop;
 update public.orders set stock_state='released',coupon_counted=false where id=p_order;
 if o.coupon_counted then update public.offers set used_count=greatest(0,used_count-1) where id=o.offer_id; end if;
end $$;
create function public.expire_reservations() returns int language plpgsql security definer set search_path='' as $$
declare o record; n int:=0;
begin
 for o in select id from public.orders where stock_state='reserved' and expires_at<=now() order by expires_at limit 1 for update skip locked loop
   perform private.release_stock(o.id);
   update public.orders set status='expired',updated_at=now() where id=o.id;
   insert into public.order_events(order_id,message) values(o.id,'The payment time ended. Stock has been released.');
   n:=n+1;
 end loop;
 delete from private.rate_limits where window_start<now()-interval '2 days';
 return n;
end $$;
create function public.record_payment(p_order uuid,p_event text,p_payment text,p_amount bigint,p_currency text,p_method text,p_actor uuid default null,p_reference text default null) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; manual boolean:=p_actor is not null;
begin
 if manual and not private.can_actor(p_actor,'payments') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount<>o.total_paise or p_currency<>'INR' then raise exception 'PAYMENT_MISMATCH'; end if;
 if manual and o.channel='razorpay' then raise exception 'GATEWAY_VERIFICATION_REQUIRED'; end if;
 if not manual and (o.channel<>'razorpay' or p_method<>'upi') then raise exception 'PAYMENT_METHOD_MISMATCH'; end if;
 if manual and length(coalesce(p_reference,''))<6 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
 insert into private.payment_events(event_id) values(p_event) on conflict do nothing;
 if not found then return o.payment_status; end if;
 if o.payment_status in ('paid','refund_pending','refunded','late_paid') then return o.payment_status; end if;
 if o.stock_state<>'reserved' or o.expires_at<=now() then
   perform private.release_stock(p_order);
   update public.orders set status='review_required',payment_status='late_paid',provider_payment_id=case when manual then null else p_payment end,payment_reference=p_reference,paid_at=now(),updated_at=now() where id=p_order;
   insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Payment arrived after the reservation ended. Staff will review and arrange a refund.');
   perform private.notify(p_order,'Payment needs review','Your payment arrived after the stock hold ended. Please contact the store.');
   return 'late_paid';
 end if;
 for line in select * from public.order_items where order_id=p_order order by product_id loop
   perform 1 from public.products where id=line.product_id for update;
   update public.products set stock_on_hand=stock_on_hand-line.quantity,reserved=reserved-line.quantity where id=line.product_id;
   insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,-line.quantity,'Paid order');
 end loop;
 update public.orders set payment_status='paid',status='confirmed',stock_state='consumed',provider_payment_id=case when manual then null else p_payment end,payment_reference=p_reference,paid_at=now(),updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Payment checked. Order confirmed.');
 perform private.audit(p_actor,'payment.confirmed','orders',p_order::text,jsonb_build_object('manual',manual));
 perform private.notify(p_order,'Order confirmed','Your payment is confirmed. We will prepare your sarees.');
 return 'paid';
end $$;

create function public.adjust_stock(p_actor uuid,p_product uuid,p_delta int,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
 if not private.can_actor(p_actor,'inventory') then raise exception 'FORBIDDEN'; end if;
 if p_delta=0 or length(trim(p_reason))<3 then raise exception 'REASON_REQUIRED'; end if;
 select * into p from public.products where id=p_product for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 if p.stock_on_hand+p_delta<p.reserved then raise exception 'STOCK_BELOW_RESERVED'; end if;
 update public.products set stock_on_hand=stock_on_hand+p_delta,updated_at=now() where id=p_product;
 insert into public.inventory_movements(product_id,actor_id,delta,reason) values(p_product,p_actor,p_delta,p_reason);
 perform private.audit(p_actor,'stock.adjusted','products',p_product::text,jsonb_build_object('delta',p_delta,'reason',p_reason));
end $$;
create function public.change_order_status(p_actor uuid,p_order uuid,p_status text,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record;
begin
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if not private.can_actor(p_actor,'orders') then
   if o.customer_id<>p_actor or not ((p_status='cancelled' and o.status='awaiting_payment') or (p_status='return_requested' and o.status='delivered')) then raise exception 'FORBIDDEN'; end if;
 end if;
 if p_status='cancelled' and o.status in ('awaiting_payment','confirmed','packing') then
   if o.stock_state='reserved' then perform private.release_stock(p_order);
   elsif o.stock_state='consumed' then
     for line in select * from public.order_items where order_id=p_order order by product_id loop
       perform 1 from public.products where id=line.product_id for update;
       update public.products set stock_on_hand=stock_on_hand+line.quantity where id=line.product_id;
       insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,line.quantity,'Cancelled before shipping');
     end loop;
     update public.orders set stock_state='released' where id=p_order;
   end if;
   if o.payment_status='paid' then update public.orders set payment_status='refund_pending' where id=p_order; end if;
 elsif p_status='packing' and o.status='confirmed' and o.payment_status='paid' then null;
 elsif p_status='shipped' and o.status='packing' and o.payment_status='paid' and o.tracking_id<>'' then null;
 elsif p_status='delivered' and o.status='shipped' and o.payment_status='paid' then null;
 elsif p_status='return_requested' and o.status='delivered' then null;
 elsif p_status='returned' and o.status='return_requested' and o.stock_state='consumed' and length(trim(p_note))>=3 then
   for line in select * from public.order_items where order_id=p_order order by product_id loop
     perform 1 from public.products where id=line.product_id for update;
     update public.products set stock_on_hand=stock_on_hand+line.quantity where id=line.product_id;
     insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,line.quantity,'Return received: '||p_note);
   end loop;
   update public.orders set stock_state='released',payment_status='refund_pending' where id=p_order;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set status=p_status,updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Order status: '||replace(p_status,'_',' ')||case when p_note<>'' then '. '||p_note else '' end);
 perform private.audit(p_actor,'order.status','orders',p_order::text,jsonb_build_object('status',p_status));
 perform private.notify(p_order,'Order update','Your order status is now '||replace(p_status,'_',' ')||'.');
end $$;

-- Every business mutation uses a server-validated service-role endpoint/RPC.
do $$ declare t text; begin
 foreach t in array array['profiles','store_settings','products','banners','offers','tracking_providers','orders','order_items','order_events','payment_proofs','inventory_movements','notifications','wishlist','addresses','bulk_inquiries','audit_log','refunds'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from anon,authenticated',t);
   execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;
grant select on public.profiles,public.orders,public.order_items,public.order_events,public.notifications,public.wishlist,public.addresses to authenticated;
create policy profile_self on public.profiles for select to authenticated using(id=auth.uid());
create policy orders_self on public.orders for select to authenticated using(customer_id=auth.uid() or public.staff_access('orders'));
create policy items_self on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or public.staff_access('orders'))));
create policy events_self on public.order_events for select to authenticated using((customer_visible and exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid())) or public.staff_access('orders'));
create policy notification_self on public.notifications for select to authenticated using(customer_id=auth.uid());
create policy wishlist_self on public.wishlist for select to authenticated using(customer_id=auth.uid());
create policy address_self on public.addresses for select to authenticated using(customer_id=auth.uid());
-- SECURITY DEFINER RPCs are never exposed to anonymous/authenticated callers.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.consume_rate_limit(text,int,int),public.create_checkout(uuid,uuid,jsonb,jsonb,text,text),public.expire_reservations(),public.record_payment(uuid,text,text,bigint,text,text,uuid,text),public.adjust_stock(uuid,uuid,int,text),public.change_order_status(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,int,int),public.create_checkout(uuid,uuid,jsonb,jsonb,text,text),public.expire_reservations(),public.record_payment(uuid,text,text,bigint,text,text,uuid,text),public.adjust_stock(uuid,uuid,int,text),public.change_order_status(uuid,uuid,text,text) to service_role;


-- === 202611160002_operations.sql ===
-- Durable provider hand-offs and auditable privileged configuration.
alter table public.orders add column gateway_state text not null default 'new' check(gateway_state in ('new','creating','ready','review'));
create function public.admin_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cap text; key uuid:=coalesce(p_id,gen_random_uuid()); oldrow jsonb; stmt text; col text; vals text:=''; cols text:=''; allowed text[];
begin
 cap:=case p_entity when 'products' then 'catalogue' when 'banners' then 'content' when 'offers' then 'offers' when 'tracking_providers' then 'shipping' when 'bulk_inquiries' then 'bulk' when 'store_settings' then '__super' else null end;
 if cap is null or not private.can_actor(p_actor,cap) then raise exception 'FORBIDDEN'; end if;
 allowed:=case p_entity
 when 'products' then array['sku','slug','name','category','colour','description','image_path','price_paise','discount_percent','published','archived','featured']
 when 'banners' then array['title','subtitle','image_path','button_label','link_path','position','sort_order','published','starts_at','ends_at']
 when 'offers' then array['title','code','kind','value','min_subtotal_paise','max_discount_paise','max_uses','per_customer_limit','active','starts_at','ends_at']
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
end $$;
create function public.set_tracking(p_actor uuid,p_order uuid,p_provider uuid,p_tracking text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_actor(p_actor,'shipping') then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.tracking_providers where id=p_provider and enabled) or length(trim(p_tracking)) not between 2 and 100 then raise exception 'INVALID_TRACKING'; end if;
 perform 1 from public.orders where id=p_order and status in ('confirmed','packing','shipped') for update;
 if not found then raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set tracking_provider_id=p_provider,tracking_id=trim(p_tracking),updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Tracking information added: '||trim(p_tracking));
 perform private.audit(p_actor,'tracking.updated','orders',p_order::text);
 perform private.notify(p_order,'Tracking update','You can now view tracking in your order.');
end $$;
create function public.submit_payment_proof(p_customer uuid,p_order uuid,p_path text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order and customer_id=p_customer for update;
 if not found or o.channel='razorpay' or o.status not in ('awaiting_payment','expired','cancelled') or o.payment_status not in ('pending','submitted','failed') then raise exception 'PROOF_NOT_ALLOWED'; end if;
 insert into public.payment_proofs(order_id,customer_id,storage_path,reference) values(p_order,p_customer,p_path,p_reference);
 update public.orders set payment_status='submitted' where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_customer,'Payment proof submitted. Waiting for a bank check.');
end $$;
create function public.gateway_claim(p_customer uuid,p_order uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.orders set gateway_state='creating' where id=p_order and customer_id=p_customer and channel='razorpay' and status='awaiting_payment' and expires_at>now() and gateway_state='new';
 return found;
end $$;
create function public.refund_begin(p_actor uuid,p_order uuid,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders; key uuid;
begin
 if not private.can_actor(p_actor,'payments') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_order for update;
 if o.payment_status not in ('refund_pending','late_paid') or length(trim(p_note))<3 then raise exception 'REFUND_NOT_ALLOWED'; end if;
 if o.channel<>'razorpay' then
   select id into key from public.refunds where order_id=p_order;
   if found then
     perform private.audit(p_actor,'refund.manual_recovery','orders',p_order::text);
     return key;
   end if;
 end if;
 insert into public.refunds(order_id,status,note) values(p_order,'processing',p_note) returning id into key;
 perform private.audit(p_actor,'refund.started','orders',p_order::text);
 return key;
end $$;
create function public.refund_complete(p_order uuid,p_provider text,p_reference text,p_event text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.payment_status not in ('refund_pending','late_paid','refunded') then raise exception 'REFUND_NOT_ALLOWED'; end if;
 if o.payment_status='refunded' then return; end if;
 insert into private.payment_events(event_id) values(p_event) on conflict do nothing;
 if not found then return; end if;
 update public.refunds set status='processed',provider_refund_id=p_provider,reference=p_reference where order_id=p_order;
 if not found then raise exception 'REFUND_NOT_STARTED'; end if;
 update public.orders set payment_status='refunded',updated_at=now() where id=p_order;
 insert into public.order_events(order_id,message) values(p_order,'Full refund completed.');
 perform private.notify(p_order,'Refund completed','Your full refund has been recorded. Bank processing may take additional time.');
end $$;
create function public.staff_update(p_actor uuid,p_user uuid,p_permissions text[],p_suspended boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(761116001);
 if not exists(select 1 from public.profiles where id=p_actor and role='superadmin' and not suspended) or p_actor=p_user then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.profiles where id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if exists(select 1 from public.profiles where id=p_user and role='superadmin') and p_suspended and (select count(*) from public.profiles where role='superadmin' and not suspended)<=1 then raise exception 'LAST_SUPERADMIN'; end if;
 update public.profiles set permissions=p_permissions,suspended=p_suspended where id=p_user;
 perform private.audit(p_actor,'staff.updated','profiles',p_user::text,jsonb_build_object('permissions',p_permissions,'suspended',p_suspended));
end $$;
create function public.email_claim() returns table(id uuid,email text,title text,body text,attempts int) language sql security definer set search_path='' as $$
 with picked as (select e.id from private.email_outbox e where e.state='pending' and e.available_at<=now() and e.attempts<5 order by available_at for update skip locked limit 25), claimed as (update private.email_outbox e set state='sending',attempts=e.attempts+1,available_at=now()+interval '5 minutes' from picked where e.id=picked.id returning e.*)
 select c.id,p.email,c.title,c.body,c.attempts from claimed c join public.profiles p on p.id=c.customer_id;
$$;
create function public.email_finish(p_id uuid,p_success boolean) returns void language sql security definer set search_path='' as $$
 update private.email_outbox set state=case when p_success then 'sent' else 'pending' end,available_at=now()+interval '10 minutes' where id=p_id;
$$;
create function public.email_recover() returns void language sql security definer set search_path='' as $$
 update private.email_outbox set state='pending' where state='sending' and available_at<now();
$$;
create function public.tracking_event(p_event text,p_order uuid,p_tracking text,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.tracking_id<>p_tracking or o.payment_status<>'paid' then raise exception 'TRACKING_MISMATCH'; end if;
 insert into private.payment_events(event_id) values('tracking:'||p_event) on conflict do nothing;
 if not found or o.status=p_status then return; end if;
 if not ((o.status='packing' and p_status='shipped') or (o.status='shipped' and p_status='delivered')) then raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set status=p_status,updated_at=now() where id=p_order;
 insert into public.order_events(order_id,message) values(p_order,'Carrier update: '||p_status);
 perform private.notify(p_order,'Shipping update','Your order is now '||p_status||'.');
end $$;
-- No browser access to operational RPCs, including SECURITY DEFINER functions.
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.staff_access(text) to authenticated;
grant execute on function public.reject_public_signup(jsonb) to supabase_auth_admin;
grant execute on all functions in schema public to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('store-media','store-media',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Intentionally no storage write/read policies for client JWTs. Service endpoints authorize every upload/signed URL.


-- === 202611170003_pos_payroll.sql ===
-- In-store sales share inventory with the online checkout. Payroll is superadmin-only.
alter table public.products add column barcode text unique check(barcode is null or (length(barcode) between 1 and 48 and barcode ~ '^[ -~]+$'));
update public.products set barcode=sku where length(sku) between 1 and 48 and sku ~ '^[ -~]+$';
alter table public.profiles alter column permissions set default array['catalogue','inventory','orders','payments','content','offers','shipping','bulk','pos'];
create table public.pos_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 business_name text not null default 'மகரந்தம் சில்க்ஸ்', business_english text not null default 'MAGARANTHAM SILKS',
 address text not null default '', phone text not null default '', gstin text not null default '',
 invoice_prefix text not null default 'MS-POS', receipt_footer text not null default 'Thank you. Please keep your bill.',
 tax_bps int not null default 0 check(tax_bps between 0 and 10000), max_discount_bps int not null default 0 check(max_discount_bps between 0 and 9000),
 paper_mm int not null default 80 check(paper_mm in (58,80)), updated_at timestamptz not null default now()
);
insert into public.pos_settings(id) values(true);
create table public.pos_sales (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 cashier_id uuid not null references public.profiles(id), request_key uuid not null, request_hash text not null,
 invoice_no text not null unique, customer_name text not null default '', customer_phone text not null default '',
 status text not null default 'completed' check(status in ('completed','returned')),
 business jsonb not null, items jsonb not null, tenders jsonb not null, subtotal_paise bigint not null,
 discount_paise bigint not null, tax_paise bigint not null, total_paise bigint not null check(total_paise>0),
 cash_received_paise bigint not null, change_paise bigint not null check(change_paise>=0),
 returned_by uuid, return_note text, refund_reference text, returned_at timestamptz,
 created_at timestamptz not null default now(), unique(cashier_id,request_key)
);
create index pos_sales_date on public.pos_sales(created_at desc);
create table public.employees (
 id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
 employment text not null check(employment in ('full_time','part_time')), pay_basis text not null check(pay_basis in ('monthly','daily','hourly')),
 rate_paise int not null check(rate_paise between 0 and 100000000), scheduled_units numeric(8,2) not null default 26 check(scheduled_units>0 and scheduled_units<=744),
 overtime_rate_paise int not null default 0 check(overtime_rate_paise between 0 and 10000000),
 allowances jsonb not null default '[]', deductions jsonb not null default '[]', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payroll_runs (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id), period date not null check(extract(day from period)=1),
 employee_snapshot jsonb not null, worked_units numeric(8,2) not null, overtime_units numeric(8,2) not null,
 allowances jsonb not null, deductions jsonb not null, base_paise bigint not null, overtime_paise bigint not null,
 allowance_paise bigint not null, deduction_paise bigint not null, gross_paise bigint not null, net_paise bigint not null check(net_paise>=0),
 status text not null default 'draft' check(status in ('draft','approved','paid')), created_by uuid not null,
 approved_by uuid, approved_at timestamptz, paid_by uuid, paid_at timestamptz, payment_reference text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(employee_id,period)
);
create function private.require_super(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.profiles where id=p_actor and role='superadmin' and not suspended) then raise exception 'FORBIDDEN'; end if; end $$;
create function private.pay_components(p_components jsonb) returns bigint language plpgsql immutable set search_path='' as $$
declare x jsonb; total bigint:=0;
begin
 if jsonb_typeof(p_components)<>'array' or jsonb_array_length(p_components)>30 then raise exception 'INVALID_COMPONENTS'; end if;
 for x in select * from jsonb_array_elements(p_components) loop
  if jsonb_typeof(x)<>'object' or length(coalesce(x->>'label','')) not between 1 and 100 or coalesce(x->>'amount_paise','') !~ '^[0-9]+$' or (x->>'amount_paise')::numeric>100000000 then raise exception 'INVALID_COMPONENTS'; end if;
  total:=total+(x->>'amount_paise')::bigint;
 end loop; return total;
end $$;
create function public.pos_checkout(p_actor uuid,p_key uuid,p_cart jsonb,p_customer jsonb,p_discount bigint,p_tenders jsonb,p_cash_received bigint,p_bank_checked boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.pos_settings; pr public.products; o public.pos_sales; line record; t jsonb; items jsonb:='[]'; subtotal bigint:=0; tax bigint; total bigint; tender_total bigint:=0; cash bigint:=0; unit int; fingerprint text; key uuid:=gen_random_uuid(); serial bigint; inv text;
begin
 if not private.can_actor(p_actor,'pos') then raise exception 'FORBIDDEN'; end if;
 fingerprint:=encode(sha256(convert_to(p_cart::text||p_customer::text||p_discount::text||p_tenders::text||p_cash_received::text||p_bank_checked::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('pos:'||p_actor::text));
 select * into o from public.pos_sales where cashier_id=p_actor and request_key=p_key;
 if found then if o.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return o.id; end if;
 select * into s from public.pos_settings where id;
 if not s.enabled then raise exception 'POS_DISABLED'; end if;
 if jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart) not between 1 and 100 then raise exception 'INVALID_CART'; end if;
 if length(coalesce(p_customer->>'name',''))>80 or length(coalesce(p_customer->>'phone',''))>25 then raise exception 'INVALID_CUSTOMER'; end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_cart)x)<>jsonb_array_length(p_cart) then raise exception 'DUPLICATE_ITEM'; end if;
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::numeric qty from jsonb_array_elements(p_cart)x order by (x->>'product_id')::uuid loop
  if line.qty is null or line.qty<>trunc(line.qty) or line.qty not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into pr from public.products where id=line.pid for update;
  if not found or pr.archived then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if pr.price_paise<=0 then raise exception 'PRICE_NOT_SET'; end if;
  if pr.stock_on_hand-pr.reserved<line.qty then raise exception 'OUT_OF_STOCK'; end if;
  unit:=floor(pr.price_paise::numeric*(100-pr.discount_percent)/100)::int;
  subtotal:=subtotal+unit::bigint*line.qty::int;
  items:=items||jsonb_build_array(jsonb_build_object('product_id',pr.id,'sku',pr.sku,'barcode',pr.barcode,'name',pr.name,'quantity',line.qty::int,'unit_paise',unit,'line_paise',unit::bigint*line.qty::int));
 end loop;
 if p_discount<0 or p_discount>floor(subtotal::numeric*s.max_discount_bps/10000) then raise exception 'DISCOUNT_LIMIT'; end if;
 tax:=round((subtotal-p_discount)::numeric*s.tax_bps/10000)::bigint; total:=subtotal-p_discount+tax;
 if total<=0 or total>2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;
 if jsonb_typeof(p_tenders)<>'array' or jsonb_array_length(p_tenders) not between 1 and 3 then raise exception 'INVALID_TENDER'; end if;
 if (select count(distinct x->>'method') from jsonb_array_elements(p_tenders)x)<>jsonb_array_length(p_tenders) then raise exception 'INVALID_TENDER'; end if;
 for t in select * from jsonb_array_elements(p_tenders) loop
  if coalesce(t->>'method','') not in ('cash','upi','card') or coalesce(t->>'amount_paise','')!~'^[0-9]+$' or (t->>'amount_paise')::numeric not between 1 and 2000000000 then raise exception 'INVALID_TENDER'; end if;
  if t->>'method'<>'cash' and (not p_bank_checked or length(coalesce(t->>'reference','')) not between 6 and 100) then raise exception 'BANK_CHECK_REQUIRED'; end if;
  tender_total:=tender_total+(t->>'amount_paise')::bigint;
  if t->>'method'='cash' then cash:=cash+(t->>'amount_paise')::bigint; end if;
 end loop;
 if tender_total<>total or p_cash_received<cash or (cash=0 and p_cash_received<>0) then raise exception 'TENDER_MISMATCH'; end if;
 serial:=nextval(pg_get_serial_sequence('public.pos_sales','number')); inv:=s.invoice_prefix||'-'||lpad(serial::text,6,'0');
 insert into public.pos_sales(id,number,cashier_id,request_key,request_hash,invoice_no,customer_name,customer_phone,business,items,tenders,subtotal_paise,discount_paise,tax_paise,total_paise,cash_received_paise,change_paise)
 overriding system value values(key,serial,p_actor,p_key,fingerprint,inv,coalesce(p_customer->>'name',''),coalesce(p_customer->>'phone',''),to_jsonb(s)-'enabled'-'max_discount_bps',items,p_tenders,subtotal,p_discount,tax,total,p_cash_received,p_cash_received-cash);
 for line in select * from jsonb_to_recordset(items) as x(product_id uuid,quantity int) order by product_id loop
  update public.products set stock_on_hand=stock_on_hand-line.quantity,updated_at=now() where id=line.product_id;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.product_id,p_actor,-line.quantity,'POS sale '||inv);
 end loop;
 perform private.audit(p_actor,'pos.completed','pos_sales',key::text,jsonb_build_object('invoice',inv,'total_paise',total)); return key;
end $$;
create function public.pos_return(p_actor uuid,p_sale uuid,p_reason text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.pos_sales; line record;
begin
 if not private.can_actor(p_actor,'pos') or not private.can_actor(p_actor,'inventory') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.pos_sales where id=p_sale for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if o.status='returned' then return; end if;
 if length(trim(p_reason)) not between 3 and 500 or length(trim(p_reference)) not between 6 and 100 then raise exception 'RETURN_DETAILS_REQUIRED'; end if;
 for line in select * from jsonb_to_recordset(o.items)as x(product_id uuid,quantity int) order by product_id loop
  perform 1 from public.products where id=line.product_id for update;
  update public.products set stock_on_hand=stock_on_hand+line.quantity,updated_at=now() where id=line.product_id;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.product_id,p_actor,line.quantity,'POS full return '||o.invoice_no);
 end loop;
 update public.pos_sales set status='returned',returned_by=p_actor,return_note=p_reason,refund_reference=p_reference,returned_at=now() where id=p_sale;
 perform private.audit(p_actor,'pos.returned','pos_sales',p_sale::text,jsonb_build_object('reason',p_reason,'reference',p_reference));
end $$;
create function public.save_employee(p_actor uuid,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=coalesce(p_id,gen_random_uuid());
begin
 perform private.require_super(p_actor); perform private.pay_components(p_data->'allowances'); perform private.pay_components(p_data->'deductions');
 insert into public.employees(id,code,name,employment,pay_basis,rate_paise,scheduled_units,overtime_rate_paise,allowances,deductions,active)
 select key,x.code,x.name,x.employment,x.pay_basis,x.rate_paise,x.scheduled_units,x.overtime_rate_paise,x.allowances,x.deductions,x.active from jsonb_populate_record(null::public.employees,p_data)x
 on conflict(id)do update set code=excluded.code,name=excluded.name,employment=excluded.employment,pay_basis=excluded.pay_basis,rate_paise=excluded.rate_paise,scheduled_units=excluded.scheduled_units,overtime_rate_paise=excluded.overtime_rate_paise,allowances=excluded.allowances,deductions=excluded.deductions,active=excluded.active,updated_at=now();
 perform private.audit(p_actor,'employee.saved','employees',key::text); return key;
end $$;
create function public.payroll_draft(p_actor uuid,p_employee uuid,p_period date,p_worked numeric,p_overtime numeric,p_allowances jsonb,p_deductions jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.employees; old public.payroll_runs; key uuid; base bigint; ot bigint; allowance bigint; deduction bigint; gross bigint; extras_a jsonb; extras_d jsonb;
begin
 perform private.require_super(p_actor);
 if extract(day from p_period)<>1 or p_worked<0 or p_worked>744 or p_overtime<0 or p_overtime>744 or p_worked<>round(p_worked,2) or p_overtime<>round(p_overtime,2) then raise exception 'INVALID_PAYROLL_UNITS'; end if;
 select * into e from public.employees where id=p_employee for update;
 if not found or not e.active then raise exception 'EMPLOYEE_UNAVAILABLE'; end if;
 select * into old from public.payroll_runs where employee_id=p_employee and period=p_period for update;
 if found and old.status<>'draft' then raise exception 'PAYROLL_LOCKED'; end if;
 if e.pay_basis='monthly' and p_worked>e.scheduled_units then raise exception 'INVALID_PAYROLL_UNITS'; end if;
 extras_a:=e.allowances||p_allowances; extras_d:=e.deductions||p_deductions;
 allowance:=private.pay_components(extras_a); deduction:=private.pay_components(extras_d);
 base:=case when e.pay_basis='monthly' then round(e.rate_paise::numeric*p_worked/e.scheduled_units)::bigint else round(e.rate_paise::numeric*p_worked)::bigint end;
 ot:=round(e.overtime_rate_paise::numeric*p_overtime)::bigint; gross:=base+ot+allowance;
 if deduction>gross or gross>2000000000 then raise exception 'INVALID_NET_PAY'; end if;
 key:=coalesce(old.id,gen_random_uuid());
 insert into public.payroll_runs(id,employee_id,period,employee_snapshot,worked_units,overtime_units,allowances,deductions,base_paise,overtime_paise,allowance_paise,deduction_paise,gross_paise,net_paise,created_by)
 values(key,e.id,p_period,to_jsonb(e),p_worked,p_overtime,extras_a,extras_d,base,ot,allowance,deduction,gross,gross-deduction,p_actor)
 on conflict(id)do update set employee_snapshot=excluded.employee_snapshot,worked_units=excluded.worked_units,overtime_units=excluded.overtime_units,allowances=excluded.allowances,deductions=excluded.deductions,base_paise=excluded.base_paise,overtime_paise=excluded.overtime_paise,allowance_paise=excluded.allowance_paise,deduction_paise=excluded.deduction_paise,gross_paise=excluded.gross_paise,net_paise=excluded.net_paise,updated_at=now();
 perform private.audit(p_actor,'payroll.drafted','payroll_runs',key::text); return key;
end $$;
create function public.payroll_post(p_actor uuid,p_run uuid,p_action text,p_reference text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.payroll_runs;
begin
 perform private.require_super(p_actor); select * into r from public.payroll_runs where id=p_run for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_action='approve' then
  if r.status in ('approved','paid') then return; end if;
  update public.payroll_runs set status='approved',approved_by=p_actor,approved_at=now(),updated_at=now() where id=p_run;
 elsif p_action='paid' then
  if r.status='paid' then if r.payment_reference<>p_reference then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return; end if;
  if r.status<>'approved' or length(trim(p_reference)) not between 6 and 100 then raise exception 'PAYROLL_PAYMENT_REQUIRED'; end if;
  update public.payroll_runs set status='paid',paid_by=p_actor,paid_at=now(),payment_reference=p_reference,updated_at=now() where id=p_run;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 perform private.audit(p_actor,'payroll.'||p_action,'payroll_runs',p_run::text);
end $$;
do $$ declare t text; begin foreach t in array array['pos_settings','pos_sales','employees','payroll_runs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant usage,select on all sequences in schema public to service_role;
revoke all on function private.require_super(uuid),private.pay_components(jsonb) from public,anon,authenticated;
revoke all on function public.pos_checkout(uuid,uuid,jsonb,jsonb,bigint,jsonb,bigint,boolean),public.pos_return(uuid,uuid,text,text),public.save_employee(uuid,uuid,jsonb),public.payroll_draft(uuid,uuid,date,numeric,numeric,jsonb,jsonb),public.payroll_post(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pos_checkout(uuid,uuid,jsonb,jsonb,bigint,jsonb,bigint,boolean),public.pos_return(uuid,uuid,text,text),public.save_employee(uuid,uuid,jsonb),public.payroll_draft(uuid,uuid,date,numeric,numeric,jsonb,jsonb),public.payroll_post(uuid,uuid,text,text) to service_role;


-- === 202611170004_erp_schema.sql ===
-- ERP upgrade. Apply after 001,002,003. Enum changes commit before 005.
alter type public.app_role add value if not exists 'billing';
alter table public.profiles alter column permissions set default array['catalogue','inventory','orders','payments','content','offers','shipping','bulk','pos','purchases','expenses','attendance','reports'];
create table public.product_categories (
 id uuid primary key default gen_random_uuid(), parent_id uuid references public.product_categories(id),
 name text not null check(length(name) between 1 and 80), slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 active boolean not null default true, created_at timestamptz not null default now(), check(parent_id is null or parent_id<>id)
);
alter table public.products add column subcategory_id uuid references public.product_categories(id);
insert into public.product_categories(name,slug) select distinct category,'legacy-'||substr(md5(category),1,12) from public.products;
insert into public.product_categories(parent_id,name,slug) select id,'All styles',slug||'-all' from public.product_categories where parent_id is null;
update public.products p set subcategory_id=c.id from public.product_categories c join public.product_categories m on m.id=c.parent_id where m.name=p.category;
create table public.catalog_discounts (
 id uuid primary key default gen_random_uuid(), name text not null, scope text not null check(scope in ('category','subcategory','product')),
 target_id uuid not null, discount_bps int not null check(discount_bps between 1 and 9000), active boolean not null default false,
 starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(), check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create table public.suppliers (
 id uuid primary key default gen_random_uuid(), name text not null, phone text not null default '', email text not null default '',
 address text not null default '', gstin text not null default '', active boolean not null default true, created_at timestamptz not null default now()
);
create table public.purchases (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 supplier_id uuid not null references public.suppliers(id), supplier_invoice text not null default '', note text not null default '',
 status text not null default 'draft' check(status in ('draft','ordered','partial','received','cancelled')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), expected_on date,
 unique(supplier_id,supplier_invoice)
);
-- Blank supplier invoice is allowed repeatedly; nonblank invoices must be unique per supplier.
alter table public.purchases drop constraint purchases_supplier_id_supplier_invoice_key;
create unique index purchase_supplier_invoice on public.purchases(supplier_id,lower(supplier_invoice)) where supplier_invoice<>'';
create table public.purchase_items (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), product_id uuid not null references public.products(id),
 quantity int not null check(quantity between 1 and 10000), received int not null default 0 check(received>=0 and received<=quantity),
 returned int not null default 0 check(returned>=0 and returned<=received), unit_cost_paise int not null check(unit_cost_paise between 0 and 100000000),
 tax_bps int not null default 0 check(tax_bps between 0 and 10000), unique(purchase_id,product_id)
);
create table public.purchase_receipts (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), request_key uuid not null unique,
 fingerprint text not null, kind text not null check(kind in ('receive','return')), lines jsonb not null, actor_id uuid not null, note text not null default '', created_at timestamptz not null default now()
);
create table public.purchase_payments (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id), request_key uuid not null unique, fingerprint text not null,
 direction text not null check(direction in ('paid','refund')), amount_paise bigint not null check(amount_paise>0), method text not null check(method in ('cash','upi','card','bank')),
 reference text not null, actor_id uuid not null, created_at timestamptz not null default now()
);
create sequence private.unit_barcode_seq;
create table public.product_units (
 id bigint generated always as identity primary key, product_id uuid not null references public.products(id), barcode text not null unique,
 state text not null default 'in_stock' check(state in ('in_stock','sold','removed')), purchase_id uuid references public.purchases(id),
 sale_id uuid references public.pos_sales(id), order_id uuid references public.orders(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), printed_at timestamptz
);
create index product_units_available on public.product_units(product_id,id) where state='in_stock';
create table public.expense_categories (
 id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.expense_categories(name) values('Rent'),('Electricity'),('Transport'),('Shop supplies'),('Payroll'),('Other');
create table public.expenses (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique, fingerprint text not null,
 category_id uuid not null references public.expense_categories(id), expense_on date not null, description text not null,
 amount_paise bigint not null check(amount_paise>0 and amount_paise<=2000000000), method text not null check(method in ('cash','upi','card','bank')),
 reference text not null default '', payee text not null default '', status text not null default 'posted' check(status in ('posted','void')),
 source text not null default 'manual' check(source in ('manual','payroll')), payroll_id uuid unique references public.payroll_runs(id),
 actor_id uuid not null, void_by uuid, void_reason text, created_at timestamptz not null default now()
);
create table public.salary_policies (
 id uuid primary key default gen_random_uuid(), name text not null, divisor_mode text not null default 'scheduled' check(divisor_mode in ('calendar','scheduled')),
 work_weekdays int[] not null default array[1,2,3,4,5,6], paid_leave_units numeric(4,1) not null default 0 check(paid_leave_units between 0 and 31),
 leave_rule_mode text not null default 'ordinal' check(leave_rule_mode in ('ordinal','monthly_total')),
 leave_tiers jsonb not null default '[]', default_leave_lop_bps int not null default 10000 check(default_leave_lop_bps between 0 and 10000),
 half_day_pay_bps int not null default 5000 check(half_day_pay_bps between 0 and 10000),
 paid_permission_minutes int not null default 0 check(paid_permission_minutes between 0 and 14400),
 permission_lop text not null default 'proportional' check(permission_lop in ('proportional','half_day','full_day')),
 holiday_paid boolean not null default true, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.salary_policies(name) values('Shop default: six-day week, unpaid leave');
alter table public.employees add column profile_id uuid unique references public.profiles(id);
alter table public.employees add column phone text not null default '';
alter table public.employees add column joined_on date not null default current_date;
alter table public.employees add column ended_on date;
alter table public.employees add column daily_minutes int not null default 480 check(daily_minutes between 60 and 1440);
alter table public.employees add column policy_id uuid references public.salary_policies(id);
update public.employees set policy_id=(select id from public.salary_policies limit 1);
create table public.attendance (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id), work_on date not null,
 status text not null check(status in ('full_day','half_day','leave','permission','weekly_off','holiday','absent')),
 leave_units numeric(2,1) not null default 1 check(leave_units in (0.5,1)),
 permission_minutes int not null default 0 check(permission_minutes between 0 and 1440),
 worked_minutes int not null default 480 check(worked_minutes between 0 and 1440), overtime_minutes int not null default 0 check(overtime_minutes between 0 and 1440),
 note text not null default '', marked_by uuid not null, updated_at timestamptz not null default now(), unique(employee_id,work_on)
);
alter table public.payroll_runs add column calculation jsonb;
alter table public.payroll_runs add column calculation_hash text;
alter table public.payroll_runs add column bonus_paise bigint not null default 0;
alter table public.payroll_runs add column payment_method text;
alter table public.pos_sales add column pricing_snapshot jsonb not null default '{}';
alter table public.pos_sales add column discount_reason text not null default '';

create or replace function private.can_actor(actor uuid,cap text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=actor and not p.suspended and
 (p.role::text='superadmin' or (
 not exists(select 1 from public.employees e where e.profile_id=p.id and not e.active) and
 ((p.role::text='manager' and cap=any(p.permissions)) or (p.role::text='billing' and cap='pos' and exists(select 1 from public.employees e where e.profile_id=p.id and e.active))))));
$$;
create or replace function private.sync_auth_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.app_role;
begin
 if tg_op='UPDATE' and new.email is distinct from old.email then update public.profiles set email=coalesce(new.email,'') where id=new.id; end if;
 if tg_op='UPDATE' and (new.raw_app_meta_data->'store_role') is not distinct from (old.raw_app_meta_data->'store_role') then return new; end if;
 if new.raw_app_meta_data ? 'store_role' then
  if new.raw_app_meta_data->>'store_role' not in ('customer','manager','billing','superadmin') or new.raw_app_meta_data->>'store_role' is null then raise exception 'INVALID_PROTECTED_ROLE'; end if;
  r:=(new.raw_app_meta_data->>'store_role')::public.app_role;
 elsif tg_op='INSERT' then r:='superadmin'; else raise exception 'PROTECTED_ROLE_CANNOT_BE_REMOVED'; end if;
 insert into public.profiles(id,email,display_name,role) values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'name',''),80),r)
 on conflict(id) do update set role=excluded.role,email=excluded.email;
 return new;
end $$;
create function private.product_visible(p public.products) returns boolean language sql stable security definer set search_path='' as $$
 select not p.archived and (p.subcategory_id is null or exists(select 1 from public.product_categories s join public.product_categories m on m.id=s.parent_id where s.id=p.subcategory_id and s.active and m.active));
$$;
create function private.product_price(p public.products) returns int language sql stable security definer set search_path='' as $$
 select floor(p.price_paise::numeric*(10000-greatest(p.discount_percent*100,coalesce((
 select max(d.discount_bps) from public.catalog_discounts d left join public.product_categories s on s.id=p.subcategory_id
 where d.active and (d.starts_at is null or d.starts_at<=now()) and (d.ends_at is null or d.ends_at>now()) and
 ((d.scope='product' and d.target_id=p.id) or (d.scope='subcategory' and d.target_id=p.subcategory_id) or (d.scope='category' and d.target_id=s.parent_id))
 ),0)))/10000)::int;
$$;
create view public.store_catalogue with (security_invoker=true) as
 select p.*, private.product_price(p) as effective_price_paise,s.name as subcategory_name,m.id as category_id,m.name as category_name,
 private.product_visible(p) as category_visible from public.products p left join public.product_categories s on s.id=p.subcategory_id left join public.product_categories m on m.id=s.parent_id;
revoke all on public.store_catalogue from public,anon,authenticated;
grant select on public.store_catalogue to service_role;

-- MSU prefix is reserved exclusively for generated serialized unit stickers.
alter table public.products add constraint product_barcode_namespace check(barcode is null or barcode !~ '^MSU[0-9]+$');
create function private.stock_unit_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare delta int; restored int:=0; selected bigint[]; wanted bigint[]; sale uuid; ord uuid; purchase uuid;
begin
 delta:=new.stock_on_hand-case when tg_op='INSERT' then 0 else old.stock_on_hand end;
 if delta=0 then return new; end if;
 if abs(delta)>10000 then raise exception 'STOCK_BATCH_LIMIT_10000'; end if;
 sale:=nullif(current_setting('store.sale_id',true),'')::uuid; ord:=nullif(current_setting('store.order_id',true),'')::uuid; purchase:=nullif(current_setting('store.purchase_id',true),'')::uuid;
 if delta>0 then
  if sale is not null or ord is not null then
   select array_agg(id) into selected from (select id from public.product_units where product_id=new.id and state='sold' and ((sale is not null and sale_id=sale) or (ord is not null and order_id=ord)) order by id limit delta for update)q;
   update public.product_units set state='in_stock',sale_id=null,order_id=null,updated_at=now() where id=any(coalesce(selected,'{}'));
   get diagnostics restored=row_count;
  end if;
  insert into public.product_units(product_id,barcode,purchase_id) select new.id,'MSU'||lpad(nextval('private.unit_barcode_seq')::text,12,'0'),purchase from generate_series(1,delta-restored);
 else
  select coalesce(array_agg(value::bigint),'{}') into wanted from jsonb_array_elements_text(coalesce(nullif(current_setting('store.unit_ids',true),''),'[]')::jsonb);
  if cardinality(wanted)>0 and cardinality(wanted)<>-delta then raise exception 'BARCODE_QUANTITY_MISMATCH'; end if;
  select array_agg(id) into selected from (select id from public.product_units where product_id=new.id and state='in_stock' and (cardinality(wanted)=0 or id=any(wanted)) order by id limit -delta for update)q;
  if cardinality(coalesce(selected,'{}'))<>-delta then raise exception 'UNIT_STOCK_MISMATCH'; end if;
  update public.product_units set state=case when sale is not null or ord is not null then 'sold' else 'removed' end,sale_id=sale,order_id=ord,updated_at=now() where id=any(selected);
 end if;
 return new;
end $$;
insert into public.product_units(product_id,barcode) select p.id,'MSU'||lpad(nextval('private.unit_barcode_seq')::text,12,'0') from public.products p cross join lateral generate_series(1,p.stock_on_hand);
create trigger sync_product_units after insert or update of stock_on_hand on public.products for each row execute function private.stock_unit_sync();

do $$ declare t text; begin foreach t in array array['product_categories','catalog_discounts','suppliers','purchases','purchase_items','purchase_receipts','purchase_payments','product_units','expense_categories','expenses','salary_policies','attendance'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
end loop; end $$;
grant usage,select on all sequences in schema public to service_role;
revoke all on all functions in schema private from public,anon,authenticated;

grant usage on schema private to service_role;
grant execute on function private.product_price(public.products),private.product_visible(public.products) to service_role;


-- === 202611170005_erp_operations.sql ===
create function private.product_category_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare main_name text;
begin
 perform pg_advisory_xact_lock(761117010);
 if new.sku ~ '^MSU[0-9]+$' then raise exception 'RESERVED_BARCODE_PREFIX'; end if;
 if exists(select 1 from public.products p where p.id<>new.id and (p.barcode=new.sku or (new.barcode is not null and (p.sku=new.barcode or p.barcode=new.barcode)))) then raise exception 'BARCODE_ALREADY_USED'; end if;
 if new.subcategory_id is not null then
  select m.name into main_name from public.product_categories s join public.product_categories m on m.id=s.parent_id where s.id=new.subcategory_id and m.parent_id is null;
  if not found then raise exception 'SUBCATEGORY_REQUIRED'; end if;
  new.category:=main_name;
 end if; return new;
end $$;
-- Revoke the default PUBLIC grant in this migration, before the next file commits.
-- Repeated at EOF for all functions introduced below as well.
create trigger product_category_guard before insert or update of sku,barcode,subcategory_id on public.products for each row execute function private.product_category_guard();
create function public.erp_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=coalesce(p_id,gen_random_uuid()); cap text; r record; old public.product_categories;
begin
 cap:=case p_entity when 'suppliers' then 'purchases' when 'product_categories' then '__super' when 'catalog_discounts' then '__super' when 'expense_categories' then '__super' when 'salary_policies' then '__super' when 'pos_settings' then '__super' else null end;
 if cap is null or not private.can_actor(p_actor,cap) then raise exception 'FORBIDDEN'; end if;
 if p_entity='product_categories' then
  perform pg_advisory_xact_lock(761117010);
  select * into old from public.product_categories where id=key for update;
  if p_data->>'parent_id' is not null then
   if (p_data->>'parent_id')::uuid=key or not exists(select 1 from public.product_categories where id=(p_data->>'parent_id')::uuid and parent_id is null) or exists(select 1 from public.product_categories where parent_id=key) then raise exception 'INVALID_CATEGORY_PARENT'; end if;
  elsif exists(select 1 from public.products where subcategory_id=key) then raise exception 'SUBCATEGORY_IN_USE'; end if;
  insert into public.product_categories(id,parent_id,name,slug,active) select key,x.parent_id,x.name,x.slug,x.active from jsonb_populate_record(null::public.product_categories,p_data)x
  on conflict(id)do update set parent_id=excluded.parent_id,name=excluded.name,slug=excluded.slug,active=excluded.active;
 elsif p_entity='catalog_discounts' then
  perform pg_advisory_xact_lock(761117030);
  if (p_data->>'scope'='product' and not exists(select 1 from public.products where id=(p_data->>'target_id')::uuid)) or
  (p_data->>'scope'='category' and not exists(select 1 from public.product_categories where id=(p_data->>'target_id')::uuid and parent_id is null)) or
  (p_data->>'scope'='subcategory' and not exists(select 1 from public.product_categories where id=(p_data->>'target_id')::uuid and parent_id is not null)) then raise exception 'INVALID_DISCOUNT_TARGET'; end if;
  insert into public.catalog_discounts(id,name,scope,target_id,discount_bps,active,starts_at,ends_at) select key,x.name,x.scope,x.target_id,x.discount_bps,x.active,x.starts_at,x.ends_at from jsonb_populate_record(null::public.catalog_discounts,p_data)x
  on conflict(id)do update set name=excluded.name,scope=excluded.scope,target_id=excluded.target_id,discount_bps=excluded.discount_bps,active=excluded.active,starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 elsif p_entity='suppliers' then
  insert into public.suppliers(id,name,phone,email,address,gstin,active) select key,x.name,x.phone,x.email,x.address,x.gstin,x.active from jsonb_populate_record(null::public.suppliers,p_data)x
  on conflict(id)do update set name=excluded.name,phone=excluded.phone,email=excluded.email,address=excluded.address,gstin=excluded.gstin,active=excluded.active;
 elsif p_entity='expense_categories' then
  insert into public.expense_categories(id,name,active) values(key,p_data->>'name',(p_data->>'active')::boolean) on conflict(id)do update set name=excluded.name,active=excluded.active;
 elsif p_entity='pos_settings' then
  update public.pos_settings set enabled=(p_data->>'enabled')::boolean,business_name=p_data->>'business_name',business_english=p_data->>'business_english',address=p_data->>'address',phone=p_data->>'phone',gstin=p_data->>'gstin',invoice_prefix=p_data->>'invoice_prefix',receipt_footer=p_data->>'receipt_footer',tax_bps=(p_data->>'tax_bps')::int,max_discount_bps=(p_data->>'max_discount_bps')::int,paper_mm=(p_data->>'paper_mm')::int,updated_at=now() where id;
 elsif p_entity='salary_policies' then
  perform pg_advisory_xact_lock(761117020);
  perform private.validate_salary_policy(p_data);
  insert into public.salary_policies(id,name,divisor_mode,work_weekdays,paid_leave_units,leave_rule_mode,leave_tiers,default_leave_lop_bps,half_day_pay_bps,paid_permission_minutes,permission_lop,holiday_paid,active)
  select key,x.name,x.divisor_mode,x.work_weekdays,x.paid_leave_units,x.leave_rule_mode,x.leave_tiers,x.default_leave_lop_bps,x.half_day_pay_bps,x.paid_permission_minutes,x.permission_lop,x.holiday_paid,x.active from jsonb_populate_record(null::public.salary_policies,p_data)x
  on conflict(id)do update set name=excluded.name,divisor_mode=excluded.divisor_mode,work_weekdays=excluded.work_weekdays,paid_leave_units=excluded.paid_leave_units,leave_rule_mode=excluded.leave_rule_mode,leave_tiers=excluded.leave_tiers,default_leave_lop_bps=excluded.default_leave_lop_bps,half_day_pay_bps=excluded.half_day_pay_bps,paid_permission_minutes=excluded.paid_permission_minutes,permission_lop=excluded.permission_lop,holiday_paid=excluded.holiday_paid,active=excluded.active,updated_at=now();
 end if;
 perform private.audit(p_actor,'erp.saved',p_entity,key::text); return key;
end $$;

create function private.purchase_due(p_id uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum((received-returned)::bigint*unit_cost_paise+round((received-returned)::numeric*unit_cost_paise*tax_bps/10000)) from public.purchase_items where purchase_id=p_id),0)::bigint-
 coalesce((select sum(case when direction='paid' then amount_paise else -amount_paise end) from public.purchase_payments where purchase_id=p_id),0)::bigint;
$$;
create function public.purchase_save(p_actor uuid,p_id uuid,p_data jsonb,p_lines jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=coalesce(p_id,gen_random_uuid()); o public.purchases; x jsonb;
begin
 if not private.can_actor(p_actor,'purchases') then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext('purchase:'||key::text));
 select * into o from public.purchases where id=key for update;
 if found and o.status<>'draft' then raise exception 'PURCHASE_LOCKED'; end if;
 if not exists(select 1 from public.suppliers where id=(p_data->>'supplier_id')::uuid and active) then raise exception 'SUPPLIER_UNAVAILABLE'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 or (select count(distinct elem->>'product_id') from jsonb_array_elements(p_lines) elem)<>jsonb_array_length(p_lines) then raise exception 'INVALID_PURCHASE_LINES'; end if;
 insert into public.purchases(id,supplier_id,supplier_invoice,note,expected_on,created_by) values(key,(p_data->>'supplier_id')::uuid,coalesce(p_data->>'supplier_invoice',''),coalesce(p_data->>'note',''),(p_data->>'expected_on')::date,p_actor)
 on conflict(id)do update set supplier_id=excluded.supplier_id,supplier_invoice=excluded.supplier_invoice,note=excluded.note,expected_on=excluded.expected_on;
 delete from public.purchase_items where purchase_id=key;
 for x in select * from jsonb_array_elements(p_lines) loop
  insert into public.purchase_items(purchase_id,product_id,quantity,unit_cost_paise,tax_bps) values(key,(x->>'product_id')::uuid,(x->>'quantity')::int,(x->>'unit_cost_paise')::int,(x->>'tax_bps')::int);
 end loop;
 perform private.audit(p_actor,'purchase.drafted','purchases',key::text); return key;
end $$;
create function public.purchase_status(p_actor uuid,p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.purchases;
begin
 if not private.can_actor(p_actor,'purchases') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.purchases where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if o.status=p_status then return; end if;
 if p_status='ordered' and o.status='draft' then null;
 elsif p_status='cancelled' and o.status in ('draft','ordered') and not exists(select 1 from public.purchase_items where purchase_id=p_id and received>0) then null;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.purchases set status=p_status where id=p_id;
 perform private.audit(p_actor,'purchase.'||p_status,'purchases',p_id::text);
end $$;
create function public.purchase_receive(p_actor uuid,p_id uuid,p_key uuid,p_kind text,p_lines jsonb,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.purchases; previous public.purchase_receipts; line record; item public.purchase_items; key uuid:=gen_random_uuid(); fingerprint text; selected bigint[];
begin
 if not private.can_actor(p_actor,'purchases') then raise exception 'FORBIDDEN'; end if;
 fingerprint:=encode(sha256(convert_to(p_id::text||p_kind||p_lines::text||p_note,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('receipt:'||p_key::text));
 select * into previous from public.purchase_receipts where request_key=p_key;
 if found then if previous.fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return previous.id; end if;
 select * into o from public.purchases where id=p_id for update;
 if not found or o.status not in ('ordered','partial','received') then raise exception 'PURCHASE_NOT_ORDERED'; end if;
 if p_kind not in ('receive','return') or (p_kind='return' and length(trim(p_note))<3) or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 or (select count(distinct elem->>'product_id') from jsonb_array_elements(p_lines) elem)<>jsonb_array_length(p_lines) then raise exception 'INVALID_PURCHASE_LINES'; end if;
 perform set_config('store.sale_id','',true); perform set_config('store.order_id','',true); perform set_config('store.purchase_id',case when p_kind='receive' then p_id::text else '' end,true);
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_lines)x order by (x->>'product_id')::uuid loop
  if line.qty not between 1 and 10000 or line.qty is null then raise exception 'INVALID_QUANTITY'; end if;
  select * into item from public.purchase_items where purchase_id=p_id and product_id=line.pid for update;
  if not found then raise exception 'INVALID_PURCHASE_LINES'; end if;
  perform 1 from public.products where id=line.pid for update;
  perform set_config('store.unit_ids','[]',true);
  if p_kind='receive' then
   if item.received+line.qty>item.quantity then raise exception 'OVER_RECEIPT'; end if;
   update public.purchase_items set received=received+line.qty where id=item.id;
   update public.products set stock_on_hand=stock_on_hand+line.qty,updated_at=now() where id=line.pid;
  else
   if item.returned+line.qty>item.received or not exists(select 1 from public.products where id=line.pid and stock_on_hand-reserved>=line.qty) then raise exception 'RETURN_EXCEEDS_STOCK'; end if;
   select array_agg(id) into selected from (select id from public.product_units where product_id=line.pid and purchase_id=p_id and state='in_stock' order by id limit line.qty for update)u;
   if cardinality(coalesce(selected,'{}'))<>line.qty then raise exception 'PURCHASE_UNITS_UNAVAILABLE'; end if;
   perform set_config('store.unit_ids',to_jsonb(selected)::text,true);
   update public.purchase_items set returned=returned+line.qty where id=item.id;
   update public.products set stock_on_hand=stock_on_hand-line.qty,updated_at=now() where id=line.pid;
  end if;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.pid,p_actor,case when p_kind='receive' then line.qty else -line.qty end,'Purchase '||o.number||' '||p_kind);
 end loop;
 update public.purchases set status=case when not exists(select 1 from public.purchase_items where purchase_id=p_id and received<quantity) then 'received' else 'partial' end where id=p_id;
 insert into public.purchase_receipts(id,purchase_id,request_key,fingerprint,kind,lines,actor_id,note) values(key,p_id,p_key,fingerprint,p_kind,p_lines,p_actor,p_note);
 perform private.audit(p_actor,'purchase.'||p_kind,'purchases',p_id::text,jsonb_build_object('receipt',key)); return key;
end $$;
create function public.purchase_pay(p_actor uuid,p_id uuid,p_key uuid,p_direction text,p_amount bigint,p_method text,p_reference text,p_checked boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare due bigint; previous public.purchase_payments; fingerprint text; key uuid:=gen_random_uuid();
begin
 if not private.can_actor(p_actor,'purchases') then raise exception 'FORBIDDEN'; end if;
 fingerprint:=encode(sha256(convert_to(p_id::text||p_direction||p_amount::text||p_method||p_reference,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('purchase-pay:'||p_key::text));
 select * into previous from public.purchase_payments where request_key=p_key;
 if found then if previous.fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return previous.id; end if;
 perform 1 from public.purchases where id=p_id for update;
 if not found or not p_checked or p_amount<=0 or p_method not in ('cash','upi','card','bank') or length(trim(p_reference)) not between 6 and 100 then raise exception 'PAYMENT_DETAILS_REQUIRED'; end if;
 due:=private.purchase_due(p_id);
 if not ((p_direction='paid' and p_amount<=due) or (p_direction='refund' and p_amount<=-due)) then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
 insert into public.purchase_payments(id,purchase_id,request_key,fingerprint,direction,amount_paise,method,reference,actor_id) values(key,p_id,p_key,fingerprint,p_direction,p_amount,p_method,p_reference,p_actor);
 perform private.audit(p_actor,'purchase.payment','purchases',p_id::text,jsonb_build_object('direction',p_direction,'amount_paise',p_amount)); return key;
end $$;
create function public.purchase_balances(p_actor uuid,p_ids uuid[]) returns table(id uuid,due_paise bigint) language plpgsql security definer set search_path='' as $$
begin if not private.can_actor(p_actor,'purchases') then raise exception 'FORBIDDEN'; end if;
 return query select p.id,private.purchase_due(p.id) from public.purchases p where p.id=any(p_ids); end $$;
create function public.expense_post(p_actor uuid,p_key uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=gen_random_uuid(); old public.expenses; fingerprint text;
begin
 if not private.can_actor(p_actor,'expenses') then raise exception 'FORBIDDEN'; end if;
 fingerprint:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('expense:'||p_key::text)); select * into old from public.expenses where request_key=p_key;
 if found then if old.fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return old.id; end if;
 if not exists(select 1 from public.expense_categories where id=(p_data->>'category_id')::uuid and active) then raise exception 'CATEGORY_UNAVAILABLE'; end if;
 if p_data->>'method'<>'cash' and length(trim(p_data->>'reference'))<6 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
 insert into public.expenses(id,request_key,fingerprint,category_id,expense_on,description,amount_paise,method,reference,payee,actor_id)
 values(key,p_key,fingerprint,(p_data->>'category_id')::uuid,(p_data->>'expense_on')::date,p_data->>'description',(p_data->>'amount_paise')::bigint,p_data->>'method',coalesce(p_data->>'reference',''),coalesce(p_data->>'payee',''),p_actor);
 perform private.audit(p_actor,'expense.posted','expenses',key::text); return key;
end $$;
create function public.expense_void(p_actor uuid,p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if not private.can_actor(p_actor,'expenses') then raise exception 'FORBIDDEN'; end if;
 select * into e from public.expenses where id=p_id for update;
 if not found or e.source<>'manual' or length(trim(p_reason))<3 then raise exception 'EXPENSE_LOCKED'; end if;
 if e.status='void' then return; end if;
 update public.expenses set status='void',void_by=p_actor,void_reason=p_reason where id=p_id;
 perform private.audit(p_actor,'expense.void','expenses',p_id::text,jsonb_build_object('reason',p_reason));
end $$;
do $$ declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_save','purchase_save','purchase_status','purchase_receive','purchase_pay','purchase_balances','expense_post','expense_void') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature); execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;
revoke all on all functions in schema private from public,anon,authenticated;


-- === 202611170006_shared_checkout.sql ===
-- Every legacy checkout/return path uses the ERP price and serialized stock ledger.

create or replace function public.create_checkout(p_customer uuid,p_key uuid,p_cart jsonb,p_address jsonb,p_channel text,p_coupon text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.store_settings; o public.orders; pr public.products; off public.offers; line record;
 fingerprint text; oid uuid:=gen_random_uuid(); subtotal bigint:=0; discount bigint:=0; shipping int; tax bigint; unit int; total bigint; selected_offer uuid;
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
 -- Serializes limited-use coupons. Automatic offers are checked again under this lock.
 if p_coupon is not null and trim(p_coupon)<>'' then
   select * into off from public.offers where code=upper(trim(p_coupon)) for update;
   if not found then raise exception 'INVALID_COUPON'; end if;
 else
   select * into off from public.offers where code is null and active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) and (max_uses is null or used_count<max_uses) order by id limit 1 for update;
 end if;
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::int qty from jsonb_array_elements(p_cart) x order by (x->>'product_id')::uuid loop
   select * into pr from public.products where id=line.pid for update;
   if not found or not pr.published or not private.product_visible(pr) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
   if pr.price_paise<=0 then raise exception 'PRICE_NOT_SET'; end if;
   if pr.stock_on_hand-pr.reserved<line.qty then raise exception 'OUT_OF_STOCK'; end if;
   unit:=private.product_price(pr);
   subtotal:=subtotal+unit::bigint*line.qty;
 end loop;
 if off.id is not null then
   if not off.active or (off.starts_at is not null and off.starts_at>now()) or (off.ends_at is not null and off.ends_at<=now()) or (off.max_uses is not null and off.used_count>=off.max_uses) or subtotal<off.min_subtotal_paise or
   (select count(*) from public.orders where customer_id=p_customer and offer_id=off.id and coupon_counted)>=off.per_customer_limit then
      if p_coupon is not null and trim(p_coupon)<>'' then raise exception 'COUPON_NOT_ELIGIBLE'; end if;
   else
     selected_offer:=off.id;
     discount:=case when off.kind='percent' then floor(subtotal::numeric*off.value/100)::bigint else off.value end;
     discount:=least(subtotal,discount,coalesce(off.max_discount_paise,discount));
     update public.offers set used_count=used_count+1 where id=off.id;
   end if;
 end if;
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

create or replace function public.record_payment(p_order uuid,p_event text,p_payment text,p_amount bigint,p_currency text,p_method text,p_actor uuid default null,p_reference text default null) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; manual boolean:=p_actor is not null;
begin
 if manual and not private.can_actor(p_actor,'payments') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_amount<>o.total_paise or p_currency<>'INR' then raise exception 'PAYMENT_MISMATCH'; end if;
 if manual and o.channel='razorpay' then raise exception 'GATEWAY_VERIFICATION_REQUIRED'; end if;
 if not manual and (o.channel<>'razorpay' or p_method<>'upi') then raise exception 'PAYMENT_METHOD_MISMATCH'; end if;
 if manual and length(coalesce(p_reference,''))<6 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
 insert into private.payment_events(event_id) values(p_event) on conflict do nothing;
 if not found then return o.payment_status; end if;
 if o.payment_status in ('paid','refund_pending','refunded','late_paid') then return o.payment_status; end if;
 if o.stock_state<>'reserved' or o.expires_at<=now() then
   perform private.release_stock(p_order);
   update public.orders set status='review_required',payment_status='late_paid',provider_payment_id=case when manual then null else p_payment end,payment_reference=p_reference,paid_at=now(),updated_at=now() where id=p_order;
   insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Payment arrived after the reservation ended. Staff will review and arrange a refund.');
   perform private.notify(p_order,'Payment needs review','Your payment arrived after the stock hold ended. Please contact the store.');
   return 'late_paid';
 end if;
 perform set_config('store.order_id',p_order::text,true); perform set_config('store.sale_id','',true); perform set_config('store.purchase_id','',true); perform set_config('store.unit_ids','[]',true);
 for line in select * from public.order_items where order_id=p_order order by product_id loop
   perform 1 from public.products where id=line.product_id for update;
   update public.products set stock_on_hand=stock_on_hand-line.quantity,reserved=reserved-line.quantity where id=line.product_id;
   insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,-line.quantity,'Paid order');
 end loop;
 update public.orders set payment_status='paid',status='confirmed',stock_state='consumed',provider_payment_id=case when manual then null else p_payment end,payment_reference=p_reference,paid_at=now(),updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Payment checked. Order confirmed.');
 perform private.audit(p_actor,'payment.confirmed','orders',p_order::text,jsonb_build_object('manual',manual));
 perform private.notify(p_order,'Order confirmed','Your payment is confirmed. We will prepare your sarees.');
 return 'paid';
end $$;

create or replace function public.change_order_status(p_actor uuid,p_order uuid,p_status text,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record;
begin
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if not private.can_actor(p_actor,'orders') then
   if o.customer_id<>p_actor or not ((p_status='cancelled' and o.status='awaiting_payment') or (p_status='return_requested' and o.status='delivered')) then raise exception 'FORBIDDEN'; end if;
 end if;
 perform set_config('store.order_id',p_order::text,true); perform set_config('store.sale_id','',true); perform set_config('store.purchase_id','',true); perform set_config('store.unit_ids','[]',true);
 if p_status='cancelled' and o.status in ('awaiting_payment','confirmed','packing') then
   if o.stock_state='reserved' then perform private.release_stock(p_order);
   elsif o.stock_state='consumed' then
     for line in select * from public.order_items where order_id=p_order order by product_id loop
       perform 1 from public.products where id=line.product_id for update;
       update public.products set stock_on_hand=stock_on_hand+line.quantity where id=line.product_id;
       insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,line.quantity,'Cancelled before shipping');
     end loop;
     update public.orders set stock_state='released' where id=p_order;
   end if;
   if o.payment_status='paid' then update public.orders set payment_status='refund_pending' where id=p_order; end if;
 elsif p_status='packing' and o.status='confirmed' and o.payment_status='paid' then null;
 elsif p_status='shipped' and o.status='packing' and o.payment_status='paid' and o.tracking_id<>'' then null;
 elsif p_status='delivered' and o.status='shipped' and o.payment_status='paid' then null;
 elsif p_status='return_requested' and o.status='delivered' then null;
 elsif p_status='returned' and o.status='return_requested' and o.stock_state='consumed' and length(trim(p_note))>=3 then
   for line in select * from public.order_items where order_id=p_order order by product_id loop
     perform 1 from public.products where id=line.product_id for update;
     update public.products set stock_on_hand=stock_on_hand+line.quantity where id=line.product_id;
     insert into public.inventory_movements(product_id,actor_id,order_id,delta,reason) values(line.product_id,p_actor,p_order,line.quantity,'Return received: '||p_note);
   end loop;
   update public.orders set stock_state='released',payment_status='refund_pending' where id=p_order;
 else raise exception 'INVALID_STATUS_CHANGE'; end if;
 update public.orders set status=p_status,updated_at=now() where id=p_order;
 insert into public.order_events(order_id,actor_id,message) values(p_order,p_actor,'Order status: '||replace(p_status,'_',' ')||case when p_note<>'' then '. '||p_note else '' end);
 perform private.audit(p_actor,'order.status','orders',p_order::text,jsonb_build_object('status',p_status));
 perform private.notify(p_order,'Order update','Your order status is now '||replace(p_status,'_',' ')||'.');
end $$;

create or replace function public.pos_checkout(p_actor uuid,p_key uuid,p_cart jsonb,p_customer jsonb,p_discount bigint,p_tenders jsonb,p_cash_received bigint,p_bank_checked boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.pos_settings; pr public.products; o public.pos_sales; line record; t jsonb; items jsonb:='[]'; subtotal bigint:=0; tax bigint; total bigint; tender_total bigint:=0; cash bigint:=0; unit int; fingerprint text; key uuid:=gen_random_uuid(); serial bigint; inv text;
begin
 if not private.can_actor(p_actor,'pos') then raise exception 'FORBIDDEN'; end if;
 fingerprint:=encode(sha256(convert_to(p_cart::text||p_customer::text||p_discount::text||p_tenders::text||p_cash_received::text||p_bank_checked::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('pos:'||p_actor::text));
 select * into o from public.pos_sales where cashier_id=p_actor and request_key=p_key;
 if found then if o.request_hash<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return o.id; end if;
 select * into s from public.pos_settings where id;
 if not s.enabled then raise exception 'POS_DISABLED'; end if;
 if jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart) not between 1 and 100 then raise exception 'INVALID_CART'; end if;
 if length(coalesce(p_customer->>'name',''))>80 or length(coalesce(p_customer->>'phone',''))>25 then raise exception 'INVALID_CUSTOMER'; end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_cart)x)<>jsonb_array_length(p_cart) then raise exception 'DUPLICATE_ITEM'; end if;
 for line in select (x->>'product_id')::uuid pid,(x->>'quantity')::numeric qty,x->'unit_ids' units from jsonb_array_elements(p_cart)x order by (x->>'product_id')::uuid loop
  if line.qty is null or line.qty<>trunc(line.qty) or line.qty not between 1 and 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into pr from public.products where id=line.pid for update;
  if not found or not private.product_visible(pr) then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if pr.price_paise<=0 then raise exception 'PRICE_NOT_SET'; end if;
  if pr.stock_on_hand-pr.reserved<line.qty then raise exception 'OUT_OF_STOCK'; end if;
  if line.units is not null and (jsonb_typeof(line.units)<>'array' or jsonb_array_length(line.units) not in (0,line.qty::int)) then raise exception 'BARCODE_QUANTITY_MISMATCH'; end if;
  if coalesce(jsonb_array_length(line.units),0)>0 and (select count(distinct u.id) from public.product_units u where u.product_id=pr.id and u.state='in_stock' and u.id in (select value::bigint from jsonb_array_elements_text(line.units)))<>line.qty then raise exception 'UNIT_UNAVAILABLE'; end if;
  unit:=private.product_price(pr);
  subtotal:=subtotal+unit::bigint*line.qty::int;
  items:=items||jsonb_build_array(jsonb_build_object('product_id',pr.id,'sku',pr.sku,'barcode',pr.barcode,'name',pr.name,'quantity',line.qty::int,'unit_paise',unit,'line_paise',unit::bigint*line.qty::int,'unit_ids',coalesce(line.units,'[]')));
 end loop;
 if p_discount>0 and length(trim(coalesce(p_customer->>'discount_reason','')))<3 then raise exception 'DISCOUNT_REASON_REQUIRED'; end if;
 if p_discount<0 or p_discount>floor(subtotal::numeric*s.max_discount_bps/10000) then raise exception 'DISCOUNT_LIMIT'; end if;
 tax:=round((subtotal-p_discount)::numeric*s.tax_bps/10000)::bigint; total:=subtotal-p_discount+tax;
 if total<=0 or total>2000000000 then raise exception 'INVALID_ORDER_TOTAL'; end if;
 if jsonb_typeof(p_tenders)<>'array' or jsonb_array_length(p_tenders) not between 1 and 3 then raise exception 'INVALID_TENDER'; end if;
 if (select count(distinct x->>'method') from jsonb_array_elements(p_tenders)x)<>jsonb_array_length(p_tenders) then raise exception 'INVALID_TENDER'; end if;
 for t in select * from jsonb_array_elements(p_tenders) loop
  if coalesce(t->>'method','') not in ('cash','upi','card') or coalesce(t->>'amount_paise','')!~'^[0-9]+$' or (t->>'amount_paise')::numeric not between 1 and 2000000000 then raise exception 'INVALID_TENDER'; end if;
  if t->>'method'<>'cash' and (not p_bank_checked or length(coalesce(t->>'reference','')) not between 6 and 100) then raise exception 'BANK_CHECK_REQUIRED'; end if;
  tender_total:=tender_total+(t->>'amount_paise')::bigint;
  if t->>'method'='cash' then cash:=cash+(t->>'amount_paise')::bigint; end if;
 end loop;
 if tender_total<>total or p_cash_received<cash or (cash=0 and p_cash_received<>0) then raise exception 'TENDER_MISMATCH'; end if;
 serial:=nextval(pg_get_serial_sequence('public.pos_sales','number')); inv:=s.invoice_prefix||'-'||lpad(serial::text,6,'0');
 insert into public.pos_sales(id,number,cashier_id,request_key,request_hash,invoice_no,customer_name,customer_phone,business,items,tenders,subtotal_paise,discount_paise,tax_paise,total_paise,cash_received_paise,change_paise)
 overriding system value values(key,serial,p_actor,p_key,fingerprint,inv,coalesce(p_customer->>'name',''),coalesce(p_customer->>'phone',''),to_jsonb(s)-'enabled'-'max_discount_bps',items,p_tenders,subtotal,p_discount,tax,total,p_cash_received,p_cash_received-cash);
 perform set_config('store.sale_id',key::text,true); perform set_config('store.order_id','',true); perform set_config('store.purchase_id','',true);
 for line in select * from jsonb_to_recordset(items) as x(product_id uuid,quantity int,unit_ids jsonb) order by product_id loop
  perform set_config('store.unit_ids',line.unit_ids::text,true);
  update public.products set stock_on_hand=stock_on_hand-line.quantity,updated_at=now() where id=line.product_id;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.product_id,p_actor,-line.quantity,'POS sale '||inv);
 end loop;
 update public.pos_sales set discount_reason=coalesce(p_customer->>'discount_reason',''),pricing_snapshot=jsonb_build_object('catalogue_prices',pos_sales.items,'walkin_discount_paise',p_discount,'max_discount_bps',s.max_discount_bps) where id=key;
 perform private.audit(p_actor,'pos.completed','pos_sales',key::text,jsonb_build_object('invoice',inv,'total_paise',total)); return key;
end $$;

create or replace function public.pos_return(p_actor uuid,p_sale uuid,p_reason text,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.pos_sales; line record;
begin
 if not private.can_actor(p_actor,'pos') or not private.can_actor(p_actor,'inventory') then raise exception 'FORBIDDEN'; end if;
 select * into o from public.pos_sales where id=p_sale for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if o.status='returned' then return; end if;
 if length(trim(p_reason)) not between 3 and 500 or length(trim(p_reference)) not between 6 and 100 then raise exception 'RETURN_DETAILS_REQUIRED'; end if;
 perform set_config('store.sale_id',p_sale::text,true); perform set_config('store.order_id','',true); perform set_config('store.purchase_id','',true); perform set_config('store.unit_ids','[]',true);
 for line in select * from jsonb_to_recordset(o.items)as x(product_id uuid,quantity int) order by product_id loop
  perform 1 from public.products where id=line.product_id for update;
  update public.products set stock_on_hand=stock_on_hand+line.quantity,updated_at=now() where id=line.product_id;
  insert into public.inventory_movements(product_id,actor_id,delta,reason) values(line.product_id,p_actor,line.quantity,'POS full return '||o.invoice_no);
 end loop;
 update public.pos_sales set status='returned',returned_by=p_actor,return_note=p_reason,refund_reference=p_reference,returned_at=now() where id=p_sale;
 perform private.audit(p_actor,'pos.returned','pos_sales',p_sale::text,jsonb_build_object('reason',p_reason,'reference',p_reference));
end $$;

create or replace function public.admin_save(p_actor uuid,p_entity text,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cap text; key uuid:=coalesce(p_id,gen_random_uuid()); oldrow jsonb; stmt text; col text; vals text:=''; cols text:=''; allowed text[];
begin
 cap:=case p_entity when 'products' then 'catalogue' when 'banners' then 'content' when 'offers' then 'offers' when 'tracking_providers' then 'shipping' when 'bulk_inquiries' then 'bulk' when 'store_settings' then '__super' else null end;
 if cap is null or not private.can_actor(p_actor,cap) then raise exception 'FORBIDDEN'; end if;
 allowed:=case p_entity
 when 'products' then array['barcode','subcategory_id','sku','slug','name','category','colour','description','image_path','price_paise','discount_percent','published','archived','featured']
 when 'banners' then array['title','subtitle','image_path','button_label','link_path','position','sort_order','published','starts_at','ends_at']
 when 'offers' then array['title','code','kind','value','min_subtotal_paise','max_discount_paise','max_uses','per_customer_limit','active','starts_at','ends_at']
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
end $$;


-- === 202611170007_attendance_payroll.sql ===
alter table public.payroll_runs add column monthly_allowances jsonb not null default '[]';
alter table public.payroll_runs add column monthly_deductions jsonb not null default '[]';
create function private.validate_salary_policy(d jsonb) returns void language plpgsql immutable set search_path='' as $$
declare a jsonb; b jsonb; previous_to numeric:=0;
begin
 if jsonb_typeof(d->'work_weekdays')<>'array' or jsonb_array_length(d->'work_weekdays') not between 1 and 7 or exists(select 1 from jsonb_array_elements_text(d->'work_weekdays')x where x::int not between 0 and 6) or (select count(distinct value) from jsonb_array_elements_text(d->'work_weekdays'))<>jsonb_array_length(d->'work_weekdays') then raise exception 'INVALID_WORK_WEEK'; end if;
 if mod((d->>'paid_leave_units')::numeric,0.5)<>0 or jsonb_typeof(d->'leave_tiers')<>'array' or jsonb_array_length(d->'leave_tiers')>62 then raise exception 'INVALID_LEAVE_TIERS'; end if;
 for a in select value from jsonb_array_elements(d->'leave_tiers') order by (value->>'from_unit')::numeric loop
  if (a->>'from_unit')::numeric<0.5 or (a->>'to_unit')::numeric>31 or (a->>'from_unit')::numeric>(a->>'to_unit')::numeric or (a->>'from_unit')::numeric<=previous_to or mod((a->>'from_unit')::numeric,0.5)<>0 or mod((a->>'to_unit')::numeric,0.5)<>0 or (a->>'lop_bps')::int not between 0 and 10000 then raise exception 'INVALID_LEAVE_TIERS'; end if;
  previous_to:=(a->>'to_unit')::numeric;
 end loop;
end $$;
create or replace function public.save_employee(p_actor uuid,p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare key uuid:=coalesce(p_id,gen_random_uuid()); old public.employees;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020); perform private.pay_components(p_data->'allowances'); perform private.pay_components(p_data->'deductions');
 if (p_data->>'ended_on')::date<(p_data->>'joined_on')::date or not exists(select 1 from public.salary_policies where id=(p_data->>'policy_id')::uuid and active) then raise exception 'INVALID_EMPLOYMENT'; end if;
 select * into old from public.employees where id=key for update;
 insert into public.employees(id,code,name,employment,pay_basis,rate_paise,scheduled_units,overtime_rate_paise,allowances,deductions,active,phone,joined_on,ended_on,daily_minutes,policy_id)
 select key,x.code,x.name,x.employment,x.pay_basis,x.rate_paise,x.scheduled_units,x.overtime_rate_paise,x.allowances,x.deductions,x.active,x.phone,x.joined_on,x.ended_on,x.daily_minutes,x.policy_id from jsonb_populate_record(null::public.employees,p_data)x
 on conflict(id)do update set code=excluded.code,name=excluded.name,employment=excluded.employment,pay_basis=excluded.pay_basis,rate_paise=excluded.rate_paise,scheduled_units=excluded.scheduled_units,overtime_rate_paise=excluded.overtime_rate_paise,allowances=excluded.allowances,deductions=excluded.deductions,active=excluded.active,phone=excluded.phone,joined_on=excluded.joined_on,ended_on=excluded.ended_on,daily_minutes=excluded.daily_minutes,policy_id=excluded.policy_id,updated_at=now();
 perform private.audit(p_actor,'employee.saved','employees',key::text); return key;
end $$;
create function public.employee_link(p_actor uuid,p_employee uuid,p_profile uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);
 perform 1 from public.employees where id=p_employee and active for update;
 if not found or not exists(select 1 from public.profiles where id=p_profile and role::text in ('billing','manager')) then raise exception 'INVALID_EMPLOYEE_LOGIN'; end if;
 if exists(select 1 from public.employees where id=p_employee and profile_id is not null and profile_id<>p_profile) then raise exception 'LOGIN_ALREADY_LINKED'; end if;
 update public.employees set profile_id=p_profile where id=p_employee;
 update public.profiles set permissions=case when role::text='billing' then array['pos'] else permissions end where id=p_profile;
 perform private.audit(p_actor,'employee.login_linked','employees',p_employee::text,jsonb_build_object('profile_id',p_profile));
end $$;
create function public.attendance_save(p_actor uuid,p_employee uuid,p_on date,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e public.employees; month_start date:=date_trunc('month',p_on)::date; worked int; permission int; overtime int;
begin
 if not private.can_actor(p_actor,'attendance') then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext('payroll:'||p_employee::text||month_start::text));
 if exists(select 1 from public.payroll_runs where employee_id=p_employee and payroll_runs.period=month_start and status<>'draft') then raise exception 'PAYROLL_LOCKED'; end if;
 select * into e from public.employees where id=p_employee for share;
 if not found or p_on<e.joined_on or (e.ended_on is not null and p_on>e.ended_on) or p_on>(now() at time zone 'Asia/Kolkata')::date then raise exception 'INVALID_ATTENDANCE_DATE'; end if;
 permission:=case when p_data->>'status'='permission' then (p_data->>'permission_minutes')::int else 0 end;
 overtime:=(p_data->>'overtime_minutes')::int;
 worked:=case p_data->>'status' when 'full_day' then (p_data->>'worked_minutes')::int when 'half_day' then (p_data->>'worked_minutes')::int when 'permission' then e.daily_minutes-permission else 0 end;
 if worked<0 or worked>e.daily_minutes or permission>e.daily_minutes or (p_data->>'status'='permission' and permission<=0) or (p_data->>'status'='half_day' and worked>e.daily_minutes/2) or (p_data->>'status' not in ('full_day','half_day','permission') and overtime<>0) then raise exception 'INVALID_ATTENDANCE_UNITS'; end if;
 insert into public.attendance(employee_id,work_on,status,leave_units,permission_minutes,worked_minutes,overtime_minutes,note,marked_by)
 values(p_employee,p_on,p_data->>'status',(p_data->>'leave_units')::numeric,permission,worked,overtime,coalesce(p_data->>'note',''),p_actor)
 on conflict(employee_id,work_on)do update set status=excluded.status,leave_units=excluded.leave_units,permission_minutes=excluded.permission_minutes,worked_minutes=excluded.worked_minutes,overtime_minutes=excluded.overtime_minutes,note=excluded.note,marked_by=excluded.marked_by,updated_at=now();
 perform private.audit(p_actor,'attendance.saved','employees',p_employee::text,jsonb_build_object('date',p_on,'status',p_data->>'status'));
end $$;
create function private.payroll_calculation(p_employee uuid,p_period date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.employees; pol public.salary_policies; day date; last_day date; a public.attendance; days jsonb:='[]'; expected boolean; active_day boolean;
 divisor numeric:=0; eligible numeric:=0; paid numeric:=0; lost numeric:=0; paid_minutes numeric:=0; expected_minutes numeric:=0; ot_minutes numeric:=0;
 permission_used int:=0; excess int; quota int; day_paid numeric; day_lop numeric; leave_ordinal numeric:=0; total_leaves numeric:=0; half numeric; rate int; tier jsonb; base bigint; lop bigint; ot bigint;
begin
 if extract(day from p_period)<>1 then raise exception 'PERIOD_MUST_START_ON_FIRST'; end if;
 last_day:=(p_period+interval '1 month -1 day')::date;
 if last_day>=(now() at time zone 'Asia/Kolkata')::date then raise exception 'PAYROLL_MONTH_NOT_CLOSED'; end if;
 select * into e from public.employees where id=p_employee;
 if not found or e.joined_on>last_day or (e.ended_on is not null and e.ended_on<p_period) then raise exception 'NO_EMPLOYMENT_IN_PERIOD'; end if;
 select * into pol from public.salary_policies where id=e.policy_id;
 if not found then raise exception 'SALARY_POLICY_REQUIRED'; end if;
 select coalesce(sum(leave_units),0) into total_leaves from public.attendance where employee_id=p_employee and work_on between greatest(p_period,e.joined_on) and least(last_day,coalesce(e.ended_on,last_day)) and status='leave';
 for day in select generate_series(p_period,last_day,interval '1 day')::date loop
  expected:=extract(dow from day)::int=any(pol.work_weekdays);
  if (pol.divisor_mode='calendar' or expected) then divisor:=divisor+1; end if;
  active_day:=day>=e.joined_on and (e.ended_on is null or day<=e.ended_on);
  if not active_day then continue; end if;
  select * into a from public.attendance where employee_id=p_employee and work_on=day;
  if not found then
   if expected then raise exception 'MISSING_ATTENDANCE: %',day; end if;
   a.status:='weekly_off';a.worked_minutes:=0;a.overtime_minutes:=0;
  end if;
  if not expected and pol.divisor_mode='scheduled' then
   -- Work on a weekly off is paid through explicitly marked overtime, avoiding a second base day.
   ot_minutes:=ot_minutes+coalesce(a.overtime_minutes,0);
   days:=days||jsonb_build_array(jsonb_build_object('date',day,'status',a.status,'paid_units',0,'lop_units',0,'overtime_minutes',coalesce(a.overtime_minutes,0))); continue;
  end if;
  eligible:=eligible+1;expected_minutes:=expected_minutes+e.daily_minutes;day_paid:=1;day_lop:=0;
  case a.status
   when 'full_day' then if e.pay_basis='hourly' then day_paid:=a.worked_minutes::numeric/e.daily_minutes; end if;
   when 'half_day' then day_paid:=case when e.pay_basis='hourly' then a.worked_minutes::numeric/e.daily_minutes else pol.half_day_pay_bps::numeric/10000 end;
   when 'absent' then day_paid:=0;
   when 'weekly_off' then day_paid:=case when e.pay_basis='monthly' then 1 else 0 end;
   when 'holiday' then day_paid:=case when pol.holiday_paid then 1 else 0 end;
   when 'permission' then
    quota:=greatest(0,pol.paid_permission_minutes-permission_used);excess:=greatest(0,a.permission_minutes-quota);permission_used:=permission_used+a.permission_minutes;
    day_paid:=case when excess=0 then 1 when pol.permission_lop='half_day' then .5 when pol.permission_lop='full_day' then 0 else 1-excess::numeric/e.daily_minutes end;
   when 'leave' then
    day_paid:=1;
    for half in select generate_series(0.5,a.leave_units,0.5) loop
     leave_ordinal:=leave_ordinal+.5;rate:=pol.default_leave_lop_bps;
     if leave_ordinal<=pol.paid_leave_units then rate:=0;
     else
      select value into tier from jsonb_array_elements(pol.leave_tiers) where (case when pol.leave_rule_mode='monthly_total' then total_leaves else leave_ordinal end) between (value->>'from_unit')::numeric and (value->>'to_unit')::numeric limit 1;
      if found then rate:=(tier->>'lop_bps')::int; end if;
     end if;
     day_paid:=day_paid-.5*rate/10000;
    end loop;
   else raise exception 'INVALID_ATTENDANCE_STATUS';
  end case;
  day_lop:=1-day_paid;paid:=paid+day_paid;lost:=lost+day_lop;paid_minutes:=paid_minutes+day_paid*e.daily_minutes;ot_minutes:=ot_minutes+coalesce(a.overtime_minutes,0);
  days:=days||jsonb_build_array(jsonb_build_object('date',day,'status',a.status,'paid_units',round(day_paid,6),'lop_units',round(day_lop,6),'permission_minutes',coalesce(a.permission_minutes,0),'overtime_minutes',coalesce(a.overtime_minutes,0),'note',coalesce(a.note,'')));
 end loop;
 if divisor<=0 then raise exception 'INVALID_SALARY_DIVISOR'; end if;
 base:=case e.pay_basis when 'monthly' then round(e.rate_paise::numeric*eligible/divisor)::bigint when 'daily' then round(e.rate_paise::numeric*eligible)::bigint else round(e.rate_paise::numeric*expected_minutes/60)::bigint end;
 lop:=case e.pay_basis when 'monthly' then round(e.rate_paise::numeric*lost/divisor)::bigint when 'daily' then round(e.rate_paise::numeric*lost)::bigint else round(e.rate_paise::numeric*(expected_minutes-paid_minutes)/60)::bigint end;
 ot:=round(e.overtime_rate_paise::numeric*ot_minutes/60)::bigint;
 return jsonb_build_object('employee',to_jsonb(e),'policy',to_jsonb(pol),'period',p_period,'period_divisor',divisor,'eligible_units',eligible,'paid_units',round(paid,6),'lop_units',round(lost,6),'overtime_hours',round(ot_minutes/60,6),'base_paise',base,'lop_paise',lop,'earned_base_paise',base-lop,'overtime_paise',ot,'days',days);
end $$;
create function public.payroll_preview(p_actor uuid,p_employee uuid,p_period date) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);return private.payroll_calculation(p_employee,p_period);end $$;
create function public.payroll_from_attendance(p_actor uuid,p_employee uuid,p_period date,p_bonus bigint,p_allowances jsonb,p_deductions jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare calc jsonb; e public.employees; old public.payroll_runs; key uuid; allowance bigint; deduction bigint; gross bigint; extras_a jsonb; extras_d jsonb;
begin
 perform private.require_super(p_actor);perform pg_advisory_xact_lock(761117020);perform pg_advisory_xact_lock(hashtext('payroll:'||p_employee::text||p_period::text));
 select * into e from public.employees where id=p_employee for share;
 select * into old from public.payroll_runs where employee_id=p_employee and period=p_period for update;
 if found and old.status<>'draft' then raise exception 'PAYROLL_LOCKED'; end if;
 if p_bonus not between 0 and 100000000 then raise exception 'INVALID_BONUS'; end if;
 calc:=private.payroll_calculation(p_employee,p_period);
 extras_a:=e.allowances||p_allowances; extras_d:=e.deductions||p_deductions;
 allowance:=private.pay_components(extras_a)+p_bonus;deduction:=private.pay_components(extras_d);
 gross:=(calc->>'earned_base_paise')::bigint+(calc->>'overtime_paise')::bigint+allowance;
 if deduction>gross or gross>2000000000 then raise exception 'INVALID_NET_PAY'; end if;
 key:=coalesce(old.id,gen_random_uuid());
 insert into public.payroll_runs(id,employee_id,period,employee_snapshot,worked_units,overtime_units,allowances,deductions,base_paise,overtime_paise,allowance_paise,deduction_paise,gross_paise,net_paise,created_by,calculation,calculation_hash,bonus_paise)
 values(key,e.id,p_period,to_jsonb(e),(calc->>'paid_units')::numeric,(calc->>'overtime_hours')::numeric,extras_a,extras_d,(calc->>'earned_base_paise')::bigint,(calc->>'overtime_paise')::bigint,allowance,deduction,gross,gross-deduction,p_actor,calc,encode(sha256(convert_to(calc::text,'UTF8')),'hex'),p_bonus)
 on conflict(id)do update set employee_snapshot=excluded.employee_snapshot,worked_units=excluded.worked_units,overtime_units=excluded.overtime_units,allowances=excluded.allowances,deductions=excluded.deductions,base_paise=excluded.base_paise,overtime_paise=excluded.overtime_paise,allowance_paise=excluded.allowance_paise,deduction_paise=excluded.deduction_paise,gross_paise=excluded.gross_paise,net_paise=excluded.net_paise,calculation=excluded.calculation,calculation_hash=excluded.calculation_hash,bonus_paise=excluded.bonus_paise,updated_at=now();
 update public.payroll_runs set monthly_allowances=p_allowances,monthly_deductions=p_deductions where id=key;
 perform private.audit(p_actor,'payroll.drafted_from_attendance','payroll_runs',key::text);return key;
end $$;
create function public.payroll_finalize(p_actor uuid,p_run uuid,p_action text,p_reference text,p_method text,p_checked boolean) returns void language plpgsql security definer set search_path='' as $$
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
-- Older manual-worked-units payroll paths cannot bypass attendance or month locks.
revoke all on function public.payroll_draft(uuid,uuid,date,numeric,numeric,jsonb,jsonb),public.payroll_post(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated;
do $$ declare r record;begin for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('erp_save','purchase_save','purchase_status','purchase_receive','purchase_pay','purchase_balances','expense_post','expense_void','employee_link','attendance_save','payroll_preview','payroll_from_attendance','payroll_finalize') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature); execute format('grant execute on function %s to service_role',r.signature);end loop;end $$;


-- === 202611170008_erp_queries.sql ===
create function public.pos_quote(p_actor uuid,p_cart jsonb,p_discount bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.pos_settings;p public.products;x jsonb;items jsonb:='[]';subtotal bigint:=0;tax bigint;unit int;qty int;
begin
 if not private.can_actor(p_actor,'pos') then raise exception 'FORBIDDEN';end if;
 select * into s from public.pos_settings where id;if not s.enabled then raise exception 'POS_DISABLED';end if;
 if jsonb_typeof(p_cart)<>'array' or jsonb_array_length(p_cart) not between 1 and 100 or (select count(distinct value->>'product_id') from jsonb_array_elements(p_cart))<>jsonb_array_length(p_cart) then raise exception 'INVALID_CART';end if;
 for x in select * from jsonb_array_elements(p_cart) loop
  qty:=(x->>'quantity')::int;if qty not between 1 and 100 or qty is null then raise exception 'INVALID_QUANTITY';end if;
  select * into p from public.products where id=(x->>'product_id')::uuid;
  if not found or not private.product_visible(p) or p.price_paise<=0 then raise exception 'PRODUCT_UNAVAILABLE';end if;
  if p.stock_on_hand-p.reserved<qty then raise exception 'OUT_OF_STOCK';end if;
  if coalesce(jsonb_array_length(x->'unit_ids'),0)>0 and (jsonb_array_length(x->'unit_ids')<>qty or (select count(distinct u.id) from public.product_units u where u.product_id=p.id and u.state='in_stock' and u.id in (select value::bigint from jsonb_array_elements_text(x->'unit_ids')))<>qty) then raise exception 'UNIT_UNAVAILABLE';end if;
  unit:=private.product_price(p);subtotal:=subtotal+unit::bigint*qty;
  items:=items||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'sku',p.sku,'quantity',qty,'unit_paise',unit,'line_paise',unit::bigint*qty));
 end loop;
 if p_discount<0 or p_discount>floor(subtotal::numeric*s.max_discount_bps/10000) then raise exception 'DISCOUNT_LIMIT';end if;
 tax:=round((subtotal-p_discount)::numeric*s.tax_bps/10000)::bigint;
 return jsonb_build_object('items',items,'subtotal_paise',subtotal,'discount_paise',p_discount,'tax_paise',tax,'total_paise',subtotal-p_discount+tax,'max_discount_paise',floor(subtotal::numeric*s.max_discount_bps/10000));
end $$;
create function public.labels_printed(p_actor uuid,p_ids bigint[]) returns void language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if not private.can_actor(p_actor,'inventory') then raise exception 'FORBIDDEN';end if;
 if cardinality(p_ids) not between 1 and 500 then raise exception 'LABEL_BATCH_LIMIT';end if;
 update public.product_units set printed_at=now() where id=any(p_ids) and state='in_stock';get diagnostics n=row_count;
 if n<>cardinality(p_ids) then raise exception 'PRINT_STOCK_CHANGED';end if;
 perform private.audit(p_actor,'labels.print_requested','product_units',null,jsonb_build_object('count',n));
end $$;
create function public.erp_report(p_actor uuid,p_from date,p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;super boolean;
begin
 if not private.can_actor(p_actor,'reports') then raise exception 'FORBIDDEN';end if;
 if p_to<p_from or p_to-p_from>366 then raise exception 'REPORT_DATE_RANGE';end if;
 select role::text='superadmin' into super from public.profiles where id=p_actor;
 select jsonb_build_object(
 'pos_gross_paise',coalesce((select sum(total_paise) from public.pos_sales where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),0),
 'pos_returns_paise',coalesce((select sum(total_paise) from public.pos_sales where status='returned' and (returned_at at time zone 'Asia/Kolkata')::date between p_from and p_to),0),
 'pos_bills',coalesce((select count(*) from public.pos_sales where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),0),
 'pos_walkin_discount_paise',coalesce((select sum(discount_paise) from public.pos_sales where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),0),
 'pos_tenders',coalesce((select jsonb_object_agg(method,amount) from (select t->>'method' method,sum((t->>'amount_paise')::bigint) amount from public.pos_sales s cross join lateral jsonb_array_elements(s.tenders)t where (s.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by t->>'method')q),'{}'),
 'online_currently_paid_paise',coalesce((select sum(total_paise) from public.orders where payment_status='paid' and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),0),
 'expenses_paise',case when private.can_actor(p_actor,'expenses') then coalesce((select sum(amount_paise) from public.expenses where status='posted' and expense_on between p_from and p_to and (source='manual' or super)),0) else null end,
 'purchase_outstanding_paise',case when private.can_actor(p_actor,'purchases') then coalesce((select sum(greatest(0,private.purchase_due(id))) from public.purchases),0) else null end,
 'stock_units',case when private.can_actor(p_actor,'inventory') then (select coalesce(sum(stock_on_hand),0) from public.products) else null end,
 'reserved_units',case when private.can_actor(p_actor,'inventory') then (select coalesce(sum(reserved),0) from public.products) else null end,
 'from',p_from,'to',p_to
 ) into result;return result;
end $$;
revoke all on function public.pos_quote(uuid,jsonb,bigint),public.labels_printed(uuid,bigint[]),public.erp_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.pos_quote(uuid,jsonb,bigint),public.labels_printed(uuid,bigint[]),public.erp_report(uuid,date,date) to service_role;


-- === 202611170009_admin_erp_system.sql ===
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


-- === 202611180010_subcategory_images.sql ===
-- Add image_path to product_categories for Main Category & Subcategory thumbnails
alter table public.product_categories
  add column if not exists image_path text not null default '';

-- === 202611200012_offer_targets.sql ===
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

-- === 202611230013_discounts_banners.sql ===
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
