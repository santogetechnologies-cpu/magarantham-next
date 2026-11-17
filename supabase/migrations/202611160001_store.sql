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
 check(kind<>'percent' or value<=90), check(ends_at is null or starts_at is null or ends_at>starts_at),
 check(code is null or code=upper(code))
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
